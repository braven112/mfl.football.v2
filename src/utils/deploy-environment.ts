/**
 * Which deployment is this, and is it allowed to touch the outside world?
 *
 * ## The problem this exists for
 *
 * The staging sites share PRODUCTION'S database and PRODUCTION'S secrets — a
 * deliberate decision (docs/plans/staging-release-process.md), because a
 * staging environment showing empty rosters and an empty Board tests almost
 * nothing. Reads and Redis writes are the accepted cost of that.
 *
 * What is NOT acceptable is the outbound half, because none of it can be
 * undone:
 *
 *   - MFL writes — lineups, contracts, waivers, in the real league
 *   - Web push — production VAPID keys, real owners' devices
 *   - GroupMe posts
 *   - Suggestion-box GitHub issue filing
 *
 * A staging deploy holding production's credentials can do all four. So each
 * of those paths calls `assertOutboundAllowed()` before it reaches the
 * network, and `tests/staging-outbound-guard.test.ts` fails the build when a
 * new one forgets.
 *
 * ## Why the deployment answers this, not the request host
 *
 * The obvious predicate is "is the request on a staging hostname?" — and that
 * IS the right question for the noindex header and the banner, which are about
 * where the viewer is (see `isStagingHost` in the registry).
 *
 * It is the wrong question here, for two reasons:
 *
 *  1. **PR previews have the same problem and no staging hostname.** Every
 *     preview deployment carries production's environment too. Blocking only
 *     the named staging hosts would leave every preview able to write to the
 *     real league — the identical hazard, missed.
 *  2. **Not every write has a request.** These utils are also called from
 *     paths where no hostname is in scope. A predicate that needs one would
 *     have to be threaded through every caller, and the one that got missed
 *     would fail open silently.
 *
 * `VERCEL_ENV` answers "is this the production deployment?" directly, per
 * deployment, with no plumbing. The earlier draft of the release plan warned
 * against `VERCEL_ENV` on the grounds that it over-matches — every preview
 * reads `preview`, not just staging. That objection is right for identifying
 * staging specifically, and backwards here: for blocking outbound writes,
 * "every non-production deployment" is exactly the set we want.
 *
 * ## Which way it fails
 *
 * Unknown → ALLOWED. `VERCEL_ENV` is unset outside Vercel, which is where the
 * cron scripts run: they execute in GitHub Actions against the real league and
 * must keep working. `pnpm dev` is also unset, and blocking local development
 * from MFL writes would make the write paths untestable.
 *
 * That is a real limitation and worth naming rather than hiding: this guard
 * protects against a *deployed* staging or preview site, not against a
 * misconfigured script. The compensating control for scripts is that they run
 * from `main` in Actions, where there is no staging code to run.
 */

import { isStagingHost, stagingHosts } from '../config/leagues-data.mjs';

export { isStagingHost, stagingHosts };

/** Outbound paths this guard covers. The string is what shows up in logs. */
export type OutboundAction =
  | 'MFL write'
  | 'web push'
  | 'GroupMe post'
  | 'GitHub issue';

/**
 * Thrown when an outbound write is attempted from a non-production deployment.
 *
 * Its own class so a caller can tell "we refused on purpose" apart from "the
 * network failed" — the two want very different handling, and collapsing them
 * would make a blocked staging write look like an MFL outage.
 */
export class OutboundBlockedError extends Error {
  readonly action: OutboundAction;

  constructor(action: OutboundAction) {
    super(
      `${action} blocked: this is a ${deployEnvLabel()} deployment, which shares ` +
        `production's credentials. Outbound writes run from production only. ` +
        `See src/utils/deploy-environment.ts.`,
    );
    this.name = 'OutboundBlockedError';
    this.action = action;
  }
}

/**
 * The raw Vercel environment: 'production', 'preview', 'development', or
 * undefined when not running on Vercel at all.
 *
 * Read at call time, never captured at module load — a module instance can
 * outlive the assumption, and a test needs to be able to set it.
 */
function vercelEnv(): string | undefined {
  return process.env.VERCEL_ENV;
}

/** Human-readable label for messages and the banner. */
export function deployEnvLabel(): string {
  return vercelEnv() ?? 'local';
}

/**
 * Is this the production deployment?
 *
 * Off-Vercel (scripts, local dev) counts as production for the purposes of
 * this file — see "Which way it fails" above.
 */
export function isProductionDeploy(): boolean {
  const env = vercelEnv();
  return env === undefined || env === 'production';
}

/**
 * Is this a deployment that must not reach the outside world — staging, or any
 * PR preview?
 */
export function isNonProductionDeploy(): boolean {
  return !isProductionDeploy();
}

/**
 * Refuse an outbound write from a non-production deployment.
 *
 * Call this at the point of no return — immediately before the network call —
 * rather than at the top of a route handler. Everything up to the send should
 * still run on staging, because "does the request validate, authorize and
 * build the right payload?" is exactly what staging is for. Only the send is
 * withheld.
 *
 * @throws {OutboundBlockedError}
 */
export function assertOutboundAllowed(action: OutboundAction): void {
  if (isProductionDeploy()) return;
  const error = new OutboundBlockedError(action);
  console.warn(`[deploy-guard] ${error.message}`);
  throw error;
}

/**
 * Non-throwing form, for a caller that wants to branch rather than catch —
 * a fan-out that should skip one recipient, say, instead of aborting.
 */
export function outboundAllowed(): boolean {
  return isProductionDeploy();
}

/**
 * Is the viewer on a staging site *right now*?
 *
 * This is the host question, not the deployment one — use it for the noindex
 * header and the banner. A preview deployment reached by its `*.vercel.app`
 * URL is not a staging host but IS non-production, which is why the two
 * predicates exist and why the banner checks both.
 */
export function isStagingRequest(url: URL | { hostname: string }): boolean {
  return isStagingHost(url.hostname);
}

/**
 * Should this response be kept out of search indexes?
 *
 * True for the staging hosts and for every preview deployment. Three real
 * subdomains of real domains would otherwise get crawled, and duplicate
 * content on staging.theleague.us is a genuine SEO problem for theleague.us.
 */
export function shouldBlockIndexing(url: URL | { hostname: string }): boolean {
  return isNonProductionDeploy() || isStagingRequest(url);
}
