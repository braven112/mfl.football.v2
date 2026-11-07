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

import { execFileSync } from 'child_process';
import { realpathSync } from 'fs';
import { pathToFileURL } from 'url';

/** Vercel's exit codes. Inverted on purpose — see the header. */
export const BUILD = 1;
export const SKIP = 0;

/**
 * The branch the per-league staging sites are aliased to in Vercel
 * (staging.theleague.us, staging.afl-fantasy.com, staging.mfl.football).
 *
 * It is exempt from the no-PR gate on purpose, and it is the ONE exemption:
 * those domains are pinned to this branch's latest deployment, so a skipped
 * build leaves all three staging sites serving stale code with no signal that
 * anything was skipped (a skip shows as CANCELED, and only the build log says
 * why). That is a deliberate trade of a handful of builds for staging sites that
 * are actually current — every other branch still needs its PR.
 *
 * A code constant rather than a Vercel env var, per CLAUDE.md "Feature flags —
 * code, not GitHub Actions variables": editing a dashboard value is never
 * easier than editing this line, and it would split the source of truth.
 */
export const STAGING_BRANCH = 'staging';

/**
 * The branch the custom-site demo (`*.demo.mfl.football`) is aliased to — the
 * same situation as STAGING_BRANCH, a pinned site that must not go stale, and
 * the only other exemption. Must equal `DEMO_BRANCH` in
 * src/utils/deploy-environment.ts (pinned by tests/demo-isolation.test.ts).
 * See docs/plans/custom-site-demo.md.
 */
export const DEMO_BRANCH = 'demo';

const GITHUB_API = 'https://api.github.com';

/**
 * Skip the build for a commit that only carries data a sync already made live.
 *
 * The roster sync publishes its files to the league-data store and moves the
 * live pointer (src/config/league-data-live.mjs) BEFORE it commits, and marks
 * the commit with `[league-data: <overlay>]` only when that publish succeeded.
 * Every running deploy picks the data up within a minute, so building it again
 * buys nothing — and those commits were about half of all builds.
 *
 * A code constant, for the same reason as STAGING_BRANCH. Off = every such
 * commit builds again, exactly as before phase 2.
 */
export const SKIP_LIVE_DATA_COMMITS = true;

/** `git` in the build's checkout. Throws on any failure; callers fail open. */
const realGit = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * Why this deployment needs no build, or null when it does.
 *
 * The range is everything since the branch's last SUCCESSFUL deployment
 * (`VERCEL_GIT_PREVIOUS_SHA`), not just the tip: Vercel builds only the newest
 * commit of a push, so a code commit landing in the same push as a sync commit
 * must still force the build. Every commit in the range must carry the marker
 * (merge commits aside — the staging merge-down is one, and the diff below
 * still sees whatever it changed), and every changed file must be one the
 * pointer carries: a code, config or Markdown change anywhere builds. Any git
 * error, such as a shallow clone missing the previous deploy, is null: build.
 */
export async function liveDataOnly(env = process.env, git = realGit) {
  try {
    // Imported here, not at the top: a module that fails to load must cost
    // only this skip, never the build decision (and the CLI tests run this
    // file copied out of the repo on its own).
    const { isSyncPublishedStoreFile, parseLeagueDataMarker } = await import('./lib/sync-published.mjs');
    const range = env.VERCEL_GIT_PREVIOUS_SHA ? `${env.VERCEL_GIT_PREVIOUS_SHA}..HEAD` : 'HEAD^1..HEAD';
    const bodies = git(['log', '--no-merges', '--format=%B%x00', range])
      .split('\0')
      .map((b) => b.trim())
      .filter(Boolean);
    if (!bodies.length || !bodies.every((b) => parseLeagueDataMarker(b))) return null;
    const files = git(['diff', '--name-only', range]).split('\n').map((f) => f.trim()).filter(Boolean);
    if (!files.length || !files.every((f) => isSyncPublishedStoreFile(f))) return null;
    return `${bodies.length} sync commit(s), ${files.length} file(s), all live through the league-data pointer`;
  } catch {
    return null;
  }
}

/**
 * Decide whether this deployment should build.
 *
 * Pure apart from the injected `fetchImpl`, so the decision table is testable
 * without a network or a Vercel environment.
 *
 * @returns {Promise<{code: number, reason: string}>}
 */
export async function decide(env = process.env, fetchImpl = globalThis.fetch, git = realGit) {
  const build = (reason) => ({ code: BUILD, reason });
  const skip = (reason) => ({ code: SKIP, reason });

  // Data a sync already made live — production or the staging merge-down that
  // carries it. The only reason production ever skips.
  const isAliasBranch = env.VERCEL_ENV === 'production' || env.VERCEL_GIT_COMMIT_REF === STAGING_BRANCH;
  if (SKIP_LIVE_DATA_COMMITS && isAliasBranch && env.FORCE_PREVIEW_BUILD !== '1') {
    const why = await liveDataOnly(env, git);
    if (why) return skip(why);
  }

  // Production is otherwise never gated. Nothing about main's cadence is discretionary.
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

  // The staging sites' branch — see STAGING_BRANCH. Checked before the network
  // call so a GitHub outage can never stop a test-site deploy.
  if (ref === STAGING_BRANCH) {
    return build(`branch is ${STAGING_BRANCH} (test-site alias target)`);
  }
  if (ref === DEMO_BRANCH) {
    return build(`branch is ${DEMO_BRANCH} (demo-site alias target)`);
  }

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
//
// pathToFileURL, NOT `file://` + argv[1]: import.meta.url is percent-encoded, so
// a repo path containing a space (or any character needing escaping) makes the
// naive comparison false. That would skip the CLI block and exit 0 — which
// Vercel reads as IGNORE, silently cancelling every deployment including
// production. The one fail-CLOSED path in a fail-open script.
//
// realpathSync, because Node resolves symlinks before it sets import.meta.url
// but leaves argv[1] exactly as typed. On macOS tmpdir() is /var/… which is a
// symlink to /private/var/…, so a script run from there compared unequal and
// exited 0 — the same silent IGNORE, reached through a different door.
const resolveArgvPath = (argvPath) => {
  try {
    return realpathSync(argvPath);
  } catch {
    return argvPath;
  }
};
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolveArgvPath(process.argv[1])).href;

if (invokedDirectly) {
  const { code, reason } = await decide();
  console.log(`[ignore-build] ${code === BUILD ? 'BUILD' : 'SKIP'} — ${reason}`);
  process.exit(code);
}
