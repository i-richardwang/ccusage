/**
 * @fileoverview Sync Amp thread data from the server using the Amp CLI.
 *
 * Since ~April 2026, Amp no longer writes thread JSON files locally.
 * This module uses `amp threads list` and `amp threads export` to fetch
 * thread data from the server and cache it locally for usage analysis.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Result } from '@praha/byethrow';
import spawn from 'nano-spawn';
import { isDirectorySync } from 'path-type';
import { AMP_THREADS_DIR_NAME, DEFAULT_AMP_DIR } from './_consts.ts';
import { getAmpPath } from './data-loader.ts';
import { logger } from './logger.ts';

/**
 * Manifest storing sync metadata for each thread
 */
type SyncManifest = {
	version: 1;
	threads: Record<
		string,
		{
			syncedAt: string;
			updatedAt?: string;
			v?: number;
			messageCount?: number;
		}
	>;
};

/**
 * Get the manifest file path (stored outside threads/ to avoid being parsed as a thread)
 */
function getManifestPath(ampDir: string): string {
	return path.join(ampDir, 'ccusage', 'sync-manifest.json');
}

/**
 * Load sync manifest from disk
 */
async function loadManifest(ampDir: string): Promise<SyncManifest> {
	const manifestPath = getManifestPath(ampDir);
	const readResult = await Result.try({
		try: readFile(manifestPath, 'utf-8'),
		catch: (error) => error,
	});

	if (Result.isFailure(readResult)) {
		return { version: 1, threads: {} };
	}

	const parseResult = Result.try({
		try: () => JSON.parse(readResult.value) as SyncManifest,
		catch: (error) => error,
	})();

	if (Result.isFailure(parseResult)) {
		return { version: 1, threads: {} };
	}

	return parseResult.value;
}

/**
 * Save sync manifest to disk
 */
async function saveManifest(ampDir: string, manifest: SyncManifest): Promise<void> {
	const manifestPath = getManifestPath(ampDir);
	const manifestDir = path.dirname(manifestPath);
	await mkdir(manifestDir, { recursive: true });
	await writeFile(manifestPath, JSON.stringify(manifest, null, '\t'));
}

/**
 * Thread info parsed from `amp threads list` output
 */
type RemoteThreadInfo = {
	id: string;
	messageCount: number;
};

/**
 * Pattern to extract message count and thread ID from a single list row.
 * The Messages column value (a number) appears right before the Thread ID column.
 */
const LIST_ROW_RE = /(\d+)\s+(T-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/**
 * Get thread info (ID + message count) from `amp threads list`
 */
async function listRemoteThreads(): Promise<RemoteThreadInfo[]> {
	const result = await spawn('amp', ['threads', 'list', '--no-color', '--no-notifications']);
	const output = result.stdout;
	const seen = new Set<string>();
	const threads: RemoteThreadInfo[] = [];
	for (const match of output.matchAll(LIST_ROW_RE)) {
		const id = match[2]!;
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		threads.push({ id, messageCount: Number(match[1]) });
	}
	return threads;
}

/**
 * Export a single thread from the server
 */
async function exportThread(threadId: string): Promise<string | null> {
	const exportResult = await Result.try({
		try: spawn('amp', ['threads', 'export', threadId, '--no-notifications']).then((r) => r.stdout),
		catch: (error) => error,
	});

	if (Result.isFailure(exportResult)) {
		logger.debug('Failed to export thread', { threadId, error: exportResult.error });
		return null;
	}

	return exportResult.value;
}

/**
 * Extract updatedAt and v from thread JSON string without full parsing
 */
function extractThreadMeta(json: string): { updatedAt?: string; v?: number } {
	const updatedAtMatch = /"updatedAt"\s*:\s*"([^"]+)"/.exec(json);
	const vMatch = /"v"\s*:\s*(\d+)/.exec(json);
	return {
		updatedAt: updatedAtMatch?.[1],
		v: vMatch != null ? Number(vMatch[1]) : undefined,
	};
}

export type SyncOptions = {
	/** Re-export all threads regardless of cache state */
	force?: boolean;
	/** Suppress console output (used when called from report commands) */
	silent?: boolean;
};

export type SyncResult = {
	synced: number;
	skipped: number;
	failed: number;
	total: number;
};

