#!/usr/bin/env node
/**
 * Should this rollup run actually publish?
 *
 * FIRST, A CORRECTION TO THE PLAN
 * -------------------------------
 * `docs/plans/staging-release-process.md` says the Monday rollup "announces
 * features that are not live yet" and that owners "get a push notification, tap
 * through, and the feature isn't there." Measured against the built train on
 * 2026-09-16, that is NOT what happens, and the reason matters:
 *
 *   The rollup runs on `main` and reads MAIN's copy of
 *   weekly-changelog-staging.json. A feature PR stages its entry on `staging`,
 *   and that entry only reaches main at the promotion.
 *
 * So the cron structurally cannot announce an unpromoted feature — it can only
 * see the bypass lane's work (hotfixes, cron and data-pipeline fixes, which go
 * straight to main and are already live). That concern was correct BEFORE the
 * train existed, when everything landed on main; the train fixed it as a side
 * effect and the plan was never updated.
 *
 * THE REAL DEFECT IS THE OPPOSITE ONE: THE ANNOUNCEMENT IS LATE
 * ------------------------------------------------------------
 * At the promotion, a release's worth of staged entries arrives on main all at
 * once — 21 of them in the first release. Nothing publishes them until the next
 * Monday, so a feature can go live on Tuesday and be announced up to six days
 * later.
 *
 * And it is worse than a delay, because the article id is
 * `weekly-rollup-<monday>` and the rollup refuses to publish a second article
 * for a week that already has one (the `alreadyPublished` guard). So a Monday
 * cron firing the night before a promotion BURNS THAT WEEK'S ID ON HOTFIXES
 * ALONE, and the release's own entries roll to the following Monday.
 *
 * THE FIX, IN TWO PARTS
 * ---------------------
 * 1. The release tag publishes. `/promote` pushes `vYYYY.MM.DD` right after
 *    fast-forwarding main, so the article lands the same day as the code — and
 *    cannot precede it, since the tag cannot exist first. This is the plan's
 *    own preference ("structural rather than two schedules that happen to
 *    agree"), and it is right for a better reason than the plan gives.
 *
 * 2. This gate keeps the week's id FREE for that article. On a scheduled run it
 *    publishes only when nothing is waiting on `staging`; if a release is
 *    pending, the cron stands down so the promotion's own run can cover the
 *    whole week in one piece. Without it, "keep the cron as a floor" would just
 *    mean the cron wins the id every week and the release article is always a
 *    week behind.
 *
 * The cron survives because the bypass lane is real: a week of pure hotfixes
 * has nothing on `staging`, no promotion to wait for, and still deserves its
 * article.
 *
 * FAIL OPEN, DELIBERATELY
 * -----------------------
 * If the comparison cannot be made — no token, an API error, a rate limit —
 * this publishes anyway and says so loudly. Same reasoning as
 * `scripts/vercel-ignore-build.mjs`, which is pinned to fail open by test: a
 * scheduling optimisation that can silently suppress the week's announcement
 * forever is worse than the thing it optimises. The cost of failing open is
 * that one release's article defers a week — which is exactly the behaviour
 * this replaces, so the floor is the status quo rather than silence.
 */

const GITHUB_API = 'https://api.github.com';

/**
 * The decision, as a pure function so it can be tested without a network.
 *
 * @param {object} input
 * @param {string} input.trigger GitHub's `github.event_name`.
 * @param {number|null} input.aheadBy How many commits `staging` has that `main`
 *   does not. `null` means "could not determine" — see FAIL OPEN above.
 * @returns {{ publish: boolean, reason: string }}
 */
export function shouldPublish({ trigger, aheadBy }) {
  // A tag push IS the promotion, and a manual dispatch is someone asking on
  // purpose. Neither needs the guard: the guard exists to stop the clock from
  // taking the week's article id before the release can use it.
  if (trigger !== 'schedule') {
    return { publish: true, reason: `trigger is ${trigger}, not the cron — publishing` };
  }

  if (aheadBy === null) {
    return {
      publish: true,
      reason:
        'could not compare main...staging — publishing anyway (this gate fails open on purpose)',
    };
  }

  if (aheadBy > 0) {
    return {
      publish: false,
      reason:
        `staging is ${aheadBy} commit(s) ahead of main, so a release is pending. ` +
        `Standing down so the week's article id stays free: publishing now would ` +
        `cover the hotfixes alone and push the release's own entries to next week.`,
    };
  }

  return {
    publish: true,
    reason: 'staging contains nothing main does not — no release pending, publishing',
  };
}

