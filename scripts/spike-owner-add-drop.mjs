#!/usr/bin/env node
/**
 * Phase 0 live spike — owner-cookie add_drop replay from a headless context.
 *
 * WHY THIS EXISTS: the August roster-cutdown deadline job
 * (scripts/apply-august-cuts.mjs) executes cuts by replaying each owner's
 * stored MFL session cookie from a GitHub Actions runner and POSTing to MFL's
 * `add_drop` page handler in OWNER mode (no FRANCHISE_ID, no commissioner
 * impersonation). That whole write path has never once been exercised
 * end-to-end from script context — execution night would otherwise be its
 * first live test. This spike proves it, net-zero, before August.
 *
 * WHAT IT DOES (one real add + one real drop = zero net roster change):
 *   1. Acquire an owner cookie — preferring the REAL job path (a stored
 *      encrypted credential envelope from Redis, decrypted with
 *      AUTOCUT_CRED_KEY), falling back to a fresh MFL_USERNAME/MFL_PASSWORD
 *      login. Reports loudly which path was used.
 *   2. Validate the cookie with the cheap authenticated `myleagues` read and
 *      DERIVE the target franchise id from it (never assume 0001).
 *   3. Pick a deep, irrelevant free agent (obscure kicker) — or --player <id>.
 *   4. Pre-read the roster (count + confirm the target is NOT already on it).
 *   5. add_drop POST add_pid=<id> (verify the add landed) → add_drop POST
 *      drop_pid=<id> via the identical owner-mode, over-limit-tolerant drop
 *      the deadline job uses (verify the drop landed) → confirm the final
 *      roster count equals the pre-spike count.
 *
 * SAFETY: --dry-run (the DEFAULT) does everything up to but NOT including the
 * two add_drop POSTs. Live writes require an explicit --live flag (or RUN_LIVE
 * env). If the ADD succeeds but the DROP fails, the spike shouts the manual
 * cleanup instruction (drop the player in the MFL UI) and exits non-zero, so a
 * half-applied spike can never masquerade as success.
 *
 * NEVER logs cookie material.
 *
 * Env:
 *   AUTOCUT_CRED_KEY                          decrypt stored credential (path a)
 *   MFL_USERNAME / MFL_PASSWORD               fresh login (path b)
 *   UPSTASH_REDIS_REST_URL/TOKEN (or KV_*)    stored-credential lookup (path a)
 *   MFL_APIKEY / MFL_API_KEY                  optional, for authenticated reads
 *   AUTOCUT_SPIKE_FID                         optional — restrict path (a) to
 *                                             one franchise's stored credential
 *   RUN_LIVE                                  truthy → enable live writes
 *                                             (equivalent to --live)
 *
 * Flags:
 *   --live            perform the real add + drop (default is --dry-run)
 *   --dry-run         force dry-run (overrides --live / RUN_LIVE)
 *   --player <id>     use this free-agent id instead of auto-picking
 *   --year <n>        override the league year (default: PT calendar year)
 */

import { getRedisConfig, redisCommand } from './lib/redis.mjs';
import {
  mflFetch,
  fetchExport,
  mflHostPrefix,
  extractMyLeagues,
  loginToMFL,
} from './lib/mfl-api.mjs';
import { deriveCredentialKey, decryptCredentialRecord, ptDateParts } from './lib/august-cutdown.mjs';
import { getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';
import { normalizeFranchiseId as pad4 } from '../src/utils/franchise-id.mjs';

const LEAGUE = getLeagueBySlug(DEFAULT_LEAGUE_SLUG);
const LEAGUE_ID = LEAGUE.id;
const TAG = '[spike-owner-add-drop]';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// GitHub Actions annotations + PASS/FAIL bookkeeping
// ---------------------------------------------------------------------------

let failed = false;
const pass = (step, msg) => console.log(`::notice::${TAG} PASS ${step}${msg ? ` — ${msg}` : ''}`);
const fail = (step, msg) => {
  failed = true;
  console.error(`::error::${TAG} FAIL ${step}${msg ? ` — ${msg}` : ''}`);
};
const info = (msg) => console.log(`${TAG} ${msg}`);

/** A hard-stop failure: annotate and abort the run with a non-zero exit. */
class SpikeError extends Error {}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { live: false, dryRun: false, player: null, year: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--live') args.live = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--player') {
      const raw = argv[++i];
      if (!raw || !/^\d+$/.test(raw)) {
        throw new SpikeError(`--player requires a numeric MFL player id (got: ${raw ?? '<missing>'})`);
      }
      args.player = raw;
    } else if (a === '--year') {
      const raw = argv[++i];
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed)) throw new SpikeError(`--year requires a numeric year (got: ${raw ?? '<missing>'})`);
      args.year = parsed;
    } else throw new SpikeError(`Unknown flag: ${a}`);
  }
  return args;
}

