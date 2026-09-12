/**
 * Guard: no outbound write escapes the non-production deployment check.
 *
 * The staging sites share production's database AND production's secrets
 * (docs/plans/staging-release-process.md — a deliberate decision, because a
 * staging site with empty rosters tests nothing). Reads and Redis writes are
 * the accepted cost. The outbound half is not, because none of it can be
 * undone: an MFL write mutates the real league, a push reaches real phones, a
 * GroupMe post lands in the real chat, an issue lands in the real backlog.
 *
 * `src/utils/deploy-environment.ts` holds the predicate. This file is the
 * mechanical half — it fails when a NEW outbound path is added without it,
 * which is the way this protection realistically breaks. Nobody removes the
 * guard from `postAsBot`; somebody adds `postAsBotV2` a year from now.
 *
 * Two shapes of check:
 *   1. Each known choke point still calls the guard.
 *   2. No file reaches one of the outbound services directly, bypassing the
 *      choke point that holds the guard.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO = join(__dirname, '..');
const GUARD_MODULE = 'src/utils/deploy-environment.ts';

/** Anything that consults the guard, in any of its forms. */
const GUARD_CALL = /\b(assertOutboundAllowed|outboundAllowed|isProductionDeploy|isNonProductionDeploy)\b/;

/**
 * The choke points. Each is the single door its class of outbound write goes
 * through, which is WHY the guard lives there rather than at the dozen-odd
 * routes upstream — a route-layer check is one forgotten route away from
 * failing open.
 */
const CHOKE_POINTS: { file: string; why: string }[] = [
  {
    file: 'src/utils/mfl-fetch.ts',
    why: 'every authenticated MFL write in the app funnels through mflFetch',
  },
  {
    file: 'src/utils/push-sender.ts',
    why: 'sendPushToFranchise is the single door every web push goes through',
  },
  {
    file: 'src/utils/groupme-client.ts',
    why: 'sendMessage and postAsBot are the only GroupMe write lanes',
  },
  {
    file: 'src/utils/github-issues.ts',
    why: 'createGitHubIssue files the suggestion box into the real repo',
  },
];

/**
 * Direct reaches at an outbound service. A file matching one of these, other
 * than the choke point that owns it, has gone around the guard.
 *
 * Deliberately narrow — these are the hostnames and endpoints themselves, not
 * the helper names — because the failure being caught is precisely someone
 * writing a fresh `fetch()` instead of reusing the guarded helper.
 */
const DIRECT_REACHES: { pattern: RegExp; owner: string; label: string }[] = [
  {
    pattern: /api\.groupme\.com|\/groups\/[^'"`]*\/messages|bots\/post/,
    owner: 'src/utils/groupme-client.ts',
    label: 'GroupMe API',
  },
  {
    pattern: /api\.github\.com\/repos\/[^'"`]*\/issues/,
    owner: 'src/utils/github-issues.ts',
    label: 'GitHub issues API',
  },
  {
    // The CALL and the IMPORT, never the bare phrase. An earlier version
    // matched /web-push/ and flagged two files whose only sin was citing
    // docs/features/web-push.md in a comment — a guard that fires on prose is
    // a guard that gets muted, and the allowlist it invites is where real
    // bypasses go to hide.
    pattern: /\bwebpush\s*\.\s*sendNotification|from\s+['"]web-push['"]|require\(\s*['"]web-push['"]\s*\)/,
    owner: 'src/utils/push-sender.ts',
    label: 'web push',
  },
];

/**
 * Files allowed to name an outbound service without holding the guard.
 *
 * Keep this SHORT and justified. Every entry is a hole, and the reason has to
 * be that the file cannot perform a write, not that adding the guard was
 * inconvenient.
 */
const ALLOWLIST = new Map<string, string>([
  // Empty, and that is the goal. Comment stripping below removes the whole
  // class of false positive an allowlist would otherwise absorb, so an entry
  // here should mean a file that really does reach the service and really
  // cannot write — not a file that merely mentions it.
]);

/**
 * Drop whole-line comments before matching.
 *
 * Every false positive this guard produced on its first run was prose: a
 * docblock citing `docs/features/web-push.md`, a type comment describing
 * `/groups/{id}/messages`. Papering over those with allowlist entries would
 * have left three permanent holes for a real bypass to hide in.
 *
 * LINE-based, deliberately. Stripping `//` to end-of-line wherever it appears
 * would eat the rest of every URL literal in the file — `https://api.groupme.com`
 * becomes `https:` — turning a false positive into a false NEGATIVE, which is
 * the failure that actually matters here.
 */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|astro)$/.test(entry)) out.push(full);
  }
  return out;
}

const SOURCE_FILES = walk(join(REPO, 'src')).map((f) => ({
  path: relative(REPO, f).replace(/\\/g, '/'),
  body: stripCommentLines(readFileSync(f, 'utf8')),
}));

