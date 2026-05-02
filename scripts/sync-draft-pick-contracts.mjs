#!/usr/bin/env node
/**
 * Sync Draft Pick Contracts
 *
 * After each MFL feed fetch, scan draftResults.json for newly-completed picks
 * and create a pending `rookie-override` contract declaration for each one.
 * The slot-based rookie salary is auto-populated from
 * scripts/lib/rookie-salary-slots.mjs so the owner only has to choose
 * contract years (1-3, vs the default 4yr RC) on the contracts page.
 *
 * Idempotent: skips picks that already have a declaration for that
 * player+franchise.
 *
 * Storage:
 *   - Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN (or KV_*) are set
 *   - Filesystem fallback at data/<league>/contract-declarations.json
 *     (mirrors the runtime behavior of src/utils/contract-storage.ts)
 *
 * Usage:
 *   node scripts/sync-draft-pick-contracts.mjs              # theleague, latest year
 *   node scripts/sync-draft-pick-contracts.mjs --league afl --year 2026
 *
 * Env:
 *   MFL_LEAGUE_SLUG              defaults to 'theleague'
 *   MFL_YEAR / PUBLIC_BASE_YEAR  optional explicit year
 *   UPSTASH_REDIS_REST_URL/TOKEN OR KV_REST_API_URL/TOKEN — production storage
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getRookieSlotSalary,
  overallPickFromRoundPick,
} from './lib/rookie-salary-slots.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REDIS_KEY = 'contract-declarations';

// ── Pure logic (testable) ──────────────────────────────────────────────

/**
 * Build the set of contract declarations that should exist for the given
 * draft results. Returns ONLY new declarations (skips ones already in
 * `existingDeclarations` by playerId+franchiseId).
 *
 * @param {object} args
 * @param {object} args.draftResults  The parsed draftResults.json content
 * @param {Map<string, {position: string, name: string}>} args.playerIndex
 * @param {Map<string, string>} args.franchiseNameMap  franchiseId → display name
 * @param {string} args.leagueId
 * @param {Array<{playerId: string, franchiseId: string}>} args.existingDeclarations
 * @param {() => string} [args.idGenerator]  For deterministic test output
 * @param {() => Date} [args.now]  Override "now" for tests
 */
export function buildDraftPickDeclarations({
  draftResults,
  playerIndex,
  franchiseNameMap,
  leagueId,
  existingDeclarations,
  idGenerator = generateId,
  now = () => new Date(),
}) {
  const draftPicks = draftResults?.draftResults?.draftUnit?.draftPick ?? [];
  const existing = new Set(
    existingDeclarations.map((d) => `${d.franchiseId}:${d.playerId}`),
  );
  const created = [];

  for (const pick of draftPicks) {
    const playerId = String(pick.player ?? '').trim();
    const ts = String(pick.timestamp ?? '').trim();
    if (!playerId || !ts) continue; // not yet drafted

    const franchiseId = String(pick.franchise ?? '').trim();
    if (!franchiseId) continue;

    const key = `${franchiseId}:${playerId}`;
    if (existing.has(key)) continue;

    const round = parseInt(pick.round, 10);
    const pickInRound = parseInt(pick.pick, 10);
    if (!Number.isFinite(round) || !Number.isFinite(pickInRound)) continue;

    const overallPick = overallPickFromRoundPick(round, pickInRound);
    const player = playerIndex.get(playerId);
    const position = player?.position ?? 'WR';
    const playerName = player?.name ?? `Player ${playerId}`;
    const salary = getRookieSlotSalary(round, overallPick, position);

    const tsSec = parseInt(ts, 10);
    const submittedAt = Number.isFinite(tsSec)
      ? new Date(tsSec * 1000).toISOString()
      : now().toISOString();

    created.push({
      id: idGenerator(),
      type: 'rookie-override',
      playerId,
      playerName,
      franchiseId,
      franchiseName: franchiseNameMap.get(franchiseId) ?? `Team ${franchiseId}`,
      leagueId,
      currentYears: 4,
      currentSalary: salary,
      currentContractInfo: 'RC',
      requestedYears: 4,
      requestedSalary: salary,
      requestedContractInfo: 'RC',
      status: 'pending',
      submittedBy: 'Draft Auto-Sync',
      submittedAt,
      mflSynced: false,
      acquisitionTimestamp: Number.isFinite(tsSec) ? tsSec : undefined,
    });
  }

  return created;
}

