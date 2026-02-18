# OpenCode CLI Notes

## Log Sources

- OpenCode stores usage data in a SQLite database at `${OPENCODE_DATA_DIR:-~/.local/share/opencode}/opencode.db`.
- The database is opened in read-only mode via built-in SQLite (`bun:sqlite` or `node:sqlite` depending on runtime).
- Assistant messages in the `message` table contain token usage and cost data in a JSON `data` column.
- Session metadata is read from the `session` table.

## Token Fields (in `message.data` JSON for assistant role)

- `tokens.input`: total input tokens sent to the model.
- `tokens.output`: output tokens (completion text).
- `tokens.cache.read`: cached portion of the input (prompt-caching).
- `tokens.cache.write`: cache creation tokens.
- `cost`: pre-calculated cost in USD.
- `modelID`: model identifier (e.g., `anthropic/claude-opus-4.6`).
- `providerID`: provider identifier (e.g., `zenmux`, `anthropic`).

## Cost Calculation

- OpenCode assistant messages include a pre-calculated `cost` field in USD.
- When `cost` is zero or missing, costs are calculated using model pricing data via LiteLLM.
- Token mapping:
  - `inputTokens` <- `tokens.input`
  - `outputTokens` <- `tokens.output`
  - `cacheReadInputTokens` <- `tokens.cache.read`
  - `cacheCreationInputTokens` <- `tokens.cache.write`

## CLI Usage

- Treat OpenCode as a sibling to `apps/ccusage` and `apps/codex`.
- Reuse shared packages (`@ccusage/terminal`, `@ccusage/internal`) wherever possible.
- OpenCode is packaged as a bundled CLI. Keep every runtime dependency in `devDependencies`.
- SQLite access uses built-in runtime modules (`bun:sqlite` / `node:sqlite`) via `_sqlite.ts` adapter — no third-party native dependencies.
- Entry point uses Gunshi framework.
- Data discovery relies on `OPENCODE_DATA_DIR` environment variable.
- Default path: `~/.local/share/opencode`.

## Testing Notes

- Tests rely on `fs-fixture` with `using` to ensure cleanup.
- All vitest blocks live alongside implementation files via `if (import.meta.vitest != null)`.
- Vitest globals are enabled - use `describe`, `it`, `expect` directly without imports.
