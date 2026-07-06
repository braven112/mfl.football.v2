/**
 * Standings Hero Data
 *
 * Feeds the Monday "standings" composite hero: who's leading the league right
 * now? This reads the MFL `standings` feed and returns the franchises in rank
 * order (rank 1 = best) so the hero can cast the #1 team's headliner (or the
 * signed-in owner's, when personalized).
 *
 * Ranking mirrors the standings page: head-to-head wins first (`h2hw`),
 * points-for (`pf`) as the tie-break. During the offseason reset every team
 * shows 0 wins / 0 points — the ranking still returns (tie-broken on id) so
 * the caller can detect the empty state and fall back gracefully.
 *
 * Runs server-side only (SSR) — reads the synced feed from disk.
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

/** A franchise's standings position — rank 1 is the league leader. */
export interface StandingRank {
  franchiseId: string;
  rank: number;
}

/**
 * Pure ranking: order franchises best-first from a parsed standings payload.
 *
 * Sort key: head-to-head wins (`h2hw`) descending, then points-for (`pf`)
 * descending, then franchise id ascending for a stable final tie-break. Every
 * franchise gets a rank whether or not games have been played — an offseason
 * reset (all zeros) still returns a deterministic order.
 *
 * Exported separately so the sort/tie-break logic is fixture-testable without
 * touching the on-disk feed.
 */
export function rankStandings(data: any): StandingRank[] {
  const raw =
    data?.leagueStandings?.franchise ?? data?.default?.leagueStandings?.franchise;
  if (!raw) return [];

  const franchises = Array.isArray(raw) ? raw : [raw];

  const rows = franchises
    .filter((f: any) => f?.id)
    .map((f: any) => ({
      franchiseId: String(f.id),
      wins: parseFloat(f.h2hw ?? '') || 0,
      pf: parseFloat(f.pf ?? '') || 0,
    }))
    .sort(
      (a: { franchiseId: string; wins: number; pf: number }, b: { franchiseId: string; wins: number; pf: number }) =>
        b.wins - a.wins ||
        b.pf - a.pf ||
        a.franchiseId.localeCompare(b.franchiseId),
    );

  return rows.map((row: { franchiseId: string }, i: number) => ({
    franchiseId: row.franchiseId,
    rank: i + 1,
  }));
}

/**
 * The league's franchises in rank order (rank 1 = best) for the season year,
 * or an empty array when the standings feed is missing. Callers should treat
 * an empty result as "no standings yet" and fall back.
 */
export function getStandingsRanking(leagueYear: number): StandingRank[] {
  return rankStandings(
    readJsonFile(`data/theleague/mfl-feeds/${leagueYear}/standings.json`),
  );
}
