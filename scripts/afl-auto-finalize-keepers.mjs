#!/usr/bin/env node
/**
 * AFL Keeper Auto-Finalize
 *
 * Owners sort their roster in the Keeper Planner (rosters?view=planner),
 * which auto-saves a plan to Redis — but the cuts only hit MFL when the
 * owner clicks "Finalize keepers". This script is the deadline backstop:
 * any plan still sitting in Redis after the keeper deadline (July 15,
 * 8:45 PM PT) gets finalized on the owner's behalf, exactly the way the
 * interactive flow would have done it — cut every rostered player who
 * isn't one of the 7 keepers, then delete the plan.
 *
 * Write path (in preference order):
 *   1. Owner-mode `add_drop` using the MFL cookie snapshotted by
 *      POST /api/afl-keepers when the plan was saved. Same request shape
 *      as src/pages/api/cut-player.ts (the proven interactive path).
 *   2. Commissioner-mode `import?TYPE=fcfsWaiver` with FRANCHISE_ID for
 *      plans saved before cookie snapshotting shipped. NOTE: MFL rejects
 *      this while the league's Commissioner Lockout is on ("Can not
 *      impersonate another franchise when LOCKOUT is on."). If you see
 *      that error, temporarily disable the lockout in MFL league setup
 *      and re-run via workflow_dispatch.
 *
 * Safety rules (see scripts/lib/afl-keeper-finalize.mjs):
 *   - Only acts between the deadline and 5 days after it (--force overrides).
 *   - Skips plans with fewer than 7 keepers (the UI can't finalize those either).
 *   - Skips stale plans where a saved keeper is no longer on the live roster.
 *   - Idempotent: a re-run only cuts players still rostered.
 *
 * Usage:
 *   node scripts/afl-auto-finalize-keepers.mjs            # live
 *   node scripts/afl-auto-finalize-keepers.mjs --dry-run  # print, no writes
 *   node scripts/afl-auto-finalize-keepers.mjs --force    # ignore deadline window
 *
 * Env:
 *   UPSTASH_REDIS_REST_URL/TOKEN (or KV_/STORAGE_ equivalents)  required
 *   MFL_USER_ID + MFL_IS_COMMISH   commissioner cookies (fallback path + roster reads)
 *   MFL_USERNAME + MFL_PASSWORD    commissioner login fallback
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import {
  KEEPER_LIMIT,
  parsePlanKey,
  decidePlanAction,
  resolveKeeperDeadline,
  isWithinAutoFinalizeWindow,
} from './lib/afl-keeper-finalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const AFL = LEAGUES['afl-fantasy'];
const PLANS_KEY = 'afl-keepers';
const CREDENTIALS_KEY = 'afl-keepers:credentials';
const CUT_THROTTLE_MS = 500;

// ── Redis (raw REST — mirrors scripts/apply-pending-contracts.mjs) ────────

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

async function redisCommand(redis, body) {
  const res = await fetch(redis.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redis.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Redis command failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.result;
}

/** HGETALL → Map<field, rawValue>. */
async function hgetallMap(redis, key) {
  const result = await redisCommand(redis, ['HGETALL', key]);
  const map = new Map();
  if (!Array.isArray(result)) return map;
  for (let i = 0; i < result.length; i += 2) {
    map.set(result[i], result[i + 1]);
  }
  return map;
}

/**
 * Values written through @upstash/redis are JSON-serialized — a plain string
 * lands in Redis wrapped in quotes. Reading over the raw REST API returns
 * that stored form verbatim, so unwrap when it parses to a string.
 */
function normalizeRedisString(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : raw;
  } catch {
    return raw;
  }
}

// ── MFL fetch helpers (redirect-safe, mirrors apply-pending-contracts) ────

