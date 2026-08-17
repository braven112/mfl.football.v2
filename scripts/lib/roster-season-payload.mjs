/**
 * Shared season-payload builder for /theleague/rosters.
 *
 * Extracted verbatim from src/pages/theleague/rosters.astro (the old
 * `buildSeasonPayload` closure plus the per-season feed indexers it read
 * from), so that:
 *
 *   - the page keeps building the CURRENT league/season years live at
 *     request time (Redis roster cache, live odds, injuries, trade bait), and
 *   - scripts/compute-roster-season-payloads.mjs builds every HISTORICAL
 *     season once at build time from the committed mfl-feeds on disk,
 *     writing data/theleague/derived/roster-season-payloads.json.
 *
 * Plain JS (JSDoc only, no TypeScript syntax) so it loads in bare node AND
 * imports cleanly from .astro frontmatter — same precedent as
 * src/config/leagues-data.mjs.
 *
 * THE PORT IS DELIBERATELY FAITHFUL. Fallback chains, operator precedence
 * and `??`/`||` choices are byte-for-byte from the page; do not "improve"
 * them — historical payloads served to owners were produced by exactly this
 * logic. The small pure helpers below (parseNumber, normalizeStatus,
 * SALARY_CAP, ROSTER_LIMIT, CAP_INCLUSION) are verbatim copies of their
 * TypeScript sources (src/utils/formatters.ts, src/utils/salary-calculations.ts)
 * because a plain-node module cannot import TS; keep them in sync if those
 * ever change.
 *
 * All request-time/closure state is passed explicitly via a `context`
 * object — see the JSDoc on buildSeasonPayload for the exact shape.
 */

// ── Verbatim copies of TS utils (plain node cannot import .ts) ─────────────

/** Copy of src/utils/formatters.ts#parseNumber. */
export const parseNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

/** Copies of src/utils/salary-calculations.ts constants. */
export const SALARY_CAP = 45_000_000;
export const ROSTER_LIMIT = 25;
export const CAP_INCLUSION = {
  ACTIVE: { current: 1, future: 1 },
  PRACTICE: { current: 0.5, future: 1 },
  INJURED: { current: 1, future: 1 },
};

/** Copy of src/utils/salary-calculations.ts#normalizeStatus. */
export const normalizeStatus = (status = 'ROSTER') => {
  const normalized = status.toUpperCase();
  if (normalized.includes('TAXI')) return 'PRACTICE';
  if (normalized.includes('INJURED') || normalized === 'IR') return 'INJURED';
  return 'ACTIVE';
};

// ── Pure helpers moved from the page frontmatter ───────────────────────────

/**
 * Normalize team codes from various MFL formats to standard 2-3 letter codes.
 * (Moved from rosters.astro — this is the ROSTER-page map, which differs from
 * src/utils/nfl-logo.ts#normalizeTeamCode: e.g. here WAS stays WAS.)
 */
export const normalizeTeamCode = (team) => {
  const map = {
    // AFC East
    BUF: 'BUF', MIA: 'MIA', NE: 'NE', NEP: 'NE',
    NYJ: 'NYJ',
    // AFC North
    BAL: 'BAL', CIN: 'CIN', CLE: 'CLE', CLV: 'CLE',
    PIT: 'PIT',
    // AFC South
    HOU: 'HOU', IND: 'IND', JAX: 'JAX', JAC: 'JAX',
    TEN: 'TEN',
    // AFC West
    DEN: 'DEN', KC: 'KC', KCC: 'KC',
    LAC: 'LAC', SD: 'LAC',
    LV: 'LV', LVR: 'LV', OAK: 'LV',
    // NFC East
    DAL: 'DAL', PHI: 'PHI', WAS: 'WAS', WSH: 'WAS',
    NYG: 'NYG',
    // NFC North
    CHI: 'CHI', DET: 'DET', GB: 'GB', GBP: 'GB',
    MIN: 'MIN',
    // NFC South
    ATL: 'ATL', CAR: 'CAR', NO: 'NO', NOR: 'NO', NOS: 'NO',
    TB: 'TB', TBB: 'TB',
    // NFC West
    ARI: 'ARI', ARZ: 'ARI', LA: 'LAR', LAR: 'LAR', STL: 'LAR',
    SF: 'SF', SFO: 'SF', SEA: 'SEA',
    // Other
    FA: 'FA',
  };
  if (!team) return '';
  const upper = team.toString().toUpperCase();
  return map[upper] ?? upper;
};

