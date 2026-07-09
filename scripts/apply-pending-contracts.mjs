#!/usr/bin/env node
/**
 * Apply Pending Contract Declarations
 *
 * Owners submit contract declarations via /api/contracts/declare, which
 * writes a `status: 'pending'` record to Redis (contract-declarations hash)
 * but does NOT touch MFL. Previously the only way to push that change to
 * MFL was the commissioner clicking "Apply" on /theleague/contracts/manage
 * (src/pages/api/contracts/approve.ts), which used the commissioner's own
 * session cookie.
 *
 * This script does the same MFL write + status flip, but headless — reads
 * every 'pending' declaration and applies it immediately, so no manual
 * click is required. If an owner updates a declaration while it's still
 * pending (declare.ts overwrites the same record in place), the next run
 * picks up the latest requestedYears/requestedSalary automatically.
 *
 * Talks to Redis over the raw REST API (not src/utils/contract-storage.ts)
 * because that module gates Redis-vs-filesystem on `process.env.VERCEL`,
 * which is never set in a GitHub Actions runner — mirrors the pattern in
 * scripts/sync-draft-pick-contracts.mjs.
 *
 * Usage:
 *   node scripts/apply-pending-contracts.mjs              # write to MFL
 *   node scripts/apply-pending-contracts.mjs --dry-run     # just print
 *
 * Env:
 *   MFL_USER_ID + (optional) MFL_IS_COMMISH  preferred (cookie-based, no login)
 *   MFL_USERNAME + MFL_PASSWORD              fallback (logs in to get cookie)
 *   MFL_LEAGUE_ID                  defaults to '13522'
 *   UPSTASH_REDIS_REST_URL/TOKEN   (or KV_REST_API_URL/TOKEN, or
 *                                   STORAGE_REST_API_URL/TOKEN) required
 */

const REDIS_KEY = 'contract-declarations';
const MFL_READ_HOST = process.env.MFL_HOST || 'https://api.myfantasyleague.com';
const MFL_WRITE_HOST = process.env.MFL_WRITE_HOST || 'https://www49.myfantasyleague.com';

// ── Redis (raw REST, no @upstash/redis dependency needed) ─────────────────

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

async function getAllDeclarations(redis) {
  const result = await redisCommand(redis, ['HGETALL', REDIS_KEY]);
  if (!Array.isArray(result)) return [];
  const declarations = [];
  for (let i = 0; i < result.length; i += 2) {
    try {
      declarations.push(JSON.parse(result[i + 1]));
    } catch {
      // skip malformed record
    }
  }
  return declarations;
}

async function saveDeclaration(redis, declaration) {
  await redisCommand(redis, ['HSET', REDIS_KEY, declaration.id, JSON.stringify(declaration)]);
}

// ── MFL auth + write (mirrors scripts/sync-draft-pick-contracts.mjs) ──────

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

async function writeContractToMFL({ leagueId, cookies, declaration }) {
  const year = new Date().getFullYear();
  const url = `${MFL_WRITE_HOST}/${year}/import?TYPE=salaries&L=${leagueId}&APPEND=1`;
  const salary = String(declaration.requestedSalary ?? declaration.currentSalary);
  const contractYear = String(declaration.requestedYears);
  const contractInfo = declaration.requestedContractInfo ?? declaration.currentContractInfo;
  const xml =
    '<salaries><leagueUnit unit="LEAGUE">' +
    `<player id="${declaration.playerId}" salary="${salary}" contractYear="${contractYear}" contractInfo="${contractInfo}" />` +
    '</leagueUnit></salaries>';
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
        return { success: true, attempts: attempt + 1 };
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

// ── CLI ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const leagueId = process.env.MFL_LEAGUE_ID || '13522';

  const redis = getRedisConfig();
  if (!redis) {
    throw new Error('No Redis config found. Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.');
  }

  const all = await getAllDeclarations(redis);
  const pending = all.filter((d) => d.status === 'pending');

  if (pending.length === 0) {
    console.log('[apply-contracts] No pending declarations. Nothing to do.');
    return;
  }

  console.log(`[apply-contracts] ${pending.length} pending declaration(s):`);
  for (const d of pending) {
    console.log(
      `  ${d.franchiseName.padEnd(20)} ${d.playerName.padEnd(24)} ${d.currentYears}yr -> ${d.requestedYears}yr`,
    );
  }

  if (cli.dryRun) {
    console.log('[apply-contracts] --dry-run: not writing to MFL.');
    return;
  }

  const envUserId = process.env.MFL_USER_ID;
  const envCommish = process.env.MFL_IS_COMMISH;
  const username = process.env.MFL_USERNAME;
  const password = process.env.MFL_PASSWORD;

  let mflUserId;
  let mflIsCommish;
  if (envUserId) {
    mflUserId = envUserId;
    mflIsCommish = envCommish;
  } else if (username && password) {
    ({ mflUserId, mflIsCommish } = await loginToMFL(username, password));
  } else {
    throw new Error('No MFL credentials available. Set MFL_USER_ID (preferred) or MFL_USERNAME + MFL_PASSWORD.');
  }
  const cookies = { MFL_USER_ID: mflUserId, MFL_IS_COMMISH: mflIsCommish };

  let applied = 0;
  let failed = 0;
  for (const declaration of pending) {
    const result = await writeContractToMFL({ leagueId, cookies, declaration });
    if (result.success) {
      applied++;
      await saveDeclaration(redis, {
        ...declaration,
        status: 'applied',
        mflSynced: true,
        mflSyncedAt: new Date().toISOString(),
        reviewedBy: 'Contract Auto-Apply',
        reviewedAt: new Date().toISOString(),
      });
      console.log(`[apply-contracts] Applied ${declaration.playerName} (${declaration.franchiseName}).`);
    } else {
      failed++;
      await saveDeclaration(redis, { ...declaration, mflError: result.error });
      console.error(`[apply-contracts] Failed ${declaration.playerName}: ${result.error}`);
    }
  }

  console.log(`[apply-contracts] Done. ${applied} applied, ${failed} failed.`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[apply-contracts] Fatal error:', err);
  process.exit(1);
});