const truthy = (v) => v !== undefined && v !== null && v !== '' && v !== '0' && String(v).toLowerCase() !== 'false';

// ---------------------------------------------------------------------------
// MFL read helpers (mirror apply-august-cuts.mjs shapes)
// ---------------------------------------------------------------------------

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function apiKeyExtra() {
  const key = process.env.MFL_APIKEY || process.env.MFL_API_KEY;
  return key ? `&APIKEY=${encodeURIComponent(key)}` : '';
}

/** Strip the APIKEY value from any string (URLs embedded in error messages). */
const redactApiKey = (s) => `${s}`.replace(/APIKEY=[^&\s]+/g, 'APIKEY=***');

async function fetchLeagueExport(year, type, extra = '') {
  try {
    return await fetchExport(
      { host: mflHostPrefix(LEAGUE.mflHost), leagueId: LEAGUE_ID, year, type, extra: `${extra}${apiKeyExtra()}` },
      {
        retries: 2,
        sleepMs: 750,
        onFetch: (url) => info(`fetch ${redactApiKey(url)}`),
        onRetry: (url, attempt) => console.warn(`${TAG} 429 from MFL (attempt ${attempt + 1}) — backing off`),
      },
    );
  } catch (err) {
    // fetchExport errors embed the full request URL — redact the APIKEY
    // before the message can reach logs or ::error:: annotations.
    throw new SpikeError(redactApiKey(err?.message ?? err));
  }
}

/**
 * Roster player ids for one franchise. Throws on a degraded/empty response
 * (same guard philosophy as apply-august-cuts.mjs#fetchRosters) — an empty
 * roster set would make the target look already-added or already-dropped.
 */
async function fetchRosterPlayerIds(year, franchiseId) {
  const data = await fetchLeagueExport(year, 'rosters', `&FRANCHISE=${pad4(franchiseId)}`);
  const franchises = toArray(data?.rosters?.franchise);
  if (franchises.length === 0) {
    throw new SpikeError(`degraded rosters response from MFL (no franchises) for ${franchiseId}`);
  }
  const target = franchises.find((fr) => pad4(fr.id) === pad4(franchiseId)) ?? franchises[0];
  return toArray(target?.player).map((p) => `${p.id}`);
}

/**
 * Cross-check the transactions feed (authoritative for adds/drops when the
 * rosters endpoint lags — docs/claude/insights/domains/mfl-api.md). Drop-only
 * markers read `|{pid},`; add markers read `{pid}|`.
 */
async function transactionMatches(year, franchiseId, needle, sinceEpochSeconds) {
  try {
    const data = await fetchLeagueExport(year, 'transactions', `&TRANS_TYPE=FREE_AGENT&FRANCHISE=${pad4(franchiseId)}`);
    for (const txn of toArray(data?.transactions?.transaction)) {
      const ts = parseInt(txn?.timestamp, 10);
      if (!Number.isFinite(ts) || ts < sinceEpochSeconds) continue;
      if (`${txn?.transaction ?? ''}`.includes(needle)) return true;
    }
  } catch (err) {
    console.warn(`${TAG} transactions cross-check failed for ${franchiseId} (${needle}): ${err.message}`);
  }
  return false;
}

const addConfirmedByTransactions = (year, fid, pid, since) => transactionMatches(year, fid, `${pid}|`, since);
const dropConfirmedByTransactions = (year, fid, pid, since) => transactionMatches(year, fid, `|${pid},`, since);

// ---------------------------------------------------------------------------
// MFL write — the add_drop page handler (owner mode; ported from cut-player.ts
// / apply-august-cuts.mjs#postAddDrop, generalized for add OR drop).
// ---------------------------------------------------------------------------

/**
 * INVARIANT: owner-mode only. NEVER send FRANCHISE_ID — MFL's lockout-
 * impersonation check silently no-ops the write when a franchise id rides
 * along on an owner request. The cookie alone identifies the franchise. This
 * is the exact drop mechanism the deadline job replays.
 */
