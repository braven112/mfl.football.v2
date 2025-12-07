import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = path.join(projectRoot, 'src', 'data');

const env = process.env;
const getNonEmpty = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};
const season =
  getNonEmpty(env.MFL_SEASON) ??
  getNonEmpty(env.MFL_YEAR) ??
  '2025';
const leagueId = getNonEmpty(env.MFL_LEAGUE_ID) ?? '13522';
const leagueKey = getNonEmpty(env.MFL_LEAGUE_SLUG) ?? leagueId;
const apiBase = getNonEmpty(env.MFL_API_BASE) ?? 'https://api.myfantasyleague.com';
const configuredWeek = getNonEmpty(env.MFL_WEEK);
const username = getNonEmpty(env.MFL_USERNAME);
const password = getNonEmpty(env.MFL_PASSWORD);
const apiKey = getNonEmpty(env.MFL_API_KEY);
const freezeWeek = Number.parseInt(getNonEmpty(env.MFL_FREEZE_WEEK) ?? '14', 10);
const outputRaw = path.join(dataDir, leagueKey, `mfl-player-salaries-${season}.json`);
const outputSummary = path.join(dataDir, leagueKey, `mfl-salary-averages-${season}.json`);
const historyDir = path.join(dataDir, 'salary-history', leagueKey, season);
const seasonStateFile = path.join(dataDir, `mfl-season-state-${leagueKey}.json`);
const cachedRostersFile = path.join(dataDir, 'mfl-feeds', leagueKey, season, 'rosters.json');
const DEFAULT_HEADSHOT_URL =
  'https://www49.myfantasyleague.com/player_photos_2010/no_photo_available.jpg';

const ensureArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const normalizeName = (player = {}) => {
  if (player.name) return player.name.trim();
  const parts = [player.firstName, player.lastName].filter(Boolean);
  return parts.join(' ').trim();
};

const suffixes = ['jr', 'sr', 'ii', 'iii', 'iv', 'v'];
const normalizeTeamCode = (team) => {
  const map = {
    KC: 'KC',
    KCC: 'KC',
    TB: 'TB',
    TBB: 'TB',
    GB: 'GB',
    GBP: 'GB',
    NE: 'NE',
    NEP: 'NE',
    NO: 'NO',
    NOR: 'NO',
    NOS: 'NO',
    JAX: 'JAX',
    JAC: 'JAX',
    LV: 'LV',
    LVR: 'LV',
    OAK: 'LV',
    LA: 'LAR',
    LAR: 'LAR',
    STL: 'LAR',
    SD: 'LAC',
    LAC: 'LAC',
    CLV: 'CLE',
    CLE: 'CLE',
    ARI: 'ARI',
    ARZ: 'ARI',
    SF: 'SF',
    SFO: 'SF',
    WAS: 'WAS',
    WSH: 'WAS',
  };
  if (!team) return '';
  const upper = team.toString().toUpperCase();
  return map[upper] ?? upper;
};

const normalizeFullName = (name = '') => {
  const cleaned = name.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const parts = cleaned.split(' ').filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && suffixes.includes(last.replace(/\./g, '').toLowerCase())) {
    parts.pop();
  }
  return parts.join(' ');
};

const buildNameKey = (name = '', team = '') =>
  `${normalizeFullName(name).toLowerCase()}|${normalizeTeamCode(team)}`;

const buildMflHeadshotUrl = (playerId) =>
  playerId
    ? `https://www49.myfantasyleague.com/player_photos_2014/${playerId}_thumb.jpg`
    : DEFAULT_HEADSHOT_URL;

const average = (values = []) => {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 100) / 100;
};

