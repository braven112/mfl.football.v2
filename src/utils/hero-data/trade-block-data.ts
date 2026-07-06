/**
 * Trade-block hero data — the stars on the block.
 *
 * The 24-hour trade-deadline hero needs a face: the BIGGEST NAME on the trade
 * block — the highest-projected player any franchise is actively shopping. This
 * reads the MFL trade-bait feed (per-franchise player ids) and joins each id
 * with its projected score so the deadline composite can cast the marquee
 * player about to (maybe) change hands.
 *
 * Reads `data/theleague/mfl-feeds/{year}/tradeBait-by-franchise.json`
 * (shape: `{ fetchedAt, franchises: { "0001": { playerIds: [...] }, ... } }`)
 * and `data/theleague/mfl-feeds/{year}/projectedScores.json`
 * (shape: `{ projectedScores: { playerScore: [{ id, score }] } }`).
 *
 * Runs server-side only (SSR) — reads the synced feeds from disk.
 */

import fs from 'node:fs';
import path from 'node:path';

function readJsonFile(relativePath: string): any {
  try {
    const filePath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** A player being shopped, joined with his projected score. */
export interface TradeBlockStar {
  playerId: string;
  franchiseId: string;
  score: number;
}

/**
 * Parse a projectedScores payload into a `playerId → score` map. Handles MFL's
 * single-vs-array `playerScore` shape and non-numeric scores (→ 0).
 */
export function parseProjectionMap(projectionsData: any): Map<string, number> {
  const map = new Map<string, number>();
  const list = projectionsData?.projectedScores?.playerScore;
  if (!list) return map;
  const scores = Array.isArray(list) ? list : [list];
  for (const ps of scores) {
    if (!ps?.id) continue;
    const score = parseFloat(ps.score ?? '0');
    map.set(String(ps.id), Number.isFinite(score) ? score : 0);
  }
  return map;
}

/**
 * Pure core: flatten every franchise's trade-bait player ids, join each with
 * its projection, and return the block sorted by projected score DESC (ties
 * break by player id ascending for a stable order). A player with no
 * projection scores 0 — still on the block, just at the bottom.
 *
 * Exported separately so the flatten/join/sort logic is fixture-testable
 * without touching the on-disk feeds (which are cron-regenerated).
 */
export function selectTradeBlockStars(
  tradeBaitData: any,
  projectionsData: any,
): TradeBlockStar[] {
  const franchises = tradeBaitData?.franchises;
  if (!franchises || typeof franchises !== 'object') return [];

  const projections = parseProjectionMap(projectionsData);

  const stars: TradeBlockStar[] = [];
  for (const [franchiseId, entry] of Object.entries<any>(franchises)) {
    const ids = Array.isArray(entry?.playerIds) ? entry.playerIds : [];
    for (const rawId of ids) {
      const playerId = String(rawId);
      if (!playerId) continue;
      stars.push({
        playerId,
        franchiseId: String(franchiseId),
        score: projections.get(playerId) ?? 0,
      });
    }
  }

  return stars.sort(
    (a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId),
  );
}

/**
 * The trade block for the given league year, biggest name (highest projection)
 * first. Returns [] when the trade-bait feed is missing so the caller can fall
 * back. Reads both the trade-bait and projectedScores feeds.
 */
export function getTradeBlockStars(leagueYear: number): TradeBlockStar[] {
  const tradeBait = readJsonFile(
    `data/theleague/mfl-feeds/${leagueYear}/tradeBait-by-franchise.json`,
  );
  if (!tradeBait) return [];
  const projections = readJsonFile(
    `data/theleague/mfl-feeds/${leagueYear}/projectedScores.json`,
  );
  return selectTradeBlockStars(tradeBait, projections);
}
