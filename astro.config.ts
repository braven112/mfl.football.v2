import './src/utils/ensure-pt-timezone';
import { defineConfig, fontProviders } from 'astro/config';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';

export default defineConfig({
  output: 'server',
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
  experimental: {},
});
