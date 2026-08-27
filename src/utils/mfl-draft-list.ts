/**
 * MFL My Draft List — read and write an owner's personal draft board.
 *
 * MFL is the source of truth for this list; our board is a working copy that
 * is pulled from and pushed back to it explicitly. Nothing here syncs on a
 * timer, and nothing here can run without a live owner session — see the auth
 * note below for why that isn't a design choice we get to make.
 *
 * Findings this module encodes (verified live 2026-08-27; full write-up in
 * docs/claude/insights/domains/mfl-api.md):
 *
 * - **Owner cookie only.** `import` never honors an APIKEY for ANY type —
 *   MFL's docs say the key method is export-only — and `myDraftList` exposes
 *   no FRANCHISE_ID, so a commissioner cannot act for an owner either. The
 *   franchise is whoever's MFL_USER_ID cookie is on the request, which is why
 *   this takes the same per-owner cookie the roster-move endpoints use
 *   (`user.id` from the session JWT) and cannot be driven by a cron.
 * - **The write is a COMPLETE OVERWRITE.** There is no insert/move/remove.
 *   Callers must send the whole ordered list, and should snapshot first —
 *   `pushDraftList` refuses an empty list rather than silently wiping a board.
 * - **HTTP 200 means nothing.** MFL answers errors with 200 and an error body,
 *   so every response here is parsed for an error before it is believed.
 * - **`import` always replies in XML and ignores JSON=1** (reproduced across
 *   five import types), while `export` does honor JSON=1 — hence the two
 *   different parsers below.
 * - **TYPE/L belong in the QUERY STRING, not the POST body.** Body-only params
 *   send `api.` into a redirect that drops them and serves MFL's HTML
 *   developer-portal page instead of an API response.
 * - **Write to the league's own host.** `api.myfantasyleague.com` 302s POST
 *   /import to the league host, and mflFetch folds the body into the redirect
 *   target's query string — fine for a one-player IR move, a truncation risk
 *   for a 300-player board. Going direct to www44/www49 skips the hop.
 */

import { mflFetch } from './mfl-fetch';
import type { LeagueDefinition } from '../config/leagues';

export interface DraftListResult {
  ok: boolean;
  /** Ordered MFL player ids. Empty array is a legitimate "no list yet". */
  playerIds: string[];
  error?: string;
}

export interface DraftListWriteResult {
  ok: boolean;
  error?: string;
}

interface DraftListParams {
  league: LeagueDefinition;
  year: number | string;
  /** Raw MFL_USER_ID cookie value — the session JWT's userId. */
  mflUserCookie: string;
}

/** MFL read host. Exports are safe on the api. subdomain. */
const READ_HOST = 'https://api.myfantasyleague.com';

/** The league's own host — writes go here directly to avoid the POST redirect. */
const writeHost = (league: LeagueDefinition) => `https://${league.mflHost}`;

/**
 * Pull an error message out of an MFL response body, whatever shape it took.
 *
 * Handles all three we have actually observed: a JSON `{"error":{"$t":"..."}}`
 * from an export, a bare `<error>...</error>` from an import, and MFL's HTML
 * pages (maintenance, the developer portal) which contain neither and would
 * otherwise parse as "no error found" on a total failure.
 */
export function parseMflError(body: string): string | null {
  const text = body.trim();
  if (!text) return 'MFL returned an empty response.';

  const xmlError = text.match(/<error[^>]*>([\s\S]*?)<\/error>/i);
  if (xmlError) return xmlError[1].trim() || 'MFL returned an unspecified error.';

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      const err = parsed?.error;
      if (typeof err === 'string') return err;
      if (err && typeof err === 'object') {
        return String(err.$t ?? err.message ?? 'MFL returned an unspecified error.');
      }
    } catch {
      return 'MFL returned a malformed response.';
    }
    return null;
  }

  // Not JSON and not an <error> element. An HTML document here is MFL serving
  // a portal/maintenance page in place of the API — never a success.
  if (/<html/i.test(text) || /<!doctype/i.test(text)) {
    return 'MFL returned a web page instead of an API response.';
  }

  return null;
}

/**
 * Normalize the `player` field of an export, which MFL emits as an object for
 * a one-player list and an array for the rest. Treating the single-player case
 * as an array yields an empty board — the same class of bug that made
 * /api/draft/status return `picks: []` for the AFL.
 */
function toPlayerArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

/** Keep only well-formed MFL ids, preserving order and dropping duplicates. */
export function normalizePlayerIds(ids: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = `${raw ?? ''}`.trim();
    if (!/^\d{1,7}$/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Read the authenticated owner's current draft list from MFL.
 *
 * An owner who has never built one gets `{ ok: true, playerIds: [] }` — an
 * empty list and a failed read must not collapse into the same value, because
 * the caller writes the difference back to MFL.
 */
export async function pullDraftList(
  { league, year, mflUserCookie }: DraftListParams,
): Promise<DraftListResult> {
  const url = `${READ_HOST}/${year}/export?TYPE=myDraftList&L=${encodeURIComponent(league.id)}&JSON=1`;

  let body: string;
  try {
    const response = await mflFetch({ url, method: 'GET', mflUserCookie });
    body = await response.text();
  } catch (err) {
    return { ok: false, playerIds: [], error: `Could not reach MFL: ${(err as Error).message}` };
  }

  const error = parseMflError(body);
  if (error) return { ok: false, playerIds: [], error };

  try {
    const parsed = JSON.parse(body);
    const list = parsed?.myDraftList ?? parsed?.myDraftlist ?? {};
    const ids = toPlayerArray(list.player).map((p) => (typeof p === 'string' ? p : p?.id));
    return { ok: true, playerIds: normalizePlayerIds(ids) };
  } catch {
    return { ok: false, playerIds: [], error: 'Could not read MFL’s draft list response.' };
  }
}

/**
 * Overwrite the authenticated owner's draft list on MFL.
 *
 * Refuses an empty list: MFL would accept it and erase the owner's board, and
 * no caller of ours has a legitimate reason to push nothing. Clearing a board
 * deliberately is a thing to build on purpose, not a thing to fall into.
 */
export async function pushDraftList(
  { league, year, mflUserCookie, playerIds }: DraftListParams & { playerIds: string[] },
): Promise<DraftListWriteResult> {
  const ids = normalizePlayerIds(playerIds);
  if (ids.length === 0) {
    return { ok: false, error: 'Refusing to push an empty draft list — that would erase your board on MFL.' };
  }

  // TYPE and L in the query string; only PLAYERS in the body. See module note.
  const url = `${writeHost(league)}/${year}/import?TYPE=myDraftList&L=${encodeURIComponent(league.id)}`;
  const body = `PLAYERS=${encodeURIComponent(ids.join(','))}`;

  let text: string;
  try {
    const response = await mflFetch({ url, method: 'POST', mflUserCookie, body });
    text = await response.text();
    // A transport-level failure is still worth surfacing, but only after the
    // body has been read — MFL's own errors arrive with a 200.
    if (!response.ok && !text.trim()) {
      return { ok: false, error: `MFL returned HTTP ${response.status}.` };
    }
  } catch (err) {
    return { ok: false, error: `Could not reach MFL: ${(err as Error).message}` };
  }

  const error = parseMflError(text);
  if (error) return { ok: false, error };

  return { ok: true };
}
