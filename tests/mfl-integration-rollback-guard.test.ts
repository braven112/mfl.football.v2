import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * MFL integration-test rollback guard.
 *
 * `.github/workflows/mfl-integration-test.yml` reverts the pushed commit on
 * main when the contract-write test against the test league fails. Two
 * conditions on that rollback are load-bearing, and this test pins them:
 *
 *   1. It must never revert a commit the bot itself authored. A revert of a
 *      bot revert re-lands the original commit, which fails the same way and
 *      is reverted again. On 2026-09-05 that loop ran on main for over an
 *      hour: a production deploy and a new GitHub issue every ~75 seconds,
 *      with routes shipped by the reverted PR (the notifications preferences
 *      API among them) returning 404 on every other deploy.
 *
 *   2. It must not revert when the stored MFL cookie is dead. Every commit
 *      fails the write test the same way then ("API requires commissioner
 *      access"), so a revert removes unrelated work and fixes nothing — the
 *      loop above started from an expired cookie, not a bad commit.
 *
 * A string scan, deliberately: the guard is on the job's `if:` expression,
 * and parsing YAML to reach it would only add a dependency to get the same
 * text back.
 */

const WORKFLOW = '.github/workflows/mfl-integration-test.yml';
const BOT_NAME = 'MFL Integration Bot';

function rollbackIf(): string {
  const text = readFileSync(WORKFLOW, 'utf8');
  const start = text.indexOf('\n  rollback:');
  expect(start, `${WORKFLOW} has no rollback job`).toBeGreaterThan(-1);
  const job = text.slice(start);
  const match = job.match(/\n    if:\s*(>-?\s*)?([\s\S]*?)\n    [a-z]/);
  expect(match, 'rollback job has no if: condition').not.toBeNull();
  return match![2].replace(/\s+/g, ' ');
}

describe('mfl-integration-test rollback guard', () => {
  it('never reverts a commit authored by the bot (a revert of a revert is the loop)', () => {
    const cond = rollbackIf();
    expect(cond).toContain(`github.event.head_commit.author.name != '${BOT_NAME}'`);
  });

  it('the bot name in the guard is the one the revert step commits with', () => {
    const text = readFileSync(WORKFLOW, 'utf8');
    expect(text).toContain(`git config user.name "${BOT_NAME}"`);
  });

  it('does not revert when the MFL cookie is dead (an environment failure is not a regression)', () => {
    const cond = rollbackIf();
    expect(cond).toContain("needs.integration-test.outputs.cookie_ok == 'true'");
    const text = readFileSync(WORKFLOW, 'utf8');
    expect(text).toMatch(/cookie_ok:\s*\$\{\{\s*steps\.cookie\.outcome == 'success'\s*\}\}/);
    expect(text).toMatch(/\n\s+id: cookie\n/);
  });

  it('still only fires for pushes to main', () => {
    const cond = rollbackIf();
    expect(cond).toContain('failure()');
    expect(cond).toContain("github.event_name == 'push'");
    expect(cond).toContain("github.ref == 'refs/heads/main'");
  });
});

/**
 * The job mints its own cookie from MFL_USERNAME/MFL_PASSWORD (which do not
 * expire) and exports it via $GITHUB_ENV. A later step that re-declares
 * `MFL_USER_ID: ${{ secrets.MFL_USER_ID }}` in its own env: silently wins
 * over $GITHUB_ENV and puts the stale stored cookie back — so the stored
 * secret may be read in exactly one place: the mint step's fallback input.
 */
describe('mfl-integration-test fresh-session step', () => {
  const text = readFileSync(WORKFLOW, 'utf8');

  it('mints a session from the username/password secrets before the tests run', () => {
    const mint = text.indexOf('run: node scripts/mint-mfl-session.mjs');
    const test = text.indexOf('run: pnpm test:mfl-integration');
    expect(mint, 'no mint-mfl-session step').toBeGreaterThan(-1);
    expect(mint).toBeLessThan(test);
    expect(text).toContain('MFL_USERNAME: ${{ secrets.MFL_USERNAME }}');
    expect(text).toContain('MFL_PASSWORD: ${{ secrets.MFL_PASSWORD }}');
  });

  it('the stored cookie secret is read only by the mint step (as its fallback)', () => {
    const reads = text.match(/secrets\.MFL_USER_ID/g) ?? [];
    expect(reads).toHaveLength(1);
    const mintStep = text.indexOf('- name: Mint a fresh MFL session');
    const nextStep = text.indexOf('- name:', mintStep + 1);
    const only = text.indexOf('secrets.MFL_USER_ID');
    expect(only).toBeGreaterThan(mintStep);
    expect(only).toBeLessThan(nextStep);
  });
});

describe('mint-mfl-session', () => {
  it('prefers a complete fresh pair, falls back to the stored pair, then to nothing', async () => {
    const { pickMflSession } = await import('../scripts/mint-mfl-session.mjs');
    const stored = { userId: 'old', isCommish: 'old-c' };
    expect(pickMflSession({ mflUserId: 'new', mflIsCommish: 'new-c' }, stored)).toEqual({
      source: 'login',
      userId: 'new',
      isCommish: 'new-c',
    });
    expect(pickMflSession(null, stored)).toEqual({ source: 'stored', userId: 'old', isCommish: 'old-c' });
    expect(pickMflSession(null, {})).toEqual({ source: 'none' });
  });

  it('never pairs a fresh identity with the STORED commissioner flag (MFL refuses the mismatch)', async () => {
    const { pickMflSession } = await import('../scripts/mint-mfl-session.mjs');
    const stored = { userId: 'old', isCommish: 'old-c' };
    // Login came back without the commissioner cookie: keep the stored pair whole.
    expect(pickMflSession({ mflUserId: 'new' }, stored)).toEqual({
      source: 'stored',
      userId: 'old',
      isCommish: 'old-c',
    });
    // No commissioner flag anywhere: a plain fresh session is fine.
    expect(pickMflSession({ mflUserId: 'new' }, { userId: 'old' })).toEqual({
      source: 'login',
      userId: 'new',
      isCommish: undefined,
    });
  });

  it('reads both cookies from one response, taking MFL_USER_ID from the body when only the flag is a header', async () => {
    const { parseSessionCookies } = await import('../scripts/mint-mfl-session.mjs');
    expect(
      parseSessionCookies(['MFL_USER_ID=u1; Path=/', 'MFL_IS_COMMISH=c1; Path=/'], ''),
    ).toEqual({ mflUserId: 'u1', mflIsCommish: 'c1' });
    expect(
      parseSessionCookies(['MFL_IS_COMMISH=c1; Path=/'], '<?xml version="1.0"?><status MFL_USER_ID="u2"/>'),
    ).toEqual({ mflUserId: 'u2', mflIsCommish: 'c1' });
  });

  it('logs into the LEAGUE on the write host with L=, credentials in the body, and never follows a redirect off MFL', async () => {
    const { loginToLeague } = await import('../scripts/mint-mfl-session.mjs');
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      if (calls.length === 1) {
        return new Response('', {
          status: 302,
          headers: new Headers({ location: 'https://evil.example/collect' }),
        });
      }
      return new Response('', { status: 200 });
    };
    const result = await loginToLeague({
      username: 'u',
      password: 'p',
      leagueId: '36189',
      year: 2026,
      host: 'https://www49.myfantasyleague.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://www49.myfantasyleague.com/2026/login?L=36189');
    expect(calls[0].body).toContain('PASSWORD=p');
    expect(calls[0].url).not.toContain('PASSWORD');
    expect(result).toEqual({});
  });
});
