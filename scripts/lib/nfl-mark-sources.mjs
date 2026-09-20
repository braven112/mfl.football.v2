/**
 * Which artwork a mark id resolves to, for one club.
 *
 * `src/data/nfl-mark-assignments.json` says WHICH mark each club draws on each
 * ground; this says WHERE that mark lives and what format it is. Both the dark
 * mirror and any future tooling read it, so the table has one copy — the same
 * reason KEEP_COMMITTED lives in nfl-logo-sources.mjs rather than in the script
 * that uses it.
 *
 * Every URL comes from the committed catalog `src/data/nfl-brand-kit.json`, so
 * adding a mark id is a table entry, never a new hardcoded host.
 *
 * Plan: docs/plans/nfl-mark-assignments.md.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nflDotComLogoUrl } from './nfl-logo-sources.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Mark id → where to get it. `espn` keys index `teams.<CODE>.espn` in the brand
 * kit; `format` is what the fetched bytes are, which decides both the on-disk
 * extension and how the mirror validates them.
 *
 * ESPN publishes no SVG at any path, so every ESPN-sourced mark is raster and
 * `nflcom` is the only vector option besides the committed primary.
 */
export const MARK_SOURCES = {
  primary: { source: 'committed', format: 'svg' },
  nflcom: { source: 'nflcom', format: 'svg' },
  espn: { source: 'espn', espnKey: 'default', format: 'png' },
  espnDark: { source: 'espn', espnKey: 'dark', format: 'png' },
  altLight: { source: 'espn', espnKey: 'secondaryOnWhite', format: 'png' },
  altDark: { source: 'espn', espnKey: 'secondaryOnBlack', format: 'png' },
  whiteKnockout: { source: 'espn', espnKey: 'primaryWhite', format: 'png' },
  wordmark: { source: 'nflverse', format: 'png' },
};

export const MARK_IDS = Object.keys(MARK_SOURCES);

let cachedKit = null;
function brandKit() {
  if (!cachedKit) {
    cachedKit = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'src', 'data', 'nfl-brand-kit.json'), 'utf-8'),
    ).teams;
  }
  return cachedKit;
}

let cachedAssignments = null;
export function markAssignments() {
  if (!cachedAssignments) {
    cachedAssignments = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'src', 'data', 'nfl-mark-assignments.json'), 'utf-8'),
    );
  }
  return cachedAssignments;
}

/**
 * The mark id a club draws on one ground. A club with no entry — which is most
 * of them — takes the default, so the assignments file stays a list of
 * deviations rather than a 32-row table that has to be kept in sync.
 */
export function assignedMark(code, ground, assignments = markAssignments()) {
  return assignments.clubs?.[code]?.[ground] ?? assignments.defaults[ground];
}

/**
 * Resolve a mark id to `{ url, format }` for one club.
 *
 * Throws on an unknown id rather than falling back: a typo silently resolving
 * to the default would ship the wrong artwork with nothing to notice it by.
 */
export function resolveMark(code, markId, kit = brandKit()) {
  const spec = MARK_SOURCES[markId];
  if (!spec) {
    throw new Error(`unknown mark id "${markId}" (known: ${MARK_IDS.join(', ')})`);
  }
  const team = kit[code];
  if (!team) throw new Error(`no brand-kit entry for ${code}`);

  switch (spec.source) {
    case 'nflcom':
      return { url: nflDotComLogoUrl(code), format: spec.format };
    case 'espn': {
      const cut = team.espn?.[spec.espnKey];
      if (!cut?.url) throw new Error(`${code}: brand kit has no espn.${spec.espnKey}`);
      return { url: cut.url, format: spec.format };
    }
    case 'nflverse':
      if (!team.wordmark) throw new Error(`${code}: brand kit has no wordmark`);
      return { url: team.wordmark, format: spec.format };
    case 'committed':
      // Not fetched — it is the file already in public/assets/nfl-logos.
      return { url: null, format: spec.format, committed: true };
    default:
      throw new Error(`mark id "${markId}" has an unhandled source "${spec.source}"`);
  }
}