export const positionOrder = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];

export const getPositionRank = (pos) => {
  if (!pos) return positionOrder.length;
  const rank = positionOrder.indexOf(pos.toUpperCase());
  return rank === -1 ? positionOrder.length : rank;
};

export const sortByPosition = (list) =>
  list.slice().sort((a, b) => {
    const diff = getPositionRank(a.position) - getPositionRank(b.position);
    if (diff !== 0) return diff;
    return parseNumber(b.salary) - parseNumber(a.salary);
  });

export const getNflLogoUrl = (teamCode) => {
  // FA / FA* (conditional free agent) have no crest — use the shield.
  if (!teamCode || teamCode.indexOf('FA') === 0) return '/assets/nfl-logos/NFL.svg';
  return `/assets/nfl-logos/${teamCode}.svg`;
};

export const nflByeWeeks = {
  ARI: 8,
  ATL: 5,
  BAL: 7,
  BUF: 7,
  CAR: 14,
  CHI: 5,
  CIN: 10,
  CLE: 9,
  DAL: 10,
  DEN: 12,
  DET: 8,
  GB: 5,
  HOU: 6,
  IND: 11,
  JAC: 8,
  KC: 10,
  LV: 8,
  LAC: 12,
  LAR: 8,
  MIA: 12,
  MIN: 6,
  NE: 14,
  NO: 11,
  NYG: 14,
  NYJ: 9,
  PHI: 9,
  PIT: 5,
  SEA: 8,
  SF: 14,
  TB: 9,
  TEN: 10,
  WAS: 12,
};