const buildUrl = (type, params = {}, options = {}) => {
  const url = new URL(`${apiBase}/${season}/export`);
  url.searchParams.set('TYPE', type);
  url.searchParams.set('JSON', '1');
  if (leagueId) url.searchParams.set('L', leagueId);
  const forcedWeek = options.forceWeek ?? null;
  const includeWeek = options.includeWeek ?? false;
  const weekToUse = forcedWeek ?? (includeWeek ? configuredWeek : null);
  if (weekToUse) url.searchParams.set('W', weekToUse);
  if (username) url.searchParams.set('USERNAME', username);
  if (password) url.searchParams.set('PASSWORD', password);
  if (apiKey) url.searchParams.set('APIKEY', apiKey);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url;
};

const fetchExport = async (type, params = {}, options = {}) => {
  const url = buildUrl(type, params, options);
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Unable to fetch ${type} (${response.status}): ${text.slice(0, 200)}`
    );
  }
  const payload = await response.json();
  if (payload?.error?.$t) {
    throw new Error(payload.error.$t);
  }
  return payload;
};

const chunkArray = (items, size = 100) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const fetchSleeperDirectory = async () => {
  const url =
    process.env.SLEEPER_PLAYERS_URL ??
    'https://api.sleeper.app/v1/players/nfl';
  console.log(`[salary-averages] Fetching Sleeper directory from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sleeper fetch failed ${res.status}`);
  const payload = await res.json();
  const values = Object.values(payload ?? {});
  const byKey = new Map();
  values.forEach((player) => {
    const fullName = player.full_name
      ?? (player.first_name && player.last_name
        ? `${player.first_name} ${player.last_name}`
        : player.name || '');
    const team = normalizeTeamCode(player.team || '');
    const key = buildNameKey(fullName, team);
    if (key.trim() && player.player_id && !byKey.has(key)) {
      byKey.set(key, player);
    }
    const nameOnlyKey = `${normalizeFullName(fullName).toLowerCase()}|`;
    if (nameOnlyKey.trim() && player.player_id && !byKey.has(nameOnlyKey)) {
      byKey.set(nameOnlyKey, player);
    }
  });
  return { payload, byKey };
};

const parseCsv = (text) => {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    if (!line.trim()) return null;
    const cells = line.split(',').map((c) => c.trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = cells[idx];
    });
    return row;
  }).filter(Boolean);
};

const fetchNflverseSnapCounts = async (seasonYear) => {
  const url =
    process.env.NFLVERSE_SNAP_URL ??
    `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${seasonYear}.csv.gz`;
  console.log(`[salary-averages] Fetching NFLverse snap counts for ${seasonYear} from GitHub...`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[salary-averages] Snap counts not available for ${seasonYear} (${res.status})`);
      return new Map();
    }
    const buffer = await res.arrayBuffer();
    // Handle gzip decompression
    const { createGunzip } = await import('zlib');
    const { Readable } = await import('stream');
    const gunzip = createGunzip();
    const readable = Readable.from(Buffer.from(buffer));
    const decompressed = await new Promise((resolve, reject) => {
      const chunks = [];
      readable.pipe(gunzip)
        .on('data', (chunk) => chunks.push(chunk))
        .on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
        .on('error', reject);
    });

    const rows = parseCsv(decompressed);
    const byPlayer = new Map();
    rows.forEach((row) => {
      const player = row.player || '';
      const team = normalizeTeamCode(row.team || '');
      const pfrPlayerId = row.pfr_player_id || '';
      // Use pfr_player_id as the key since it's stable and unique
      const key = pfrPlayerId || (player && buildNameKey(player, team));
      if (!key) return;
      const week = Number.parseInt(row.week ?? 0, 10) || 0;

      // Track all weeks for games played calculation
      if (!byPlayer.has(key)) {
        byPlayer.set(key, {
          weeks: new Set(),
          latest: null,
          player,
          team,
          position: row.position ?? null,
          pfrPlayerId,
        });
      }

      const entry = byPlayer.get(key);
      entry.weeks.add(week);

      // Keep the latest week's data for detailed snaps
      if (!entry.latest || week >= entry.latest.week) {
        entry.latest = {
          week,
          season: seasonYear,
          player,
          team,
          position: row.position ?? null,
          offenseSnaps: row.offense_snaps ? Number.parseInt(row.offense_snaps, 10) : null,
          offenseSnapPct: row.offense_pct ? Number.parseFloat(row.offense_pct) : null,
          defenseSnaps: row.defense_snaps ? Number.parseInt(row.defense_snaps, 10) : null,
          defenseSnapPct: row.defense_pct ? Number.parseFloat(row.defense_pct) : null,
          stSnaps: row.st_snaps ? Number.parseInt(row.st_snaps, 10) : null,
          stSnapPct: row.st_pct ? Number.parseFloat(row.st_pct) : null,
          pfrPlayerId,
        };
      }
    });

    // Convert to final map with games played calculated
    const result = new Map();
    byPlayer.forEach((entry, key) => {
      if (entry.latest) {
        result.set(key, {
          ...entry.latest,
          gamesPlayed: entry.weeks.size,
          gamesPlayedWeeks: Array.from(entry.weeks).sort((a, b) => a - b),
        });
      }
    });

    return result;
  } catch (error) {
    console.warn(`[salary-averages] Error fetching snap counts: ${error.message}`);
    return new Map();
  }
};

