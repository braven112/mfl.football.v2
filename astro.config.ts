import './src/utils/ensure-pt-timezone';
import './src/utils/ensure-demo-isolation';
import { defineConfig, fontProviders } from 'astro/config';
import { loadEnv } from 'vite';
import vercel from '@astrojs/vercel';
import { REMOTE_MARK_HOSTS } from './src/utils/remote-image';
import react from '@astrojs/react';
import { archivedFeedFiles } from './scripts/lib/archived-feed-files.mjs';
import { schefterArchiveIncludeFiles, scheduleReleaseIncludeFiles } from './scripts/lib/schefter-archive.mjs';

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
  /* Opt-IN prefetching, never `prefetchAll`.
     One caller today: the AFL roster header's crest row, whose links are real
     navigations (TheLeague's are intercepted and switched in place, so
     prefetching its 4.6 MB page would be pure waste). Those links ask for the
     `tap` strategy specifically — `touchstart` + `mousedown`, i.e. only the
     link actually being activated. `hover` would be wrong there: 24 crests sit
     in one row, and a mouse sweeping across them would pull 24 whole pages. */
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'tap',
  },
  // Astro 7 changed the default to 'jsx', which strips whitespace between
  // inline elements the way React does. Keep the HTML-preserving v6 behavior
  // rather than visually auditing every page for lost spaces.
  compressHTML: true,
  adapter: vercel({
    imageService: true,
    /**
     * Vercel's Image Optimization config — AND IT LIVES HERE, NOT IN
     * `vercel.json`.
     *
     * The adapter writes `.vercel/output/config.json` (Build Output API), and
     * that file is what `/_vercel/image` reads. A `vercel.json` `images` block
     * is silently ignored on this project: it deploys, it looks configured,
     * and every optimize request still answers
     * `400 INVALID_IMAGE_OPTIMIZE_REQUEST`.
     *
     * TWO HALVES, BOTH REQUIRED. A request is rejected unless its `w` is in
     * `sizes` AND its host matches `remotePatterns` — and passing
     * `imagesConfig` REPLACES the derived default rather than extending it, so
     * the adapter's own width list (`getDefaultImageConfig`) is restated here
     * in full. Dropping one of those widths would break every existing
     * `<Image>` that asks for it; `sizes` also becomes Astro's `breakpoints`.
     *
     * 256 is the addition: MFL franchise marks render into boxes of 1.4rem and
     * 2.25rem, and one league's uploads are 1500x636 PNGs of ~400 KB
     * (`src/utils/remote-image.ts`). 640 — the smallest the platform served
     * before — is several times more pixels than those boxes can show.
     */
    imagesConfig: {
      sizes: [256, 640, 750, 828, 1080, 1200, 1920, 2048, 3840],
      domains: [],
      // Where our own edge is willing to fetch a source image FROM, which
      // makes this a security boundary rather than a convenience list. Shared
      // with `optimizedRemoteImage`, which checks the same list before
      // rewriting a URL — a host allowed by one and not the other is either a
      // lost optimization or a 400 with a broken image in its place.
      remotePatterns: REMOTE_MARK_HOSTS,
      formats: ['image/webp'],
      // A franchise's uploaded mark changes about never.
      minimumCacheTTL: 604800,
    },
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
      // NFL bye calendar — read with fs by /api/schedule-plan. Small, and the
      // tracer cannot follow a process.cwd() join on its own.
      'data/nfl/bye-weeks.json',
      // Icon sprite — read with fs by the SSR /instructions page to list the
      // icon gallery. public/ is served statically, not bundled with functions.
      'public/assets/icons/sprite.svg',
      // Season archives the OG renderer falls back to for posts older than
      // the active window. Enumerated (NOT globbed — includeFiles realpaths
      // each entry, so a literal '*.json' fails the whole build).
      ...schefterArchiveIncludeFiles(),
      // Locked schedule reveals — same process.cwd() join problem.
      ...scheduleReleaseIncludeFiles(),
    ],
    // Keeps the file tracer's unresolvable-path fallback from shipping 20
    // years of archived feeds in every request's function. See the module for
    // why this is safe and why it counts seasons instead of naming a year.
    excludeFiles: archivedFeedFiles(),
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
