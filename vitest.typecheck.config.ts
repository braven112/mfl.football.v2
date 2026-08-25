import { defineConfig } from 'vitest/config';

/**
 * Config for the type-error ratchet (`pnpm test:types`).
 *
 * Kept separate from vitest.config.ts on purpose: the suite shells out to
 * `astro check`, which takes ~2.5 minutes and needs a large heap, so it must
 * not sit inside `pnpm test:unit`. The `.typecheck.ts` suffix keeps it out of
 * the default `tests/**\/*.test.ts` glob for the same reason `*.eval.ts` files
 * stay out of it.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.typecheck.ts'],
    // One full `astro check` per test.
    testTimeout: 300_000,
    // The single astro check runs in beforeAll; give it more room than the
    // check's own 420s ceiling so its error surfaces instead of the hook's.
    hookTimeout: 540_000,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
