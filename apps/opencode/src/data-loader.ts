/**
 * @fileoverview Data loading utilities for OpenCode usage analysis
 *
 * This module provides functions for loading and parsing OpenCode usage data
 * from the SQLite database (opencode.db) in the OpenCode data directory.
 * OpenCode stores its database at ~/.local/share/opencode/opencode.db
 *
 * @module data-loader
 */

import type { SqliteDatabase } from './_sqlite.ts';
import path from 'node:path';
import process from 'node:process';
import { isDirectorySync, isFileSync } from 'path-type';
import * as v from 'valibot';
import { openSqlite } from './_sqlite.ts';

/**
 * Default OpenCode data directory path (~/.local/share/opencode)
 */
const DEFAULT_OPENCODE_PATH = '.local/share/opencode';

/**
 * OpenCode SQLite database filename
 */
const OPENCODE_DB_FILENAME = 'opencode.db';

/**
 * Environment variable for specifying custom OpenCode data directory
 */
const OPENCODE_CONFIG_DIR_ENV = 'OPENCODE_DATA_DIR';

/**
 * User home directory
 */
const USER_HOME_DIR = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();

/**
 * Valibot schema for tokens stored in assistant message JSON data
 */
const assistantTokensSchema = v.object({
	input: v.number(),
	output: v.number(),
	reasoning: v.optional(v.number(), 0),
	total: v.optional(v.number()),
	cache: v.object({
		read: v.number(),
		write: v.number(),
	}),
});

/**
 * Valibot schema for assistant message data extracted from the `data` JSON column.
 * Only assistant messages contain token usage and cost information.
 */
const assistantMessageDataSchema = v.object({
	role: v.literal('assistant'),
	modelID: v.string(),
	providerID: v.string(),
	time: v.object({
		created: v.number(),
		completed: v.optional(v.number()),
	}),
	cost: v.number(),
	tokens: assistantTokensSchema,
});

/**
 * Raw row shape returned by the message query
 */
type MessageRow = {
	id: string;
	session_id: string;
	time_created: number;
	data: string;
};

/**
 * Raw row shape returned by the session query
 */
type SessionRow = {
	id: string;
	parent_id: string | null;
	title: string;
	project_id: string;
	directory: string;
};

/**
 * Represents a single usage data entry loaded from the OpenCode database
 */
export type LoadedUsageEntry = {
	timestamp: Date;
	sessionID: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheCreationInputTokens: number;
		cacheReadInputTokens: number;
	};
	model: string;
	costUSD: number | null;
};

export type LoadedSessionMetadata = {
	id: string;
	parentID: string | null;
	title: string;
	projectID: string;
	directory: string;
};

/**
 * Get OpenCode data directory
 * @returns Path to OpenCode data directory, or null if not found
 */
export function getOpenCodePath(): string | null {
	// Check environment variable first
	const envPath = process.env[OPENCODE_CONFIG_DIR_ENV];
	if (envPath != null && envPath.trim() !== '') {
		const normalizedPath = path.resolve(envPath);
		if (isDirectorySync(normalizedPath)) {
			return normalizedPath;
		}
	}

	// Use default path
	const defaultPath = path.join(USER_HOME_DIR, DEFAULT_OPENCODE_PATH);
	if (isDirectorySync(defaultPath)) {
		return defaultPath;
	}

	return null;
}

/**
 * Get the path to the OpenCode SQLite database file
 * @returns Path to opencode.db, or null if not found
 */
function getOpenCodeDbPath(): string | null {
	const openCodePath = getOpenCodePath();
	if (openCodePath == null) {
		return null;
	}

	const dbPath = path.join(openCodePath, OPENCODE_DB_FILENAME);
	if (!isFileSync(dbPath)) {
		return null;
	}

	return dbPath;
}

/**
 * Open the OpenCode database in read-only mode
 * @returns Database instance, or null if the database file is not found
 */
function openDatabase(): SqliteDatabase | null {
	const dbPath = getOpenCodeDbPath();
	if (dbPath == null) {
		return null;
	}

	return openSqlite(dbPath);
}

/**
 * Convert a parsed assistant message row to LoadedUsageEntry
 */
function convertMessageToUsageEntry(
	row: MessageRow,
	data: v.InferOutput<typeof assistantMessageDataSchema>,
): LoadedUsageEntry {
	return {
		timestamp: new Date(data.time.created),
		sessionID: row.session_id,
		usage: {
			inputTokens: data.tokens.input,
			outputTokens: data.tokens.output,
			cacheCreationInputTokens: data.tokens.cache.write,
			cacheReadInputTokens: data.tokens.cache.read,
		},
		model: data.modelID,
		costUSD: data.cost > 0 ? data.cost : null,
	};
}

/**
 * Load all OpenCode session metadata from the database
 * @returns Map of session ID to metadata
 */