/**
 * How far ahead `staging` is, via the compare API.
 *
 * The API rather than git ancestry on purpose: the rollup's checkout is
 * shallow, and deepening it to run one `merge-base` costs more than one
 * request. Returns `null` on any failure — the caller treats that as fail-open.
 *
 * THE DECLARED PARAMETER BLOCK BELOW IS LOAD-BEARING, not decoration. A
 * destructured option bag in a `.mjs` is typed from the destructuring ALONE,
 * so a bare name with no default contributes nothing to the inferred shape:
 * `{ repo, token, fetchImpl = fetch }` infers as `{ fetchImpl?: … }` and every
 * caller passing `repo` is a ts(2353). That is the `staleOptionShapes` class,
 * driven to zero and pinned there by tests/typecheck-baseline.typecheck.ts —
 * the same trap `redactTradeOffer` hit, recorded in the baseline's own
 * provenance note. Declaring the parameters is the fix; a `= undefined`
 * default is not, because it infers the type AS `undefined` and breaks every
 * caller passing a real value.
 *
 * And do not name a JSDoc tag in the prose of a doc comment. Writing the tag
 * name inline here is what broke this block on the first attempt: the parser
 * read it as a real tag, took the next word as the parameter name, and
 * discarded the genuine declarations underneath — so the comment explaining
 * the fix was the thing defeating it.
 *
 * The injected fetch is typed as the SLICE actually used — a URL, optional
 * init, and a response read for `ok`, `status` and `json()` — rather than as
 * `typeof fetch`. The real `fetch` still satisfies it (its parameter is wider,
 * which contravariance allows, and `Response` carries all three members), and
 * a test can hand over a three-property stub without an `as unknown as` cast.
 * Casting at the call sites would have been the other way to green, and the
 * worse one: it suppresses exactly the mismatch this type exists to catch.
 *
 * @param {object} [options]
 * @param {string} [options.repo] `owner/name`, normally `GITHUB_REPOSITORY`.
 * @param {string} [options.token] A token with read access to the repo.
 * @param {(url: string, init?: RequestInit) => Promise<{ ok: boolean, status: number, json: () => Promise<any> }>} [options.fetchImpl]
 *   Injected by tests; defaults to the global `fetch`.
 * @param {number} [options.timeoutMs] Abort budget for the request. Without one
 *   a stalled DNS/TCP/TLS connect leaves this awaiting `fetch` forever, and the
 *   fail-open path below — the whole safety net — is never reached: the job
 *   hangs instead of publishing. `catch` turns the abort into the documented
 *   `null`.
 * @returns {Promise<number|null>} Commits `staging` has that `main` lacks, or
 *   `null` when the comparison could not be made.
 */
export async function fetchAheadBy({ repo, token, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  if (!repo || !token) return null;
  try {
    const res = await fetchImpl(`${GITHUB_API}/repos/${repo}/compare/main...staging`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'changelog-rollup-gate',
      },
    });
    // A 404 is the legitimate "there is no staging branch" case — a repo
    // without the release train has nothing to wait for, which reads as zero.
    if (res.status === 404) return 0;
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.ahead_by === 'number' ? body.ahead_by : null;
  } catch {
    return null;
  }
}

const invokedDirectly =
  process.argv[1] && process.argv[1].endsWith('changelog-rollup-gate.mjs');

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? null : argv[i + 1];
  };

  const trigger = arg('--trigger') ?? process.env.GITHUB_EVENT_NAME ?? 'workflow_dispatch';
  const aheadBy =
    trigger === 'schedule'
      ? await fetchAheadBy({
          repo: process.env.GITHUB_REPOSITORY,
          token: process.env.GITHUB_TOKEN,
        })
      : 0;

  const { publish, reason } = shouldPublish({ trigger, aheadBy });

  console.log(`[rollup-gate] ${publish ? 'PUBLISH' : 'SKIP'} — ${reason}`);
  if (publish && trigger === 'schedule' && aheadBy === null) {
    console.log('::warning::Rollup gate could not read main...staging; published without the check.');
  }

  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
  }
}
