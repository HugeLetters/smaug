# Finance App Project - Agent Reference

## Agent Guidelines

- Make concise plans, sacrificing grammar for efficiency.
- After making a plan, provide a list of unresolved questions for the user to answer.

## LLM Interaction Guidelines

- Verify tool results before proceeding; batch operations for efficiency.
- Ask clarifying questions before major changes.
- Follow security best practices; avoid exposing secrets.
- Run lint and typecheck after edits.

## Project Overview

Family finance app for tracking spending, investments, and shared expenses with live sync. Initialized with Solid Start (basic routes, sample components), Bun runtime, Playwright testing, and implemented color palette system with semantic colors.

## Desired Features

- **Spending Table**: Track purchases by date, spender, category, comment, recurring status.
- **Personal Tracking**: Option to mark transactions private.
- **Multi-Currency**: Purchases with currencies; display preferred with hover for original.
- **Merchant Recognition**: Helper for identifying merchants.
- **Mini-Apps**: Calculator for shared expenses, Bitcoin tracking, family debt, monthly balances.
- **Auth & Access**: Invite-based for two users with workspace.
- **Customization**: Custom palettes with presets (semantic colors implemented).
- **Live Sync**: Real-time client synchronization.
- **UX**: Google Sheets-like interface with keyboard navigation.
- **Command Palette**: Quick actions.

## Technology Stack

- **Runtime**: Bun JS - https://bun.sh/docs (run app, manage deps with bun add/install/run, scripts)
- **Effect System**: Effect - https://effect.website/ ([API Reference](https://effect.website/docs/additional-resources/api-reference/)) (FP library for TS; wildcard imports like `import * as Effect from "effect/Effect"`; platform packages (@effect/platform, @effect/platform-bun, @effect/platform-node) for file system and process operations; Differ API for change tracking)
- **Schema Validation**: effect/schema - https://effect-ts.github.io/effect/docs/schema (type-safe validation; use `Schema.transformOrFail` for parsing; avoid throwing in decode)
- **Typed Regex**: arkregex - https://www.npmjs.com/package/arkregex (compile-time typed regex with named captures)
- **Styling**: TailwindCSS - https://tailwindcss.com/
- **UI Kit**: Kobalte - https://kobalte.dev/docs
- **Frontend Framework**: SolidJS - https://docs.solidjs.com/quick-start
- **Routing**: Solid Router - https://docs.solidjs.com/solid-router/getting-started/installation-and-setup
- **Full-Stack Framework**: Solid Start - https://docs.solidjs.com/solid-start/getting-started (initialized with src/routes/, entry files, app.tsx)
- **Linter/Formatter**: Biome - https://biomejs.dev/ (recommended rules; lint warnings: non-null assertions, button types)
- **Testing**: Playwright - https://playwright.dev/ (e2e with auto-start dev server via playwright.config.ts)
- **Live Sync Options** (research needed).
- Absolutely do not want to use a cloud provider - everything is self-hosted

## Core Modules

- **Differ Module** (`src/utils/differ/index.ts`): Provides type-safe differencers for computing and applying patches to data structures (strings, objects, arrays, maps, sets). Uses Effect's Differ API with tagged unions for patches and Match for exhaustive pattern matching. Supports live sync by enabling efficient change tracking and application. Includes Formatter namespace for visualizing patches as tree structures for debugging.

## Development Environment

- **Code Quality**: Biome handles linting and formatting with recommended rules enabled. Run `bun run lint` to check for issues, `bun run lint:fix` to auto-apply fixes, and `bun run format` to format code. Always run linting after code changes to ensure consistency.
- **Type Checking**: Use `bun run tsc` for comprehensive TypeScript type checking. The project uses strict mode with Effect language service integration for better developer experience.
- **VSCode Integration**: Project includes `.vscode/settings.json` configured for Biome (format on save, default formatter for JS/TS/JSON/CSS files, code actions for imports and fixes). The Biome and Effect language service extensions are recommended in `.vscode/extensions.json`.
- **Git**: Repository initialized for version control. Commit changes after verifying tests pass.
- **Testing**: Playwright tests are in `tests/` directory. Scripts added: `bun run e2e` (headless), `bun run e2e:ui` (interactive UI). Config in `playwright.config.ts` auto-starts dev server at http://localhost:3000. Run tests after starting dev server or use config for automatic server management.
- **Build Scripts**: Custom build scripts in `scripts/` directory for specialized tasks. For example, `scripts/build.ts` runs palette generation then `vinxi build` with inherited stdout/stderr for logging output.
- **Common Pitfalls**: Existing lint warning in `src/entry-client.tsx` for non-null assertion (`document.getElementById("app")!`) - resolve by adding null check or using optional chaining. Avoid throwing in schema decode functions; use `ParseResult.Forbidden` instead. LSP may show type warnings for Effect platform services due to inference issues, but code compiles and runs correctly with proper layer provision. For Bun scripts using Effect, provide `BunContext.layer` to access platform services like FileSystem, Path, and Command.
- **Color Palette Updates**: After modifying `src/color/palette.ts`, regenerate `src/color/palette.css` by running `scripts/build.ts` or manually calling the `GeneratePalette` effect to export updated CSS variables and format the file.

## Effect Patterns

