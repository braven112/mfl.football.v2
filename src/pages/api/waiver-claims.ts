/**
 * /api/waiver-claims — read and manage the claims an owner has ALREADY filed.
 *
 * GET   → the franchise's pending claims for the current league year.
 * POST  → { action: 'delete' | 'editDrop', round, addPlayerId, dropPlayerId, … }
 *
 * WHY THESE TWO ACTIONS AND NOT REORDERING. MFL exposes no reorder control at
 * all. A round is ONE record whose `addsDrops` is an ordered list, MFL appends
 * to it, and nothing edits the order:
 *
 *   - `import?TYPE=waiverRequest` + `REPLACE=1` is documented as replacing a
 *     round's entries and is INERT for these leagues — proven live by replaying
 *     a claim's own picks and watching the timestamp not move;
 *   - MFL's own Edit page exposes the DROP and the COMMENT, nothing else.
 *
 * So reordering could only be delete-then-refile, which leaves a window where
 * the owner holds no claim. Deliberately not shipped here. Delete and edit-drop
 * each map to a SINGLE MFL primitive with no such window, which is why they are
 * safe to offer during a live waiver period.
 * See docs/claude/insights/features/waiver-claims.md (2026-09-03).
 *
 * Every write is verified by reading `pendingWaivers` back, because MFL's page
 * handlers answer with a 200 and an HTML page whether or not anything happened.
 * `success` means MFL accepted; `verified` means we saw the result.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { getCurrentLeagueYear, getRolloverLeagueYear } from '../../utils/league-year';
import { mflFetch } from '../../utils/mfl-fetch';
import { getLeagueById, getLeagueBySlug, DEFAULT_LEAGUE_ID, DEFAULT_LEAGUE_SLUG } from '../../config/leagues';
import { JSON_HEADERS_NO_STORE as JSON_HEADERS } from '../../utils/api-response';
import { checkRateLimit } from '../../utils/rate-limit';
import { getPlayerMap } from '../../utils/player-map';
import { readFiledWaiverClaims, type FiledWaiverClaim } from '../../utils/waiver-claim';

const fail = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ success: false, message, ...extra }), { status, headers: JSON_HEADERS });

interface ClaimsContext {
  user: { id: string; franchiseId: string };
  leagueId: string;
  year: number;
  host: string;
}

/**
 * League year + host for the caller's league, or a Response explaining why not.
 * A discriminated union rather than an `error?` field, so `ok` narrows both
 * branches and the handlers need no non-null assertions on `user`.
 */
function resolveContext(request: Request): { ok: false; error: Response } | ({ ok: true } & ClaimsContext) {
  const user = getAuthUser(request);
  if (!user) return { ok: false, error: fail('Authentication required. Please sign in.', 401) };
  if (!user.id) return { ok: false, error: fail('MFL session not found. Please sign in again.', 401) };
  if (!user.franchiseId) return { ok: false, error: fail('No franchise associated with your account.', 403) };

  const leagueId = user.leagueId || DEFAULT_LEAGUE_ID;
  const league = getLeagueById(leagueId);
  if (!league) return { ok: false, error: fail('Unrecognized league on session. Please sign in again.', 400) };

  const year = league.leagueYearRollover
    ? getRolloverLeagueYear(league.leagueYearRollover)
    : getCurrentLeagueYear();
  // Never a literal: a hardcoded host sends one league's owners to the other's
  // site (tests/league-literal-guard.test.ts).
  const host = league.mflHost || getLeagueBySlug(DEFAULT_LEAGUE_SLUG)!.mflHost;
  return { ok: true, user: { id: user.id, franchiseId: user.franchiseId }, leagueId, year, host };
}

/** The franchise's filed claims, or null when the read failed or was unreadable. */
async function readClaims(year: number, leagueId: string, cookie: string): Promise<FiledWaiverClaim[] | null> {
  try {
    const res = await mflFetch({
      url: `https://api.myfantasyleague.com/${year}/export?TYPE=pendingWaivers&L=${leagueId}&JSON=1&_=${Date.now()}`,
      method: 'GET',
      mflUserCookie: cookie,
    });
    return readFiledWaiverClaims(await res.json());
  } catch {
    return null;
  }
}

/**
 * Attach names so the panel is readable without shipping the player map.
 *
 * The claimed player also carries `addHeadshot` / `addEspnId`, because the
 * panel renders him with the same PlayerCell lockup the Free Agents rows use
 * and that lockup needs a photo. Both come from the SAME player map the rows
 * are built from, so the claim card and the table below it can never disagree
 * about a player's face. `espnId` here is the map's best-guess id (NFL or
 * college) — correct for picking a headshot, which is all it is used for.
 */
function withNames(claims: FiledWaiverClaim[], year: number) {
  const players = getPlayerMap(year);
  const name = (id: string | null) => (id ? (players.get(id)?.name ?? `Player ${id}`) : null);
  const position = (id: string | null) => (id ? (players.get(id)?.position ?? '') : '');
  const nflTeam = (id: string | null) => (id ? (players.get(id)?.nflTeam ?? '') : '');
  const headshot = (id: string | null) => (id ? (players.get(id)?.headshot ?? '') : '');
  const espnId = (id: string | null) => (id ? (players.get(id)?.espnId ?? '') : '');
  return claims.map((c) => ({
    ...c,
    addName: name(c.addPlayerId),
    addPosition: position(c.addPlayerId),
    addNflTeam: nflTeam(c.addPlayerId),
    addHeadshot: headshot(c.addPlayerId),
    addEspnId: espnId(c.addPlayerId),
    dropName: name(c.dropPlayerId),
    dropPosition: position(c.dropPlayerId),
    dropNflTeam: nflTeam(c.dropPlayerId),
  }));
}

