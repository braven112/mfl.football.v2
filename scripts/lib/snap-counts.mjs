/**
 * Aggregate NFLverse per-game snap counts into the season totals the Free
 * Agents page renders, and match them to MFL player ids.
 *
 * Extracted from scripts/fetch-snap-counts.mjs so the arithmetic is testable
 * without a network fetch — see tests/snap-counts.test.ts. Two of the three
 * rules below are bugs that shipped.
 *
 * WHAT A SEASON ROW MEANS
 * -----------------------
 * `offenseSnaps`  every REG offensive snap the player took this season, on
 *                 every team he played for.
 * `offensePct`    his share of the offensive plays his team ran IN THE GAMES
 *                 HE PLAYED. This is the standard fantasy "snap share": a
 *                 starter who missed 15 weeks still reads ~80%, and `games`
 *                 is what tells you the sample is one game.
 * `games`         games in which he took at least one offensive snap.
 *
 * ONE PLAYER IS ONE ROW, ACROSS TEAMS
 * -----------------------------------
 * The key used to be `name|team|position`, so a midseason trade produced two
 * rows for one player — and because both rows resolve to the SAME MFL id, the
 * second write silently replaced the first. Jakobi Meyers shipped as 463
 * snaps (JAX) with his 409 for LV dropped on the floor; 27 players were wrong
 * this way in 2025. The key is now the player's own id (`pfr_player_id`), and
 * team/position come from his most recent game, which is what the MFL match
 * should tiebreak against anyway.
 *
 * THE PERCENTAGE IS WEIGHTED, NOT A MEAN OF MEANS
 * -----------------------------------------------
 * NFLverse gives a per-game `offense_pct` against a per-game denominator: a
 * 45-play game and an 80-play game are not the same weight. Averaging the
 * percentages treats them as if they were. NFLverse does not publish team
 * plays, but each row implies them (`offense_snaps / offense_pct`), so the
 * season share is Σ snaps ÷ Σ implied plays. The correction is usually under
 * a point — it matters because it makes the number a ratio you can reason
 * about rather than an average of ratios, and because the same denominator is
 * what a per-week partial season needs.
 */

/** NFLverse team codes that need normalizing to the standard code. */
const NFLVERSE_TEAM_MAP = {
  LA: 'LAR',   // NFLverse uses LA for Rams
  OAK: 'LV',   // Historical
  SD: 'LAC',   // Historical
  STL: 'LAR',  // Historical
};

/** MFL uses non-standard team codes — map to standard. */
const MFL_TEAM_MAP = {
  GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO',
  SFO: 'SF', TBB: 'TB', LVR: 'LV', HST: 'HOU',
  BLT: 'BAL', CLV: 'CLE', ARZ: 'ARI', JAC: 'JAX',
};

/** Positions the Free Agents page has columns for. */
const OFFENSE_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K']);

export function normalizeMflTeam(code) {
  if (!code) return '';
  return MFL_TEAM_MAP[code] || code;
}

export function normalizeNflverseTeam(code) {
  if (!code) return '';
  return NFLVERSE_TEAM_MAP[code] || code;
}