- **Effect Composition**: Use `Effect.gen` for sequential effects and `Effect.all` for concurrent execution. Combine with `Effect.map` and `Effect.flatMap`. Example: `Effect.gen(function*() { const a = yield* Effect.succeed(1); return a + 1; })`
- **Error Handling**: Prefer `Effect.fail` with typed errors over throwing. Use `ParseResult.Forbidden` for schema validation errors.
- **Functional Functions**: Use `Effect.fn` for curried, composable effectful functions.
- **Schema Naming**: `XFromSelf` for self-validating schemas, `X` for serializable transforms (e.g., parsing strings to objects).
- **Concurrency**: Leverage `Effect.all` on records or arrays for parallel execution.
- **Platform Services**: Use services like FileSystem from @effect/platform for cross-platform operations; provide implementations via layers from platform-specific packages (e.g., `BunContext.layer` for Bun runtime to access FileSystem, Path, Command, etc.).
- **Running Effects**: Use `Effect.runPromise` for async execution with provided layers; wrap synchronous operations in `Effect.sync`. For Bun scripts, use `BunRuntime.runMain` with layers like `BunContext.layer`.
- **Command Execution**: To run shell commands with output logging, pipe the Command with `Command.stdout("inherit")` and `Command.stderr("inherit")`, then yield `Command.exitCode` to execute and check exit status.
- **Differ API**: Use Effect's Differ for change tracking; implement diff, patch, combine, and empty methods. Use tagged unions (Data.TaggedClass) for patch types to ensure type safety.
- **Pattern Matching**: Prefer `Match.value(...).pipe(Match.tagsExhaustive({...}))` over switch statements for exhaustive, type-safe pattern matching on tagged unions.

## Code Conventions

- File naming: Use kebab-case for routes/components (e.g., `spending-table.tsx`), camelCase for utilities and plugins.
- Imports: Group external libs first, then internal modules; sort alphabetically.
- Commit messages: Start with verb (add, fix, refactor), summarize change, keep under 50 chars.
- **Documentation**: Use JSDoc comments for modules, namespaces, and key functions to explain purpose and usage. Add module-level comments at the top of files describing overall functionality.
- **Value Clamping and Scaling**: For derived calculations (e.g., color L/C), use `Math.max(0, Math.min(1, value))` to clamp to valid ranges, preventing out-of-bounds issues with edge-case inputs like very light/dark bases.
- **Plugin Development**: Use Effect.gen for sequential operations in Vite plugins; provide necessary layers for platform services; run effects with Effect.runPromise.
- **Refactoring**: When refactoring, prefer Effect's Match API over switch statements for better type safety and consistency. Ensure exhaustive matching with Match.tagsExhaustive.

## Color System

- **Semantic Colors**: Restrict color tokens to fixed semantic names ("primary", "secondary", "accent", "neutral", "success", "warning", "error") using union types for compile-time safety. "Neutral" was recently added for gray tones with very low chroma (e.g., 0.01) to ensure true gray shades.
- **Type Aliases**: Use `BaseColors` for `Record<SemanticColor, string>` and `Palette` for `Record<SemanticColor, ColorShades>` to improve readability.
- **Palette Generation**: Generate palettes concurrently using `Effect.all` on base color records. Use `generateShades` with OKLCH strings for consistent shade calculation. Each semantic color generates 10 shades (50-900) using predefined lightness and chroma scales.
- **Typed Regex**: Use arkregex for parsing OKLCH strings with named captures to ensure type-safe extraction of color components.
- **Adding New Colors**: To extend the color system, update the `SemanticColor` union type in `src/color/generate.ts` and add base OKLCH colors to each palette (default, warm, cool). The system automatically generates full shade ranges.
- **CSS Export**: Use `generatePaletteCss()` to output CSS custom properties for theming (e.g., `--color-primary-500: oklch(...);`).
- **Automated CSS Generation**: The `GeneratePalette` effect in `src/color/generate.ts` regenerates `palette.css` during build, writes the CSS to the file, and formats it using `bun run format` via Command execution. This ensures CSS is always up-to-date with palette changes.
- **OKLCH Best Practices**: OKLCH provides perceptually uniform colors; derive L and C from base for all shades using relative deltas/factors to ensure consistent contrast and accessibility. For lightness, use decreasing scales (50 lightest, 900 darkest); for chroma, use bell-curve scaling (low at extremes, high mid-range). Handle very light/dark bases by clamping L to [0,1] and scaling C proportionally to avoid gamut clipping. Research standard generators (e.g., sine waves for chroma) for advanced patterns, but keep derivation simple for maintainability.

## Testing

- **Unit Testing**: Always use Effect-based test harness in `src/test/index.ts` for testing Effect computations with Bun:test.
- **E2E Testing**: Playwright for end-to-end testing.
- **Test Structure**: Unit tests anywhere in `src/` with `*.test.ts` pattern, using harness from `src/test/index.ts`.
- **E2E Test Structure**: Tests in `tests/` directory (e.g., `basic.spec.ts` checks home page elements).
- **Running Unit Tests**: `bun test` (configured via bunfig.toml to include `src/**/*.test.ts`).
- **Running E2E Tests**: `bun run e2e` (headless), `bun run e2e:ui` (interactive UI). Config in `playwright.config.ts` auto-starts dev server at http://localhost:3000.
- **Best Practices**: Always use Effect-based tests; prefer `test.effect` for most tests; use `expectEquivalence` for assertions with detailed diffs; run lint and typecheck after adding tests.
