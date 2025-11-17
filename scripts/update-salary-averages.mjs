import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = path.join(projectRoot, 'src', 'data');

const env = process.env;
const season = env.MFL_SEASON ?? '2024';
const leagueId = env.MFL_LEAGUE_ID ?? '13522';
const apiBase = env.MFL_API_BASE ?? 'https://api.myfantasyleague.com';
const configuredWeek = env.MFL_WEEK;
const username = env.MFL_USERNAME;
const password = env.MFL_PASSWORD;
const apiKey = env.MFL_API_KEY;
const freezeWeek = Number.parseInt(env.MFL_FREEZE_WEEK ?? '14', 10);
const outputRaw = path.join(dataDir, `mfl-player-salaries-${season}.json`);
const outputSummary = path.join(dataDir, `mfl-salary-averages-${season}.json`);
const historyDir = path.join(dataDir, 'salary-history', season);
const seasonStateFile = path.join(dataDir, 'mfl-season-state.json');

const ensureArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const normalizeName = (player = {}) => {
  if (player.name) return player.name.trim();
  const parts = [player.firstName, player.lastName].filter(Boolean);
  return parts.join(' ').trim();
};

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
        team: player?.team?.toUpperCase?.() ?? null,
        draftYear: player?.draft_year ? Number.parseInt(player.draft_year, 10) : null,
        draftTeam: player?.draft_team ?? null,
      });
    });
  });
  return { meta, rawPayloads: results };
};

const normalizePlayers = (rosterPayload, playerMetaMap, pointsMap = new Map()) => {
  const franchises = ensureArray(rosterPayload?.rosters?.franchise);
  const normalized = [];

  franchises.forEach((franchise) => {
    const franchiseId = franchise?.id;
    ensureArray(franchise?.player).forEach((player) => {
      const meta = playerMetaMap.get(player?.id);
      const salary = Number.parseFloat(player?.salary);
      if (!meta || !Number.isFinite(salary)) return;
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
      });
    });
  });

  return normalized.filter((player) => player.position);
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

const run = async () => {
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
    const weekLabel = week ? `, week ${week}` : '';
    console.log(
      `[salary-averages] Fetching rosters for league ${leagueId} (${season}${weekLabel})...`
    );
    try {
      return {
        payload: await fetchExport('rosters', {}, {
          includeWeek: true,
          forceWeek: week ?? undefined,
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
      throw error;
    }
  };

  const { payload: rosterPayload, week: resolvedRosterWeek } =
    await fetchRostersWithFallback(effectiveWeek);
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

  const players = normalizePlayers(rosterPayload, playerMeta, playerPointsMap);

  if (!players.length) {
    throw new Error('No player salaries found in the combined API responses.');
  }

  const metadata = {
    leagueId,
    season,
    week: effectiveWeek ?? configuredWeek ?? null,
    detectedWeek,
    freezeWeek,
    frozenWeek: lockedWeek ?? null,
    sources: {
      rosters: `${apiBase}/${season}/export?TYPE=rosters&L=${leagueId}&JSON=1${
        effectiveWeek ? `&W=${effectiveWeek}` : configuredWeek ? `&W=${configuredWeek}` : ''
      }`,
      players: `${apiBase}/${season}/export?TYPE=players&DETAILS=1`,
      weeklyResults: `${apiBase}/${season}/export?TYPE=weeklyResults&L=${leagueId}&W=YTD&JSON=1`,
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
