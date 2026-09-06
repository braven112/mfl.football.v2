#!/usr/bin/env node
/**
 * Vercel Ignored Build Step — skip preview builds for branches with no PR yet.
 *
 * Wired in via `ignoreCommand` in vercel.json. Vercel's exit codes here are
 * inverted from intuition and are the whole contract:
 *
 *     exit 0  →  IGNORE the build (skip it)
 *     exit 1  →  PROCEED with the build
 *
 * Getting that backwards silently stops every deployment, which is why
 * tests/vercel-ignore-build.test.ts pins the numbers themselves rather than
 * only the decisions.
 *
 * Why this exists: Build CPU Minutes were 91% of the Vercel bill ($22.36 of
 * $24.70 for the cycle ending 2026-09-07, +291%), while Fast Origin Transfer —
 * actual bandwidth — was $0.46. Build DURATION is not the problem (~128s for a
 * production build); build COUNT is. In one 7.9-hour sample there were 20
 * deployments and 14 were preview builds from agent branches, one of which
 * built four times in 19 minutes on work-in-progress pushes nobody looked at.
 *
 * So: a push to a branch with no open PR builds nothing. The moment a PR
 * exists that branch builds on every push again and the preview URL updates
 * exactly as before — review flow is unchanged.
 *
 * FAIL OPEN, ALWAYS. Every unexpected condition — network error, non-200,
 * malformed JSON, missing env — proceeds with the build. A cost optimization
 * that can block a deploy is not worth having, and GitHub's unauthenticated
 * API allows 60 req/hr against a shared Vercel egress IP, so being rate
 * limited here is a question of when, not if.
 *
 * Runs BEFORE `pnpm install`, so it uses Node builtins only.
 */

/** Vercel's exit codes. Inverted on purpose — see the header. */
export const BUILD = 1;
export const SKIP = 0;

const GITHUB_API = 'https://api.github.com';

/**
 * Decide whether this deployment should build.
 *
 * Pure apart from the injected `fetchImpl`, so the decision table is testable
 * without a network or a Vercel environment.
 *
 * @returns {Promise<{code: number, reason: string}>}
 */
export async function decide(env = process.env, fetchImpl = globalThis.fetch) {
  const build = (reason) => ({ code: BUILD, reason });
  const skip = (reason) => ({ code: SKIP, reason });

  // Production is never gated. Nothing about main's cadence is discretionary.
  if (env.VERCEL_ENV === 'production') return build('production deployment');

  // Explicit override, for a WIP branch you actively want a preview URL for.
  if (env.FORCE_PREVIEW_BUILD === '1') return build('FORCE_PREVIEW_BUILD=1');

  const ref = env.VERCEL_GIT_COMMIT_REF;
  const owner = env.VERCEL_GIT_REPO_OWNER;
  const repo = env.VERCEL_GIT_REPO_SLUG;

  // Missing the pieces needed to ask the question — not a case to guess on.
  if (!ref) return build('no VERCEL_GIT_COMMIT_REF (cannot resolve branch)');
  if (!owner || !repo) return build('no VERCEL_GIT_REPO_OWNER/SLUG (cannot query PRs)');

  // Belt and braces: main reaching here would mean VERCEL_ENV lied.
  if (ref === 'main') return build('branch is main');

  const base = env.GITHUB_API_BASE || GITHUB_API;
  const url =
    `${base}/repos/${owner}/${repo}/pulls` +
    `?head=${encodeURIComponent(`${owner}:${ref}`)}&state=open&per_page=1`;

  // A token lifts the 60/hr unauthenticated ceiling. Optional — its absence is
  // not an error, it just makes a rate-limited fail-open more likely.
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'mfl-football-vercel-ignore-build',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) });

    if (!res.ok) return build(`GitHub API returned ${res.status} (failing open)`);

    const pulls = await res.json();

    if (!Array.isArray(pulls)) return build('unexpected GitHub API shape (failing open)');

    if (pulls.length > 0) return build(`PR #${pulls[0].number} is open for ${ref}`);

    return skip(`no open PR for ${ref} — open one (or set FORCE_PREVIEW_BUILD=1) for a preview`);
  } catch (err) {
    return build(`GitHub API check failed: ${err?.message ?? err} (failing open)`);
  }
}

// CLI. Guarded so importing this module for tests does not exit the process.
const invokedDirectly =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  const { code, reason } = await decide();
  console.log(`[ignore-build] ${code === BUILD ? 'BUILD' : 'SKIP'} — ${reason}`);
  process.exit(code);
}