const fetchPlayerMeta = async (playerIds) => {
  const chunks = chunkArray(playerIds, 150);
  const results = [];
  for (const chunk of chunks) {
    const payload = await fetchExport(
      'players',
      { DETAILS: '1', PLAYERS: chunk.join(',') },
      { includeWeek: false }
    );
    results.push(payload);
  }

  const meta = new Map();
  results.forEach((payload) => {
    ensureArray(payload?.players?.player).forEach((player) => {
      const id = player?.id;
      if (!id) return;
      meta.set(id, {
        id,
        name: normalizeName(player),
        position: player?.position,
        team: normalizeTeamCode(player?.team) || null,
        draftYear: player?.draft_year ? Number.parseInt(player.draft_year, 10) : null,
        draftTeam: player?.draft_team ?? null,
        birthdate: player?.birthdate ? Number.parseInt(player.birthdate, 10) : null,
      });
    });
  });
  return { meta, rawPayloads: results };
};

const matchSleeperPlayer = (meta, sleeperByKey) => {
  if (!meta?.name) return null;
  const team = normalizeTeamCode(meta.team || '');
  const primaryKey = buildNameKey(meta.name, team);
  if (sleeperByKey?.has(primaryKey)) return sleeperByKey.get(primaryKey);

  // Try swapping first/last if name came in as "Last, First"
  const parts = normalizeFullName(meta.name).split(' ');
  if (parts.length >= 2) {
    const swapped = `${parts.slice(1).join(' ')} ${parts[0]}`;
    const swapKey = buildNameKey(swapped, team);
    if (sleeperByKey?.has(swapKey)) return sleeperByKey.get(swapKey);
  }

  // Last resort: ignore team
  const nameOnlyKey = `${normalizeFullName(meta.name).toLowerCase()}|`;
  if (sleeperByKey?.has(nameOnlyKey)) return sleeperByKey.get(nameOnlyKey);

  return null;
};

