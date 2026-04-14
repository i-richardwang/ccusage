import { define } from 'gunshi';
import pc from 'picocolors';
import { migrateExistingThreadsToManifest, syncThreads } from '../sync.ts';

export const syncCommand = define({
	name: 'sync',
	description: 'Sync Amp thread data from the server to local cache',
	args: {
		force: {
			type: 'boolean',
			short: 'f',
			description: 'Re-export all threads, even if already cached',
		},
	},
	async run(ctx) {
		// First, migrate any existing local thread files to the manifest
		const migrated = await migrateExistingThreadsToManifest();
		if (migrated > 0) {
			// eslint-disable-next-line no-console
			console.log(`Registered ${migrated} existing local thread(s) in sync manifest.`);
		}

		// eslint-disable-next-line no-console
		console.log('Syncing threads from Amp server...');

		const result = await syncThreads({ force: Boolean(ctx.values.force) });

		// eslint-disable-next-line no-console
		console.log(
			`\n${pc.green('✓')} Sync complete: ${pc.bold(String(result.synced))} synced, ${result.skipped} skipped, ${result.failed > 0 ? pc.red(String(result.failed)) : '0'} failed (${result.total} total)`,
		);
	},
});
