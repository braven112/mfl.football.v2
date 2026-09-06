/**
 * Guards the Vercel Ignored Build Step decision table.
 *
 * The dangerous part of this script is not the policy, it is Vercel's inverted
 * exit codes: exit 0 IGNORES a build, exit 1 PROCEEDS with one. Inverting them
 * silently stops every deployment in the project, so the numbers themselves are
 * asserted here, not just "build" vs "skip".
 *
 * The second rule this pins is fail-open: every unexpected condition must build.
 * A cost optimization that can block a deploy is worse than the cost.
 */

import { describe, it, expect } from 'vitest';
import { decide, BUILD, SKIP } from '../scripts/vercel-ignore-build.mjs';

/** Minimal preview env with everything the PR lookup needs. */
const previewEnv = (overrides: Record<string, string> = {}) => ({
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'claude/some-branch',
  VERCEL_GIT_REPO_OWNER: 'braven112',
  VERCEL_GIT_REPO_SLUG: 'mfl.football.v2',
  ...overrides,
});

/** A fetch stub returning `body` with `status`. */
const stubFetch = (body: unknown, status = 200) =>
  async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as unknown as Response;

/** A fetch stub that throws, as a network failure would. */
const throwingFetch = (message: string) => async () => {
  throw new Error(message);
};

describe('Vercel exit-code contract', () => {
  it('uses Vercel’s inverted codes: 1 proceeds, 0 ignores', () => {
    expect(BUILD).toBe(1);
    expect(SKIP).toBe(0);
  });
});

describe('decisions that never reach the network', () => {
  it('always builds production, even with no PR anywhere', async () => {
    const { code } = await decide(
      { VERCEL_ENV: 'production' },
      stubFetch([]),
    );
    expect(code).toBe(BUILD);
  });

  it('builds when FORCE_PREVIEW_BUILD=1 overrides a missing PR', async () => {
    const { code } = await decide(
      previewEnv({ FORCE_PREVIEW_BUILD: '1' }),
      stubFetch([]),
    );
    expect(code).toBe(BUILD);
  });

  it('builds main even if it somehow arrives as a preview', async () => {
    const { code } = await decide(
      previewEnv({ VERCEL_GIT_COMMIT_REF: 'main' }),
      stubFetch([]),
    );
    expect(code).toBe(BUILD);
  });
});

describe('the actual policy', () => {
  it('builds a branch that has an open PR', async () => {
    const { code, reason } = await decide(
      previewEnv(),
      stubFetch([{ number: 991 }]),
    );
    expect(code).toBe(BUILD);
    expect(reason).toContain('991');
  });

  it('SKIPS a branch with no open PR — the whole point of the script', async () => {
    const { code } = await decide(previewEnv(), stubFetch([]));
    expect(code).toBe(SKIP);
  });

  it('scopes the PR query to this owner and branch', async () => {
    let seen = '';
    await decide(previewEnv(), async (url: string) => {
      seen = url;
      return stubFetch([])();
    });
    expect(seen).toContain('braven112%3Aclaude%2Fsome-branch');
    expect(seen).toContain('state=open');
  });
});

describe('fail open', () => {
  it.each([
    ['a rate limit', stubFetch({ message: 'rate limited' }, 403)],
    ['an auth failure', stubFetch({ message: 'unauthorized' }, 401)],
    ['a server error', stubFetch({}, 500)],
    ['a non-array body', stubFetch({ message: 'not a list' })],
    ['a network error', throwingFetch('ECONNREFUSED')],
    ['a timeout', throwingFetch('The operation was aborted due to timeout')],
  ])('builds on %s', async (_label, fetchImpl) => {
    const { code } = await decide(previewEnv(), fetchImpl as typeof fetch);
    expect(code).toBe(BUILD);
  });

  it.each([
    ['no branch ref', { VERCEL_GIT_COMMIT_REF: '' }],
    ['no repo owner', { VERCEL_GIT_REPO_OWNER: '' }],
    ['no repo slug', { VERCEL_GIT_REPO_SLUG: '' }],
  ])('builds when the env is missing %s', async (_label, overrides) => {
    const { code } = await decide(previewEnv(overrides), stubFetch([]));
    expect(code).toBe(BUILD);
  });
});
