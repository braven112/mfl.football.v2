import { defineConfig } from 'vitest/config';

/**
 * Config for the LIVE Ask Roger eval (`pnpm eval:roger`).
 *
 * Kept separate from vitest.config.ts on purpose: eval files (*.eval.ts)
 * make real Anthropic API calls, cost money, and are mildly nondeterministic
 * (temperature 0.3), so they must never run inside `pnpm test:unit` or CI.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['tests/eval/eval-global-setup.ts'],
    include: ['tests/eval/**/*.eval.ts'],
    // One API round-trip (answer + judge) per test — give them room.
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // Gentle on rate limits; still ~4x faster than sequential.
    maxConcurrency: 4,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
