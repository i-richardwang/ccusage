import process from 'node:process';
import { cli } from 'gunshi';
import { description, name, version } from '../package.json';
import { dailyCommand, monthlyCommand, sessionCommand, syncCommand } from './commands/index.ts';

const subCommandUnion = [
	['daily', dailyCommand],
	['monthly', monthlyCommand],
	['session', sessionCommand],
	['sync', syncCommand],
] as const;

const subCommands = new Map();
for (const [name, command] of subCommandUnion) {
	subCommands.set(name, command);
}

const mainCommand = dailyCommand;

export async function run(): Promise<void> {
	// When invoked through npx, the binary name might be passed as the first argument
	// Filter it out if it matches the expected binary name
	let args = process.argv.slice(2);
	if (args[0] === 'ccusage-amp') {
		args = args.slice(1);
	}

	await cli(args, mainCommand, {
		name,
		version,
		description,
		subCommands,
		renderHeader: null,
	});
}
