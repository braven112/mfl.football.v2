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
