/**
 * Draft Hero Data
 *
 * Feeds the live rookie-draft composite hero: "who just came off the board?"
 * During a live draft the hero features the most-recent pick, so this reads
 * the MFL draftResults feed and returns the pick with the latest timestamp.
 *
 * Runs server-side only (SSR) — reads the synced feed from disk.
 */

import fs from 'node:fs';
import path from 'node:path';

/** A single resolved draft pick — the most recent one off the board. */
export interface RecentDraftPick {
  /** MFL player id that was drafted */
  playerId: string;
  /** Franchise id that made the pick */
  franchiseId: string;
  /** Unix epoch SECONDS the pick was made */
  timestamp: number;
}

function readJsonFile(relativePath: string): any {
  try {
    const filePath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Pure selection: the most-recent pick from a parsed draftResults payload.
 *
 * Picks the entry with the MAX numeric `timestamp`. When several picks share
 * the same timestamp (MFL stamps a batch of pre-draft-list auto-picks with one
 * time), the LATER pick in the draft wins — highest round, then highest pick
 * within the round — so "just picked" always points at the freshest slot and
 * SSR output is stable.
 *
 * Exported separately so the timestamp/tie-break logic is fixture-testable
 * without touching the on-disk feed. Only returns picks that actually have a
 * player; unfilled slots (empty `player`) are ignored.
 */
export function selectMostRecentDraftPick(data: any): RecentDraftPick | null {
  const raw = data?.draftResults?.draftUnit?.draftPick;
  if (!raw) return null;

  const picks = Array.isArray(raw) ? raw : [raw];

  let best: { playerId: string; franchiseId: string; timestamp: number; round: number; pick: number } | null = null;
  for (const p of picks) {
    if (!p) continue;
    const playerId = String(p.player ?? '').trim();
    if (!playerId) continue; // unfilled slot
    const timestamp = parseInt(p.timestamp, 10);
    if (!Number.isFinite(timestamp)) continue;
    const round = parseInt(p.round, 10) || 0;
    const pick = parseInt(p.pick, 10) || 0;

    if (
      !best ||
      timestamp > best.timestamp ||
      (timestamp === best.timestamp && round > best.round) ||
      (timestamp === best.timestamp && round === best.round && pick > best.pick)
    ) {
      best = { playerId, franchiseId: String(p.franchise ?? ''), timestamp, round, pick };
    }
  }

  if (!best) return null;
  return { playerId: best.playerId, franchiseId: best.franchiseId, timestamp: best.timestamp };
}

/**
 * The most-recent rookie-draft pick for the league year, or null when the
 * draftResults feed is missing or has no filled picks. Timestamp is Unix
 * epoch seconds (MFL's native format).
 */
export function getMostRecentDraftPick(leagueYear: number): RecentDraftPick | null {
  return selectMostRecentDraftPick(
    readJsonFile(`data/theleague/mfl-feeds/${leagueYear}/draftResults.json`),
  );
}
