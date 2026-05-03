#!/usr/bin/env node
/**
 * Sync Draft Pick Contracts
 *
 * After each MFL feed fetch, scan draftResults.json for newly-completed
 * picks and write the league's standard rookie contract directly to MFL:
 *   contractInfo = "RC" for rounds 2-3, and rounds 1 in years before 2026
 *   contractInfo = "TO" for round 1 picks in 2026 and later (5th-year team
 *                       option flag — required for the rosters page to offer
 *                       the team-option action when the player has 1 year left)
 *   contractYear = "4"  (default RC length; owners reduce to 1-3 via the
 *                        existing rookie-override flow before the August
 *                        cutdown)
 *   salary       = slot-based rookie salary by round/pick/position
 *
 * Why direct write instead of pending-declaration model:
 *   MFL does NOT auto-apply RC on drafted players. Without this script
 *   stamping a contractInfo, the rosters-page rookie-override button never
 *   appears (eligibility check requires contractInfo === 'RC' or 'TO'). By
 *   writing the right tag + the slot salary up front, owners can self-serve
 *   their year choice 1-3 from the rosters page until the August cutdown.
 *   The commissioner is no longer the critical-path step.
 *
 * Idempotency: queries current MFL salaries first and skips any drafted
 * player whose contractInfo already matches what we'd write. A 1st-round
 * pick that was previously stamped 'RC' (before this script knew about TO)
 * gets re-stamped as 'TO' on the next run — preserving any reduced
 * contractYear from the rookie-override flow. Safe to run on every
 * roster-sync tick (every 5 min).
 *
 * Audit trail: also writes an `applied` ContractDeclaration record into
 * storage (Upstash Redis or local JSON) so the change shows up in the
 * Applied Contracts section on /theleague/contracts/manage.
 *
 * Usage:
 *   node scripts/sync-draft-pick-contracts.mjs              # write to MFL
 *   node scripts/sync-draft-pick-contracts.mjs --dry-run    # just print
 *   node scripts/sync-draft-pick-contracts.mjs --league afl --year 2026
 *
 * Env:
 *   MFL_USER_ID + (optional) MFL_IS_COMMISH  preferred (cookie-based, no login)
 *   MFL_USERNAME + MFL_PASSWORD              fallback (logs in to get cookie)
 *   MFL_LEAGUE_ID                  defaults to '13522'
 *   MFL_LEAGUE_SLUG                defaults to 'theleague'
 *   MFL_YEAR / PUBLIC_BASE_YEAR    optional explicit year override
 *   UPSTASH_REDIS_REST_URL/TOKEN   audit trail in production
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
const RC_DEFAULT_YEARS = 4;
const MFL_READ_HOST = process.env.MFL_HOST || 'https://api.myfantasyleague.com';
const MFL_WRITE_HOST = process.env.MFL_WRITE_HOST || 'https://www49.myfantasyleague.com';

// ── Pure logic (testable) ──────────────────────────────────────────────

/**
 * Returns the contractInfo tag that a freshly-drafted pick of the given
 * round/year should carry. 1st-round picks from 2026 onward get 'TO' (5th-
 * year team option); everything else gets 'RC'. Per league constitution
 * (FIRST-ROUND TEAM OPTION section).
 */
export function getExpectedRookieContractInfo(round, year) {
  const yr = parseInt(year, 10);
  if (round === 1 && Number.isFinite(yr) && yr >= 2026) return 'TO';
  return 'RC';
}

/**
 * Build the list of MFL contract writes that should happen for the given
 * draft results, skipping any pick whose current MFL contractInfo already
 * matches the expected value for its round/year.
 *
 * @param {object} args
 * @param {object} args.draftResults  Parsed draftResults.json
 * @param {Map<string, {position: string, name: string}>} args.playerIndex
 * @param {Map<string, {salary: string, contractYear: string, contractInfo: string}>} args.mflSalaries
 *   Player ID → current MFL contract state
 * @param {string|number} args.year  Draft year (e.g. '2026')
 */
