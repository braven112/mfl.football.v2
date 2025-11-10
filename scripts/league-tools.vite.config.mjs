import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'public/assets/js/dist',
    emptyOutDir: false,
    copyPublicDir: false,
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