describe('staging outbound-write guard', () => {
  it('has the guard module the rest of this file depends on', () => {
    const guard = SOURCE_FILES.find((f) => f.path === GUARD_MODULE);
    expect(guard, `${GUARD_MODULE} is missing`).toBeDefined();
    // The two shapes callers use. If either is renamed, every call site below
    // is silently unguarded, so pin the names themselves.
    expect(guard!.body).toMatch(/export function assertOutboundAllowed/);
    expect(guard!.body).toMatch(/export function outboundAllowed/);
  });

  it.each(CHOKE_POINTS)('$file consults the guard — $why', ({ file }) => {
    const source = SOURCE_FILES.find((f) => f.path === file);
    expect(source, `${file} not found — was it moved? Update CHOKE_POINTS.`).toBeDefined();
    expect(
      GUARD_CALL.test(source!.body),
      `${file} is a known outbound choke point but never calls the deployment ` +
        `guard. Import it from ${GUARD_MODULE} and refuse before the network ` +
        `call, or this write reaches the real world from staging.`,
    ).toBe(true);
  });

  it.each(DIRECT_REACHES)(
    'nothing reaches $label except its choke point',
    ({ pattern, owner, label }) => {
      const offenders = SOURCE_FILES.filter(
        (f) =>
          f.path !== owner &&
          f.path !== GUARD_MODULE &&
          !ALLOWLIST.has(f.path) &&
          pattern.test(f.body) &&
          !GUARD_CALL.test(f.body),
      ).map((f) => f.path);

      expect(
        offenders,
        `These files reach ${label} directly without the deployment guard, ` +
          `bypassing ${owner}:\n  ${offenders.join('\n  ')}\n\n` +
          `Route the call through ${owner}, or — if it genuinely cannot ` +
          `write — add it to ALLOWLIST in this test with the reason.`,
      ).toEqual([]);
    },
  );

  it('the MFL write predicate treats POST and /import as writes', async () => {
    const { isMflWrite } = await import('../src/utils/mfl-fetch');

    // Writes.
    expect(isMflWrite('POST', 'https://www49.myfantasyleague.com/2026/import?TYPE=salaries')).toBe(true);
    expect(isMflWrite('GET', 'https://www49.myfantasyleague.com/2026/import?TYPE=myWatchList')).toBe(true);
    expect(isMflWrite('post', 'https://api.myfantasyleague.com/2026/export?TYPE=rosters')).toBe(true);

    // Reads stay reads — over-blocking would break every export on staging,
    // and staging showing real data is the entire reason it exists.
    expect(isMflWrite('GET', 'https://api.myfantasyleague.com/2026/export?TYPE=rosters')).toBe(false);
    expect(isMflWrite('GET', 'https://api.myfantasyleague.com/2026/export?TYPE=league')).toBe(false);
  });
});

describe('deployment environment predicate', () => {
  const withVercelEnv = async <T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> => {
    const previous = process.env.VERCEL_ENV;
    if (value === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = value;
    try {
      return await fn();
    } finally {
      if (previous === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previous;
    }
  };

  it('blocks preview, allows production, and allows off-Vercel', async () => {
    const mod = await import('../src/utils/deploy-environment');

    // Preview covers BOTH the staging branch deploy and every PR preview —
    // they share the same hazard and the same credentials.
    await withVercelEnv('preview', () => {
      expect(mod.outboundAllowed()).toBe(false);
      expect(() => mod.assertOutboundAllowed('MFL write')).toThrow(mod.OutboundBlockedError);
    });

    await withVercelEnv('production', () => {
      expect(mod.outboundAllowed()).toBe(true);
      expect(() => mod.assertOutboundAllowed('MFL write')).not.toThrow();
    });

    // Unset is the cron scripts in GitHub Actions and `pnpm dev`. Both must
    // keep working, so unknown FAILS OPEN — a real limitation, pinned here so
    // it stays a decision rather than becoming a surprise.
    await withVercelEnv(undefined, () => {
      expect(mod.outboundAllowed()).toBe(true);
    });
  });

  it('reads the env per call, never captured at module load', async () => {
    const mod = await import('../src/utils/deploy-environment');
    // The same module instance must answer differently as the env changes; a
    // value captured at import time would make the guard depend on which
    // request warmed the lambda.
    await withVercelEnv('production', () => expect(mod.outboundAllowed()).toBe(true));
    await withVercelEnv('preview', () => expect(mod.outboundAllowed()).toBe(false));
    await withVercelEnv('production', () => expect(mod.outboundAllowed()).toBe(true));
  });

  it('recognises every staging host in the registry, and no production host', async () => {
    const mod = await import('../src/utils/deploy-environment');
    const { LEAGUES } = await import('../src/config/leagues-data.mjs');

    const declared = Object.values(LEAGUES).flatMap(
      (l: any) => (l.stagingDomains ?? []) as string[],
    );
    // The registry is the source of truth; a staging host that exists in
    // Vercel but not here is a host this guard does not recognise.
    expect(declared.length).toBeGreaterThan(0);
    for (const host of declared) {
      expect(mod.isStagingHost(host), `${host} should be a staging host`).toBe(true);
    }

    // The shared multi-league host's staging twin is not any one league's
    // stagingDomains entry, so it has to be covered separately.
    expect(mod.isStagingHost('staging.mfl.football')).toBe(true);

    for (const host of ['theleague.us', 'www.theleague.us', 'afl-fantasy.com', 'mfl.football']) {
      expect(mod.isStagingHost(host), `${host} is production, not staging`).toBe(false);
    }
  });
});