/** Name normalization (mirrors rankings-importer.ts). */
export function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/\s+jr\.?$/i, '')
    .replace(/\s+sr\.?$/i, '')
    .replace(/\s+iii$/i, '')
    .replace(/\s+ii$/i, '')
    .replace(/\s+iv$/i, '')
    .replace(/\s+v$/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** CSV parser — snap count data has no commas inside values. */
export function parseCSV(text) {
  const lines = text.split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(',').map((v) => v.trim().replace(/"/g, ''));
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Roll per-game rows up to one row per player.
 *
 * @param {Array<Record<string, string>>} rows parsed NFLverse snap_counts rows
 * @returns {Array<{name, team, position, offenseSnaps, offensePct, gamesPlayed, weeks}>}
 */
export function aggregateSnapCounts(rows) {
  const playerMap = new Map();

  for (const row of rows) {
    // Regular season only — preseason and playoff snaps are a different
    // question from "how much is this player playing this season".
    if ((row.game_type || '') !== 'REG') continue;

    const position = row.position || '';
    if (!OFFENSE_POSITIONS.has(position)) continue;

    const offenseSnaps = parseInt(row.offense_snaps, 10) || 0;
    const offensePct = parseFloat(row.offense_pct) || 0;
    // Inactive / defense-and-ST-only appearances are not snap-share data.
    if (offenseSnaps === 0 && offensePct === 0) continue;

    const name = row.player || '';
    const team = normalizeNflverseTeam(row.team || '');
    const week = parseInt(row.week, 10) || 0;
    // One row per PLAYER: a trade must not split him in two. pfr_player_id is
    // the stable identity; fall back to name+position only if it is missing.
    const key = row.pfr_player_id || `${name}|${position}`;

    if (!playerMap.has(key)) {
      playerMap.set(key, {
        name,
        team,
        position,
        offenseSnaps: 0,
        pctSnaps: 0,
        pctPlays: 0,
        gamesPlayed: 0,
        weeks: 0,
        lastWeek: -1,
      });
    }

    const entry = playerMap.get(key);
    entry.offenseSnaps += offenseSnaps;
    if (offenseSnaps > 0) entry.gamesPlayed += 1;
    entry.weeks += 1;
    // A row with snaps but no percentage carries no denominator, so it feeds
    // the total and sits out the ratio rather than skewing it.
    if (offensePct > 0) {
      entry.pctSnaps += offenseSnaps;
      entry.pctPlays += offenseSnaps / offensePct;
    }
    // Team and position follow his LATEST game — that is his current team,
    // which is what the MFL match tiebreaks on.
    if (week >= entry.lastWeek) {
      entry.lastWeek = week;
      entry.team = team;
      entry.name = name;
      entry.position = position;
    }
  }

  const result = [];
  for (const entry of playerMap.values()) {
    result.push({
      name: entry.name,
      team: entry.team,
      // MFL calls kickers PK.
      position: entry.position === 'K' ? 'PK' : entry.position,
      offenseSnaps: entry.offenseSnaps,
      offensePct: entry.pctPlays > 0
        ? Math.round((entry.pctSnaps / entry.pctPlays) * 1000) / 10
        : 0,
      gamesPlayed: entry.gamesPlayed,
      weeks: entry.weeks,
    });
  }

  return result;
}

/**
 * Match aggregated players to MFL ids by normalized name + position.
 *
 * @returns {{ matched: Record<string, object>, matchCount: number, missCount: number }}
 */
export function matchToMflPlayers(snapPlayers, mflPlayers) {
  const mflByNamePos = new Map();
  for (const p of mflPlayers) {
    if (!p.id || !p.name || !p.position) continue;
    const pos = p.position === 'Def' ? 'DEF' : p.position;

    // MFL name format: "LastName, FirstName"
    const parts = p.name.split(', ');
    const fullName = parts.length === 2 ? `${parts[1]} ${parts[0]}` : p.name;
    const key = `${normalizeName(fullName)}|${pos}`;

    if (!mflByNamePos.has(key)) mflByNamePos.set(key, []);
    mflByNamePos.get(key).push({ id: p.id, name: fullName, team: normalizeMflTeam(p.team || '') });
  }

  const matched = {};
  let matchCount = 0;
  let missCount = 0;

  for (const snap of snapPlayers) {
    const key = `${normalizeName(snap.name)}|${snap.position}`;
    const candidates = mflByNamePos.get(key);

    if (candidates && candidates.length > 0) {
      let best = candidates[0];
      if (candidates.length > 1) {
        const sameTeam = candidates.find((c) => c.team === snap.team);
        if (sameTeam) best = sameTeam;
      }

      matched[best.id] = {
        offenseSnaps: snap.offenseSnaps,
        offensePct: snap.offensePct,
        gamesPlayed: snap.gamesPlayed,
      };
      matchCount++;
    } else {
      missCount++;
    }
  }

  return { matched, matchCount, missCount };
}
