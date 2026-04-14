import type { ConsolaInstance } from 'consola';
import process from 'node:process';
import { consola } from 'consola';

export function createLogger(name: string): ConsolaInstance {
	const logger: ConsolaInstance = consola.withTag(name);

	// Apply LOG_LEVEL environment variable if set
	if (process.env.LOG_LEVEL != null) {
		const level = Number.parseInt(process.env.LOG_LEVEL, 10);
		if (!Number.isNaN(level)) {
			logger.level = level;
		}
	}

	return logger;
}

// eslint-disable-next-line no-console
export const log = console.log;

/**
 * Write a string to stdout in a way that is safe for large payloads under Bun.
 *
 * Bun has a bug where accessing `process.stdout.isTTY` (which consola does
 * at import time) causes a single write > 64 KB to be silently truncated
 * when stdout is a pipe. Writing in chunks ≤ 32 KB works around the issue
 * while remaining correct on Node.js and in TTY mode.
 *
 * Use this for any machine-readable output (JSON, jq results) that may
 * exceed 64 KB.
 */
export function writeStdout(data: string): void {
	const output = `${data}\n`;
	const CHUNK = 32768; // 32 KB — well under Bun's 64 KB pipe-write limit
	for (let i = 0; i < output.length; i += CHUNK) {
		process.stdout.write(output.slice(i, i + CHUNK));
	}
}
