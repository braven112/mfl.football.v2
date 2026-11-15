/**
 * "Notable + daily notebook" (Brandon, Nov 2026): for a big league — Archie's
 * runs 99 teams and moves 150+ players a week — a post per move buries the
 * feed. Notable moves keep their own post; every other move of the league day
 * folds into ONE notebook post, which later scans extend in place (same id,
 * so it keeps its reactions), the way roster lists do
 * (scripts/lib/schefter-wire-formats.mjs, foldRosterLists).
 *
 * Opt-in per league: `schefter.newsVolume: 'notable'` in the registry.
 * TheLeague and the AFL declare nothing and are untouched.
 */
import { leagueDay } from './schefter-wire-formats.mjs';

/** A blind bid at or above this (league dollars) is news on its own. */
export const NOTABLE_BID = 20;
/** An IR move is news when a player in it ranks this high in redraft ADP. */
export const NOTABLE_ADP_RANK = 150;
/** The notebook shows this many moves; the rest are counted. */
export const NOTEBOOK_MAX_LINES = 20;

export const NOTEBOOK_SUBTYPE = 'NOTEBOOK';

/** The league's notebook id for one league day. */
export function notebookId(leagueSlug, day) {
  return `sf_notebook_${leagueSlug}_${day.replace(/-/g, '')}`;
}

/**
 * Whether a draft gets its own post.
 *
 * @param {{ post: Record<string, any>, txn: Record<string, any> | null }} draft
 * @param {{ bidOf: (txn: any) => number | undefined, adpRank: (id: string) => number | undefined }} ctx
 */
export function isNotableMove({ post, txn }, { bidOf, adpRank }) {
  if (!txn) return true;
  if (post.tier === 'breaking' || post.bigDrop) return true;
  if (txn.type === 'TRADE' || txn.type === 'AUCTION_WON') return true;
  if (txn.type === 'BBID_WAIVER') {
    const bid = bidOf(txn);
    return Number.isFinite(bid) && /** @type {number} */ (bid) >= NOTABLE_BID;
  }
  if (txn.type === 'IR') {
    const ids = String(txn.deactivated ?? '').split(',').filter((s) => /^\d+$/.test(s.trim()));
    return ids.some((id) => {
      const rank = adpRank(id.trim());
      return Number.isFinite(rank) && /** @type {number} */ (rank) <= NOTABLE_ADP_RANK;
    });
  }
  return false;
}

/** "Nov 14" for a YYYY-MM-DD league day. */
function dayLabel(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The notebook's headline and body from its items, newest last. */
export function notebookText(items, day) {
  const shown = items.slice(-NOTEBOOK_MAX_LINES);
  const more = items.length - shown.length;
  const lines = shown.map((i) => `- ${i.line}`);
  if (more > 0) lines.push(`- …and ${more} more ${more === 1 ? 'move' : 'moves'} on the wire.`);
  return {
    headline: `Around the league: ${dayLabel(day)} notebook`,
    body: `Notes from around the league today:\n${lines.join('\n')}`,
  };
}

/**
 * Fold a scan's non-notable drafts into the day's notebook.
 *
 * Drafts are `{ post, txn }`. Returns the drafts to post, oldest first: the
 * notable ones untouched, plus one notebook per league day (txn null). An
 * existing notebook for that day is removed from `feed.posts` and returned
 * extended. Mutates `feed.posts` only for that removal.
 *
 * @param {Array<{ post: Record<string, any>, txn: Record<string, any> | null }>} drafts
 * @param {{ posts?: Array<Record<string, any>> }} feed
 * @param {{ leagueSlug: string, clockZone: string, bidOf: (txn: any) => number | undefined, adpRank: (id: string) => number | undefined }} ctx
 */
export function foldDailyNotebook(drafts, feed, ctx) {
  const { leagueSlug, clockZone } = ctx;
  const byDay = new Map();
  const kept = [];
  for (const d of drafts) {
    if (isNotableMove(d, ctx)) {
      kept.push(d);
      continue;
    }
    const day = leagueDay(d.txn?.timestamp ?? d.post.sourceTimestamp, clockZone);
    byDay.set(day, [...(byDay.get(day) ?? []), d]);
  }

  const notebooks = [];
  for (const [day, group] of byDay) {
    const id = notebookId(leagueSlug, day);
    const existing = (feed.posts ?? []).find((p) => p.id === id);
    const items = [
      ...(existing?.items ?? []),
      ...group.map(({ post }) => ({
        sourceTimestamp: String(post.sourceTimestamp),
        transactionSubType: post.transactionSubType,
        line: String(post.headline ?? '').trim(),
        franchiseIds: post.franchiseIds ?? [],
        playerIds: post.playerIds ?? [],
      })),
    ]
      .filter((i) => i.line)
      .sort((a, b) => Number(a.sourceTimestamp) - Number(b.sourceTimestamp));
    if (!items.length) continue;
    if (existing) feed.posts = (feed.posts ?? []).filter((p) => p.id !== id);
    const latest = items[items.length - 1].sourceTimestamp;
    const { headline, body } = notebookText(items, day);
    notebooks.push({
      post: {
        id,
        timestamp: new Date(Number(latest) * 1000).toISOString(),
        type: 'transaction',
        transactionSubType: NOTEBOOK_SUBTYPE,
        format: 'notebook',
        tier: 'minor',
        headline,
        body,
        franchiseIds: [...new Set(items.flatMap((i) => i.franchiseIds))],
        playerIds: [...new Set(items.flatMap((i) => i.playerIds))],
        sourceTimestamp: latest,
        items,
        league: leagueSlug,
      },
      txn: null,
    });
  }

  return [...kept, ...notebooks].sort((a, b) => Number(a.post.sourceTimestamp) - Number(b.post.sourceTimestamp));
}

/**
 * A redraft-ADP rank lookup from MFL's adp export (`{ adp: { player: [...] } }`).
 * Anything unreadable gives a lookup that ranks nobody, so IR moves fold.
 *
 * @param {any} adpJson
 * @returns {(id: string) => number | undefined}
 */
export function adpRankLookup(adpJson) {
  const rows = adpJson?.adp?.player;
  const map = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const rank = Number(r?.rank);
    if (r?.id && Number.isFinite(rank)) map.set(String(r.id), rank);
  }
  return (id) => map.get(String(id));
}