const matchNflverseUsage = (meta, sleeperMatch, nflverseMap) => {
  if (!nflverseMap || nflverseMap.size === 0) return null;
  // First try using PFR player ID if available
  if (sleeperMatch?.gsis_id && nflverseMap.has(sleeperMatch.gsis_id)) {
    return nflverseMap.get(sleeperMatch.gsis_id);
  }
  // Try matching by name+team (handles name format differences)
  const team = meta?.team ?? '';
  const metaName = meta?.name ?? '';

  // Parse meta name (MFL format is "Last, First")
  const metaNormalized = normalizeFullName(metaName);
  const metaParts = metaNormalized.split(' ');

  for (const [, data] of nflverseMap) {
    if (!data.player) continue;
    const snapTeam = normalizeTeamCode(data.team || '');
    if (snapTeam !== team) continue;

    const snapNormalized = normalizeFullName(data.player);
    const snapParts = snapNormalized.split(' ');

    // Handle different name formats
    // MFL: "Last, First" -> normalized to "Last First"
    // Snap counts: "First Last" -> stays as "First Last"

    // Try direct normalized match (works if both are in same format after normalization)
    if (metaNormalized.toLowerCase() === snapNormalized.toLowerCase()) {
      return data;
    }

    // Try reversing snap parts to match "First Last" -> "Last First"
    if (snapParts.length > 1) {
      const snapReversed = [snapParts[snapParts.length - 1], ...snapParts.slice(0, -1)].join(' ');
      if (metaNormalized.toLowerCase() === snapReversed.toLowerCase()) {
        return data;
      }
    }

    // Try matching by last name + first initial (case-insensitive)
    if (metaParts.length > 0 && snapParts.length > 0) {
      const metaLastName = metaParts[0]?.toLowerCase() || '';
      const snapLastName = snapParts[snapParts.length - 1]?.toLowerCase() || '';

      if (metaLastName === snapLastName && metaParts.length > 1 && snapParts.length > 1) {
        const metaFirst = metaParts[1]?.charAt(0).toLowerCase() || '';
        const snapFirst = snapParts[0]?.charAt(0).toLowerCase() || '';
        if (metaFirst === snapFirst) {
          return data;
        }
      }
    }
  }

  return null;
};

const normalizePlayers = (
  rosterPayload,
  playerMetaMap,
  pointsMap = new Map(),
  options = {}
) => {
  const { sleeperByKey = new Map(), nflverseMap = new Map() } = options;
  const franchises = ensureArray(rosterPayload?.rosters?.franchise);
  const normalized = [];

  franchises.forEach((franchise) => {
    const franchiseId = franchise?.id;
    ensureArray(franchise?.player).forEach((player) => {
      const meta = playerMetaMap.get(player?.id);
      const salary = Number.parseFloat(player?.salary);
      if (!meta || !Number.isFinite(salary)) return;
      const sleeperMatch = matchSleeperPlayer(meta, sleeperByKey);
      const nflverse = matchNflverseUsage(meta, sleeperMatch, nflverseMap);
      const headshot =
        sleeperMatch?.photo_url ||
        sleeperMatch?.headshot_url ||
        buildMflHeadshotUrl(meta.id);
      normalized.push({
        id: meta.id,
        name: meta.name,
        position: meta.position,
        salary,
        franchiseId,
        status: player?.status,
        contractYear: player?.contractYear,
        points: Math.round((pointsMap.get(meta.id) ?? 0) * 100) / 100,
        team: meta.team,
        draftYear: meta.draftYear,
        draftTeam: meta.draftTeam,
        birthdate: meta.birthdate,
        headshot,
        externalIds: {
          mfl: meta.id,
          sleeper: sleeperMatch?.player_id ?? null,
          gsis: nflverse?.gsisId ?? sleeperMatch?.gsis_id ?? null,
        },
        sleeper: sleeperMatch
          ? {
              id: sleeperMatch.player_id ?? null,
              fullName: sleeperMatch.full_name ?? null,
              team: normalizeTeamCode(sleeperMatch.team),
              age: sleeperMatch.age ?? null,
              height: sleeperMatch.height ?? null,
              weight: sleeperMatch.weight ?? null,
              number: sleeperMatch.number ?? null,
              college: sleeperMatch.college ?? null,
              birthDate: sleeperMatch.birth_date ?? null,
              status: sleeperMatch.status ?? null,
              active: sleeperMatch.active ?? null,
              position: sleeperMatch.position ?? null,
              depthChartPosition: sleeperMatch.depth_chart_position ?? null,
              depthChartOrder: sleeperMatch.depth_chart_order ?? null,
              fantasyPositions: sleeperMatch.fantasy_positions ?? null,
              experience: sleeperMatch.years_exp ?? sleeperMatch.experience ?? null,
              injuryStatus: sleeperMatch.injury_status ?? null,
              injuryBodyPart: sleeperMatch.injury_body_part ?? null,
              gsisId: sleeperMatch.gsis_id ?? null,
            }
          : null,
        nflverse: nflverse ? {
              week: nflverse.week,
              season: nflverse.season,
              player: nflverse.player,
              team: nflverse.team,
              position: nflverse.position,
              offenseSnaps: nflverse.offenseSnaps,
              offenseSnapPct: nflverse.offenseSnapPct,
              defenseSnaps: nflverse.defenseSnaps,
              defenseSnapPct: nflverse.defenseSnapPct,
              stSnaps: nflverse.stSnaps,
              stSnapPct: nflverse.stSnapPct,
              pfrPlayerId: nflverse.pfrPlayerId,
              gamesPlayed: nflverse.gamesPlayed,
              gamesPlayedWeeks: nflverse.gamesPlayedWeeks,
            } : null,
        gamesPlayed: nflverse?.gamesPlayed ?? null,
      });
    });
  });

  return normalized.filter((player) => player.position);
};

