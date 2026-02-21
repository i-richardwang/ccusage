import { LiteLLMPricingFetcher } from '@ccusage/internal/pricing';
import { Result } from '@praha/byethrow';
import { prefetchClaudePricing } from './_macro.ts' with { type: 'macro' };
import { logger } from './logger.ts';

const CLAUDE_PROVIDER_PREFIXES = [
	'anthropic/',
	'claude-3-5-',
	'claude-3-',
	'claude-',
	'openrouter/openai/',
];

/**
 * Model aliases for Claude Code model names that don't exist in LiteLLM.
 * Maps model names used by Claude Code to equivalent LiteLLM model names.
 */
export const CLAUDE_MODEL_ALIASES = new Map<string, string>([
	// Claude Code uses anthropic/claude-opus-4.6, but LiteLLM has claude-opus-4-6
	['anthropic/claude-opus-4.6', 'claude-opus-4-6'],
	// Claude Code uses anthropic/claude-haiku-4.5, but LiteLLM has claude-haiku-4-5
	['anthropic/claude-haiku-4.5', 'claude-haiku-4-5'],
	// Claude Code uses anthropic/claude-sonnet-4.5, but LiteLLM has claude-sonnet-4-5-20250929
	['anthropic/claude-sonnet-4.5', 'claude-sonnet-4-5-20250929'],
	// Claude Code uses anthropic/claude-sonnet-4.6, but LiteLLM has claude-sonnet-4-6
	['anthropic/claude-sonnet-4.6', 'claude-sonnet-4-6'],
]);

const PREFETCHED_CLAUDE_PRICING = prefetchClaudePricing();

export class PricingFetcher extends LiteLLMPricingFetcher {
	constructor(offline = false) {
		super({
			offline,
			offlineLoader: async () => PREFETCHED_CLAUDE_PRICING,
			logger,
			providerPrefixes: CLAUDE_PROVIDER_PREFIXES,
		});
	}

	/**
	 * Resolve model name using aliases if direct lookup fails
	 */
	override async getModelPricing(
		modelName: string,
	): Result.ResultAsync<import('@ccusage/internal/pricing').LiteLLMModelPricing | null, Error> {
		// First try direct lookup
		const directResult = await super.getModelPricing(modelName);
		if (Result.isFailure(directResult)) {
			return directResult;
		}

		// If found, return it
		if (directResult.value != null) {
			return directResult;
		}

		// Try alias lookup
		const alias = CLAUDE_MODEL_ALIASES.get(modelName);
		if (alias != null) {
			logger.debug(`Using alias for model ${modelName} -> ${alias}`);
			return super.getModelPricing(alias);
		}

		return directResult;
	}
}

if (import.meta.vitest != null) {
	describe('PricingFetcher', () => {
		it('loads offline pricing when offline flag is true', async () => {
			using fetcher = new PricingFetcher(true);
			const pricing = await Result.unwrap(fetcher.fetchModelPricing());
			expect(pricing.size).toBeGreaterThan(0);
		});

		it('calculates cost for Claude model tokens', async () => {
			using fetcher = new PricingFetcher(true);
			const pricing = await Result.unwrap(fetcher.getModelPricing('claude-sonnet-4-20250514'));
			const cost = fetcher.calculateCostFromPricing(
				{
					input_tokens: 1000,
					output_tokens: 500,
					cache_read_input_tokens: 300,
				},
				pricing!,
			);

			expect(cost).toBeGreaterThan(0);
		});

		it('resolves anthropic/claude-opus-4.6 via alias to claude-opus-4-6', async () => {
			using fetcher = new PricingFetcher(true);
			const pricing = await Result.unwrap(fetcher.getModelPricing('anthropic/claude-opus-4.6'));
			expect(pricing).not.toBeNull();
			expect(pricing?.input_cost_per_token).toBeGreaterThan(0);
		});

		it('resolves anthropic/claude-haiku-4.5 via alias to claude-haiku-4-5', async () => {
			using fetcher = new PricingFetcher(true);
			const pricing = await Result.unwrap(fetcher.getModelPricing('anthropic/claude-haiku-4.5'));
			expect(pricing).not.toBeNull();
			expect(pricing?.input_cost_per_token).toBeGreaterThan(0);
		});

		it('resolves anthropic/claude-sonnet-4.5 via alias to claude-sonnet-4-5-20250929', async () => {
			using fetcher = new PricingFetcher(true);
			const pricing = await Result.unwrap(fetcher.getModelPricing('anthropic/claude-sonnet-4.5'));
			expect(pricing).not.toBeNull();
			expect(pricing?.input_cost_per_token).toBeGreaterThan(0);
		});

		it('resolves anthropic/claude-sonnet-4.6 via alias to claude-sonnet-4-6', async () => {
			using fetcher = new PricingFetcher(true);
			const pricing = await Result.unwrap(fetcher.getModelPricing('anthropic/claude-sonnet-4.6'));
			expect(pricing).not.toBeNull();
			expect(pricing?.input_cost_per_token).toBeGreaterThan(0);
		});
	});
}
