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
  {
    file: 'src/pages/api/admin/schefter-announce.ts',
    why:
      'dispatches schefter-announce.yml with ref:main and dry_run:false — the ' +
      'workflow commits the feed and posts to GroupMe with Actions secrets',
  },
  {
    file: 'src/utils/workflow-dispatch.ts',
    why:
      'the single door every Vercel cron bridge dispatches through — ' +
      'roster-sync.yml, schefter-scan.yml and groupme-sync.yml all commit, ' +
      'post or push with Actions secrets, and staging holds the same GH_PAT',
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
    // A dispatch is a write one hop away: the workflow it starts commits and
    // posts with Actions secrets. Guarding only direct calls left this open.
    pattern: /actions\/workflows\/[^'"`]*\/dispatches/,
    // Two owners, deliberately: the cron bridges share
    // src/utils/workflow-dispatch.ts, while the admin announce route keeps its
    // own copy for the timeout and 401/403/404 diagnostics a human pressing a
    // button needs. Both hold the guard, which is what the filter below checks.
    owner: 'src/pages/api/admin/schefter-announce.ts',
    label: 'GitHub Actions workflow dispatch',
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

  // A bespoke check rather than a DIRECT_REACHES entry, because the generic
  // shape cannot express it: a bare `myfantasyleague.com` rule flags 20+ files
  // that build a URL and hand it to the guarded mflFetch, and muting those with
  // an allowlist would hide the one case that matters. The bypass shape is
  // narrower — a RAW fetch aimed at a MUTATING MFL endpoint.
  it('no raw fetch() reaches a mutating MFL endpoint outside mflFetch', () => {
    // MFL's mutating endpoints by their full query signature. Matching the
    // ENDPOINT rather than the host is what makes the host check unnecessary:
    // `import?TYPE=`, `add_drop?` and `csetup?` are MFL's own URL shapes and
    // appear nowhere else, whereas a bare `/import` also matches this repo's
    // own /api/accounting/import route.
    const MUTATING = /\/(import\?TYPE=|add_drop\?|csetup\?)/;
    const offenders: string[] = [];

    for (const file of SOURCE_FILES) {
      if (file.path === 'src/utils/mfl-fetch.ts') continue;
      const lines = file.body.split('\n');
      lines.forEach((line, i) => {
        // `fetch(` not preceded by an identifier character, so `mflFetch(`
        // — the guarded path — does not match.
        if (!/(^|[^A-Za-z0-9_])fetch\(/.test(line)) return;
        // Look BOTH WAYS around the call, not just forward. The usual shape is
        //   const url = `https://…/add_drop?…&DELETE=…`;
        //   await fetch(url, { method: 'GET' });
        // — the URL is assigned on an EARLIER line, which a forward-only window
        // misses entirely. A probe of exactly that shape slipped through the
        // first version of this check.
        const window = lines.slice(Math.max(0, i - 3), i + 3).join('\n');
        // NO HOSTNAME CHECK, deliberately, and this is the third shape of
        // this line. A regex `/myfantasyleague\.com/` tripped CodeQL's
        // missing-anchor rule; rewriting it as `.includes('myfantasyleague.com')`
        // tripped incomplete-URL-substring-sanitization instead. Both alerts
        // are false here — this greps SOURCE TEXT, it does not validate a URL —
        // but "silence the scanner" is the wrong lesson, and splitting the
        // literal to hide it from the scanner would be worse.
        //
        // The right answer was that the host check earned nothing. The
        // endpoint signatures above are MFL's alone, so a raw fetch at one of
        // them is the bypass whatever host string sits beside it — and a
        // future MFL host rename cannot slip past a check that never looked at
        // the host.
        if (MUTATING.test(window)) {
          offenders.push(`${file.path}:${i + 1}`);
        }
      });
    }

    expect(
      offenders,
      `These raw fetch() calls target a mutating MFL endpoint, bypassing ` +
        `mflFetch and its deployment guard:\n  ${offenders.join('\n  ')}\n\n` +
        `Route the call through mflFetch — it is the only place the staging ` +
        `guard can stop a write to the real league.`,
    ).toEqual([]);
  });

  it('the MFL write predicate treats POST, /import and GET mutations as writes', async () => {
    const { isMflWrite } = await import('../src/utils/mfl-fetch');

    // Writes.
    expect(isMflWrite('POST', 'https://www49.myfantasyleague.com/2026/import?TYPE=salaries')).toBe(true);
    expect(isMflWrite('GET', 'https://www49.myfantasyleague.com/2026/import?TYPE=myWatchList')).toBe(true);
    expect(isMflWrite('post', 'https://api.myfantasyleague.com/2026/export?TYPE=rosters')).toBe(true);

    // The one that got away first time round. MFL's own page cancels a filed
    // waiver claim with a plain GET, and src/pages/api/waiver-claims.ts
    // replays exactly that — so a POST-or-/import test let staging delete a
    // real owner's claim.
    expect(
      isMflWrite('GET', 'https://www49.myfantasyleague.com/2026/add_drop?L=13522&F=0001&DELETE=1_1234_0000'),
    ).toBe(true);
    // Same shape: the Custom Waiver Order form is the only way to write
    // waiver priority, and it is a page, not an import.
    expect(isMflWrite('GET', 'https://www49.myfantasyleague.com/2026/csetup?L=13522&C=WAIVORD')).toBe(true);

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

/**
 * A blocked write must report itself, not impersonate an MFL outage.
 *
 * The guard above stops the send. This describe block is about what the OWNER
 * is told afterwards, which was wrong everywhere: `Watch player` on staging
 * answered HTTP 502 "Could not reach MFL" (someone spent an hour hunting a bug
 * in the roster code), a lineup submit answered "Internal server error", and
 * the contract writer retried the refusal three times with backoff before
 * reporting it. `OutboundBlockedError` is a distinct class precisely so a
 * caller can tell "we refused on purpose" from "the network failed" —
 * `describeMflFailure` is the one place that does it, and this pins that every
 * MFL write goes through it.
 */
describe('a blocked MFL write says so', () => {
  it('describes the refusal in the owner’s words, and a real failure in its own', async () => {
    const { describeMflFailure, MFL_WRITE_BLOCKED_MESSAGE } =
      await import('../src/utils/mfl-fetch');
    const { OutboundBlockedError } = await import('../src/utils/deploy-environment');

    const blocked = describeMflFailure(new OutboundBlockedError('MFL write'));
    expect(blocked.blocked).toBe(true);
    expect(blocked.message).toBe(MFL_WRITE_BLOCKED_MESSAGE);
    // The owner-facing copy must not read as an outage, and must not send an
    // owner looking at a source file.
    expect(blocked.message).not.toMatch(/Could not reach MFL|src\/utils/);

    const network = describeMflFailure(new Error('fetch failed'));
    expect(network.blocked).toBe(false);
    expect(network.message).toBe('Could not reach MFL: fetch failed');
  });

  it('a bulk ledger write refuses every row once, not row by row', async () => {
    // The refusal belongs to the DEPLOYMENT, so row 2 cannot fare better than
    // row 1. The loop used to attempt all of them and report each as its own
    // row-level MFL failure, which reads like a partially-applied batch — the
    // one thing an accounting write must never be ambiguous about.
    const previous = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = 'preview';
    try {
      const { writeAccountingRecords } = await import('../src/utils/mfl-accounting');
      const { MFL_WRITE_BLOCKED_MESSAGE } = await import('../src/utils/mfl-fetch');
      const rows = [
        { franchiseId: '0001', amount: 10, description: 'one' },
        { franchiseId: '0002', amount: 20, description: 'two' },
        { franchiseId: '0003', amount: 30, description: 'three' },
      ];
      const results = await writeAccountingRecords(rows, {
        league: { id: '13522', slug: 'theleague', mflHost: 'www49.myfantasyleague.com' } as never,
        year: 2026,
        mflUserCookie: 'unused — the guard throws before the network',
      } as never);

      expect(results).toHaveLength(rows.length);
      expect(results.every((r) => r.ok === false && r.blocked === true)).toBe(true);
      expect(results.every((r) => r.error === MFL_WRITE_BLOCKED_MESSAGE)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previous;
    }
  });

  it('every MFL write routes its catch through describeMflFailure', () => {
    // A write is an mflFetch call carrying method: 'POST'. Reads are exempt —
    // the guard never blocks an export, so there is nothing to describe.
    const offenders = SOURCE_FILES.filter((f) => {
      if (f.path === 'src/utils/mfl-fetch.ts') return false;
      const writes = [...f.body.matchAll(/mflFetch\(/g)].some((m) =>
        /method:\s*'POST'/.test(f.body.slice(m.index! + m[0].length, m.index! + m[0].length + 400)),
      );
      return writes && !/describeMflFailure/.test(f.body);
    }).map((f) => f.path);

    expect(
      offenders,
      `These files POST to MFL but never call describeMflFailure, so a staging ` +
        `refusal reaches the owner as an outage or an internal error:\n  ` +
        `${offenders.join('\n  ')}\n\n` +
        `Import it from src/utils/mfl-fetch.ts and branch on \`blocked\` in the catch.`,
    ).toEqual([]);
  });
});