/** Parse a "Dropped <name> (<...>)" salary-adjustment description. */
export const parseAdjustmentMeta = (description = '') => {

  const meta = {
    name: '',
    nflTeam: '',
    position: '',
    salary: null,
    yearsRemaining: null,
  };
  const nameMatch = description.match(/^Dropped\s+([^()]+)\s*\(/i);
  if (nameMatch) {
    const fullNamePart = nameMatch[1].trim();
    const parts = fullNamePart.split(' ');

    // Extract position (last part, like "QB", "WR", "RB")
    const maybePosition = parts[parts.length - 1];
    if (maybePosition && /^(QB|RB|WR|TE|PK|K|DEF|DET)$/i.test(maybePosition)) {
      meta.position = maybePosition.toUpperCase();
    }

    // Extract NFL team (second to last part, like "NYG", "SFO", "TB", "SF")
    const maybeTeam = parts[parts.length - 2];
    if (maybeTeam && (maybeTeam.length === 2 || maybeTeam.length === 3)) {
      meta.nflTeam = normalizeTeamCode(maybeTeam);
    }

    // Extract player name (everything before team and position)
    const nameEndIndex = meta.position ? parts.length - 2 : (meta.nflTeam ? parts.length - 1 : parts.length);
    meta.name = parts.slice(0, nameEndIndex).join(' ');
  }
  const salaryMatch = description.match(/Salary:\s*\$?([\d,\.]+)/i);
  if (salaryMatch) {
    const raw = salaryMatch[1].replace(/,/g, '');
    meta.salary = Number(raw) || null;
  }
  const yearsMatch = description.match(/Years:\s*(\d+)/i);
  if (yearsMatch) meta.yearsRemaining = parseInt(yearsMatch[1], 10);
  return meta;
};

// ── Per-season feed indexers (one feed file → the lookup the payload reads) ─

/**
 * Build the enriched per-season salary-adjustments list.
 * Faithful port of the page's salaryAdjustmentFeeds loop body.
 *
 * @param {any} data - parsed salaryAdjustments.json for the season
 * @param {Map<string, {name: string, espnId: string|null, headshot: string}>} identityMap
 *   player-identity map for the season (getPlayerMap-shaped values)
 * @returns {Array<object>|null} enriched adjustments, or null when the feed
 *   has no adjustments (the page skips the season in that case)
 */
export const buildSeasonSalaryAdjustments = (data, identityMap) => {
  if (!data?.salaryAdjustments?.salaryAdjustment) return null;

  // Build name→identity lookup for enriching dead money entries with headshots
  // Index by both "First Last" and "Last, First" since dead money uses MFL's "Last, First" format
  const nameToIdentity = new Map();
  for (const [id, identity] of identityMap) {
    const entry = { id, espnId: identity.espnId, headshot: identity.headshot };
    nameToIdentity.set(identity.name.toLowerCase(), entry); // "first last"
    const parts = identity.name.split(' ');
    if (parts.length >= 2) {
      const lastFirst = `${parts.slice(-1)[0]}, ${parts.slice(0, -1).join(' ')}`;
      nameToIdentity.set(lastFirst.toLowerCase(), entry); // "last, first"
    }
  }

  return data.salaryAdjustments.salaryAdjustment
    .map((adj) => {
      const meta = parseAdjustmentMeta(adj.description ?? '');
      const playerIdentity = meta.name ? nameToIdentity.get(meta.name.toLowerCase()) : null;
      return {
        franchiseId: adj.franchise_id ?? adj.franchiseId ?? '',
        amount: parseNumber(adj.amount),
        description: adj.description ?? '',
        yearOffset: 0,
        timestamp: adj.timestamp ?? null,
        ...meta,
        // Enrich with player identity for headshot display
        playerId: playerIdentity?.id ?? null,
        espnId: playerIdentity?.espnId ?? null,
        headshot: playerIdentity?.headshot ?? null,
      };
    })
    .filter((adj) => Number.isFinite(adj.amount));
};

/**
 * Cap/roster metadata from a season's league.json.
 * Faithful port of the page's leagueFeeds loop body.
 *
 * @param {any} data - parsed league.json for the season
 * @returns {{capLimit: number, rosterLimit: number, taxiPercent: number, irPercent: number}|null}
 */
export const buildSeasonLeagueMeta = (data) => {
  if (!data?.league) return null;
  const league = data.league;
  return {
    capLimit: parseNumber(league.salaryCapAmount) || SALARY_CAP,
    rosterLimit: parseInt(league.rosterSize, 10) || ROSTER_LIMIT,
    taxiPercent: parseNumber(league.includeTaxiWithSalary) / 100 || CAP_INCLUSION.PRACTICE.current,
    irPercent: parseNumber(league.includeIRWithSalary) / 100 || CAP_INCLUSION.INJURED.current,
  };
};

/**
 * Id-indexed player feed map from a season's players.json.
 * Faithful port of the page's playersFeeds loop body.
 *
 * @param {any} data - parsed players.json for the season
 * @returns {Record<string, any>|null} id → raw feed player, or null when the
 *   feed shape is unusable (the page skips the season in that case)
 */
export const indexPlayersFeed = (data) => {
  const list =
    data?.players?.player ??
    data?.players ??
    [];
  if (!Array.isArray(list) && typeof list !== 'object') return null;
  const arr = Array.isArray(list) ? list : Object.values(list);
  const byId = {};
  arr.forEach((player) => {
    const id = player.id ?? player.player_id ?? player.playerId ?? player.playerid;
    if (!id) return;
    byId[id] = player;
  });
  return byId;
};

/**
 * Per-player roster assignment map from a season's rosters.json.
 * Faithful port of the page's rostersFeeds loop body (minus the
 * current-year Redis-cache short-circuit, which stays in the page).
 *
 * @param {any} data - parsed rosters.json for the season
 * @returns {Record<string, {franchiseId: string, salary: any, contractYear: any, contractInfo: any, status: any}>|null}
 */
export const indexRosterFeed = (data) => {
  const franchises = data?.rosters?.franchise ?? [];
  if (!Array.isArray(franchises)) return null;
  const byPlayerId = {};
  franchises.forEach((franchise) => {
    const franchiseId = franchise.id;
    if (!franchiseId) return;
    const players = Array.isArray(franchise.player) ? franchise.player : [franchise.player].filter(Boolean);
    players.forEach((player) => {
      if (player?.id) {
        // Store full player data from live rosters including salary, contractYear, status
        byPlayerId[player.id] = {
          franchiseId,
          salary: player.salary,
          contractYear: player.contractYear,
          contractInfo: player.contractInfo,
          status: player.status,
        };
      }
    });
  });
  return byPlayerId;
};

/**
 * Win-loss record map from a season's standings.json.
 * Faithful port of the page's standingsFeeds loop body.
 *
 * @param {any} data - parsed standings.json for the season
 * @returns {Record<string, string>|null} franchiseId → "W-L-T", or null when
 *   the feed has no rows (the page skips the season in that case)
 */
export const buildSeasonRecords = (data) => {
  const rows =
    data?.leagueStandings?.franchise ??
    data?.standings?.standing ??
    data?.standings ??
    [];
  const list = Array.isArray(rows) ? rows : Object.values(rows ?? {});
  if (!list.length) return null;
  const toInt = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  };
  const map = {};
  list.forEach((row) => {
    const id =
      row.franchise_id ??
      row.franchiseId ??
      row.id ??
      row.franchise ??
      row.team ??
      row.franchise_id1;
    if (!id) return;
    const wins =
      toInt(row.h2hw ?? row.wins ?? row.w ?? row.h2h_w ?? row.h2hwins);
    const losses =
      toInt(row.h2hl ?? row.losses ?? row.l ?? row.h2h_l ?? row.h2hlosses);
    const ties = toInt(row.h2ht ?? row.ties ?? row.t ?? row.h2h_t);
    map[id] = `${wins}-${losses}-${ties}`;
  });
  return map;
};