export const GET: APIRoute = async ({ request }) => {
  const ctx = resolveContext(request);
  if (!ctx.ok) return ctx.error;
  const { user, leagueId, year, host } = ctx;

  const claims = await readClaims(year, leagueId, user.id);
  if (claims === null) {
    return fail('Could not read your pending waivers from MFL.', 502, {
      confirmUrl: `https://${host}/${year}/add_drop?L=${leagueId}`,
    });
  }
  return new Response(
    JSON.stringify({
      success: true,
      claims: withNames(claims, year),
      confirmUrl: `https://${host}/${year}/add_drop?L=${leagueId}`,
    }),
    { status: 200, headers: JSON_HEADERS }
  );
};

export const POST: APIRoute = async ({ request }) => {
  const ctx = resolveContext(request);
  if (!ctx.ok) return ctx.error;
  const { user, leagueId, year, host } = ctx;

  // Authenticated write that fans out to MFL.
  const limit = await checkRateLimit('waiver-claims', user.id, 30, 60);
  if (!limit.allowed) return fail('Too many requests — wait a moment and try again.', 429);

  const { action, round, addPlayerId, dropPlayerId, comment } = (await request.json()) as {
    action?: string;
    round?: number | string;
    addPlayerId?: string;
    dropPlayerId?: string | null;
    comment?: string;
  };

  const confirmUrl = `https://${host}/${year}/add_drop?L=${leagueId}`;
  const roundStr = String(round ?? '');
  if (!/^\d+$/.test(roundStr)) return fail('Which round? That claim is missing its round.', 400);
  if (!addPlayerId || !/^\d+$/.test(String(addPlayerId))) return fail('Invalid player.', 400);

  // The claim must actually be the CALLER'S. `pendingWaivers` is scoped to the
  // session's own franchise, so finding it there IS the ownership check — there
  // is no id the client could send that would reach someone else's claim.
  const before = await readClaims(year, leagueId, user.id);
  if (before === null) {
    return fail('Could not read your pending waivers from MFL, so nothing was changed.', 502, { confirmUrl });
  }
  const target = before.find((c) => c.round === roundStr && c.addPlayerId === String(addPlayerId));
  if (!target) {
    return fail('That claim is no longer in your pending waivers. Reload to see the current list.', 409, {
      confirmUrl,
    });
  }

  try {
    if (action === 'delete') {
      // A plain GET, exactly as MFL's own page links it:
      //   add_drop?L=…&F=<franchise>&DELETE=<round>_<add>_<drop>
      const token = `${target.round}_${target.addPlayerId}_${target.dropPlayerId ?? '0000'}`;
      const url = `https://${host}/${year}/add_drop?L=${leagueId}&F=${user.franchiseId}&DELETE=${encodeURIComponent(token)}`;
      console.log(`[waiver-claims] GET ${url}`);
      await mflFetch({ url, method: 'GET', mflUserCookie: user.id });

      const after = await readClaims(year, leagueId, user.id);
      const gone = after !== null && !after.some((c) => c.round === roundStr && c.addPlayerId === String(addPlayerId));
      return new Response(
        JSON.stringify({
          success: true,
          verified: gone,
          message: after === null
            ? 'Deleted, but we could not read your pending waivers back to confirm it.'
            : gone
              ? 'Claim deleted.'
              : 'MFL accepted the request but the claim is still listed. Check your pending waivers.',
          claims: after ? withNames(after, year) : null,
          confirmUrl,
        }),
        { status: 200, headers: JSON_HEADERS }
      );
    }

    if (action === 'editDrop') {
      const newDrop = dropPlayerId && String(dropPlayerId) !== '0000' ? String(dropPlayerId) : '';
      if (newDrop && !/^\d+$/.test(newDrop)) return fail('Invalid player to drop.', 400);

      // MFL's own editor: options?O=255&ROUND=n, posting form_name=editwr.
      // `drop_N` is POSITIONAL within the round — index 0 is the first claim —
      // so it is taken from the claim's position in `addsDrops`, which is the
      // same order MFL renders. Only the single-claim shape has been observed
      // live, so the read-back below is doing real work here, not ceremony.
      const body = new URLSearchParams({
        form_name: 'editwr',
        LEAGUE_ID: leagueId,
        O: '255',
        ROUND: target.round,
        [`drop_${target.index}`]: newDrop,
        comment: String(comment ?? target.comment ?? ''),
        SAVE: 'Save Waiver Request',
      }).toString();
      const url = `https://${host}/${year}/options`;
      console.log(`[waiver-claims] POST ${url} (${body})`);
      await mflFetch({ url, method: 'POST', mflUserCookie: user.id, body });

      const after = await readClaims(year, leagueId, user.id);
      const updated = after?.find((c) => c.round === roundStr && c.addPlayerId === String(addPlayerId));
      const applied = !!updated && (updated.dropPlayerId ?? '') === newDrop;
      return new Response(
        JSON.stringify({
          success: true,
          verified: applied,
          message: after === null
            ? 'Saved, but we could not read your pending waivers back to confirm it.'
            : applied
              ? 'Drop updated.'
              : 'MFL accepted the request but the claim still shows the old drop. Check your pending waivers.',
          claims: after ? withNames(after, year) : null,
          confirmUrl,
        }),
        { status: 200, headers: JSON_HEADERS }
      );
    }

    return fail('Unknown action.', 400);
  } catch (error) {
    console.error('[waiver-claims]', error);
    return fail('Something went wrong talking to MFL. Nothing was changed.', 500, { confirmUrl });
  }
};