export function loadOpenCodeSessions(): Map<string, LoadedSessionMetadata> {
	const db = openDatabase();
	if (db == null) {
		return new Map();
	}

	try {
		const rows = db
			.prepare('SELECT id, parent_id, title, project_id, directory FROM session')
			.all() as SessionRow[];

		const sessionMap = new Map<string, LoadedSessionMetadata>();

		for (const row of rows) {
			sessionMap.set(row.id, {
				id: row.id,
				parentID: row.parent_id,
				title: row.title !== '' ? row.title : row.id,
				projectID: row.project_id,
				directory: row.directory,
			});
		}

		return sessionMap;
	} finally {
		db.close();
	}
}

/**
 * Load all OpenCode assistant messages with token usage from the database.
 * Only assistant messages are loaded since they contain cost and token data.
 * @returns Array of LoadedUsageEntry for aggregation
 */
export function loadOpenCodeMessages(): LoadedUsageEntry[] {
	const db = openDatabase();
	if (db == null) {
		return [];
	}

	try {
		// Use json_extract to filter assistant messages at the SQL level
		const rows = db
			.prepare(
				`SELECT id, session_id, time_created, data FROM message
			 WHERE json_extract(data, '$.role') = 'assistant'`,
			)
			.all() as MessageRow[];

		const entries: LoadedUsageEntry[] = [];

		for (const row of rows) {
			const parsed = v.safeParse(assistantMessageDataSchema, JSON.parse(row.data));
			if (!parsed.success) {
				continue;
			}

			const data = parsed.output;

			// Skip messages with zero tokens
			if (data.tokens.input === 0 && data.tokens.output === 0) {
				continue;
			}

			entries.push(convertMessageToUsageEntry(row, data));
		}

		return entries;
	} finally {
		db.close();
	}
}

if (import.meta.vitest != null) {
	const { describe, it, expect } = import.meta.vitest;

	describe('convertMessageToUsageEntry', () => {
		it('should convert a message row with assistant data to LoadedUsageEntry', () => {
			const row: MessageRow = {
				id: 'msg_123',
				session_id: 'ses_456',
				time_created: 1700000000000,
				data: '',
			};

			const data: v.InferOutput<typeof assistantMessageDataSchema> = {
				role: 'assistant' as const,
				modelID: 'anthropic/claude-sonnet-4-5',
				providerID: 'anthropic',
				time: { created: 1700000000000, completed: 1700000010000 },
				cost: 0.05,
				tokens: {
					input: 100,
					output: 200,
					reasoning: 0,
					cache: { read: 50, write: 25 },
				},
			};

			const entry = convertMessageToUsageEntry(row, data);

			expect(entry.sessionID).toBe('ses_456');
			expect(entry.usage.inputTokens).toBe(100);
			expect(entry.usage.outputTokens).toBe(200);
			expect(entry.usage.cacheReadInputTokens).toBe(50);
			expect(entry.usage.cacheCreationInputTokens).toBe(25);
			expect(entry.model).toBe('anthropic/claude-sonnet-4-5');
			expect(entry.costUSD).toBe(0.05);
		});

		it('should set costUSD to null when cost is zero', () => {
			const row: MessageRow = {
				id: 'msg_789',
				session_id: 'ses_012',
				time_created: 1700000000000,
				data: '',
			};

			const data: v.InferOutput<typeof assistantMessageDataSchema> = {
				role: 'assistant' as const,
				modelID: 'openai/gpt-5.1',
				providerID: 'openai',
				time: { created: 1700000000000 },
				cost: 0,
				tokens: {
					input: 50,
					output: 100,
					reasoning: 0,
					cache: { read: 0, write: 0 },
				},
			};

			const entry = convertMessageToUsageEntry(row, data);

			expect(entry.usage.inputTokens).toBe(50);
			expect(entry.usage.outputTokens).toBe(100);
			expect(entry.usage.cacheReadInputTokens).toBe(0);
			expect(entry.usage.cacheCreationInputTokens).toBe(0);
			expect(entry.costUSD).toBeNull();
		});
	});

	describe('assistantMessageDataSchema', () => {
		it('should parse valid assistant message data', () => {
			const data = {
				role: 'assistant',
				modelID: 'anthropic/claude-opus-4.6',
				providerID: 'zenmux',
				time: { created: 1770806241551, completed: 1770806307456 },
				cost: 0.16363825,
				tokens: {
					input: 1,
					output: 4157,
					reasoning: 0,
					cache: { read: 90579, write: 2307 },
				},
			};

			const result = v.safeParse(assistantMessageDataSchema, data);
			expect(result.success).toBe(true);
		});

		it('should reject user message data', () => {
			const data = {
				role: 'user',
				time: { created: 1770806197123 },
			};

			const result = v.safeParse(assistantMessageDataSchema, data);
			expect(result.success).toBe(false);
		});
	});
}