function generateId() {
  return `DECL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Storage layer ──────────────────────────────────────────────────────

function getRedisConfig() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function readDeclarationsFromRedis(redis) {
  const res = await fetch(`${redis.url}/hgetall/${encodeURIComponent(REDIS_KEY)}`, {
    headers: { Authorization: `Bearer ${redis.token}` },
  });
  if (!res.ok) {
    throw new Error(`Redis hgetall failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const result = json?.result;
  if (!result) return [];

  // Upstash REST returns an object {field: value, ...} for hgetall
  if (typeof result === 'object' && !Array.isArray(result)) {
    return Object.values(result).map(parseRedisValue).filter(Boolean);
  }

  // Legacy flat-array form: [field, value, field, value, ...]
  if (Array.isArray(result)) {
    const out = [];
    for (let i = 1; i < result.length; i += 2) {
      const parsed = parseRedisValue(result[i]);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  return [];
}

function parseRedisValue(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

async function writeDeclarationsToRedis(redis, declarations) {
  // Upstash supports HSET with multiple field/value pairs in one call.
  // Build args: [REDIS_KEY, field1, value1, field2, value2, ...]
  const body = [REDIS_KEY];
  for (const d of declarations) {
    body.push(d.id, JSON.stringify(d));
  }
  const res = await fetch(`${redis.url}/hset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redis.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Redis hset failed: ${res.status} ${await res.text()}`);
  }
}

async function readDeclarationsFromFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.declarations ?? [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeDeclarationsToFile(filePath, declarations) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const file = {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    declarations,
  };
  await fs.writeFile(filePath, JSON.stringify(file, null, 2), 'utf-8');
}

// ── CLI entry point ────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { league: undefined, year: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--league') args.league = argv[++i];
    else if (argv[i] === '--year') args.year = argv[++i];
  }
  return args;
}

function getCurrentDraftYear() {
  const env =
    process.env.MFL_YEAR ||
    process.env.PUBLIC_BASE_YEAR ||
    process.env.MFL_SEASON;
  if (env) return parseInt(env, 10);
  // The draft happens in the spring of the current calendar year for that
  // year's season. Default to the current calendar year — the script also
  // tolerates a missing draftResults.json by exiting cleanly.
  return new Date().getFullYear();
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const leagueSlug = cli.league || process.env.MFL_LEAGUE_SLUG || 'theleague';
  const year = cli.year || String(getCurrentDraftYear());

  const feedsDir = path.join(projectRoot, 'data', leagueSlug, 'mfl-feeds', year);
  const draftResultsPath = path.join(feedsDir, 'draftResults.json');
  const playersPath = path.join(feedsDir, 'players.json');
  const leagueConfigPath = path.join(
    projectRoot,
    'src',
    'data',
    `${leagueSlug}.config.json`,
  );

  // Bail cleanly if no draft data yet
  let draftResults;
  try {
    draftResults = JSON.parse(await fs.readFile(draftResultsPath, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`[draft-pick-sync] No draftResults.json at ${draftResultsPath}; nothing to do.`);
      return;
    }
    throw err;
  }

  const playersRaw = JSON.parse(await fs.readFile(playersPath, 'utf-8'));
  const playerIndex = new Map();
  for (const p of playersRaw?.players?.player ?? []) {
    playerIndex.set(String(p.id), { position: p.position, name: p.name });
  }

  const leagueConfig = JSON.parse(await fs.readFile(leagueConfigPath, 'utf-8'));
  const franchiseNameMap = new Map();
  for (const team of leagueConfig.teams ?? []) {
    franchiseNameMap.set(
      team.franchiseId,
      team.nameShort || team.nameMedium || team.name || `Team ${team.franchiseId}`,
    );
  }
  const leagueId = String(
    leagueConfig.leagueId || process.env.MFL_LEAGUE_ID || '13522',
  );

  // Read existing declarations (Redis preferred, file fallback)
  const redis = getRedisConfig();
  const filePath = path.join(
    projectRoot,
    'data',
    leagueSlug,
    'contract-declarations.json',
  );

  let existingDeclarations;
  if (redis) {
    existingDeclarations = await readDeclarationsFromRedis(redis);
  } else {
    existingDeclarations = await readDeclarationsFromFile(filePath);
  }

  const newDeclarations = buildDraftPickDeclarations({
    draftResults,
    playerIndex,
    franchiseNameMap,
    leagueId,
    existingDeclarations,
  });

  if (newDeclarations.length === 0) {
    console.log('[draft-pick-sync] No new draft picks to process.');
    return;
  }

  if (redis) {
    await writeDeclarationsToRedis(redis, newDeclarations);
  } else {
    const merged = [...newDeclarations, ...existingDeclarations];
    await writeDeclarationsToFile(filePath, merged);
  }

  console.log(`[draft-pick-sync] Created ${newDeclarations.length} new rookie-override declaration(s):`);
  for (const d of newDeclarations) {
    const fmtSalary = `$${d.currentSalary.toLocaleString()}`;
    console.log(`  ${d.franchiseName.padEnd(14)} → ${d.playerName} (${fmtSalary})`);
  }
}

// Run only when invoked directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[draft-pick-sync] Failed:', err);
    process.exit(1);
  });
}