export function buildDraftPickWrites({ draftResults, playerIndex, mflSalaries, year }) {
  const draftPicks = draftResults?.draftResults?.draftUnit?.draftPick ?? [];
  const writes = [];

  for (const pick of draftPicks) {
    const playerId = String(pick.player ?? '').trim();
    const ts = String(pick.timestamp ?? '').trim();
    if (!playerId || !ts) continue; // not yet drafted

    const franchiseId = String(pick.franchise ?? '').trim();
    if (!franchiseId) continue;

    const round = parseInt(pick.round, 10);
    const pickInRound = parseInt(pick.pick, 10);
    if (!Number.isFinite(round) || !Number.isFinite(pickInRound)) continue;

    const expectedContractInfo = getExpectedRookieContractInfo(round, year);

    // Skip if MFL already has the expected tag — intent-aware so a 1st-rounder
    // previously stamped 'RC' gets re-stamped to 'TO' on the next run.
    const current = mflSalaries.get(playerId);
    if (current?.contractInfo === expectedContractInfo) continue;

    // Preserve the existing contractYear when re-stamping a player who was
    // already given a rookie tag (their year may have been reduced via the
    // rookie-override flow). Otherwise default to the standard 4-year RC.
    const wasAlreadyStamped = current?.contractInfo === 'RC' || current?.contractInfo === 'TO';
    const existingYear = wasAlreadyStamped ? parseInt(current?.contractYear ?? '', 10) : NaN;
    const contractYear =
      Number.isFinite(existingYear) && existingYear >= 1 && existingYear <= 5
        ? String(existingYear)
        : String(RC_DEFAULT_YEARS);

    const overallPick = overallPickFromRoundPick(round, pickInRound);
    const player = playerIndex.get(playerId);
    const position = player?.position ?? 'WR';
    const playerName = player?.name ?? `Player ${playerId}`;
    const salary = getRookieSlotSalary(round, overallPick, position);
    const tsSec = parseInt(ts, 10);

    writes.push({
      playerId,
      playerName,
      franchiseId,
      round,
      pickInRound,
      position,
      salary,
      contractYear,
      contractInfo: expectedContractInfo,
      acquisitionTimestamp: Number.isFinite(tsSec) ? tsSec : undefined,
    });
  }

  return writes;
}

// ── MFL auth + fetch (mirrors src/utils/mfl-login.ts + mfl-fetch.ts) ──

/**
 * Manual-redirect fetch that re-attaches the Cookie header on every hop.
 * Required because Node.js undici strips Cookie on cross-origin 302s, and
 * MFL's api.* host always redirects to www49.* for authenticated calls.
 */
