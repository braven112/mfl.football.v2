import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A LOGIN MUST BE PREFERRED OVER A STORED COOKIE — in every job that has both.
 *
 * The failure mode of an MFL cookie secret is that it is PRESENT AND EXPIRED,
 * and a present cookie is a non-empty string forever. So `if (storedCookie)
 * … else if (username && password)` puts the login behind a branch that only
 * fires when the secret is MISSING — i.e. never — and the job depends on a
 * credential that silently dies every few weeks.
 *
 * docs/claude/rules/accounting.md records this from the accounting job, where
 * the first cut gated the login on `(!userCookie || !commishCookie)` and could
 * never fire. The lesson was not ported: apply-pending-contracts.mjs carried
 * the cookie-first ordering until 2026-09-09, and when the stored cookie
 * expired on 2026-09-08 every approved contract declaration stopped reaching
 * MFL. mint-mfl-session.mjs had the same shape behind a subtler condition.
 *
 * Three implementations, two of which were wrong, is what makes this a scan
 * rather than a unit test: the rule is about ORDER in a file, and the next
 * script to grow a credential block is the one nobody will think to check.
 */

const REPO_ROOT = process.cwd();

/** Scripts that resolve MFL credentials from BOTH a login pair and a stored cookie. */
const CREDENTIAL_CONSUMERS = [
  'scripts/apply-pending-contracts.mjs',
  'scripts/sync-draft-pick-contracts.mjs',
];

/**
 * Deliberately NOT subject to the ordering rule, with the reason.
 *
 * fetch-owner-names.mjs reads owner names, which MFL returns only to a
 * COMMISSIONER session — a request carrying MFL_USER_ID alone authenticates
 * fine and comes back anonymous, which is a silent wrong answer rather than an
 * error. Since no MFL request issues MFL_IS_COMMISH (2026-09-05 probe), only
 * the STORED pair can carry that flag, so preferring a login there would
 * downgrade the script to the anonymous payload. The write path has no such
 * constraint — the write does not need the flag — which is why the rule applies
 * to the others and not this one.
 *
 * Consequence worth knowing: this script depends on a hand-rotated cookie and
 * cannot be freed by the login the way the write jobs were.
 */
const EXEMPT = new Map([
  ['scripts/fetch-owner-names.mjs', 'owner names require a commissioner session; only the stored pair carries MFL_IS_COMMISH'],
  // Its decision is not an if/else in main() — it is the pure pickMflSession(),
  // whose internal order a line scan cannot read (the scan sees `stored.userId`
  // inside the helper and the login gate 60 lines later in main() and calls it
  // an inversion). Enforced by unit tests instead, and the test below asserts
  // those tests still exist, so this exemption cannot become a hole.
  ['scripts/mint-mfl-session.mjs', 'ordering lives in the pure pickMflSession(); covered by unit tests, not a text scan'],
  // Writes import?TYPE=draftResults. The 2026-09-05 probe measured
  // TYPE=salaries ONLY, so "the commissioner flag is not required" is not
  // established for this endpoint — and preferring a login there would drop
  // the flag from a write that currently works. Unproven is not the same as
  // safe, so it keeps the cookie-first ordering until its own probe run.
  ['scripts/export-best-ball-draft.mjs', 'writes TYPE=draftResults, which no probe has measured; needs its own proof before the rule applies'],
  // The file the rule CAME from, and already correct. It reads the stored
  // cookie into a mutable `userCookie` BEFORE logging in and overwrites it on
  // success — so the ordering lives in the overwrite, not in a branch, and the
  // index heuristic below reads the early assignment as an inversion. Widening
  // the patterns to accept it would blind the scan to the real thing.
  ['scripts/accounting-carry-over.ts', 'reads the stored cookie into a variable then overwrites it from the login; ordering is in the overwrite, which a line scan cannot see'],
  // A manual spike, not a scheduled job: its primary path is an OWNER cookie
  // replayed from Redis, which is a different mechanism from this rule.
  ['scripts/spike-owner-add-drop.mjs', 'manual spike; replays an owner cookie from Redis rather than resolving service credentials'],
  // The two probes are EXPERIMENTS, and the ordering rule would invert their
  // meaning: each exists to compare a login-derived cookie against a stored
  // one, so "prefer the login" is the thing being measured, not a rule to
  // impose. They are dispatch-only and write nothing on a schedule.
  ['scripts/probe-commish-cookie.mjs', 'a read-only experiment that compares credential paths; the ordering is its subject, not its rule'],
  ['scripts/probe-write-auth.mjs', 'an experiment that compares credential paths; APPEND=1 is what this file is guarded on instead'],
]);

/**
 * Every script that reads BOTH MFL_USERNAME and MFL_USER_ID must be accounted
 * for — scanned or exempted. A roster that silently omits a consumer reads as
 * coverage while leaving it unguarded, which is the failure this whole file
 * exists to prevent one level down.
 */
function discoverCredentialConsumers(): string[] {
  const dir = path.join(REPO_ROOT, 'scripts');
  const found: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(mjs|ts)$/.test(e.name)) continue;
      const src = readFileSync(full, 'utf8');
      if (src.includes('MFL_USERNAME') && src.includes('MFL_USER_ID')) {
        found.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
      }
    }
  };
  walk(dir);
  return found.sort();
}