const calculateDepthChartAhead = (players) => {
  // Helper function to get base position (WR/LWR/RWR/SWR all map to WR)
  const getBasePosition = (depthChartPosition) => {
    if (!depthChartPosition) return null;
    if (depthChartPosition.includes('WR')) return 'WR';
    return depthChartPosition;
  };

  // Create a map of players by team and base position
  const depthChartMap = new Map();

  players.forEach((player) => {
    if (!player.sleeper?.depthChartPosition || !player.team) return;

    const basePosition = getBasePosition(player.sleeper.depthChartPosition);
    const key = `${player.team}:${basePosition}`;
    if (!depthChartMap.has(key)) {
      depthChartMap.set(key, []);
    }
    depthChartMap.get(key).push(player);
  });

  // For each position group, sort by depth chart order and store players ahead
  depthChartMap.forEach((playerList) => {
    // Sort by depth chart order (1 = 1st string, 2 = 2nd string, etc.)
    playerList.sort((a, b) => {
      const orderA = a.sleeper?.depthChartOrder ?? Infinity;
      const orderB = b.sleeper?.depthChartOrder ?? Infinity;
      return orderA - orderB;
    });
  });

  // Add depthChartAhead to each player
  players.forEach((player) => {
    if (!player.sleeper?.depthChartPosition || !player.team) {
      player.depthChartAhead = null;
      return;
    }

    const basePosition = getBasePosition(player.sleeper.depthChartPosition);
    const key = `${player.team}:${basePosition}`;
    const positionGroup = depthChartMap.get(key) || [];
    const playerIndex = positionGroup.findIndex((p) => p.id === player.id);

    if (playerIndex <= 0) {
      // First string or not found
      player.depthChartAhead = null;
    } else {
      // Get all players ahead (those with lower order numbers)
      player.depthChartAhead = positionGroup
        .slice(0, playerIndex)
        .map((p) => ({
          id: p.id,
          name: p.name,
        }));
    }
  });
};

const summarizeByPosition = (players) => {
  const buckets = new Map();
  players.forEach((player) => {
    if (!buckets.has(player.position)) buckets.set(player.position, []);
    buckets.get(player.position).push(player);
  });

  const summary = {};
  buckets.forEach((list, position) => {
    list.sort((a, b) => b.salary - a.salary);
    const top3 = list.slice(0, 3);
    const top5 = list.slice(0, 5);
    summary[position] = {
      totalPlayers: list.length,
      top3Average: average(top3.map((player) => player.salary)),
      top5Average: average(top5.map((player) => player.salary)),
      topPlayers: list.slice(0, 5).map((player) => ({
        id: player.id,
        name: player.name,
        salary: player.salary,
        franchiseId: player.franchiseId,
      })),
    };
  });

  return summary;
};

