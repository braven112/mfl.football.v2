/**
 * Detect "round.pick" references like "1.12" in tip text and decide
 * whether the referenced pick has already been made. Used by the rumor
 * scanner to drop stale draft gossip — e.g. "Vitside taking TE at 1.12"
 * tips that arrive in the queue before the pick is made but, because
 * tips live in the queue for up to 7 days, can otherwise emit a fresh-
 * voiced post 24h+ after Vitside actually picked.
 *
 * Pure function — takes the parsed draftResults payload and returns
 * whether the tip should be dropped. Filesystem access is split into a
 * separate helper below so the matcher stays unit-testable.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// Bounds for plausible draft coordinates. Picks outside these get
// treated as measurements / years / version numbers and ignored — keeps
// "$1.50", "10.5%", "v2.10" from accidentally matching a real pick.
const MIN_ROUND = 1;
const MAX_ROUND = 7;
const MIN_SLOT = 1;
const MAX_SLOT = 32;

// Match "1.12", "2.05", etc. Word boundaries on both sides so "$1.50"
// and "10.5%" stay clear (they hit MAX_ROUND clamp anyway).
const PICK_REF_REGEX = /\b(\d{1,2})\.(\d{1,2})\b/g;

/**
 * @param {string} text
 * @param {Array<{round?:string|number, pick?:string|number, player?:string}>} draftPicks
 * @returns {boolean}
 */
export function tipReferencesCompletedPick(text, draftPicks) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (!Array.isArray(draftPicks) || draftPicks.length === 0) return false;

  const filledPicks = new Set();
  for (const p of draftPicks) {
    const round = parseInt(String(p?.round ?? ''), 10);
    const slot = parseInt(String(p?.pick ?? ''), 10);
    if (!Number.isFinite(round) || !Number.isFinite(slot)) continue;
    const playerId = typeof p?.player === 'string' ? p.player.trim() : '';
    if (playerId.length > 0) filledPicks.add(`${round}.${slot}`);
  }
  if (filledPicks.size === 0) return false;

  for (const match of text.matchAll(PICK_REF_REGEX)) {
    const round = parseInt(match[1], 10);
    const slot = parseInt(match[2], 10);
    if (round < MIN_ROUND || round > MAX_ROUND) continue;
    if (slot < MIN_SLOT || slot > MAX_SLOT) continue;
    if (filledPicks.has(`${round}.${slot}`)) return true;
  }

  return false;
}

/**
 * Read draftResults.json for the given league year. Returns the picks
 * array (or null when the file is missing / malformed).
 *
 * @param {{ projectRoot: string, leagueYear: number|string }} args
 */
export async function loadDraftPicksForYear({ projectRoot, leagueYear }) {
  try {
    const file = path.join(
      projectRoot,
      'data',
      'theleague',
      'mfl-feeds',
      String(leagueYear),
      'draftResults.json',
    );
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    const draftPick = data?.draftResults?.draftUnit?.draftPick;
    if (!draftPick) return null;
    return Array.isArray(draftPick) ? draftPick : [draftPick];
  } catch {
    return null;
  }
}
