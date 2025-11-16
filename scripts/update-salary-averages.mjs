import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = path.join(projectRoot, 'src', 'data');

const env = process.env;
const season = env.MFL_SEASON ?? '2024';
const leagueId = env.MFL_LEAGUE_ID ?? '13522';
const apiBase = env.MFL_API_BASE ?? 'https://api.myfantasyleague.com';
const week = env.MFL_WEEK;
const username = env.MFL_USERNAME;
const password = env.MFL_PASSWORD;
const apiKey = env.MFL_API_KEY;
const outputRaw = path.join(dataDir, `mfl-player-salaries-${season}.json`);
const outputSummary = path.join(dataDir, `mfl-salary-averages-${season}.json`);
const historyDir = path.join(dataDir, 'salary-history', season);

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
  if (week && options.includeWeek) url.searchParams.set('W', week);
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
      });
    });
  });
  return { meta, rawPayloads: results };
};

const normalizePlayers = (rosterPayload, playerMetaMap) => {
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

const run = async () => {
  console.log(
    `[salary-averages] Fetching rosters for league ${leagueId} (${season}${
      week ? `, week ${week}` : ''
    })...`
  );
  const rosterPayload = await fetchExport('rosters', {}, { includeWeek: true });
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

  const players = normalizePlayers(rosterPayload, playerMeta);

  if (!players.length) {
    throw new Error('No player salaries found in the combined API responses.');
  }

  await writeJson(outputRaw, {
    metadata: {
      leagueId,
      season,
      week: week ?? null,
      sources: {
        rosters: `${apiBase}/${season}/export?TYPE=rosters&L=${leagueId}&JSON=1${
          week ? `&W=${week}` : ''
        }`,
        players: `${apiBase}/${season}/export?TYPE=players&DETAILS=1`,
      },
      fetchedAt: new Date().toISOString(),
    },
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
      leagueId,
      season,
      week: week ?? null,
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