async function mflFetch({ url, method = 'GET', cookies, body, timeoutMs = 10_000 }) {
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;
  const cookieHeader = Object.entries(cookies)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  for (let hop = 0; hop <= 3; hop++) {
    const headers = { Cookie: cookieHeader };
    if (currentMethod === 'POST' && currentBody) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const res = await fetch(currentUrl, {
      method: currentMethod,
      headers,
      body: currentMethod === 'POST' ? currentBody : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    currentUrl = location.startsWith('http')
      ? location
      : new URL(location, currentUrl).href;
    if (res.status === 302 || res.status === 303) {
      if (currentMethod === 'POST' && currentBody) {
        const sep = currentUrl.includes('?') ? '&' : '?';
        currentUrl = `${currentUrl}${sep}${currentBody}`;
      }
      currentMethod = 'GET';
      currentBody = undefined;
    }
  }
  throw new Error(`mflFetch exceeded redirect limit for ${url}`);
}

/**
 * Log into MFL with username/password and return MFL_USER_ID + (optional)
 * MFL_IS_COMMISH cookies. Mirrors src/utils/mfl-login.ts but stripped to
 * just the cookie acquisition (no franchise-resolution step).
 */
async function loginToMFL(username, password) {
  const year = new Date().getFullYear();
  const loginUrl = `https://api.myfantasyleague.com/${year}/login`;
  const params = new URLSearchParams({ USERNAME: username, PASSWORD: password, XML: '1' });

  const allSetCookies = [];
  let url = loginUrl;
  let method = 'POST';
  let body = params.toString();
  let finalText = '';

  for (let hop = 0; hop <= 3; hop++) {
    const headers = method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {};
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    const hopCookies = res.headers.getSetCookie?.() ?? [];
    allSetCookies.push(...hopCookies);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        finalText = await res.text();
        break;
      }
      url = location.startsWith('http') ? location : new URL(location, url).href;
      if (res.status === 302 || res.status === 303) {
        if (method === 'POST' && body) {
          const sep = url.includes('?') ? '&' : '?';
          url = `${url}${sep}${body}`;
        }
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    finalText = await res.text();
    break;
  }

  // Fall back to GET-with-params if POST returned empty
  if (!finalText.trim()) {
    const fallbackUrl = `${loginUrl}?${params.toString()}`;
    const res = await fetch(fallbackUrl, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
    finalText = await res.text();
    const hopCookies = res.headers.getSetCookie?.() ?? [];
    allSetCookies.push(...hopCookies);
  }

  const errorMatch = finalText.match(/<error[^>]*>(.*?)<\/error>/s);
  if (errorMatch) throw new Error(`MFL login failed: ${errorMatch[1].trim()}`);

  const cookieMatch = finalText.match(/MFL_USER_ID="([^"]+)"/);
  if (!cookieMatch) throw new Error(`MFL login: no MFL_USER_ID in response: ${finalText.slice(0, 200)}`);

  let commishCookie;
  for (const cookieStr of allSetCookies) {
    const m = cookieStr.match(/MFL_IS_COMMISH=([^;]+)/);
    if (m) {
      commishCookie = m[1];
      break;
    }
  }

  return { mflUserId: cookieMatch[1], mflIsCommish: commishCookie };
}

async function fetchCurrentMFLSalaries({ leagueId, year, cookies }) {
  const url = `${MFL_READ_HOST}/${year}/export?TYPE=salaries&L=${leagueId}&JSON=1`;
  const res = await mflFetch({ url, cookies });
  if (!res.ok) throw new Error(`MFL salaries fetch failed: ${res.status}`);
  const data = await res.json();
  const players = data?.salaries?.leagueUnit?.player ?? [];
  const map = new Map();
  for (const p of players) {
    map.set(String(p.id), {
      salary: p.salary,
      contractYear: p.contractYear,
      contractInfo: p.contractInfo,
    });
  }
  return map;
}

async function writeContractsToMFL({ leagueId, year, cookies, writes }) {
  const url = `${MFL_WRITE_HOST}/${year}/import?TYPE=salaries&L=${leagueId}&APPEND=1`;
  const playerXml = writes
    .map(
      (w) =>
        `<player id="${w.playerId}" salary="${w.salary}" contractYear="${w.contractYear}" contractInfo="${w.contractInfo}" />`,
    )
    .join('');
  const xml = `<salaries><leagueUnit unit="LEAGUE">${playerXml}</leagueUnit></salaries>`;
  const body = new URLSearchParams({ DATA: xml }).toString();

  const delays = [500, 1500];
  let lastError = '';
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await mflFetch({ url, method: 'POST', cookies, body });
    if (res.ok) {
      const text = await res.text();
      if (text.toLowerCase().includes('error')) {
        lastError = `MFL error response: ${text.slice(0, 200)}`;
      } else {
        return { success: true, attempts: attempt + 1, response: text.slice(0, 200) };
      }
    } else {
      lastError = `HTTP ${res.status}`;
    }
    if (attempt < delays.length) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  return { success: false, attempts: delays.length + 1, error: lastError };
}

// ── Audit-trail declaration storage (best-effort) ──────────────────────

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

async function writeAuditDeclarations(declarations, leagueSlug) {
  if (declarations.length === 0) return;

  const redis = getRedisConfig();
  if (redis) {
    const body = [REDIS_KEY];
    for (const d of declarations) body.push(d.id, JSON.stringify(d));
    const res = await fetch(`${redis.url}/hset`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[draft-pick-sync] audit write to Redis failed: ${res.status} ${await res.text()}`);
    }
    return;
  }

  // Local dev fallback
  const filePath = path.join(projectRoot, 'data', leagueSlug, 'contract-declarations.json');
  let existing = { version: '1.0', lastUpdated: '', declarations: [] };
  try {
    existing = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  existing.lastUpdated = new Date().toISOString();
  existing.declarations = [...declarations, ...(existing.declarations ?? [])];
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2), 'utf-8');
}

function generateDeclarationId() {
  return `DECL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildAuditDeclaration({ write, leagueId, franchiseNameMap }) {
  const submittedAt = write.acquisitionTimestamp
    ? new Date(write.acquisitionTimestamp * 1000).toISOString()
    : new Date().toISOString();
  return {
    id: generateDeclarationId(),
    type: 'rookie-override',
    playerId: write.playerId,
    playerName: write.playerName,
    franchiseId: write.franchiseId,
    franchiseName: franchiseNameMap.get(write.franchiseId) ?? `Team ${write.franchiseId}`,
    leagueId,
    currentYears: 0,
    currentSalary: 0,
    currentContractInfo: '',
    requestedYears: parseInt(write.contractYear, 10) || RC_DEFAULT_YEARS,
    requestedSalary: write.salary,
    requestedContractInfo: write.contractInfo,
    status: 'applied',
    submittedBy: 'Draft Auto-Sync',
    submittedAt,
    reviewedBy: 'Draft Auto-Sync',
    reviewedAt: new Date().toISOString(),
    mflSynced: true,
    mflSyncedAt: new Date().toISOString(),
    acquisitionTimestamp: write.acquisitionTimestamp,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { league: undefined, year: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--league') args.league = argv[++i];
    else if (argv[i] === '--year') args.year = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

function getCurrentDraftYear() {
  const env =
    process.env.MFL_YEAR ||
    process.env.PUBLIC_BASE_YEAR ||
    process.env.MFL_SEASON;
  if (env) return parseInt(env, 10);
  return new Date().getFullYear();
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const leagueSlug = cli.league || process.env.MFL_LEAGUE_SLUG || 'theleague';
  const year = cli.year || String(getCurrentDraftYear());

  const feedsDir = path.join(projectRoot, 'data', leagueSlug, 'mfl-feeds', year);
  const draftResultsPath = path.join(feedsDir, 'draftResults.json');
  const playersPath = path.join(feedsDir, 'players.json');
  const leagueConfigPath = path.join(projectRoot, 'src', 'data', `${leagueSlug}.config.json`);

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
  const leagueId = String(leagueConfig.leagueId || process.env.MFL_LEAGUE_ID || '13522');

  // Auth — prefer cookies if present (matches existing repo patterns); fall
  // back to username/password login. Either yields the same cookie pair used
  // by mfl-contract-writer.ts.
  const envUserId = process.env.MFL_USER_ID;
  const envCommish = process.env.MFL_IS_COMMISH;
  const username = process.env.MFL_USERNAME;
  const password = process.env.MFL_PASSWORD;

  let mflUserId;
  let mflIsCommish;
  if (envUserId) {
    mflUserId = envUserId;
    mflIsCommish = envCommish;
    console.log(
      `[draft-pick-sync] Using MFL_USER_ID cookie from env${envCommish ? ' (commish cookie present)' : ''}.`,
    );
  } else if (username && password) {
    ({ mflUserId, mflIsCommish } = await loginToMFL(username, password));
    console.log(
      `[draft-pick-sync] Logged into MFL via MFL_USERNAME/MFL_PASSWORD${mflIsCommish ? ' (commish cookie present)' : ''}.`,
    );
  } else {
    throw new Error(
      'No MFL credentials available. Set MFL_USER_ID (preferred) or MFL_USERNAME + MFL_PASSWORD.',
    );
  }
  const cookies = { MFL_USER_ID: mflUserId, MFL_IS_COMMISH: mflIsCommish };

  // Fetch current MFL salaries to detect which picks still need RC stamped
  const mflSalaries = await fetchCurrentMFLSalaries({ leagueId, year, cookies });

  const writes = buildDraftPickWrites({ draftResults, playerIndex, mflSalaries, year });

  if (writes.length === 0) {
    console.log('[draft-pick-sync] All drafted players already have the expected contractInfo stamped. Nothing to do.');
    return;
  }

  console.log(`[draft-pick-sync] ${writes.length} draft pick(s) need contract stamped:`);
  for (const w of writes) {
    console.log(
      `  ${(franchiseNameMap.get(w.franchiseId) ?? w.franchiseId).padEnd(14)} ` +
        `R${w.round}.${String(w.pickInRound).padStart(2, '0')} ${w.position.padEnd(3)} ` +
        `${w.playerName.padEnd(28)} → $${w.salary.toLocaleString()} / ${w.contractYear}yr / ${w.contractInfo}`,
    );
  }

  if (cli.dryRun) {
    console.log('[draft-pick-sync] --dry-run: not writing to MFL.');
    return;
  }

  const result = await writeContractsToMFL({ leagueId, year, cookies, writes });
  if (!result.success) {
    throw new Error(`MFL write failed after ${result.attempts} attempt(s): ${result.error}`);
  }
  console.log(`[draft-pick-sync] MFL write succeeded (attempt ${result.attempts}).`);

  const auditDeclarations = writes.map((w) =>
    buildAuditDeclaration({ write: w, leagueId, franchiseNameMap }),
  );
  try {
    await writeAuditDeclarations(auditDeclarations, leagueSlug);
    console.log(`[draft-pick-sync] Recorded ${auditDeclarations.length} audit-trail declaration(s).`);
  } catch (err) {
    console.warn(`[draft-pick-sync] Audit-trail write failed (MFL write already succeeded): ${err.message}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[draft-pick-sync] Failed:', err);
    process.exit(1);
  });
}
