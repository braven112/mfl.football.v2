/**
 * The custom-site demo's isolation rules, in plain JS so BOTH halves of the
 * demo enforce the same list: the SSR server (`demo-isolation.ts`, applied by
 * `ensure-demo-isolation.ts`) and the demo BUILD
 * (`scripts/demo/lib/guard-preload.mjs`, loaded into every build script with
 * `node --import`). A rule added here reaches both; a second copy would drift.
 *
 * See docs/plans/custom-site-demo.md.
 */

/**
 * The branch the demo sites (`*.demo.mfl.football`) are pinned to. Must equal
 * `DEMO_BRANCH` in scripts/vercel-ignore-build.mjs (pinned by
 * tests/demo-isolation.test.ts).
 */
export const DEMO_BRANCH = 'demo';

/**
 * Is this process the demo — its server or its build? Two independent
 * signals, either sufficient, so a forgotten `DEMO_PROFILE` still fails CLOSED
 * on the demo branch.
 */
export function isDemoEnv(env = typeof process === 'undefined' ? undefined : process.env) {
  // This module also reaches the browser (via the league registry), where
  // there is no process: the client learns demo mode from the build flag.
  // eslint-disable-next-line no-undef -- a Vite compile-time constant
  if (!env) return typeof __DEMO_BUILD__ !== 'undefined' && __DEMO_BUILD__ === true;
  return Boolean(env.DEMO_PROFILE) || env.VERCEL_GIT_COMMIT_REF === DEMO_BRANCH;
}

/**
 * Credential families a demo process must never hold, matched by prefix (or
 * exact name where the family is one variable). By FAMILY rather than an exact
 * list so a new `MFL_*` or `GROUPME_*` secret is covered the day it is added; a
 * credential with an entirely new prefix is the known gap, and
 * tests/demo-isolation.test.ts fails when src/ reads one.
 */
export const DEMO_FORBIDDEN_ENV_PATTERNS = [
  /^MFL_/, // owner/commissioner cookies, API keys, host overrides, league id
  /^GROUPME_/,
  /^VAPID_PRIVATE_KEY$/, // the public key is public; the private key signs pushes
  /^GITHUB_/,
  /^GH_/,
  /^UPSTASH_/, // production Redis — replaced by DEMO_REDIS_* below
  /^KV_/,
  /^STORAGE_/,
  /^CRON_SECRET$/,
  /^AUTOCUT_/,
  /^BLOB_/,
  /^SCHEFTER_/,
  /^ANTHROPIC_/, // LLM spend on the real account; the demo ships Roger/Schefter off
  /^JWT_SECRET$/, // production's session key — replaced by DEMO_JWT_SECRET below
];

/**
 * The demo's OWN values, mapped onto the names the rest of the code reads.
 * Applied after the scrub, so a missing demo value leaves the real name unset
 * rather than falling back to production's.
 */
export const DEMO_ENV_MAPPINGS = {
  DEMO_REDIS_REST_URL: 'UPSTASH_REDIS_REST_URL',
  DEMO_REDIS_REST_TOKEN: 'UPSTASH_REDIS_REST_TOKEN',
  DEMO_JWT_SECRET: 'JWT_SECRET',
};

export function isForbiddenDemoEnvName(name) {
  return DEMO_FORBIDDEN_ENV_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Delete every forbidden credential from `env`, then install the demo's own
 * replacements. Mutates; returns the names removed (names only, never values).
 */
export function scrubDemoEnvironment(env) {
  const removed = Object.keys(env).filter(isForbiddenDemoEnvName).sort();
  for (const name of removed) delete env[name];
  for (const [from, to] of Object.entries(DEMO_ENV_MAPPINGS)) {
    const value = env[from];
    if (value) env[to] = value;
  }
  return removed;
}

/**
 * Hosts a demo SERVER may never call, beyond MFL (which gets the stand-in).
 * The demo BUILD is stricter still: it may call nothing at all.
 */
const DEMO_REFUSED_HOST_SUFFIXES = [
  'groupme.com',
  'api.github.com',
  'api.anthropic.com',
  // Web-push services (Chrome/Android, Firefox, Safari, Edge).
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

function hostMatches(hostname, suffix) {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function isMflHost(hostname) {
  return hostMatches(String(hostname).toLowerCase(), 'myfantasyleague.com');
}

export function isDemoRefusedHost(hostname) {
  const host = String(hostname).toLowerCase();
  return DEMO_REFUSED_HOST_SUFFIXES.some((suffix) => hostMatches(host, suffix));
}

/**
 * Paths the demo never serves: every league except the fictional one in
 * TheLeague's slot, and their API routes. Matched on the REQUESTED path,
 * before any league-host rewrite, so no host can reach them.
 */
const DEMO_REFUSED_PATH = /^\/(?:api\/)?(?:afl-fantasy|afl-keepers|afl-rules-qa|best-ball-1|best-ball-draft)(?:[/.?]|$)/;

export function isDemoRefusedPath(pathname) {
  return DEMO_REFUSED_PATH.test(String(pathname));
}

/** Marks the demo's fetch guard, so code can confirm it is actually installed. */
export const DEMO_FETCH_MARK = Symbol.for('mfl.football.demoFetch');

export function isDemoFetch(candidate) {
  return typeof candidate === 'function' && DEMO_FETCH_MARK in candidate;
}

/**
 * The demo's league paths: demo.mfl.football/<demoPath>/… serves the route
 * slot of the league whose registry entry names that path (dynasty →
 * theleague). Passed in rather than imported, because the registry imports
 * this module.
 *
 * Three outcomes for a requested path:
 *   - `/dynasty/x`   → rewrite to `/theleague/x` (the route that renders it)
 *   - `/theleague/x` → redirect to `/dynasty/x` (a link the HTML pass missed,
 *                       or one built in client script), so the slot's real
 *                       name never sits in a prospect's address bar
 *   - `/`            → redirect to the first demo league
 * Anything else (api, assets) is left alone.
 *
 * @param {string} pathname
 * @param {Record<string, string>} demoPaths  demoPath → route slug
 * @returns {{ rewrite: string } | { redirect: string } | null}
 */
export function resolveDemoPath(pathname, demoPaths) {
  const entries = Object.entries(demoPaths);
  if (!entries.length) return null;
  if (pathname === '/' || pathname === '') return { redirect: `/${entries[0][0]}/` };
  for (const [demoPath, slug] of entries) {
    const shown = `/${demoPath}`;
    const real = `/${slug}`;
    if (pathname === shown || pathname.startsWith(`${shown}/`)) {
      return { rewrite: real + pathname.slice(shown.length) };
    }
    if (pathname === real || pathname.startsWith(`${real}/`)) {
      return { redirect: shown + pathname.slice(real.length) };
    }
  }
  return null;
}

/**
 * Rewrite the route-slot prefix in a page's HTML links to the demo path
 * (`href="/theleague/rosters"` → `href="/dynasty/rosters"`), so navigation
 * never takes the redirect hop. Only quoted, root-relative URLs are touched.
 */
export function rewriteDemoHtml(html, demoPaths) {
  let out = html;
  for (const [demoPath, slug] of Object.entries(demoPaths)) {
    out = out.replace(new RegExp(`(["'(=])/${slug}(?=[/"'?#)])`, 'g'), `$1/${demoPath}`);
  }
  return out;
}
