/**
 * Reading MFL's draft board as fresh as MFL will give it — shared by the
 * site's `/api/draft/status` (the draft room and the broadcast board) and the
 * MFL Football app's `/api/mfl-live/draft`.
 *
 * Moved out of `src/pages/api/draft/status.ts` unchanged, so both read the
 * static file and compare freshness by the same rules instead of a copy that
 * drifts. The reasoning for each piece is on the piece.
 */

import { toSafeMflUrl } from './draft-broadcast-source';

/** One `draftPick` row as MFL sends it, from the JSON export or the static XML. */
export interface RawDraftPick {
  player?: string;
  pick?: string;
  franchise?: string;
  timestamp?: string;
  comments?: string;
  round?: string;
}

/**
 * Decode the XML entities an attribute value can carry.
 *
 * `res.json()` did this for free on the export path, so nothing downstream ever
 * had to think about it. The static file is raw XML: a franchise called
 * `Da Bear's & Co.` arrives as `Da Bear&#39;s &amp; Co.`, and that string is
 * read by `parseTradeFromComment` and rendered on a 65" screen.
 */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(lt|gt|quot|apos|amp));/gi, (whole, dec, hex, named) => {
      if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      switch ((named as string).toLowerCase()) {
        case 'lt': return '<';
        case 'gt': return '>';
        case 'quot': return '"';
        case 'apos': return "'";
        case 'amp': return '&';
        default: return whole;
      }
    });
}

/** `<draftPick ... />` attributes, in whatever order MFL emitted them. */
export function parseStaticXml(xml: string): RawDraftPick[] | null {
  if (!xml.includes('<draftResults')) return null;
  const out: RawDraftPick[] = [];
  for (const tag of xml.match(/<draftPick\b[^>]*\/?>/g) ?? []) {
    const attr = (name: string) => {
      const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
      // `&amp;` must be decoded LAST or an encoded entity decodes twice.
      return m ? decodeXmlEntities(m[1]) : '';
    };
    out.push({
      round: attr('round'),
      pick: attr('pick'),
      franchise: attr('franchise'),
      player: attr('player'),
      timestamp: attr('timestamp'),
      comments: attr('comments'),
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * How recent a parsed board is: newest pick stamp, then how many picks.
 *
 * A TUPLE, never one number standing in for both. Collapsing them —
 * "timestamp if any pick has one, else the count" — makes two boards
 * incomparable the moment one of them is unstamped: an epoch second always
 * dwarfs a pick count, so an unstamped static board could never win and the
 * headline fix would silently never engage, while an unstamped JSON board would
 * lose to a far staler stamped one. Same shape as the client's `boardAge`.
 */
export interface BoardFreshness {
  newestPick: number;
  filled: number;
}

export function picksFreshness(picks: RawDraftPick[]): BoardFreshness {
  let newestPick = 0;
  let filled = 0;
  for (const p of picks) {
    if (!p.player) continue;
    filled += 1;
    const ts = Number.parseInt(p.timestamp ?? '', 10);
    if (Number.isFinite(ts) && ts > newestPick) newestPick = ts;
  }
  return { newestPick, filled };
}

/** Is `a` at least as recent as `b`? Stamp first, count only breaks ties. */
export function atLeastAsFresh(a: BoardFreshness, b: BoardFreshness): boolean {
  if (a.newestPick !== b.newestPick) return a.newestPick > b.newestPick;
  return a.filled >= b.filled;
}

/** Fetch and parse the static file. Null on any failure — it is an optimisation. */
export async function fetchStaticBoard(staticUrl: string): Promise<RawDraftPick[] | null> {
  // Rebuilt here rather than trusting the caller: this is the function that
  // actually reaches the network with a URL derived from a response body.
  const safeUrl = toSafeMflUrl(staticUrl);
  if (!safeUrl) return null;
  try {
    const res = await fetch(safeUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return parseStaticXml(await res.text());
  } catch {
    return null;
  }
}