// ── The payload builder itself ─────────────────────────────────────────────

/**
 * @typedef {object} SeasonPayloadContext
 * @property {Record<string, Record<string, any>>} playersFeedBySeason
 *   season → (playerId → raw players.json row); see indexPlayersFeed
 * @property {(year: number) => Map<string, {name: string, position: string, nflTeam: string, espnId: string|null, headshot: string}>} getIdentityMap
 *   season-year → player identity map (the page passes
 *   src/utils/player-map.ts#getPlayerMap; the compute script passes its
 *   on-disk port). Must return an empty Map for years with no players.json.
 * @property {Record<string, Record<string, any>>} liveRosterDataByPlayerId
 *   season → (playerId → roster assignment); see indexRosterFeed
 * @property {Record<string, any>} projectedScoresBySeason
 *   season → parsed projectedScores.json ({} for historical builds)
 * @property {string} currentSeasonYearStr
 * @property {number} currentLeagueYear
 *   used only as the fallback when `season` fails to parse as a number
 * @property {Record<string, any>} liveOddsData - ESPN odds keyed by NFL team
 *   code ({} for historical builds)
 * @property {boolean} isDemoMode
 * @property {Record<string, any>} fantasyPointsAllowedBySeason
 * @property {number[]} trendWeeks - last completed weeks ([] historical)
 * @property {Map<string, Record<number, number>>} playerScoresMap
 *   playerId → (week → score) (empty Map for historical builds)
 * @property {{players?: Record<string, {espnCollegeId?: string}>}} espnCollegeIds
 *   parsed data/theleague/espn-college-ids.json
 * @property {(mflId?: string, espnId?: string|null) => string} getPlayerHeadshot
 * @property {(collegeName?: string|null) => ({logo?: string|null, logoDark?: string|null}|null)} getCollegeAssets
 * @property {Record<string, {injuryStatus?: string, injuryBodyPart?: string}>} mflInjuryData
 *   ({} for historical builds)
 * @property {Record<string, Record<string, string>>} recordsBySeason
 *   season → (franchiseId → "W-L-T"); see buildSeasonRecords
 * @property {Record<string, {capLimit: number, rosterLimit: number}>} leagueMetaBySeason
 *   see buildSeasonLeagueMeta
 * @property {Record<string, Array<object>>} feedSalaryAdjustmentsBySeason
 *   see buildSeasonSalaryAdjustments
 */

/**
 * Build the full enriched roster payload for one season.
 * Faithful port of the page's buildSeasonPayload — the only change is that
 * every closure dependency now arrives via `context`.
 *
 * @param {SeasonPayloadContext} context
 * @param {string} season - four-digit season string, e.g. '2015'
 * @param {any} rawData - parsed src/data/mfl-player-salaries-<season>.json
 * @param {Set<string>} [tradeBaitPlayerIds]
 */
