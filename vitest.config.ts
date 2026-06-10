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
    },
  },
});
