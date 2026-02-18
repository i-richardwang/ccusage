/**
 * @fileoverview Runtime-agnostic SQLite adapter
 *
 * Provides a unified interface for SQLite access that works across
 * both Bun (bun:sqlite) and Node.js (node:sqlite) runtimes.
 *
 * @module _sqlite
 */

/**
 * Minimal interface for a prepared SQL statement
 */
type SqliteStatement = {
	all: () => unknown[];
};

/**
 * Minimal interface for a SQLite database connection
 */
export type SqliteDatabase = {
	prepare: (sql: string) => SqliteStatement;
	close: () => void;
};

/* eslint-disable ts/no-unsafe-member-access, ts/no-unsafe-call, ts/no-unsafe-assignment */

/**
 * Open a SQLite database in read-only mode.
 * Automatically detects the runtime and uses the appropriate built-in SQLite module.
 *
 * Uses `bun:sqlite` when running under Bun, `node:sqlite` otherwise.
 * Both modules are accessed via `require()` to avoid bundler resolution issues.
 */
export function openSqlite(filePath: string): SqliteDatabase {
	// Detect runtime: Bun exposes a global `Bun` object
	if (typeof (globalThis as Record<string, unknown>).Bun !== 'undefined') {
		return openBunSqlite(filePath);
	}
	return openNodeSqlite(filePath);
}

function openBunSqlite(filePath: string): SqliteDatabase {
	// eslint-disable-next-line ts/no-require-imports
	const mod = require('bun:sqlite') as Record<string, any>;
	const db = new mod.Database(filePath, { readonly: true });
	db.exec('PRAGMA journal_mode = WAL');
	return {
		prepare(sql: string) {
			const stmt = db.prepare(sql);
			return {
				all() {
					return stmt.all() as unknown[];
				},
			};
		},
		close() {
			db.close();
		},
	};
}

function openNodeSqlite(filePath: string): SqliteDatabase {
	// eslint-disable-next-line ts/no-require-imports
	const mod = require('node:sqlite') as Record<string, any>;
	const db = new mod.DatabaseSync(filePath, { readOnly: true });
	db.exec('PRAGMA journal_mode = WAL');
	return {
		prepare(sql: string) {
			const stmt = db.prepare(sql);
			return {
				all() {
					return stmt.all() as unknown[];
				},
			};
		},
		close() {
			db.close();
		},
	};
}

/* eslint-enable ts/no-unsafe-member-access, ts/no-unsafe-call, ts/no-unsafe-assignment */
