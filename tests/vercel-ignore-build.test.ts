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
import { execFileSync } from 'child_process';
import { mkdtempSync, copyFileSync, rmSync, realpathSync, symlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { decide, liveDataOnly, BUILD, SKIP, STAGING_BRANCH, DEMO_BRANCH } from '../scripts/vercel-ignore-build.mjs';

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

/** A git that fails every command, as a clone missing history would. */
const noGit = () => {
  throw new Error('no git');
};

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
      noGit,
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

  it('builds the staging branch with no PR — the staging sites alias it', async () => {
    // staging.theleague.us / staging.afl-fantasy.com are pinned to this branch's
    // latest deployment. Skipping its build silently serves stale code on all
    // three staging sites, and a skip only ever shows as CANCELED.
    const { code, reason } = await decide(
      previewEnv({ VERCEL_GIT_COMMIT_REF: STAGING_BRANCH }),
      stubFetch([]),
      noGit,
    );
    expect(code).toBe(BUILD);
    expect(reason).toContain(STAGING_BRANCH);
  });

  it('decides staging without asking GitHub at all', async () => {
    // A GitHub outage or a 403 must never be able to stall a test-site
    // deploy, so the branch check sits ahead of the network call.
    let called = false;
    const spy: typeof fetch = async (input) => {
      called = true;
      return stubFetch([])();
    };
    const { code } = await decide(
      previewEnv({ VERCEL_GIT_COMMIT_REF: STAGING_BRANCH }),
      spy,
      noGit,
    );
    expect(code).toBe(BUILD);
    expect(called).toBe(false);
  });

  it('exempts ONLY staging — a lookalike branch still needs its PR', async () => {
    for (const ref of [`${STAGING_BRANCH}-2`, `claude/${STAGING_BRANCH}`, 'stage']) {
      const { code } = await decide(
        previewEnv({ VERCEL_GIT_COMMIT_REF: ref }),
        stubFetch([]),
      );
      expect(code, `${ref} must not inherit the staging exemption`).toBe(SKIP);
    }
  });

  it('builds the demo branch with no PR, without asking GitHub — the demo sites alias it', async () => {
    // *.demo.mfl.football is pinned to this branch the way the staging sites
    // are pinned to staging (docs/plans/custom-site-demo.md).
    let called = false;
    const spy: typeof fetch = async () => {
      called = true;
      return stubFetch([])();
    };
    const { code, reason } = await decide(previewEnv({ VERCEL_GIT_COMMIT_REF: DEMO_BRANCH }), spy);
    expect(code).toBe(BUILD);
    expect(reason).toContain(DEMO_BRANCH);
    expect(called).toBe(false);

    for (const ref of [`${DEMO_BRANCH}-2`, `claude/${DEMO_BRANCH}`, 'demos']) {
      const lookalike = await decide(previewEnv({ VERCEL_GIT_COMMIT_REF: ref }), stubFetch([]));
      expect(lookalike.code, `${ref} must not inherit the demo exemption`).toBe(SKIP);
    }
  });

  it('scopes the PR query to this owner and branch', async () => {
    let seen = '';
    // Signature must match lib.dom's fetch, not just the string we pass — a
    // narrowed `url: string` is a ts(2345) against RequestInfo | URL.
    const spy: typeof fetch = async (input) => {
      seen = String(input);
      return stubFetch([])();
    };
    await decide(previewEnv(), spy);
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

describe('the CLI guard must not fail closed', () => {
  /**
   * import.meta.url is percent-encoded; `file://` + argv[1] is not. Comparing
   * them naively is false for any path needing escaping, which skips the CLI
   * block and exits 0 — and Vercel reads 0 as IGNORE. That is the one
   * fail-CLOSED path in a fail-open script: it would silently cancel every
   * deployment, production included. Hence pathToFileURL, and hence this test
   * running the script from a directory with a space in its name.
   */
  it('still BUILDs when run from a path containing a space', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pre build '));
    try {
      const script = join(dir, 'vercel-ignore-build.mjs');
      copyFileSync('scripts/vercel-ignore-build.mjs', script);

      let code = 0;
      try {
        execFileSync(process.execPath, [script], {
          env: { ...process.env, VERCEL_ENV: 'production' },
          encoding: 'utf8',
        });
      } catch (err) {
        code = (err as { status: number }).status;
      }

      // 1 = proceed with the build. A 0 here means the guard fell through.
      expect(code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Node resolves symlinks before setting import.meta.url; argv[1] stays as
   * typed. macOS's tmpdir() is /var/… → /private/var/…, so the test above
   * exited 0 on every Mac while passing on Linux CI. This one builds the
   * symlink itself, so Linux CI pins it too.
   */
  it('still BUILDs when invoked through a symlinked directory', () => {
    const real = realpathSync(mkdtempSync(join(tmpdir(), 'ignore-build-real-')));
    const link = `${real}-link`;
    try {
      copyFileSync('scripts/vercel-ignore-build.mjs', join(real, 'vercel-ignore-build.mjs'));
      symlinkSync(real, link, 'dir');

      let code = 0;
      try {
        execFileSync(process.execPath, [join(link, 'vercel-ignore-build.mjs')], {
          env: { ...process.env, VERCEL_ENV: 'production' },
          encoding: 'utf8',
        });
      } catch (err) {
        code = (err as { status: number }).status;
      }

      expect(code).toBe(1);
    } finally {
      rmSync(link, { force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });
});

/**
 * Phase 2 of "Data syncs without a Vercel build": a commit that only carries
 * data the roster sync already made live through the league-data pointer
 * skips its build — on production and on the staging merge-down — and
 * anything else in range builds.
 */
describe('commits whose data is already live', () => {
  const OVERLAY = 'c'.repeat(32);
  const MARKED = `chore: sync rosters and playoff data [league-data: ${OVERLAY}]`;
  const ADP = 'data/theleague/mfl-feeds/2026/adp-redraft.json';

  /** A git that answers `log` with these bodies and `diff` with these files. */
  const fakeGit = (bodies: string[], files: string[], seen: string[][] = []) => (args: string[]) => {
    seen.push(args);
    if (args[0] === 'log') return bodies.map((b) => `${b}\0`).join('\n');
    if (args[0] === 'diff') return files.join('\n');
    throw new Error(`unexpected git ${args.join(' ')}`);
  };

  it('skips production for a marked commit that changes only live data', async () => {
    const res = await decide({ VERCEL_ENV: 'production' }, stubFetch([]), fakeGit([MARKED], [ADP]));
    expect(res.code).toBe(SKIP);
  });

  it('checks everything since the last successful deploy, not just the tip', async () => {
    const seen: string[][] = [];
    await liveDataOnly({ VERCEL_GIT_PREVIOUS_SHA: 'abc123' }, fakeGit([MARKED], [ADP], seen));
    expect(seen.map((a) => a.at(-1))).toEqual(['abc123..HEAD', 'abc123..HEAD']);
  });

  it('builds when any commit in range is not marked — a code commit in the same push', async () => {
    const res = await decide(
      { VERCEL_ENV: 'production' },
      stubFetch([]),
      fakeGit([MARKED, 'Fix the standings page (#1700)'], [ADP]),
    );
    expect(res.code).toBe(BUILD);
  });

  it('builds when a changed file is not one the pointer carries', async () => {
    for (const file of [
      'src/pages/theleague/standings.astro',
      'data/sandbox/derived/rules-from-mfl.md',
      'data/theleague/config.json',
    ]) {
      const res = await decide({ VERCEL_ENV: 'production' }, stubFetch([]), fakeGit([MARKED], [ADP, file]));
      expect(res.code, file).toBe(BUILD);
    }
  });

  it('skips the staging merge-down that carries only marked commits', async () => {
    const res = await decide(
      previewEnv({ VERCEL_GIT_COMMIT_REF: STAGING_BRANCH }),
      stubFetch([]),
      fakeGit([MARKED, MARKED], [ADP]),
    );
    expect(res.code).toBe(SKIP);
  });

  it('fails open: any git error, an empty range or FORCE_PREVIEW_BUILD builds', async () => {
    expect((await decide({ VERCEL_ENV: 'production' }, stubFetch([]), noGit)).code).toBe(BUILD);
    expect((await decide({ VERCEL_ENV: 'production' }, stubFetch([]), fakeGit([], []))).code).toBe(BUILD);
    expect((await decide({ VERCEL_ENV: 'production' }, stubFetch([]), fakeGit([MARKED], []))).code).toBe(BUILD);
    expect(
      (await decide(previewEnv({ VERCEL_GIT_COMMIT_REF: STAGING_BRANCH, FORCE_PREVIEW_BUILD: '1' }), stubFetch([]), fakeGit([MARKED], [ADP]))).code,
    ).toBe(BUILD);
  });

  it('never applies to an ordinary branch — those are decided by their PR', async () => {
    const res = await decide(previewEnv(), stubFetch([{ number: 9 }]), fakeGit([MARKED], [ADP]));
    expect(res.code).toBe(BUILD);
    expect(res.reason).toMatch(/PR #9/);
  });
});

describe('.vercelignore keeps git history for the live-data check', () => {
  // Vercel applies .vercelignore before running the ignore command, so a
  // `.git/` line there deletes the history liveDataOnly reads and every
  // marked sync commit builds anyway (shipped 2026-11-07).
  it('does not exclude .git', () => {
    const lines = readFileSync(join(__dirname, '..', '.vercelignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(lines.filter((l) => /^\/?\.git(\/|$|\/\*)/.test(l))).toEqual([]);
  });
});
