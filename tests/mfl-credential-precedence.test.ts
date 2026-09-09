import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
  'scripts/mint-mfl-session.mjs',
];

const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('MFL credential precedence', () => {
  it('every credential consumer still reads both a login pair and a stored cookie', () => {
    // If this fails the file was restructured — re-point the guard rather than
    // deleting it, or the ordering rule below stops being checked at all.
    for (const rel of CREDENTIAL_CONSUMERS) {
      const src = read(rel);
      expect(src, `${rel}: no MFL_USERNAME`).toContain('MFL_USERNAME');
      expect(src, `${rel}: no MFL_USER_ID`).toContain('MFL_USER_ID');
    }
  });

  it('reaches for the login BEFORE the stored cookie', () => {
    const offenders: string[] = [];
    for (const rel of CREDENTIAL_CONSUMERS) {
      const lines = read(rel).split('\n');
      // The first line that BRANCHES on each source — comments and env reads
      // don't count, only the conditional that decides which one is used.
      const loginAt = lines.findIndex((l) => /^\s*(\}\s*else\s+)?if\s*\(.*\busername\b.*&&.*\bpassword\b/.test(l));
      const cookieAt = lines.findIndex((l) => /^\s*(\}\s*else\s+)?if\s*\(\s*!?\s*(env|stored)/i.test(l) && /userId|UserId|USER_ID/.test(l));
      if (loginAt === -1) continue; // covered by the shape test above
      if (cookieAt !== -1 && cookieAt < loginAt) {
        offenders.push(
          `${rel}:${cookieAt + 1} branches on the stored cookie before the login at :${loginAt + 1}`,
        );
      }
    }
    expect(
      offenders,
      'A stored MFL cookie fails by being present and EXPIRED, so a login gated behind '
        + '"no cookie set" never runs. Prefer the login; keep the cookie as the fallback.\n'
        + offenders.join('\n'),
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
 * The proof run must actually withhold the secret.
 *
 * A GitHub expression like `${{ inputs.withhold && '' || secrets.X }}` does
 * NOT withhold anything: '' is falsy, so `||` falls through and the secret is
 * passed anyway. The run would look like a proof and prove nothing. The
 * workflow therefore uses two steps whose NAMES record which credentials were
 * in scope.
 */
describe('probe-commish-cookie proof run', () => {
  const wf = read('.github/workflows/probe-commish-cookie.yml');

  it('has a step that runs the write probe with NO stored cookie in env', () => {
    // Anchor on the STEP, not the first textual match — the input description
    // names the same mode and appears earlier in the file.
    const stepStart = wf.indexOf('- name: No-op write test (test league) — username/password ONLY');
    expect(stepStart, 'no username/password-only step').toBeGreaterThan(-1);
    const step = wf.slice(stepStart, wf.indexOf('run:', stepStart));
    expect(step, 'the proof step still passes MFL_IS_COMMISH').not.toContain('MFL_IS_COMMISH');
    expect(step, 'the proof step still passes MFL_USER_ID').not.toContain('MFL_USER_ID');
    expect(step).toContain('MFL_USERNAME');
    expect(step).toContain('MFL_PASSWORD');
  });

  it('never tries to withhold a secret with a falsy-empty-string expression', () => {
    const bad = wf
      .split('\n')
      .map((line, i) => ({ line, i }))
      // Skip comments — the workflow documents this trap, and a guard that
      // fires on its own explanation is a guard nobody keeps.
      .filter(({ line }) => !/^\s*#/.test(line))
      .filter(({ line }) => /&&\s*''\s*\|\|\s*secrets\./.test(line));
    expect(
      bad.map(({ line, i }) => `:${i + 1} ${line.trim()}`),
      "`cond && '' || secrets.X` passes the secret — '' is falsy. Use separate steps.",
    ).toEqual([]);
  });
});

/**
 * The proof runs in CI, not by hand.
 *
 * A one-off dispatch answers "did it work once". The question that matters is
 * "is it still true" — before stages 3-4 delete the stored cookies, and after.
 * mfl-integration-test.yml runs on every push to main and daily at 7am PT, so
 * the proof belongs there.
 */
describe('credentials-only write proof runs in CI', () => {
  const wf = read('.github/workflows/mfl-integration-test.yml');
  const STEP = '- name: Credentials-only write proof';

  it('exists as a step in the integration test', () => {
    expect(wf.indexOf(STEP), 'no credentials-only proof step').toBeGreaterThan(-1);
  });

  it('runs with no stored cookie in scope', () => {
    const start = wf.indexOf(STEP);
    const step = wf.slice(start, wf.indexOf('run:', start));
    expect(step).toContain('MFL_USERNAME');
    expect(step).toContain('MFL_PASSWORD');
    // The mint step exports MFL_IS_COMMISH via $GITHUB_ENV, so the proof step
    // must blank it explicitly or the run is not a clean proof.
    expect(step, 'MFL_IS_COMMISH is not blanked, so the minted one is in scope')
      .toMatch(/MFL_IS_COMMISH:\s*''/);
    // Blanked with a literal — never by reaching for the secret.
    expect(step, 'the proof step reads a stored cookie secret').not.toContain('secrets.MFL_IS_COMMISH');
    expect(step, 'the proof step reads a stored cookie secret').not.toContain('secrets.MFL_USER_ID');
  });

  it('runs even when the write tests above failed (independent signal)', () => {
    const start = wf.indexOf(STEP);
    const step = wf.slice(start, wf.indexOf('run:', start));
    expect(step, 'a failing write test would skip the proof and hide the answer')
      .toContain('if: always()');
  });
});
