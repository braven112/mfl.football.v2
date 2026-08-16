import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['tests/global-setup-timezone.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.js'],
    // Requires MFL API credentials — run separately via pnpm test:mfl-integration
    exclude: ['tests/mfl-write-integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/utils/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
      // Lets tests import src/middleware.ts and exercise onRequest directly.
      // Without this the inbound redirect could only be grep-tested, which is
      // how a neutered branch and a dropped Location header both stayed green.
      'astro:middleware': new URL('./tests/stubs/astro-middleware.ts', import.meta.url).pathname,
    },
  },
});
