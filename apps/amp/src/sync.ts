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
 * Thread ID pattern: T-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
const THREAD_ID_RE = /T-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

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
 * Get thread IDs from `amp threads list`
 */
async function listRemoteThreadIds(): Promise<string[]> {
	const result = await spawn('amp', ['threads', 'list', '--no-color', '--no-notifications']);
	const output = result.stdout;
	const ids = new Set<string>();
	for (const match of output.matchAll(THREAD_ID_RE)) {
		ids.add(match[0]);
	}
	return [...ids];
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

	// Get remote thread IDs
	const remoteIds = await listRemoteThreadIds();

	const result: SyncResult = {
		synced: 0,
		skipped: 0,
		failed: 0,
		total: remoteIds.length,
	};

	for (const threadId of remoteIds) {
		const existing = manifest.threads[threadId];

		// Skip if already synced and not forcing
		if (existing != null && options.force !== true) {
			result.skipped++;
			continue;
		}

		const json = await exportThread(threadId);
		if (json == null) {
			result.failed++;
			continue;
		}

		// Validate JSON is parseable and has expected id
		const validateResult = Result.try({
			try: () => {
				const parsed = JSON.parse(json) as { id?: string };
				if (parsed.id !== threadId) {
					throw new Error(`Thread ID mismatch: expected ${threadId}, got ${parsed.id}`);
				}
			},
			catch: (error) => error,
		})();

		if (Result.isFailure(validateResult)) {
			logger.debug('Invalid exported thread JSON', { threadId, error: validateResult.error });
			result.failed++;
			continue;
		}

		// Atomic write: write to temp file, then rename
		const filePath = path.join(threadsDir, `${threadId}.json`);
		const tmpPath = `${filePath}.tmp`;
		await writeFile(tmpPath, json);
		await rename(tmpPath, filePath);

		// Update manifest
		const meta = extractThreadMeta(json);
		manifest.threads[threadId] = {
			syncedAt: new Date().toISOString(),
			updatedAt: meta.updatedAt,
			v: meta.v,
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