/**
 * Sync thread data from the Amp server to local cache.
 *
 * - Fetches thread list via `amp threads list`
 * - For each thread not in the manifest (or when --force), exports via `amp threads export`
 * - Writes exported JSON to the standard threads/ directory
 * - Updates sync manifest
 */
export async function syncThreads(options: SyncOptions = {}): Promise<SyncResult> {
	const ampDir = getAmpPath() ?? DEFAULT_AMP_DIR;
	const threadsDir = path.join(ampDir, AMP_THREADS_DIR_NAME);

	// Ensure threads directory exists
	if (!isDirectorySync(threadsDir)) {
		await mkdir(threadsDir, { recursive: true });
	}

	// Load manifest
	const manifest = await loadManifest(ampDir);

	// Get remote thread info (ID + message count)
	const remoteThreads = await listRemoteThreads();

	const result: SyncResult = {
		synced: 0,
		skipped: 0,
		failed: 0,
		total: remoteThreads.length,
	};

	for (const remote of remoteThreads) {
		const existing = manifest.threads[remote.id];

		// Skip if already synced and not forcing
		if (existing != null && options.force !== true) {
			// If we have a stored messageCount, compare with remote to detect changes
			if (existing.messageCount != null && existing.messageCount === remote.messageCount) {
				result.skipped++;
				continue;
			}
			// If no stored messageCount (legacy manifest entry), skip since the thread
			// file already exists locally — it will be re-synced on the next change
			if (existing.messageCount == null) {
				// Backfill messageCount for future incremental checks
				existing.messageCount = remote.messageCount;
				result.skipped++;
				continue;
			}
			logger.debug('Thread changed, re-syncing', {
				threadId: remote.id,
				oldMessageCount: existing.messageCount,
				newMessageCount: remote.messageCount,
			});
		}

		const json = await exportThread(remote.id);
		if (json == null) {
			result.failed++;
			continue;
		}

		// Validate JSON is parseable and has expected id
		const validateResult = Result.try({
			try: () => {
				const parsed = JSON.parse(json) as { id?: string };
				if (parsed.id !== remote.id) {
					throw new Error(`Thread ID mismatch: expected ${remote.id}, got ${parsed.id}`);
				}
			},
			catch: (error) => error,
		})();

		if (Result.isFailure(validateResult)) {
			logger.debug('Invalid exported thread JSON', {
				threadId: remote.id,
				error: validateResult.error,
			});
			result.failed++;
			continue;
		}

		// Atomic write: write to temp file, then rename
		const filePath = path.join(threadsDir, `${remote.id}.json`);
		const tmpPath = `${filePath}.tmp`;
		await writeFile(tmpPath, json);
		await rename(tmpPath, filePath);

		// Update manifest
		const meta = extractThreadMeta(json);
		manifest.threads[remote.id] = {
			syncedAt: new Date().toISOString(),
			updatedAt: meta.updatedAt,
			v: meta.v,
			messageCount: remote.messageCount,
		};

		result.synced++;
	}

	// Save manifest
	await saveManifest(ampDir, manifest);

	return result;
}

/**
 * Register existing local thread files in the manifest
 * (one-time migration for threads that were saved before the sync mechanism)
 */
export async function migrateExistingThreadsToManifest(): Promise<number> {
	const ampDir = getAmpPath() ?? DEFAULT_AMP_DIR;
	const threadsDir = path.join(ampDir, AMP_THREADS_DIR_NAME);

	if (!isDirectorySync(threadsDir)) {
		return 0;
	}

	const manifest = await loadManifest(ampDir);
	let migrated = 0;

	const { glob } = await import('tinyglobby');
	const files = await glob('*.json', { cwd: threadsDir, absolute: true });

	for (const file of files) {
		const basename = path.basename(file, '.json');
		if (manifest.threads[basename] != null) {
			continue;
		}

		const readResult = await Result.try({
			try: readFile(file, 'utf-8'),
			catch: (error) => error,
		});

		if (Result.isFailure(readResult)) {
			continue;
		}

		const meta = extractThreadMeta(readResult.value);
		manifest.threads[basename] = {
			syncedAt: new Date().toISOString(),
			updatedAt: meta.updatedAt,
			v: meta.v,
		};
		migrated++;
	}

	if (migrated > 0) {
		await saveManifest(ampDir, manifest);
	}

	return migrated;
}