export const buildSeasonPayload = (context, season, rawData, tradeBaitPlayerIds = new Set()) => {
  const {
    playersFeedBySeason,
    getIdentityMap,
    liveRosterDataByPlayerId,
    projectedScoresBySeason,
    currentSeasonYearStr,
    liveOddsData,
    isDemoMode,
    fantasyPointsAllowedBySeason,
    trendWeeks,
    playerScoresMap,
    espnCollegeIds,
    getPlayerHeadshot,
    getCollegeAssets,
    mflInjuryData,
    recordsBySeason,
    leagueMetaBySeason,
    feedSalaryAdjustmentsBySeason,
  } = context;

  const feedPlayers = playersFeedBySeason[season] ?? {};
  const playerIdentityMap = getIdentityMap(Number(season));
  const liveRosterData = liveRosterDataByPlayerId[season] ?? {};

  // Projections Map — use the season's projected scores data
  const projectedScoresData = projectedScoresBySeason[season] ?? projectedScoresBySeason[currentSeasonYearStr] ?? {};
  const projectedScores = projectedScoresData?.projectedScores?.playerScore || [];
  const projectionMap = new Map();
  if (Array.isArray(projectedScores)) {
    projectedScores.forEach(p => projectionMap.set(p.id, p.score));
  } else if (projectedScores.id) {
    projectionMap.set(projectedScores.id, projectedScores.score);
  }

  // Build player list from live roster data (the authoritative source).
  // The salary file is only used for enrichment (sleeper, nflverse, etc.).
  const salaryDataById = new Map((rawData?.players ?? []).map((p) => [p.id, p]));
  const hasLiveRosters = Object.keys(liveRosterData).length > 0;

  const basePlayers = hasLiveRosters
    ? Object.entries(liveRosterData).map(([id, liveData]) => {
        const salaryPlayer = salaryDataById.get(id) ?? {};
        const feed = feedPlayers[id] ?? {};
        const identity = playerIdentityMap.get(id);
        return {
          ...salaryPlayer,
          id,
          name: identity?.name ?? salaryPlayer.name ?? feed.name ?? `Player ${id}`,
          position: identity?.position ?? (salaryPlayer.position ?? feed.position ?? 'N/A').replace(/^Def$/i, 'DEF'),
          team: identity?.nflTeam ?? salaryPlayer.team ?? feed.team ?? '',
          salary: liveData.salary ?? salaryPlayer.salary ?? '0',
          contractYear: liveData.contractYear ?? salaryPlayer.contractYear ?? '1',
          status: liveData.status ?? salaryPlayer.status ?? 'ROSTER',
          points: salaryPlayer.points ?? 0,
          draftYear: salaryPlayer.draftYear ?? (feed.draft_year ? Number(feed.draft_year) : null),
          draftTeam: salaryPlayer.draftTeam ?? feed.draft_team ?? '',
        };
      })
    : (rawData?.players ?? []).filter((player) => !!liveRosterData[player.id] || !hasLiveRosters);

  const players = basePlayers.map((player) => {
    // Get live roster data for this player (includes current salary, contract, franchise)
    const liveData = liveRosterData[player.id];

    // Use live salary if available, otherwise fall back to frozen data
    const salary = liveData?.salary ? parseNumber(liveData.salary) : parseNumber(player.salary);
    const nflverse = player.nflverse ?? {};
    const parseSnap = (val) => {
      if (val === undefined || val === null || val === '') return null;
      const num = Number(val);
      return Number.isFinite(num) ? num : null;
    };
    // Use live contract years if available
    const contractYears =
      Number.parseInt(liveData?.contractYear ?? player.contractYear ?? player.contractYearRemaining ?? '0', 10) ||
      0;
    // Use live roster data for current franchise assignment
    // If player not in live rosters, they may have been dropped - show as FA
    const franchiseId = liveData?.franchiseId ?? 'FA';
    const totalRemaining = salary * Math.max(contractYears || 1, 1);
    const seasonYear = Number.parseInt(season, 10) || context.currentLeagueYear;
    // Use live status if available
    const status = liveData?.status ?? player.status ?? 'ROSTER';
    const contractType =
      player.contractType ??
      (status && status !== 'ROSTER'
        ? status
        : player.draftYear && seasonYear - Number(player.draftYear) <= 2
          ? 'Rookie'
          : 'Standard');
    const nflTeam = normalizeTeamCode(player.team ?? '');

    // Helper to get odds data
    const getOddsData = (team) => {
      const normalized = team === 'JAC' ? 'JAX' : team === 'WSH' ? 'WAS' : team;
      return liveOddsData[normalized] || null;
    };

    const gameOdds = getOddsData(nflTeam);
    const opponent = gameOdds ? (gameOdds.isHome ? `vs ${gameOdds.opponent}` : `@ ${gameOdds.opponent}`) : 'BYE';

    // Parse Spread
    let favoredTeam = null;
    let spreadAmount = null;
    if (gameOdds?.spread) {
      const parts = gameOdds.spread.split(' ');
      if (parts.length >= 2) {
        favoredTeam = parts[0];
        // Strip non-numeric characters to get the absolute spread amount
        spreadAmount = parts[1].replace(/[^0-9.]/g, '');
      }
    }

    // Get Opponent Stats (Rank/Avg)
    let oppStats = null;
    const fpaData = fantasyPointsAllowedBySeason[season] ?? fantasyPointsAllowedBySeason[currentSeasonYearStr];
    if (gameOdds && fpaData?.fantasyPointsAllowed) {
      const oppCode = gameOdds.opponent === 'JAX' ? 'JAC' : gameOdds.opponent === 'WAS' ? 'WSH' : gameOdds.opponent;
      const teamStats = fpaData.fantasyPointsAllowed[oppCode] || fpaData.fantasyPointsAllowed[gameOdds.opponent];
      if (teamStats) {
        oppStats = teamStats[player.position];
      }
    }

    // In demo mode, generate unique oppStats per player for sorting demonstration
    if (isDemoMode && gameOdds) {
      // Simple hash from player ID to get a consistent pseudo-random value
      const idNum = parseInt(player.id, 10) || 0;
      const seed = ((idNum * 2654435761) >>> 0) % 1000; // Knuth multiplicative hash
      const rank = (seed % 32) + 1; // 1-32
      const avg = (15 + (seed % 200) / 10).toFixed(1); // 15.0 - 35.0
      oppStats = { rank, avg };
    }

    // Get Recent Scores
    const recentScores = trendWeeks.map(week => ({
      week,
      score: playerScoresMap.get(player.id)?.[week] !== undefined
        ? playerScoresMap.get(player.id)[week]
        : '-'
    }));

    // Calculate Recent Average (Last 3 Weeks)
    const recentNumericScores = recentScores
      .map(s => s.score)
      .filter(s => typeof s === 'number');
    const avgRecent = recentNumericScores.length > 0
      ? (recentNumericScores.reduce((sum, s) => sum + s, 0) / recentNumericScores.length).toFixed(1)
      : '-';

    // Calculate Season Average (All Weeks)
    const playerAllScores = playerScoresMap.get(player.id) || {};
    const seasonScores = Object.values(playerAllScores).filter(s => typeof s === 'number');
    const avgSeason = seasonScores.length > 0
      ? (seasonScores.reduce((sum, s) => sum + s, 0) / seasonScores.length).toFixed(1)
      : '-';

    const feedPlayer = feedPlayers[player.id] ?? null;
    const identity = playerIdentityMap.get(player.id);
    const resolvedEspnId = identity?.espnId ?? feedPlayer?.espn_id ?? espnCollegeIds.players?.[player.id]?.espnCollegeId ?? null;
    const headshot = identity?.headshot ?? getPlayerHeadshot(player.id, resolvedEspnId);
    const collegeName = player.sleeper?.college ?? player.college ?? null;
    const collegeAssets = getCollegeAssets(collegeName);
    const parseDraft = (val) => {
      if (val === undefined || val === null || val === '') return null;
      const num = parseInt(val, 10);
      return Number.isFinite(num) ? num : null;
    };
    const draftYear = parseDraft(player.draftYear ?? feedPlayer?.draft_year);
    const draftRound = parseDraft(feedPlayer?.draft_round);
    const draftPick = parseDraft(feedPlayer?.draft_pick);
    const draftTeam = (player.draftTeam ?? feedPlayer?.draft_team ?? '').toUpperCase() || null;

    const playerObj = {
      id: player.id,
      espnId: resolvedEspnId,
      name: player.name,
      position: player.position ?? 'N/A',
      salary,
      contractYears,
      totalRemaining,
      franchiseId,
      status,
      contractType,
      points: parseNumber(player.points),
      projectedPoints: projectionMap.get(player.id) || '-',
      recentScores,
      avgRecent,
      avgSeason,
      nflTeam,
      opponent,
      oppStats,
      gameOdds: gameOdds ? {
        spread: gameOdds.spread,
        overUnder: gameOdds.overUnder,
        favoredTeam,
        spreadAmount,
        weather: gameOdds.weather,
        opponent: gameOdds.opponent,
        isHome: gameOdds.isHome
      } : null,
      draftYear,
      draftTeam,
      draftRound,
      draftPick,
      nflLogo: getNflLogoUrl(nflTeam),
      rosterSlot: normalizeStatus(player.status),
      byeWeek: nflByeWeeks[nflTeam] ?? null,
      birthdate: player.birthdate ?? (feedPlayer?.birthdate ? Number(feedPlayer.birthdate) : null),
      headshot,
      college: collegeName,
      collegeLogo: collegeAssets?.logo ?? null,
      collegeLogoDark: collegeAssets?.logoDark ?? null,
      height: player.sleeper?.height ?? null,
      weight: player.sleeper?.weight ?? null,
      number: player.sleeper?.number ?? null,
      experience: player.sleeper?.experience ?? null,
      depthChartPosition: player.sleeper?.depthChartPosition ?? null,
      depthChartOrder: player.sleeper?.depthChartOrder ?? null,
      injuryStatus: mflInjuryData[player.id]?.injuryStatus ?? player.sleeper?.injuryStatus ?? null,
      injuryBodyPart: mflInjuryData[player.id]?.injuryBodyPart ?? player.sleeper?.injuryBodyPart ?? null,
      sleeperId: player.sleeper?.id ?? null,
      sleeperFullName: player.sleeper?.fullName ?? null,
      sleeperPosition: player.sleeper?.position ?? null,
      fantasyPositions: player.sleeper?.fantasyPositions ?? null,
      gsisId: player.sleeper?.gsisId ?? null,
      sleeperAge: player.sleeper?.age ?? null,
      sleeperStatus: player.sleeper?.status ?? null,
      sleeperActive: player.sleeper?.active ?? null,
      offenseSnaps: parseSnap(nflverse.offenseSnaps),
      defenseSnaps: parseSnap(nflverse.defenseSnaps),
      stSnaps: parseSnap(nflverse.stSnaps),
      gamesPlayed: player.gamesPlayed ?? null,
      depthChartAhead: player.depthChartAhead ?? null,
      tradeBait: tradeBaitPlayerIds.has(String(player.id)),
      contractInfo: liveData?.contractInfo || '',
    };

    return playerObj;
  });

  const grouped = {};
  players.forEach((player) => {
    const key = player.franchiseId || 'FA';
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(player);
  });

  const teams = {};

  Object.entries(grouped).forEach(([teamId, teamPlayers]) => {
    const buckets = {
      ACTIVE: [],
      PRACTICE: [],
      INJURED: [],
    };
    (Array.isArray(teamPlayers) ? teamPlayers : []).forEach((player) => {
      if (player.status === 'TAXI_SQUAD') {
        buckets.PRACTICE.push(player);
      } else if (player.status === 'INJURED_RESERVE') {
        buckets.INJURED.push(player);
      } else {
        buckets.ACTIVE.push(player);
      }
    });
    const activeSorted = sortByPosition(buckets.ACTIVE);
    const practiceSorted = sortByPosition(buckets.PRACTICE);
    const injuredSorted = sortByPosition(buckets.INJURED);

    // Calculate total salary: ACTIVE @ 100%, INJURED @ 100%, PRACTICE @ 50%
    const activeSalary = activeSorted.reduce(
      (sum, player) => sum + parseNumber(player.salary),
      0
    );
    const injuredSalary = injuredSorted.reduce(
      (sum, player) => sum + parseNumber(player.salary),
      0
    );
    const practiceSalary = practiceSorted.reduce(
      (sum, player) => sum + parseNumber(player.salary) * 0.5,
      0
    );
    const totalSalary = activeSalary + injuredSalary + practiceSalary;
    teams[teamId] = {
      players: activeSorted,
      practiceSquad: practiceSorted,
      injuredReserve: injuredSorted,
      record: recordsBySeason[season]?.[teamId] ?? null,
      totals: {
        totalSalary,
        rosterCount: activeSorted.length,
        openSpots: Math.max(ROSTER_LIMIT - activeSorted.length, 0),
        practiceCount: practiceSorted.length,
        injuredCount: injuredSorted.length,
      },
    };
  });

  return {
    metadata: {
      capLimit: leagueMetaBySeason[season]?.capLimit ?? SALARY_CAP,
      rosterLimit: leagueMetaBySeason[season]?.rosterLimit ?? ROSTER_LIMIT,
      season,
    },
    teams,
    salaryAdjustments: feedSalaryAdjustmentsBySeason[season] ?? [],
  };
};