const writeJson = async (filePath, data) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
};

const timestampSlug = () => new Date().toISOString().replace(/[:]/g, '-');

const buildPlayerPoints = (weeklyPayload, maxWeek = null) => {
  const totals = new Map();
  const weeklyResults = ensureArray(
    weeklyPayload?.allWeeklyResults?.weeklyResults ??
      weeklyPayload?.weeklyResults
  );
  weeklyResults.forEach((entry) => {
    const weekNumber = Number.parseInt(entry?.week ?? entry?.weekNumber ?? entry?.W ?? 0, 10) || 0;
    if (maxWeek && weekNumber > maxWeek) return;
    ensureArray(entry?.matchup).forEach((matchup) => {
      ensureArray(matchup?.franchise).forEach((franchise) => {
        ensureArray(franchise?.player).forEach((player) => {
          const id = player?.id;
          const score = Number.parseFloat(player?.score ?? 0);
          if (!id || Number.isNaN(score)) return;
          totals.set(id, (totals.get(id) ?? 0) + score);
        });
      });
    });
  });
  return totals;
};

const dataDirName = `mfl-salary-cache-${leagueId}-${season}`;
const cacheDir =
  env.MFL_CACHE_DIR ??
  path.join(os.homedir(), '.cache', 'mfl-football', dataDirName);
