/**
 * Pure lineup-warning logic for the Sunday pre-kickoff Schefter lineup check
 * (scripts/schefter-lineup-check.mjs).
 *
 * Everything in this module is a pure function of already-fetched JSON —
 * no network, no fs, no Redis — so the whole flagging pipeline is unit-
 * testable (tests/lineup-warnings.test.ts). The script owns all I/O.
 *
 * Data flow:
 *   MFL weeklyResults JSON  ──parseStartingLineups──▶ [{franchiseId, starters}]
 *   MFL players JSON        ──buildPlayerIndex──────▶ Map(id → {name, position, team})
 *   MFL injuries JSON       ──parseInjuries─────────▶ Map(id → normalized status)
 *   MFL nflByeWeeks JSON    ──parseByeTeams─────────▶ Set(teamCode on bye this week)
 *   MFL league JSON         ──parseFranchiseNames / parseRequiredStarters
 *
 *   buildLineupWarnings(all of the above) ──▶ [{franchiseId, franchiseName,
 *     problems: [{playerId, playerName, position, team, type}], emptySlots,
 *     noLineup}]
 *
 *   formatWarningLine / composePost turn that into the GroupMe post body.
 */

/**
 * Normalize a raw MFL injury status string to the site's canonical set.
 * Ported from scripts/fetch-live-lineups.mjs#normalizeInjuryStatus (kept in
 * sync — the canonical strings are what the committed injuries.json feed
 * already stores).
 *
 * @param {string | undefined | null} status
 * @returns {string} 'Out' | 'IR' | 'Doubtful' | 'Questionable' | 'Suspended'
 *   | 'Retired' | 'Holdout' | 'Healthy'
 */
export function normalizeInjuryStatus(status) {
  if (!status) return 'Healthy';

  const normalized = String(status).toLowerCase().trim();

  // IR variants (IR-PUP, IR-R, IR-NFI, ...)
  if (normalized.startsWith('ir-') || normalized.startsWith('ir ')) {
    return 'IR';
  }

  switch (normalized) {
    case 'out':
    case 'o':
      return 'Out';
    case 'doubtful':
    case 'd':
      return 'Doubtful';
    case 'questionable':
    case 'q':
      return 'Questionable';
    case 'ir':
    case 'injured reserve':
      return 'IR';
    case 'suspended':
      return 'Suspended';
    case 'retired':
      return 'Retired';
    case 'holdout':
      return 'Holdout';
    default:
      return 'Healthy';
  }
}

/** MFL stores names as "Last, First" — flip to "First Last" for post copy. */
export function formatPlayerName(name) {
  if (typeof name !== 'string') return '';
  const idx = name.indexOf(',');
  if (idx === -1) return name.trim();
  const last = name.slice(0, idx).trim();
  const first = name.slice(idx + 1).trim();
  return `${first} ${last}`.trim();
}

/** Coerce MFL's "maybe array, maybe single object" shape to an array. */
function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Index an MFL players export (`{players: {player: [...]}}`) by player id.
 * Team-position pseudo-players (TMWR etc.) are kept — they simply never
 * carry a flaggable status or bye (defenses DO get byes via their team code).
 *
 * @returns {Map<string, {name: string, position: string, team: string}>}
 */
export function buildPlayerIndex(playersJson) {
  const index = new Map();
  for (const p of asArray(playersJson?.players?.player)) {
    if (!p?.id) continue;
    index.set(String(p.id), {
      name: formatPlayerName(p.name ?? ''),
      position: p.position ?? '',
      team: p.team ?? '',
    });
  }
  return index;
}

/**
 * Extract each franchise's submitted starters from an MFL weeklyResults
 * export. Handles single-object vs array coalescing at every level, and
 * franchises listed outside a matchup (playoff byes).
 *
 * @returns {Array<{franchiseId: string, starters: string[]}>}
 */
