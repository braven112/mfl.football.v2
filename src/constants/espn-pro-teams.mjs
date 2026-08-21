/**
 * ESPN `proTeamId` → NFL team abbreviation.
 *
 * ESPN's fantasy player payloads identify a player's NFL team ONLY by numeric
 * id, which is why the ESPN rankings import used to ship `team: ''` with a
 * comment claiming the API doesn't return the team. It does — just not as a
 * string. Team is a real signal for the fuzzy matcher (it disambiguates
 * same-name players and rescues near-threshold matches), so throwing it away
 * cost match rate on every ESPN import.
 *
 * Plain .mjs so the build-time fetch script and the browser island share ONE
 * copy — same reason src/config/leagues-data.mjs is .mjs (node scripts can't
 * import .ts). A duplicated 32-entry map is a map that drifts.
 *
 * Generated from ESPN's own `?view=proTeamSchedules_wl` (settings.proTeams),
 * not hand-typed. Ids are not contiguous: 31/32 are unused, BAL is 33 and
 * HOU is 34, and 0 is the free-agent bucket. Codes are ESPN's own spelling
 * (WSH, LAR, LAC, JAX) — run them through `normalizeTeamCode` before
 * comparing against an MFL feed, which uses its own aliases.
 */
export const ESPN_PRO_TEAM_ABBREV = {
  0: '', // free agent — no team
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR',
  15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI',
  22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH',
  29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
};

/** Resolve an ESPN proTeamId to an abbreviation ('' when unknown/free agent). */
export function espnProTeamAbbrev(proTeamId) {
  return typeof proTeamId === 'number' ? (ESPN_PRO_TEAM_ABBREV[proTeamId] ?? '') : '';
}
