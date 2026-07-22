import './src/utils/ensure-pt-timezone';
import { defineConfig, fontProviders } from 'astro/config';
import { loadEnv } from 'vite';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';

// Local dev: hydrate process.env from .env / .env.local (`pnpm vercel env pull`).
// Vite only exposes those files to import.meta.env, but the server utils
// (auth/session, every Upstash-backed storage module) read process.env — without
// this, local dev gets a random JWT secret per restart and KV writes 503.
// Real environment variables always win; on Vercel the files don't exist, no-op.
const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');
for (const [key, value] of Object.entries(fileEnv)) {
  process.env[key] ??= value;
}

export default defineConfig({
  output: 'server',
  // Astro 7 changed the default to 'jsx', which strips whitespace between
  // inline elements the way React does. Keep the HTML-preserving v6 behavior
  // rather than visually auditing every page for lost spaces.
  compressHTML: true,
  adapter: vercel({
    imageService: true,
    webAnalytics: {
      enabled: true,
    },
    maxDuration: 30,
    // Files the Schefter OG renderer (src/utils/schefter-og.ts) reads with
    // fs at runtime — dynamic join() paths that Vercel's file tracing can't
    // follow on its own.
    includeFiles: [
      'src/assets/fonts/og/UFCSans-Regular.ttf',
      'src/assets/fonts/og/UFCSans-Medium.ttf',
      'src/assets/fonts/og/UFCSans-CondensedBold.ttf',
      'public/assets/logos/theleague-logo-dark.svg',
      'public/assets/logos/afl-logo-dark.svg',
      'src/data/theleague/schefter-feed.json',
      'data/afl-fantasy/schefter-feed.json',
    ],
  }),
  integrations: [react()],
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Vend Sans',
      cssVariable: '--font-vend-sans',
      weights: [400, 500, 600, 700],
      subsets: ['latin'],
      fallbacks: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
    },
  ],
});