export function parseStartingLineups(weeklyResultsJson) {
  const wr = weeklyResultsJson?.weeklyResults;
  if (!wr) return [];

  const franchises = [];
  for (const matchup of asArray(wr.matchup)) {
    franchises.push(...asArray(matchup?.franchise));
  }
  // Playoff-bye / unmatched franchises appear directly on weeklyResults.
  franchises.push(...asArray(wr.franchise));

  const lineups = [];
  const seen = new Set();
  for (const fr of franchises) {
    if (!fr?.id || seen.has(fr.id)) continue;
    seen.add(fr.id);
    const starters = asArray(fr.player)
      .filter((p) => p?.status === 'starter' && p.id)
      .map((p) => String(p.id));
    lineups.push({ franchiseId: String(fr.id), starters });
  }
  return lineups;
}

/**
 * Normalize an injuries payload to Map(playerId → canonical status).
 * Accepts BOTH shapes we encounter:
 *  - raw MFL export: `{injuries: {injury: [{id, status}, ...]}}`
 *  - committed feed (data/<league>/mfl-feeds/<year>/injuries.json):
 *    `{injuries: {"<id>": {injuryStatus: 'Out'}, ...}}` (already normalized)
 *
 * @returns {Map<string, string>}
 */
export function parseInjuries(injuriesJson) {
  const map = new Map();
  const container = injuriesJson?.injuries;
  if (!container) return map;

  if (container.injury) {
    for (const inj of asArray(container.injury)) {
      if (inj?.id && inj.status) {
        map.set(String(inj.id), normalizeInjuryStatus(inj.status));
      }
    }
    return map;
  }

  for (const [id, entry] of Object.entries(container)) {
    if (entry && typeof entry === 'object' && entry.injuryStatus) {
      map.set(String(id), normalizeInjuryStatus(entry.injuryStatus));
    }
  }
  return map;
}

/**
 * Teams on bye for the given week, from an MFL nflByeWeeks export
 * (`{nflByeWeeks: {team: [{id: 'ARI', bye_week: '8'}, ...]}}`).
 *
 * @returns {Set<string>} NFL team codes with bye_week === week
 */
export function parseByeTeams(byeWeeksJson, week) {
  const set = new Set();
  const target = Number(week);
  if (!Number.isFinite(target)) return set;
  for (const team of asArray(byeWeeksJson?.nflByeWeeks?.team)) {
    if (team?.id && Number(team.bye_week) === target) {
      set.add(String(team.id));
    }
  }
  return set;
}

/** Franchise id → display name from an MFL league export. */
export function parseFranchiseNames(leagueJson) {
  const map = new Map();
  for (const fr of asArray(leagueJson?.league?.franchises?.franchise)) {
    if (fr?.id) map.set(String(fr.id), fr.name ?? `Franchise ${fr.id}`);
  }
  return map;
}

