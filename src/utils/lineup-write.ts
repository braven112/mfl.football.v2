/**
 * Submitting a lineup to MFL — the one implementation behind every lineup
 * write: the site's per-league routes (createLineupRoute, src/utils/lineup-route.ts)
 * and the MFL Football app's `/api/mfl-live/lineup`, which serves ANY MFL
 * league the signed-in account is in.
 *
 * Extracted from createLineupRoute's POST so the app's route reuses the same
 * request, the same reading of MFL's answer and the same IR-violation
 * explanation instead of a second copy that can drift. The callers keep what
 * genuinely differs: who the caller is (session cookie vs Bearer), which
 * league (pinned per route path vs verified against the account's leagues),
 * and how many starters the league takes (nine for our leagues; any MFL
 * league's own count for the app).
 *
 * Always the OWNER's cookie, never the server's env credentials
 * (tests/auth-league-scope.test.ts). MFL answers errors as HTTP 200 with an
 * `<error>` body, so the body is what decides success
 * (docs/claude/rules/lineups.md), never `res.ok`.
 */

import { mflFetch, describeMflFailure } from './mfl-fetch';
import { parseMflImportError } from './mfl-import-error';

export interface LineupSubmission {
  week: number;
  starters: string[];
}

/**
 * Validate a lineup POST body. `starterCount` is how many the league starts:
 * MFL rejects a short or long lineup, so a wrong count is refused here rather
 * than sent.
 */
export function parseLineupSubmission(
  body: unknown,
  starterCount: number,
): { ok: true; value: LineupSubmission } | { ok: false; error: string } {
  const { week, starters } = (body ?? {}) as { week?: unknown; starters?: unknown };
  const weekNum = typeof week === 'number' ? Math.floor(week) : NaN;
  if (
    isNaN(weekNum) || weekNum < 1 || weekNum > 22
    || !Array.isArray(starters) || starters.length !== starterCount
  ) {
    return {
      ok: false,
      error: `Invalid lineup: must provide week (1-22) and exactly ${starterCount} starter IDs.`,
    };
  }
  // MFL player ids are numeric strings.
  if (starters.some((id) => typeof id !== 'string' || !/^\d+$/.test(id))) {
    return { ok: false, error: 'Invalid player IDs in lineup.' };
  }
  if (new Set(starters).size !== starters.length) {
    return { ok: false, error: 'A player can only start once.' };
  }
  return { ok: true, value: { week: weekNum, starters: starters as string[] } };
}

export interface SubmitLineupInput extends LineupSubmission {
  leagueId: string;
  year: number;
  /** The owner's MFL_USER_ID cookie. */
  ownerCookie: string;
  /** League web host without protocol, for MFL's fix link. */
  mflHost: string;
  irEligibleStatuses?: readonly string[];
}

export type SubmitLineupResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      error: string;
      reason?: 'ir-violation';
      fixUrl?: string;
      blocked?: true;
    };

export async function submitLineupToMfl(input: SubmitLineupInput): Promise<SubmitLineupResult> {
  try {
    const response = await mflFetch({
      url: `https://api.myfantasyleague.com/${input.year}/import`,
      method: 'POST',
      mflUserCookie: input.ownerCookie,
      body: `TYPE=lineup&L=${input.leagueId}&W=${input.week}&STARTERS=${input.starters.join(',')}`,
      timeoutMs: 15_000,
    });
    const text = await response.text();

    // MFL returns XML: <status>OK</status> on success, <error>msg</error> on failure
    if (text.includes('<error>')) {
      const errorMsg = text.match(/<error>([\s\S]*?)<\/error>/)?.[1] || 'Unknown MFL error';
      console.error('[lineup] MFL submit error:', errorMsg);
      // MFL's error is an escaped HTML fragment, and some of them (an IR
      // violation) can never succeed on retry — so the caller needs a plain
      // sentence it can SHOW, plus MFL's own link to the fix.
      const parsed = parseMflImportError(errorMsg, {
        mflHost: input.mflHost,
        year: input.year,
        irEligibleStatuses: input.irEligibleStatuses,
      });
      return { ok: false, status: 422, error: parsed.message, reason: parsed.reason, fixUrl: parsed.fixUrl };
    }

    if (text.includes('<status>OK</status>') || text.includes('>OK<')) return { ok: true };

    console.warn('[lineup] Unexpected MFL response:', text.slice(0, 500));
    return {
      ok: false,
      status: 500,
      error: 'Unexpected response from MFL. Your lineup may or may not have been saved.',
    };
  } catch (error) {
    // A staging/preview deployment refusing to send is not an outage, and
    // "Internal server error" is what it used to say — the one message that
    // tells an owner validating a lineup change nothing at all.
    const failure = describeMflFailure(error);
    if (failure.blocked) return { ok: false, status: 503, error: failure.message, blocked: true };
    console.error('[lineup] Submit error:', error);
    return { ok: false, status: 500, error: 'Internal server error. Please try again.' };
  }
}
