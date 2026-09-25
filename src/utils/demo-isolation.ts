/**
 * Isolation for the custom-site demo (docs/plans/custom-site-demo.md).
 *
 * The demo is a `demo`-branch deployment in the SAME Vercel project as the real
 * site, so it inherits every Preview variable — production's MFL, GroupMe,
 * VAPID and GitHub credentials, and production's Redis. Relying on someone to
 * blank each of those in the dashboard fails open: next year's new secret
 * reaches the demo silently. So the demo removes them itself, at boot, and
 * refuses the outbound hosts they would be used against.
 *
 * Pure functions here; `ensure-demo-isolation.ts` is the side-effect import
 * that applies them to the live process.
 */

import { isMflWrite } from './mfl-fetch';

/**
 * Credential families a demo process must never hold, matched by prefix (or
 * exact name where the family is one variable). By FAMILY rather than an
 * exact list so a new `MFL_*` or `GROUPME_*` secret is covered the day it is
 * added; a credential with an entirely new prefix is the known gap, and adding
 * its prefix here is the fix.
 */
export const DEMO_FORBIDDEN_ENV_PATTERNS: readonly RegExp[] = [
  /^MFL_/, // owner/commissioner cookies, API keys, host overrides
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
 * rather than falling back to production's: no Redis (degraded storage), and
 * `session.ts` refuses to mint sessions on Vercel without a secret.
 */
export const DEMO_ENV_MAPPINGS: Readonly<Record<string, string>> = {
  DEMO_REDIS_REST_URL: 'UPSTASH_REDIS_REST_URL',
  DEMO_REDIS_REST_TOKEN: 'UPSTASH_REDIS_REST_TOKEN',
  DEMO_JWT_SECRET: 'JWT_SECRET',
};

export function isForbiddenDemoEnvName(name: string): boolean {
  return DEMO_FORBIDDEN_ENV_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Delete every forbidden credential from `env`, then install the demo's own
 * replacements. Mutates and returns the names removed (for one boot log line —
 * names only, never values).
 */
export function scrubDemoEnvironment(env: NodeJS.ProcessEnv): string[] {
  const removed = Object.keys(env).filter(isForbiddenDemoEnvName).sort();
  for (const name of removed) delete env[name];
  for (const [from, to] of Object.entries(DEMO_ENV_MAPPINGS)) {
    const value = env[from];
    if (value) env[to] = value;
  }
  return removed;
}

/**
 * Hosts a demo process may never call, beyond MFL (which gets the stand-in).
 * The scrub already removed the credentials these would need; refusing the
 * host too means a credential that slipped the denylist still goes nowhere.
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

function hostMatches(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function isMflHost(hostname: string): boolean {
  return hostMatches(hostname.toLowerCase(), 'myfantasyleague.com');
}

export function isDemoRefusedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return DEMO_REFUSED_HOST_SUFFIXES.some((suffix) => hostMatches(host, suffix));
}

/** Thrown by the demo fetch guard for a host the demo may never reach. */
export class DemoOutboundRefusedError extends Error {
  readonly host: string;

  constructor(host: string) {
    super(`Demo deployment refused an outbound call to ${host}. See src/utils/demo-isolation.ts.`);
    this.name = 'DemoOutboundRefusedError';
    this.host = host;
  }
}

export const DEMO_MFL_UNAVAILABLE_MESSAGE =
  'This is the demo site. It has no connection to MyFantasyLeague.';

/**
 * The demo's stand-in for MyFantasyLeague.
 *
 * Phase 1 answers every request with an MFL-shaped error, at HTTP 200 the way
 * MFL itself reports errors (docs/claude/rules/lineups.md), so pages take
 * their existing "couldn't read MFL" path. Later phases answer `/export` from
 * the synthetic league and record writes as simulated successes — this is the
 * seam they fill in. It never touches the network, whatever the request.
 */
export function demoMflResponse(url: URL, method: string): Response {
  const wantsJson = url.searchParams.get('JSON') === '1';
  const write = isMflWrite(method, url.href);
  const reason = write
    ? `${DEMO_MFL_UNAVAILABLE_MESSAGE} Nothing was sent.`
    : DEMO_MFL_UNAVAILABLE_MESSAGE;
  const headers = { 'X-Demo-Mfl': write ? 'write' : 'read' };
  if (wantsJson) {
    return Response.json({ error: { $t: reason } }, { status: 200, headers });
  }
  return new Response(`<?xml version="1.0" encoding="ISO-8859-1"?>\n<error>${reason}</error>`, {
    status: 200,
    headers: { ...headers, 'Content-Type': 'text/xml; charset=ISO-8859-1' },
  });
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof URL) return input;
    if (typeof input === 'string') return new URL(input);
    return new URL(input.url);
  } catch {
    // A relative URL has no host to judge — and no server-side call to MFL is
    // relative. Let the real fetch reject it as it would anyway.
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof input === 'object' && 'method' in input && typeof input.method === 'string') {
    return input.method;
  }
  return 'GET';
}

const DEMO_FETCH_MARK = Symbol.for('mfl.football.demoFetch');

/**
 * Wrap a fetch so MFL goes to the stand-in and refused hosts throw. Everything
 * else (the demo's own Redis, ESPN, ranking sources) passes through.
 */
export function createDemoFetch(realFetch: typeof fetch): typeof fetch {
  const demoFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url) {
      if (isMflHost(url.hostname)) return demoMflResponse(url, requestMethod(input, init));
      if (isDemoRefusedHost(url.hostname)) throw new DemoOutboundRefusedError(url.hostname);
    }
    return realFetch(input, init);
  };
  return Object.assign(demoFetch, { [DEMO_FETCH_MARK]: true }) as typeof fetch;
}

export function isDemoFetch(candidate: unknown): boolean {
  return typeof candidate === 'function' && DEMO_FETCH_MARK in candidate;
}

/**
 * Apply demo isolation to a process: scrub, then guard fetch. Idempotent — the
 * middleware and astro.config.ts both import it, and a second wrap would be
 * harmless but pointless.
 */
export function applyDemoIsolation(
  env: NodeJS.ProcessEnv,
  target: { fetch: typeof fetch },
): { removed: string[] } {
  const removed = scrubDemoEnvironment(env);
  if (!isDemoFetch(target.fetch)) target.fetch = createDemoFetch(target.fetch.bind(target));
  return { removed };
}
