import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist/league-tools',
    emptyOutDir: false,
    lib: {
      entry: './src/scripts/main.js',
      formats: ['iife'],
      name: 'LeagueTools',
      fileName: () => 'league-tools.js',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'league-tools.js',
      },
    },
  },
});