const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('MFL credential precedence', () => {
  it('every script reading both credential kinds is either scanned or exempted', () => {
    const accounted = new Set([...CREDENTIAL_CONSUMERS, ...EXEMPT.keys()]);
    const missing = discoverCredentialConsumers().filter((f) => !accounted.has(f));
    expect(
      missing,
      'These scripts read MFL_USERNAME and MFL_USER_ID but are neither scanned nor EXEMPT. '
        + 'Add them to CREDENTIAL_CONSUMERS, or to EXEMPT with a reason — an unlisted consumer '
        + 'is unguarded while the suite reads as green.\n'
        + missing.join('\n'),
    ).toEqual([]);
  });

  it('every credential consumer still reads both a login pair and a stored cookie', () => {
    // If this fails the file was restructured — re-point the guard rather than
    // deleting it, or the ordering rule below stops being checked at all.
    for (const rel of CREDENTIAL_CONSUMERS) {
      const src = read(rel);
      expect(src, `${rel}: no MFL_USERNAME`).toContain('MFL_USERNAME');
      expect(src, `${rel}: no MFL_USER_ID`).toContain('MFL_USER_ID');
    }
  });

  it('every exemption is still a real credential consumer (a stale exemption widens the guard)', () => {
    for (const [rel, reason] of EXEMPT) {
      const src = read(rel);
      expect(src, `${rel} no longer reads a login pair — drop the exemption (${reason})`).toContain('MFL_USERNAME');
      expect(src, `${rel} no longer reads a stored cookie — drop the exemption (${reason})`).toContain('MFL_USER_ID');
    }
  });

  it('the mint-mfl-session exemption is backed by real coverage, not just a sentence', () => {
    // The exemption is only honest while those unit tests exist. If they are
    // deleted or renamed, this fails and the exemption has to be re-earned.
    const unit = read('tests/mfl-integration-rollback-guard.test.ts');
    expect(unit, 'no pickMflSession coverage').toContain('pickMflSession');
    expect(
      unit,
      'no test pins that a bare fresh login still WINS — the exact regression the exemption assumes is covered',
    ).toContain('uses a fresh login even when it carries NO commissioner flag');
  });

  it('reaches for the login BEFORE the stored cookie', () => {
    const offenders: string[] = [];
    const unscanned: string[] = [];
    for (const rel of CREDENTIAL_CONSUMERS) {
      const src = read(rel);
      // Compare the two things that actually decide it — the login CALL and the
      // first point the stored cookie is USED as a value. The earlier version
      // matched on the shape of the `if (…)` line, and both files this PR fixed
      // ended up as `if (!mflUserId && envUserId)`, which that pattern missed:
      // the assertion passed vacuously for exactly the code it exists to pin.
      const loginAt = src.indexOf('loginToMFL(');
      const cookieUseAt = Math.min(
        ...[
          /\bmflUserId\s*=\s*envUserId\b/,
          /MFL_USER_ID:\s*envUserId\b/,
          /\breturn\s+envUserId\b/,
        ]
          .map((re) => src.search(re))
          .filter((i) => i !== -1)
          .concat([Number.MAX_SAFE_INTEGER]),
      );
      if (loginAt === -1) {
        unscanned.push(`${rel}: no loginToMFL() call — the scan is not covering this file`);
        continue;
      }
      if (cookieUseAt === Number.MAX_SAFE_INTEGER) {
        unscanned.push(`${rel}: no stored-cookie use matched — widen the patterns or EXEMPT it`);
        continue;
      }
      if (cookieUseAt < loginAt) {
        offenders.push(`${rel}: uses the stored cookie at index ${cookieUseAt}, before loginToMFL() at ${loginAt}`);
      }
    }
    expect(
      offenders,
      'A stored MFL cookie fails by being present and EXPIRED, so a login gated behind '
        + '"no cookie set" never runs. Prefer the login; keep the cookie as the fallback.\n'
        + offenders.join('\n'),
    ).toEqual([]);
    expect(
      unscanned,
      'A listed consumer this scan cannot read is UNGUARDED. Widen the patterns or move it '
        + 'to EXEMPT with a reason — do not leave it silently skipped.\n'
        + unscanned.join('\n'),
    ).toEqual([]);
  });

  it('documents the login as preferred, so the next reader is not misled', () => {
    const src = read('scripts/apply-pending-contracts.mjs');
    const header = src.slice(0, src.indexOf('*/'));
    const preferredLine = header
      .split('\n')
      .find((l) => /PREFERRED/i.test(l));
    expect(preferredLine, 'no line marks a credential source as preferred').toBeTruthy();
    expect(
      preferredLine,
      'the header still advertises the stored cookie as preferred',
    ).toMatch(/MFL_USERNAME/);
  });
});

/**
 * The probe writes to a real league, so its payload rules are not optional.
 */
describe('probe-write-auth safety', () => {
  it('writes with APPEND=1', () => {
    // Without it MFL treats the payload as the WHOLE salary table and erases
    // every player not named in it. This script posts ONE player.
    //
    // Assert the URL, not the file: the comment above it explains APPEND=1, so
    // a file-wide toContain() passes on the prose after the parameter is gone.
    const probe = read('scripts/probe-write-auth.mjs');
    const importUrl = probe
      .split('\n')
      .find((l) => l.includes('import?TYPE=salaries') && l.includes('${leagueId}'));
    expect(importUrl, 'could not find the salaries import URL — re-point this guard').toBeTruthy();
    expect(importUrl, 'a non-APPEND salaries import would reduce the league to one row')
      .toContain('APPEND=1');
  });
});
