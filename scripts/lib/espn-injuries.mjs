/**
 * ESPN's NFL injury report → Doc Rivers' input.
 *
 * Doc Rivers posted NOTHING from launch to Nov 2026: every scan logged
 * "ESPN injuries: 0 players". ESPN had changed the response under the old
 * parser, which looked for `data.injuries[].entries[].athlete.id`. Today:
 *
 *   - the league-wide endpoint (no `?team=`) returns `injuries` as 32 TEAMS,
 *     each carrying its own `injuries` array of entries;
 *   - the per-team endpoint (`?team=N`) returns `injuries` as a FLAT list of
 *     entries, with the club in `data.team`;
 *   - an entry's `athlete` has NO `id` field any more — the athlete id only
 *     survives inside its links (`…/nfl/player/_/id/4683062/xavier-worthy`);
 *     `entry.id` is the injury record's id, not the player's;
 *   - the report now lists ACTIVE players too (519 of 800 rows on
 *     2026-11-15), so "on the report" no longer means "injured".
 *
 * Nothing threw — the old parser just found no groups, no entries, no ids —
 * so the failure was a silent empty feed. This parser accepts all three
 * shapes (the old grouped one included, in case ESPN flips back) and is pinned
 * by `tests/espn-injuries.test.ts` against a recorded sample.
 */

export const ESPN_INJURIES_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries';

/** Rows that mean "not hurt". The report carries them; Doc ignores them. */
const HEALTHY_STATUSES = new Set(['active']);

/** ESPN's placeholder when it has no detail to give. */
const EMPTY_DETAILS = new Set(['', 'not specified', 'undisclosed']);

/**
 * The ESPN NFL athlete id for an injury entry's athlete: the `id` field when
 * ESPN sends one, else the id in its player-card link.
 *
 * @param {any} athlete
 * @returns {string | null}
 */
export function espnAthleteId(athlete) {
  if (!athlete) return null;
  if (athlete.id != null && /^\d+$/.test(String(athlete.id))) return String(athlete.id);
  for (const link of athlete.links ?? []) {
    const m = /\/nfl\/player\/(?:[a-z]+\/)?_\/id\/(\d+)/.exec(link?.href ?? '');
    if (m) return m[1];
  }
  return null;
}

/** @param {any} details */
function injuryDetail(details) {
  if (!details || typeof details !== 'object') return '';
  for (const value of [details.type, details.detail]) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text && !EMPTY_DETAILS.has(text.toLowerCase())) return text;
  }
  return '';
}

/** Every injury entry in a response, whichever of the three shapes it has. */
function entriesOf(data) {
  const out = [];
  const fallbackTeam = data?.team?.abbreviation ?? '';
  for (const item of Array.isArray(data?.injuries) ? data.injuries : []) {
    if (item?.athlete) {
      // Per-team: a flat list of entries.
      out.push({ entry: item, team: fallbackTeam });
    } else if (Array.isArray(item?.injuries)) {
      // League-wide: one item per club.
      for (const entry of item.injuries) out.push({ entry, team: item.abbreviation ?? '' });
    } else if (Array.isArray(item?.entries)) {
      // The original grouped shape.
      for (const entry of item.entries) out.push({ entry, team: fallbackTeam });
    }
  }
  return out;
}

/**
 * @typedef {{ espnId: string, name: string, position: string, nflTeam: string, status: string, detail: string }} EspnInjury
 */

/**
 * Parse an ESPN injuries response into `espnId → injury`, healthy rows dropped.
 *
 * @param {any} data
 * @returns {Map<string, EspnInjury>}
 */
export function parseEspnInjuries(data) {
  /** @type {Map<string, EspnInjury>} */
  const injuries = new Map();
  for (const { entry, team } of entriesOf(data)) {
    const athlete = entry?.athlete;
    const espnId = espnAthleteId(athlete);
    if (!espnId) continue;
    const status = String(entry.status ?? entry.type?.description ?? '').trim();
    if (!status || HEALTHY_STATUSES.has(status.toLowerCase())) continue;
    injuries.set(espnId, {
      espnId,
      name: athlete.displayName ?? athlete.fullName ?? 'Unknown',
      position: athlete.position?.abbreviation ?? '',
      nflTeam: athlete.team?.abbreviation ?? team ?? '',
      status,
      detail: injuryDetail(entry.details),
    });
  }
  return injuries;
}

/**
 * MFL players keyed by their ESPN id, from a `players` export. Doc joins an
 * ESPN row to an MFL player on this id and NEVER on the name: a name match
 * resolves the wrong person instead of failing (docs/claude/rules/live-scoring.md).
 *
 * @param {any} playersExport  The raw `players.json` export.
 * @returns {Map<string, { id: string, name: string, position: string, nflTeam: string }>}
 */
export function mflPlayersByEspnId(playersExport) {
  const list = playersExport?.players?.player ?? [];
  const map = new Map();
  for (const p of Array.isArray(list) ? list : [list]) {
    const espnId = p?.espn_id ? String(p.espn_id) : '';
    if (!p?.id || !/^\d+$/.test(espnId)) continue;
    map.set(espnId, { id: p.id, name: p.name ?? '', position: p.position ?? '', nflTeam: p.team ?? '' });
  }
  return map;
}