const stampFile = path.join(cacheDir, 'last-fetch.json');
const readSeasonState = async () => {
  try {
    const raw = await fs.readFile(seasonStateFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const writeSeasonState = async (state) => {
  await fs.mkdir(path.dirname(seasonStateFile), { recursive: true });
  await fs.writeFile(seasonStateFile, JSON.stringify(state, null, 2));
};

const detectLatestWeek = (weeklyPayload) => {
  const weeklyResults = ensureArray(
    weeklyPayload?.allWeeklyResults?.weeklyResults ??
      weeklyPayload?.weeklyResults
  );
  return weeklyResults.reduce((max, entry) => {
    const value = Number.parseInt(entry?.week ?? entry?.weekNumber ?? entry?.W ?? 0, 10) || 0;
    return Math.max(max, value);
  }, 0);
};

const hasRecentFetch = async () => {
  try {
    const raw = await fs.readFile(stampFile, 'utf8');
    const { fetchedAt } = JSON.parse(raw);
    if (!fetchedAt) return false;
    const last = new Date(fetchedAt);
    const now = new Date();
    return (
      last.getUTCFullYear() === now.getUTCFullYear() &&
      last.getUTCMonth() === now.getUTCMonth() &&
      last.getUTCDate() === now.getUTCDate()
    );
  } catch {
    return false;
  }
};

const writeFetchStamp = async () => {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    stampFile,
    JSON.stringify({ fetchedAt: new Date().toISOString() }, null, 2)
  );
};

const shouldSkipFetch =
  typeof env.SKIP_SALARY_FETCH === 'string' &&
  ['1', 'true', 'yes'].includes(env.SKIP_SALARY_FETCH.toLowerCase());

const run = async () => {
  if (shouldSkipFetch) {
    console.log(
      '[salary-averages] SKIP_SALARY_FETCH set. Skipping salary update script.'
    );
    return;
  }
  const isFresh = await hasRecentFetch();
  if (isFresh) {
    console.log(
      '[salary-averages] Data already fetched today. Skipping API refresh.'
    );
    return;
  }

  console.log('[salary-averages] Fetching cumulative player scoring...');
  let weeklyResultsPayload = null;
  try {
    weeklyResultsPayload = await fetchExport(
      'weeklyResults',
      { W: 'YTD' },
      { includeWeek: false }
    );
  } catch (error) {
    console.warn('[salary-averages] Unable to fetch weekly results:', error.message);
  }

  const detectedWeek = weeklyResultsPayload ? detectLatestWeek(weeklyResultsPayload) : 0;
  const state = (await readSeasonState()) ?? {};
  const stateIsCurrentSeason = state?.season === season;
  let lockedWeek = stateIsCurrentSeason ? state?.frozenWeek ?? null : null;
  let effectiveWeek = lockedWeek ?? (freezeWeek && detectedWeek >= freezeWeek ? freezeWeek : detectedWeek);
  if (!Number.isFinite(effectiveWeek) || effectiveWeek <= 0) effectiveWeek = null;

  if (!lockedWeek && freezeWeek && detectedWeek >= freezeWeek) {
    lockedWeek = freezeWeek;
    effectiveWeek = freezeWeek;
    await writeSeasonState({
      season,
      frozenWeek: freezeWeek,
      frozenAt: new Date().toISOString(),
    });
    console.log(`[salary-averages] Week ${freezeWeek} reached. Freezing data for remainder of season.`);
  } else if (lockedWeek) {
    console.log(`[salary-averages] Using frozen week ${lockedWeek} from season state.`);
  }

  const fetchRostersWithFallback = async (week) => {
    const weekLabel = week ? `, week ${week}` : ', latest';
    console.log(
      `[salary-averages] Fetching rosters for league ${leagueId} (${season}${weekLabel})...`
    );
    // Only include a week param when intentionally freezing; otherwise let MFL serve the latest/YTD.
    const weekParam = week ? { W: week } : {};
    try {
      return {
        payload: await fetchExport('rosters', weekParam, {
          includeWeek: false, // explicit week/YTD passed via params
        }),
        week,
      };
    } catch (error) {
      const message = error?.message ?? String(error);
      const match = message.match(/upcoming week\s*\((\d+)\)/i);
      if (match) {
        const upcomingWeek = Number.parseInt(match[1], 10);
        const fallbackWeek = Number.isFinite(upcomingWeek)
          ? Math.max(Math.min(upcomingWeek - 1, week ?? upcomingWeek - 1), 1)
          : null;
        if (fallbackWeek && (!week || week !== fallbackWeek)) {
          console.warn(
            `[salary-averages] Requested week ${week ?? 'latest'} unavailable, retrying with week ${fallbackWeek}.`
          );
          return fetchRostersWithFallback(fallbackWeek);
        }
      }
      try {
        const cachedRaw = await fs.readFile(cachedRostersFile, 'utf8');
        const cached = JSON.parse(cachedRaw);
        console.warn(
          `[salary-averages] Live roster fetch failed (${message}). Using cached rosters from ${path.relative(
            projectRoot,
            cachedRostersFile
          )}.`
        );
        return { payload: cached, week: week ?? null };
      } catch (cacheErr) {
        console.warn(
          `[salary-averages] Live roster fetch failed (${message}) and no cached rosters available: ${cacheErr?.message ?? cacheErr}`
        );
        return { payload: null, week: week ?? null, error: message };
      }
    }
  };

  const { payload: rosterPayload, week: resolvedRosterWeek } =
    await fetchRostersWithFallback(effectiveWeek);
  if (!rosterPayload) {
    console.warn('[salary-averages] Skipping salary update because no roster payload was available.');
    return;
  }
  if (resolvedRosterWeek && resolvedRosterWeek !== effectiveWeek) {
    effectiveWeek = resolvedRosterWeek;
  }
  const rosterPlayers = new Set();
  ensureArray(rosterPayload?.rosters?.franchise).forEach((franchise) => {
    ensureArray(franchise?.player).forEach((player) => {
      if (player?.id) rosterPlayers.add(player.id);
    });
  });

  if (!rosterPlayers.size) {
    throw new Error('No rostered players returned from the API response.');
  }

  console.log(
    `[salary-averages] Fetching metadata for ${rosterPlayers.size} players...`
  );
  const { meta: playerMeta, rawPayloads: playerPayloads } = await fetchPlayerMeta(
    Array.from(rosterPlayers)
  );

  let sleeperDirectory = { byKey: new Map(), payload: null };
  try {
    sleeperDirectory = await fetchSleeperDirectory();
    console.log(
      `[salary-averages] Sleeper directory ready with ${sleeperDirectory.byKey.size} keyed entries.`
    );
  } catch (error) {
    console.warn('[salary-averages] Sleeper directory unavailable:', error.message);
  }

  let nflverseSnapCounts = new Map();
  try {
    nflverseSnapCounts = await fetchNflverseSnapCounts(season);
    console.log(
      `[salary-averages] NFLverse snap counts ready with ${nflverseSnapCounts.size} entries.`
    );
  } catch (error) {
    console.warn('[salary-averages] NFLverse snap counts unavailable:', error.message);
  }

  let playerPointsMap = new Map();
  if (weeklyResultsPayload) {
    playerPointsMap = buildPlayerPoints(
      weeklyResultsPayload,
      effectiveWeek ?? detectedWeek ?? null
    );
    console.log(
      `[salary-averages] Aggregated points for ${playerPointsMap.size} players through week ${effectiveWeek ?? detectedWeek ?? 'latest'}.`
    );
  }

  const players = normalizePlayers(rosterPayload, playerMeta, playerPointsMap, {
    sleeperByKey: sleeperDirectory.byKey,
    nflverseMap: nflverseSnapCounts,
  });

  if (!players.length) {
    console.warn('[salary-averages] No player salaries found - league may not use salary cap feature. Skipping...');
    return;
  }

  // Calculate depth chart ahead for each player
  calculateDepthChartAhead(players);

  const metadata = {
    leagueId,
    season,
    week: effectiveWeek ?? configuredWeek ?? null,
    detectedWeek,
    freezeWeek,
    frozenWeek: lockedWeek ?? null,
    sources: {
      rosters: `${apiBase}/${season}/export?TYPE=rosters&L=${leagueId}&JSON=1${
        effectiveWeek ? `&W=${effectiveWeek}` : ''
      }`,
      players: `${apiBase}/${season}/export?TYPE=players&DETAILS=1`,
      weeklyResults: `${apiBase}/${season}/export?TYPE=weeklyResults&L=${leagueId}&W=YTD&JSON=1`,
      sleeper: sleeperDirectory.payload ? 'cached' : 'https://api.sleeper.app/v1/players/nfl',
      nflverse:
        process.env.NFLVERSE_SNAP_URL ??
        `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv.gz`,
    },
    fetchedAt: new Date().toISOString(),
  };

  await writeJson(outputRaw, {
    metadata,
    players,
  });
  console.log(
    `[salary-averages] Saved ${players.length} player salaries -> ${path.relative(
      projectRoot,
      outputRaw
    )}`
  );

  const summary = {
    metadata: {
      ...metadata,
      description:
        'Top salary averages calculated for franchise tag (top 3) and extension (top 5).',
      generatedAt: new Date().toISOString(),
    },
    positions: summarizeByPosition(players),
  };
  await writeJson(outputSummary, summary);
  console.log(
    `[salary-averages] Saved per-position averages -> ${path.relative(
      projectRoot,
      outputSummary
    )}`
  );

  const snapshot = timestampSlug();
  const historyRaw = path.join(historyDir, `raw-${snapshot}.json`);
  const historySummary = path.join(historyDir, `summary-${snapshot}.json`);
  await writeJson(historyRaw, {
    snapshot,
    rosters: rosterPayload,
    players: playerPayloads,
    weeklyResults: weeklyResultsPayload,
  });
  await writeJson(historySummary, { snapshot, ...summary });
  console.log(
    `[salary-averages] Archived history snapshots -> ${path.relative(
      projectRoot,
      historyDir
    )}`
  );
};

run().catch((error) => {
  console.error('[salary-averages] Failed to update salary data:');
  console.error(error.message);
  process.exitCode = 1;
});

writeFetchStamp().catch(() => {});