async function mflFetch({ url, method = 'GET', cookies = {}, body, timeoutMs = 15_000 }) {
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;
  const cookieHeader = Object.entries(cookies)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  for (let hop = 0; hop <= 3; hop++) {
    const headers = {};
    if (cookieHeader) headers.Cookie = cookieHeader;
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
    currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
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

async function loginToMFL(username, password, year) {
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
    allSetCookies.push(...(res.headers.getSetCookie?.() ?? []));
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

// ── League data ────────────────────────────────────────────────────────────

/** AFL league year: June 1 PT hard flip (mirrors getAflLeagueYear). */
function getAflLeagueYear(now = new Date()) {
  const rollover = AFL.leagueYearRollover ?? { month: 6, day: 1 };
  const calendarYear = now.getUTCFullYear();
  const cutoff = new Date(Date.UTC(calendarYear, rollover.month - 1, rollover.day, 7, 0, 0, 0));
  return now >= cutoff ? calendarYear : calendarYear - 1;
}

function loadLeagueEvents() {
  const path = join(__dirname, '../src/data/afl-fantasy/league-events.json');
  return JSON.parse(readFileSync(path, 'utf-8')).events;
}

/** Fetch live rosters → Map<franchiseId, string[] playerIds> (all statuses). */
async function fetchRosters(year, commishCookies) {
  const url = `https://api.myfantasyleague.com/${year}/export?TYPE=rosters&L=${AFL.id}&JSON=1`;
  const res = await mflFetch({ url, cookies: commishCookies });
  if (!res.ok) throw new Error(`rosters fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  const franchises = data?.rosters?.franchise;
  const list = Array.isArray(franchises) ? franchises : franchises ? [franchises] : [];
  const map = new Map();
  for (const f of list) {
    const players = Array.isArray(f?.player) ? f.player : f?.player ? [f.player] : [];
    map.set(
      String(f.id),
      players.map((p) => String(p.id))
    );
  }
  return map;
}

// ── Cut execution ──────────────────────────────────────────────────────────

const ADD_DROP_ERROR_PATTERNS = [
  /Transaction Would Create[^<]*/i,
  /Exceeds League Limit[^<]*/i,
  /<error[^>]*>(.*?)<\/error>/s,
];

/** Owner-mode drop via MFL's add_drop page handler (mirrors api/cut-player.ts). */
async function ownerModeCut({ year, ownerCookie, playerId }) {
  const url = `https://${AFL.mflHost}/${year}/add_drop`;
  const params = new URLSearchParams({
    L: AFL.id,
    add_settings: '',
    PROJSRC: 'mfl',
    add_pid: '',
    drop_pid: String(playerId),
    ROUND: '1',
    COMMENTS: '',
    SUBMIT: 'Perform Add/Drop',
  });
  const res = await mflFetch({
    url,
    method: 'POST',
    cookies: { MFL_USER_ID: ownerCookie },
    body: params.toString(),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  for (const pattern of ADD_DROP_ERROR_PATTERNS) {
    const m = text.match(pattern);
    if (m) return { ok: false, error: (m[1] || m[0] || '').trim() || 'MFL rejected the cut' };
  }
  // add_drop returns an HTML page with no machine-readable success marker —
  // the roster re-read after the batch is the authoritative verification.
  return { ok: true };
}

/** Commissioner-mode drop via fcfsWaiver import + FRANCHISE_ID impersonation. */
async function commishModeCut({ year, commishCookies, franchiseId, playerId }) {
  const url = `https://${AFL.mflHost}/${year}/import?TYPE=fcfsWaiver&L=${AFL.id}`;
  const body = new URLSearchParams({
    DROP: String(playerId),
    FRANCHISE_ID: franchiseId,
  }).toString();
  const res = await mflFetch({ url, method: 'POST', cookies: commishCookies, body });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const err = text.match(/<error[^>]*>(.*?)<\/error>/s);
  if (err) return { ok: false, error: err[1].trim() };
  return { ok: true };
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
  };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const now = new Date();
  const year = getAflLeagueYear(now);

  const deadline = resolveKeeperDeadline(loadLeagueEvents(), year);
  console.log(`[auto-finalize] AFL year ${year}, keeper deadline ${deadline.toISOString()}`);

  if (!cli.force && !isWithinAutoFinalizeWindow(now, deadline)) {
    console.log('[auto-finalize] Outside the deadline window (deadline → +5 days). Nothing to do. Use --force to override.');
    return;
  }

  const redis = getRedisConfig();
  if (!redis) {
    throw new Error('No Redis config found. Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.');
  }

  const rawPlans = await hgetallMap(redis, PLANS_KEY);
  const credentials = await hgetallMap(redis, CREDENTIALS_KEY);

  // Plans for this league + year only. Upstash may return values as objects
  // (REST API deserializes JSON) or strings depending on how they were written.
  const plans = [];
  for (const [key, raw] of rawPlans) {
    const parsed = parsePlanKey(key);
    if (!parsed || parsed.leagueId !== AFL.id || parsed.year !== year) continue;
    let plan = raw;
    if (typeof raw === 'string') {
      try {
        plan = JSON.parse(raw);
      } catch {
        console.warn(`[auto-finalize] Skipping malformed plan record at ${key}`);
        continue;
      }
    }
    plans.push({ key, franchiseId: parsed.franchiseId, plan });
  }

  if (plans.length === 0) {
    console.log('[auto-finalize] No un-finalized plans for this year. Everyone beat the deadline (or never planned).');
    return;
  }

  console.log(`[auto-finalize] ${plans.length} un-finalized plan(s) found.`);

  // Commissioner cookies: used for roster reads and as the write fallback for
  // plans saved before owner-cookie snapshotting shipped.
  let commishCookies = {};
  if (process.env.MFL_USER_ID) {
    commishCookies = {
      MFL_USER_ID: process.env.MFL_USER_ID,
      MFL_IS_COMMISH: process.env.MFL_IS_COMMISH,
    };
  } else if (process.env.MFL_USERNAME && process.env.MFL_PASSWORD) {
    const { mflUserId, mflIsCommish } = await loginToMFL(
      process.env.MFL_USERNAME,
      process.env.MFL_PASSWORD,
      year
    );
    commishCookies = { MFL_USER_ID: mflUserId, MFL_IS_COMMISH: mflIsCommish };
  }

  const rosters = await fetchRosters(year, commishCookies);

  let finalized = 0;
  let skipped = 0;
  let failed = 0;

  for (const { key, franchiseId, plan } of plans) {
    const rosterIds = rosters.get(franchiseId) ?? [];
    const keepers = Array.isArray(plan?.keepers) ? plan.keepers : [];
    const decision = decidePlanAction({ keepers, rosterIds, limit: KEEPER_LIMIT });
    const label = `franchise ${franchiseId}`;

    if (decision.action === 'skip-partial') {
      skipped++;
      console.warn(`[auto-finalize] SKIP ${label}: only ${keepers.length}/${KEEPER_LIMIT} keepers saved — plan is incomplete, leaving roster untouched.`);
      continue;
    }
    if (decision.action === 'skip-missing-keepers') {
      skipped++;
      console.warn(`[auto-finalize] SKIP ${label}: keeper(s) no longer on live roster (${decision.missingKeepers.join(', ')}) — stale plan, needs a human.`);
      continue;
    }
    if (decision.action === 'already-finalized') {
      console.log(`[auto-finalize] ${label}: roster already matches the plan — cleaning up leftover plan record.`);
      if (!cli.dryRun) {
        await redisCommand(redis, ['HDEL', PLANS_KEY, key]);
        await redisCommand(redis, ['HDEL', CREDENTIALS_KEY, key]);
      }
      finalized++;
      continue;
    }

    const ownerCookie = normalizeRedisString(credentials.get(key));
    const mode = ownerCookie ? 'owner' : 'commissioner';
    console.log(`[auto-finalize] ${label}: cutting ${decision.cuts.length} player(s) [${mode}-mode]: ${decision.cuts.join(', ')}`);

    if (cli.dryRun) {
      console.log(`[auto-finalize] --dry-run: not writing to MFL for ${label}.`);
      continue;
    }

    if (mode === 'commissioner' && !commishCookies.MFL_USER_ID) {
      failed++;
      console.error(`[auto-finalize] FAIL ${label}: no owner cookie snapshot and no commissioner credentials configured.`);
      continue;
    }

    const cutErrors = [];
    for (const playerId of decision.cuts) {
      const result = ownerCookie
        ? await ownerModeCut({ year, ownerCookie, playerId })
        : await commishModeCut({ year, commishCookies, franchiseId, playerId });
      if (!result.ok) cutErrors.push(`${playerId}: ${result.error}`);
      await new Promise((r) => setTimeout(r, CUT_THROTTLE_MS));
    }

    // Authoritative verification: re-read this franchise's live roster and
    // check that every intended cut actually left it.
    const afterRosters = await fetchRosters(year, commishCookies);
    const after = new Set(afterRosters.get(franchiseId) ?? []);
    const stillRostered = decision.cuts.filter((id) => after.has(id));

    if (stillRostered.length === 0) {
      finalized++;
      console.log(`[auto-finalize] DONE ${label}: all ${decision.cuts.length} cuts confirmed on MFL. Deleting plan.`);
      await redisCommand(redis, ['HDEL', PLANS_KEY, key]);
      await redisCommand(redis, ['HDEL', CREDENTIALS_KEY, key]);
    } else {
      failed++;
      console.error(
        `[auto-finalize] FAIL ${label}: ${stillRostered.length} player(s) still rostered after cuts: ${stillRostered.join(', ')}.` +
          (cutErrors.length ? ` MFL errors: ${cutErrors.join(' | ')}` : '') +
          ' Plan kept in Redis for retry.'
      );
      if (cutErrors.some((e) => /LOCKOUT/i.test(e))) {
        console.error('[auto-finalize] HINT: Commissioner Lockout is blocking impersonation. Disable it in MFL league setup (temporarily) and re-run this workflow.');
      }
    }
  }

  console.log(`[auto-finalize] Summary: ${finalized} finalized, ${skipped} skipped, ${failed} failed (of ${plans.length} plans).`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[auto-finalize] Fatal error:', err);
  process.exit(1);
});