/** Required starter count from an MFL league export (null if unknown). */
export function parseRequiredStarters(leagueJson) {
  const raw = leagueJson?.league?.starters?.count;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Injury statuses that flag a starter. Deliberately ONLY the "this player
 * cannot play" set — Questionable/Doubtful starters are a normal Sunday
 * call, not a warning. (Suspended/Retired/Holdout players can't play
 * either, so they flag as OUT-severity with their own label.)
 */
const FLAGGED_STATUSES = new Map([
  ['Out', 'OUT'],
  ['IR', 'IR'],
  ['Suspended', 'SUSPENDED'],
  ['Retired', 'RETIRED'],
  ['Holdout', 'HOLDOUT'],
]);

/**
 * The core flagger: cross-reference each franchise's starters against
 * injury statuses and bye weeks, and count empty starting slots.
 *
 * @param {Object} args
 * @param {Array<{franchiseId: string, starters: string[]}>} args.lineups
 * @param {Map<string, {name: string, position: string, team: string}>} args.players
 * @param {Map<string, string>} args.injuries   playerId → canonical status
 * @param {Set<string>} args.byeTeams           NFL team codes on bye
 * @param {Map<string, string>} [args.franchiseNames]
 * @param {number | null} [args.requiredStarters]
 * @returns {Array<{franchiseId, franchiseName, problems, emptySlots, noLineup}>}
 *   Only franchises with at least one problem; sorted by franchiseId.
 */
export function buildLineupWarnings({
  lineups,
  players,
  injuries,
  byeTeams,
  franchiseNames = new Map(),
  requiredStarters = null,
}) {
  const warnings = [];

  for (const { franchiseId, starters } of lineups ?? []) {
    const problems = [];

    for (const playerId of starters) {
      const player = players?.get?.(playerId);
      const status = injuries?.get?.(playerId) ?? 'Healthy';
      const flagged = FLAGGED_STATUSES.get(status);
      const onBye = !!player?.team && !!byeTeams?.has?.(player.team);

      // Injury status outranks bye in the label (an IR guy is wrong every
      // week, not just this one); a healthy player on a bye team flags BYE.
      const type = flagged ?? (onBye ? 'BYE' : null);
      if (!type) continue;

      problems.push({
        playerId,
        playerName: player?.name || `Player #${playerId}`,
        position: player?.position || '?',
        team: player?.team || '',
        type,
      });
    }

    const noLineup = starters.length === 0 && (requiredStarters ?? 0) > 0;
    const emptySlots =
      !noLineup && requiredStarters != null && starters.length < requiredStarters
        ? requiredStarters - starters.length
        : 0;

    if (problems.length > 0 || emptySlots > 0 || noLineup) {
      warnings.push({
        franchiseId,
        franchiseName: franchiseNames.get(franchiseId) ?? `Franchise ${franchiseId}`,
        problems,
        emptySlots,
        noLineup,
      });
    }
  }

  warnings.sort((a, b) => a.franchiseId.localeCompare(b.franchiseId));
  return warnings;
}

const TYPE_LABELS = {
  OUT: 'OUT',
  IR: 'on IR',
  SUSPENDED: 'suspended',
  RETIRED: 'retired',
  HOLDOUT: 'holding out',
  BYE: 'on BYE',
};

/** One GroupMe bullet line per flagged franchise. */
export function formatWarningLine(warning) {
  const parts = warning.problems.map(
    (p) => `${p.playerName} (${p.position}) ${TYPE_LABELS[p.type] ?? p.type}`,
  );
  if (warning.noLineup) {
    parts.push('no lineup submitted');
  } else if (warning.emptySlots > 0) {
    parts.push(`${warning.emptySlots} empty starting slot${warning.emptySlots === 1 ? '' : 's'}`);
  }
  return `• ${warning.franchiseName}: ${parts.join(', ')}`;
}

/**
 * GroupMe bot posts are capped at 1000 characters — stay under it with
 * headroom. If the full team list doesn't fit, keep whole lines and append
 * an honest "+N more" tail (never ship a mid-line truncation).
 */
export const MAX_POST_CHARS = 950;

/**
 * Assemble intro + warning lines into the final post body, trimming whole
 * lines from the end to respect maxLen.
 *
 * @param {string} intro
 * @param {string[]} lines
 * @param {number} [maxLen]
 */
export function composePost(intro, lines, maxLen = MAX_POST_CHARS) {
  const allLines = [...lines];
  let kept = allLines.length;

  const build = (n) => {
    const body = allLines.slice(0, n).join('\n');
    const dropped = allLines.length - n;
    const tail = dropped > 0 ? `\n…plus ${dropped} more team${dropped === 1 ? '' : 's'} with lineup issues.` : '';
    return `${intro.trim()}\n\n${body}${tail}`;
  };

  let post = build(kept);
  while (post.length > maxLen && kept > 0) {
    kept -= 1;
    post = build(kept);
  }
  // Degenerate case: even one line + intro overflows — hard-cap the intro.
  if (post.length > maxLen) {
    post = post.slice(0, maxLen - 1) + '…';
  }
  return post;
}

/**
 * Deterministic Schefter-voice intro used when ANTHROPIC_API_KEY is unset
 * (dry runs still produce a recognizable post). Template picked by week so
 * consecutive Sundays rotate phrasing without RNG in tests.
 */
export function fallbackIntro({ week, teamCount }) {
  const teams = `${teamCount} team${teamCount === 1 ? '' : 's'}`;
  const templates = [
    `Sources say kickoff waits for no one. Week ${week} lineup alert — ${teams} flagged:`,
    `Filing this before the early games: Week ${week} lineup check turned up ${teams} with problems:`,
    `My phone says it's Sunday and my spreadsheet says ${teams} have lineup trouble in Week ${week}:`,
    `Pre-kickoff wire, Week ${week}: ${teams} starting players who will not be playing football today:`,
  ];
  const idx = Number.isFinite(Number(week)) ? Math.abs(Number(week)) % templates.length : 0;
  return templates[idx];
}
