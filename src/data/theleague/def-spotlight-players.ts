/**
 * "Face of the defense" pool for each NFL team — the marquee defenders shown
 * (and rotated between) when the Free Agents hero spotlight lands on a team
 * defense (D/ST). TheLeague uses team defenses only, so a DEF free agent has no
 * headshot of its own; we surface its team's top defenders' ESPN headshots over
 * the team-logo watermark instead of a bare crest.
 *
 * Data is AUTO-GENERATED — do not edit the players by hand. It comes from
 * `def-spotlight-players.json`, refreshed weekly by
 * `scripts/fetch-def-spotlight-players.mjs` (def-spotlight-sync.yml), which pulls
 * each team's CURRENT roster from ESPN and ranks defenders by a playmaking-weighted
 * production score. Keyed by the normalized NFL team code that free-agent objects
 * carry in `player.team` (see `normalizeMflTeam` / `MFL_TEAM_CODE_MAP` in
 * `src/pages/theleague/players.astro` — e.g. GBP→GB, JAC→JAX; Washington stays `WAS`).
 *
 * `espnId` drives the headshot URL:
 *   https://a.espncdn.com/i/headshots/nfl/players/full/{espnId}.png
 *
 * A team with no entry (or an empty pool) falls back to the clean logo-only
 * spotlight treatment.
 */
import defData from './def-spotlight-players.json';

export interface DefSpotlightPlayer {
  name: string;
  espnId: string;
  position?: string;
}

interface DefSpotlightData {
  generatedAt?: string;
  season?: number;
  source?: string;
  teams: Record<string, DefSpotlightPlayer[]>;
}

const DATA = defData as DefSpotlightData;

/** team code → ranked pool of marquee defenders (best first). */
export const DEF_SPOTLIGHT_PLAYERS: Record<string, DefSpotlightPlayer[]> = DATA.teams ?? {};

/** The NFL season the production ranking was computed from. */
export const DEF_SPOTLIGHT_SEASON = DATA.season ?? null;

/** Ranked pool of marquee defenders for a team, or [] if none is mapped. */
export function getDefSpotlightPlayers(teamCode: string | null | undefined): DefSpotlightPlayer[] {
  if (!teamCode) return [];
  return DEF_SPOTLIGHT_PLAYERS[teamCode] ?? [];
}

/** The single top (primary) marquee defender for a team, or null. */
export function getDefSpotlightPlayer(teamCode: string | null | undefined): DefSpotlightPlayer | null {
  return getDefSpotlightPlayers(teamCode)[0] ?? null;
}