async function postAddDrop({ year, addPid = '', dropPid = '', ownerCookie }) {
  const addDropUrl = `https://${LEAGUE.mflHost}/${year}/add_drop`;
  const params = new URLSearchParams({
    L: LEAGUE_ID,
    add_settings: '',
    PROJSRC: 'mfl',
    add_pid: `${addPid}`,
    drop_pid: `${dropPid}`,
    ROUND: '1',
    COMMENTS: '',
    SUBMIT: 'Perform Add/Drop',
  });

  const res = await mflFetch({
    url: addDropUrl,
    method: 'POST',
    cookies: { MFL_USER_ID: ownerCookie },
    body: params.toString(),
    timeoutMs: 15_000,
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

  // add_drop returns an HTML page; a recognized error message is definitive.
  const errMatch =
    text.match(/Transaction Would Create[^<]*/i) ||
    text.match(/Exceeds League Limit[^<]*/i) ||
    text.match(/Can not impersonate[^<]*/i) ||
    text.match(/not available[^<]*/i) ||
    text.match(/<error[^>]*>(.*?)<\/error>/s);
  if (errMatch) {
    const errorMsg = (errMatch[1] || errMatch[0] || '').trim() || 'MFL rejected the add_drop request';
    return { ok: false, error: errorMsg };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Credential acquisition — prefer the real job path (stored envelope).
// ---------------------------------------------------------------------------

async function redisGetJson(redis, key) {
  const raw = await redisCommand(redis, ['GET', key]);
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** SCAN the whole keyspace for a MATCH pattern (cursor loop). */
async function scanKeys(redis, pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const res = await redisCommand(redis, ['SCAN', cursor, 'MATCH', pattern, 'COUNT', 200]);
    cursor = Array.isArray(res) ? `${res[0]}` : '0';
    for (const k of (Array.isArray(res) ? res[1] : []) ?? []) keys.push(k);
  } while (cursor !== '0');
  return keys;
}

/**
 * Returns { cookie, source } or throws SpikeError if no credential is
 * obtainable. `source` is one of 'stored-envelope' | 'fresh-login'. The cookie
 * is NEVER logged.
 */
async function acquireCredential() {
  // ── Path (a): stored encrypted envelope — the REAL deadline-job path ──
  const redis = getRedisConfig();
  const credentialKeyBuf = deriveCredentialKey();
  if (redis && credentialKeyBuf) {
    const wantFid = process.env.AUTOCUT_SPIKE_FID ? pad4(process.env.AUTOCUT_SPIKE_FID) : null;
    let credKeys = await scanKeys(redis, 'autocut:cred:*');
    if (wantFid) credKeys = credKeys.filter((k) => pad4(k.split(':').pop()) === wantFid);
    for (const k of credKeys) {
      const storedFid = pad4(k.split(':').pop());
      const record = await redisGetJson(redis, k);
      const cred = record ? decryptCredentialRecord(record, credentialKeyBuf, storedFid) : null;
      if (cred) {
        info(`credential source: STORED ENVELOPE (autocut:cred:${storedFid}, captured ${cred.capturedAt}) — this exercises the real deadline-job path.`);
        pass('credential-acquired', `stored envelope for franchise ${storedFid}`);
        return { cookie: cred.cookie, source: 'stored-envelope' };
      }
    }
    if (credKeys.length) {
      info(`found ${credKeys.length} stored credential(s) but none decrypted with AUTOCUT_CRED_KEY — falling back to fresh login.`);
    } else {
      info('no stored credential envelopes in Redis — falling back to fresh login.');
    }
  } else {
    const why = !redis ? 'no Redis config' : 'AUTOCUT_CRED_KEY not set';
    info(`stored-envelope path unavailable (${why}) — falling back to fresh login.`);
  }

  // ── Path (b): fresh MFL_USERNAME/MFL_PASSWORD login (XML=1 flow) ──
  const username = process.env.MFL_USERNAME;
  const password = process.env.MFL_PASSWORD;
  if (username && password) {
    const { mflUserId } = await loginToMFL(username, password);
    if (!mflUserId) throw new SpikeError('fresh login returned no MFL_USER_ID cookie.');
    info('credential source: FRESH LOGIN (MFL_USERNAME/MFL_PASSWORD, XML=1) — also proves cookie acquisition.');
    pass('credential-acquired', 'fresh login');
    return { cookie: mflUserId, source: 'fresh-login' };
  }

  throw new SpikeError(
    'no credential available. Provide a stored envelope (AUTOCUT_CRED_KEY + Redis) or MFL_USERNAME/MFL_PASSWORD.',
  );
}

// ---------------------------------------------------------------------------
// Cookie validation + target-franchise resolution (never assume 0001)
// ---------------------------------------------------------------------------

function normalizeFranchise(value) {
  if (!value) return '';
  const trimmed = `${value}`.trim();
  if (!trimmed) return '';
  return /^\d+$/.test(trimmed) ? pad4(trimmed) : trimmed;
}

async function resolveTargetFranchise(cookie, year) {
  const url = `https://api.myfantasyleague.com/${year}/export?TYPE=myleagues&JSON=1`;
  const res = await mflFetch({ url, cookies: { MFL_USER_ID: cookie } });
  if (!res.ok) throw new SpikeError(`myleagues read returned HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  const leagues = extractMyLeagues(body);
  if (leagues.length === 0) {
    throw new SpikeError('the cookie no longer authenticates (myleagues returned no leagues).');
  }
  const target = leagues.find(
    (l) =>
      `${l.id ?? l.league_id ?? l.leagueId ?? ''}` === `${LEAGUE_ID}` ||
      `${l.league ?? ''}` === `${LEAGUE_ID}`,
  );
  if (!target) {
    throw new SpikeError(`the account is not a member of league ${LEAGUE_ID} (found ${leagues.length} other league(s)).`);
  }
  const fid = normalizeFranchise(
    target?.franchise_id ?? target?.franchiseId ?? target?.team_id ?? target?.teamId ?? target?.team ?? '',
  );
  if (!fid) throw new SpikeError('resolved the league but MFL returned no franchise id for this account.');
  return { fid, leagueCount: leagues.length };
}

// ---------------------------------------------------------------------------
// Target free-agent selection
// ---------------------------------------------------------------------------

/**
 * Pick a deep, irrelevant free agent: prefer kickers (near-zero dynasty
 * waiver interest), then take the highest MFL id (newest DB record → obscure
 * UDFA/practice-squad nobody). Falls back to the whole FA pool if the league
 * carries no free-agent kickers. Aborts if the FA read looks degraded/empty.
 */
async function pickTargetPlayer(year) {
  const data = await fetchLeagueExport(year, 'freeAgents');
  // `leagueUnit` is normally a single object but can be an array in
  // multi-unit leagues — flatten either shape before reading `player`.
  const players = toArray(data?.freeAgents?.leagueUnit)
    .flatMap((unit) => toArray(unit?.player))
    .map((p) => ({ id: `${p.id}`, position: `${p.position ?? ''}` }))
    .filter((p) => /^\d+$/.test(p.id));

  // A healthy league has hundreds of free agents; a near-empty list is a
  // degraded/errored MFL response, not a real "everyone's rostered".
  if (players.length < 10) {
    throw new SpikeError(`free-agent read looks degraded (only ${players.length} free agents) — refusing to pick a target.`);
  }

  const kickers = players.filter((p) => p.position === 'PK');
  const pool = kickers.length ? kickers : players;
  pool.sort((a, b) => Number(a.id) - Number(b.id));
  const chosen = pool[pool.length - 1];
  info(
    `picked free agent ${chosen.id} (${chosen.position || 'pos?'}) from ${players.length} FAs ` +
      `(${kickers.length} kicker(s); heuristic: deepest ${kickers.length ? 'kicker' : 'free agent'} by id).`,
  );
  return chosen;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const year = args.year ?? ptDateParts(now).year;

  // Live writes require an explicit opt-in; dry-run is the safe default and
  // an explicit --dry-run always wins over --live / RUN_LIVE.
  const liveRequested = args.live || truthy(process.env.RUN_LIVE);
  const live = liveRequested && !args.dryRun;
  const modeLabel = live ? 'LIVE (real add + drop)' : 'DRY-RUN (no MFL writes)';
  info(`league=${LEAGUE_ID} host=${LEAGUE.mflHost} year=${year} mode=${modeLabel}`);
  if (!live && liveRequested && args.dryRun) {
    info('--dry-run overrides --live/RUN_LIVE — no writes will be attempted.');
  }

  // 1. Acquire owner cookie (prefer the real stored-envelope path).
  const { cookie } = await acquireCredential();

  // 2. Validate the cookie and DERIVE the target franchise (never assume 0001).
  const { fid, leagueCount } = await resolveTargetFranchise(cookie, year);
  pass('cookie-validated', `myleagues authenticated (${leagueCount} league(s)); target franchise ${fid}`);

  // 3. Choose the target free agent.
  let target;
  if (args.player) {
    if (!/^\d+$/.test(String(args.player))) throw new SpikeError(`--player must be a numeric MFL id (got: ${args.player}).`);
    target = { id: String(args.player), position: '' };
    info(`using --player override: ${target.id}`);
  } else {
    target = await pickTargetPlayer(year);
  }
  pass('target-selected', `player ${target.id}`);

  // 4. Pre-read roster: count + confirm the target is NOT already rostered.
  const beforeIds = await fetchRosterPlayerIds(year, fid);
  const beforeCount = beforeIds.length;
  if (beforeIds.includes(target.id)) {
    throw new SpikeError(`target ${target.id} is ALREADY on franchise ${fid}'s roster — pick another (a free agent should not be rostered).`);
  }
  pass('pre-read', `franchise ${fid} has ${beforeCount} player(s); target ${target.id} not rostered`);

  if (!live) {
    info('DRY-RUN complete — validated credential, cookie, target, and roster read. Skipped both add_drop POSTs.');
    pass('dry-run', 'all pre-write steps succeeded; no MFL writes attempted');
    return;
  }

  const runStartEpoch = Math.floor(Date.now() / 1000) - 60;

  // 5a. ADD the free agent.
  info(`ADD: POST add_drop add_pid=${target.id} (owner-mode, franchise ${fid})`);
  const addRes = await postAddDrop({ year, addPid: target.id, ownerCookie: cookie });
  if (!addRes.ok) {
    fail('add', `MFL rejected the add: ${addRes.error}`);
    throw new SpikeError(`add failed before any roster change: ${addRes.error}`);
  }
  await sleep(1_000);

  let addVerified = false;
  try {
    const afterAdd = await fetchRosterPlayerIds(year, fid);
    addVerified = afterAdd.includes(target.id);
  } catch (err) {
    console.warn(`${TAG} add verify roster read failed: ${err.message}`);
  }
  if (!addVerified) addVerified = await addConfirmedByTransactions(year, fid, target.id, runStartEpoch);
  if (!addVerified) {
    fail('add-verify', `could not confirm ${target.id} landed on franchise ${fid}. Check the MFL UI; a manual drop may be needed if the add partially applied.`);
    throw new SpikeError('add not verified — aborting before the drop.');
  }
  pass('add', `${target.id} confirmed on franchise ${fid}`);

  await sleep(1_000);

  // 5b. DROP the free agent — the IDENTICAL owner-mode, over-limit-tolerant
  // drop the deadline job replays (owner cookie, no FRANCHISE_ID).
  info(`DROP: POST add_drop drop_pid=${target.id} (owner-mode, franchise ${fid})`);
  const dropRes = await postAddDrop({ year, dropPid: target.id, ownerCookie: cookie });
  const cleanup = `MANUAL CLEANUP REQUIRED: franchise ${fid} still has spike player ${target.id} — drop it in the MFL UI.`;
  if (!dropRes.ok) {
    fail('drop', `MFL rejected the drop: ${dropRes.error}. ${cleanup}`);
    throw new SpikeError(`ADD SUCCEEDED BUT DROP FAILED. ${cleanup}`);
  }
  await sleep(1_000);

  let dropVerified = false;
  try {
    const afterDrop = await fetchRosterPlayerIds(year, fid);
    dropVerified = !afterDrop.includes(target.id);
  } catch (err) {
    console.warn(`${TAG} drop verify roster read failed: ${err.message}`);
  }
  if (!dropVerified) dropVerified = await dropConfirmedByTransactions(year, fid, target.id, runStartEpoch);
  if (!dropVerified) {
    fail('drop-verify', `could not confirm ${target.id} was removed. ${cleanup}`);
    throw new SpikeError(`ADD SUCCEEDED BUT DROP NOT VERIFIED. ${cleanup}`);
  }
  pass('drop', `${target.id} confirmed removed from franchise ${fid}`);

  // 6. Net-zero: final roster count must equal the pre-spike count.
  const finalIds = await fetchRosterPlayerIds(year, fid);
  if (finalIds.length !== beforeCount) {
    fail('net-zero', `final roster count ${finalIds.length} != pre-spike count ${beforeCount}. Inspect franchise ${fid} in the MFL UI.`);
    throw new SpikeError('roster count did not return to its pre-spike value.');
  }
  pass('net-zero', `franchise ${fid} back to ${beforeCount} player(s)`);

  info('LIVE SPIKE COMPLETE — one real owner-cookie add_drop pair replayed and verified, net-zero.');
}

main()
  .then(() => {
    if (failed) {
      console.error(`::error::${TAG} spike finished with failures.`);
      process.exit(1);
    }
    console.log(`::notice::${TAG} spike finished OK.`);
  })
  .catch((err) => {
    // SpikeError carries an operator-friendly message; anything else is a bug
    // and keeps its stack. Either way this is a clear failure, not a crash.
    if (err instanceof SpikeError) {
      console.error(`::error::${TAG} ${err.message}`);
    } else {
      console.error(`::error::${TAG} unexpected error: ${err?.message ?? err}`);
      if (err?.stack) console.error(err.stack);
    }
    process.exit(1);
  });
