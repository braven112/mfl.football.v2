#!/usr/bin/env node
/**
 * Apply August Cuts — deadline execution job for TheLeague's roster cutdown
 * (rosters must be at 22 active players by the 3rd Sunday of August, 8:45 PM
 * PT). See docs/features/august-roster-cuts-automation-plan.md.
 *
 * At/after the deadline, cuts every over-limit roster down to 22 by replaying
 * each OWNER's own stored MFL session cookie (never commissioner
 * impersonation — lockout stays on). Marked players (autocut:{fid} lists)
 * go first; the remainder is filled newest-acquisition-first via the shared
 * selection core (src/utils/august-cut-selection-core.mjs), so the owner
 * preview and this job literally run the same algorithm.
 *
 * Modes:
 *   (no flags)        live — date-gated: refuses to run before the deadline
 *                     instant (NEVER early), then executes with per-franchise
 *                     resumability (autocut:done:{year} hash, MAX_ATTEMPTS
 *                     retries across cron ticks).
 *   --dry-run         like live (same gates) but stops before each MFL write
 *                     and performs NO Redis writes at all, so a manual
 *                     dry-run can never poison the real run's state.
 *   --validate-only   T-7/T-2 credential checks: decrypts each over-limit
 *                     franchise's stored cookie and live-checks it with the
 *                     cheap myleagues read; posts a GroupMe nag naming TEAMS
 *                     that must re-login (never players). Skips the date gate.
 *   --rehearse        T-1 full run minus MFL writes + credential deletes:
 *                     live rosters, every slate, cap totals, snapshot format
 *                     exercised; posts a counts-only league summary. Skips
 *                     the date gate.
 *   --auto            scheduled default: derives the mode from PT calendar
 *                     days until the deadline (T-7/T-2 → validate-only,
 *                     T-1 → rehearse, ≥ deadline instant → live, else no-op).
 *                     Touch dedupe lives in the autocut:touches:{year} hash;
 *                     windows come from roger-reminder-window.mjs (fire on
 *                     the target day or one day late — never early).
 *   --year <n>        override the league year (testing).
 *   --franchise <id>  process only one franchise (debugging).
 *
 * Redis keys (Phase 1 contract — see src/utils/autocut-storage.ts):
 *   autocut:{fid}          owner cut list  { year, playerIds, updatedAt }
 *   autocut:cred:{fid}     AES-256-GCM cookie envelope (AUTOCUT_CRED_KEY)
 *   autocut:paused:{year}  kill switch — any value halts every mode
 *   autocut:done:{year}    hash fid → 'done' | 'failed:<n>' (resumability)
 *   autocut:snapshot:{year} audit snapshot, frozen BEFORE any MFL write
 *   autocut:touches:{year} hash touchKey → PT date (auto-mode dedupe)
 *
 * INVARIANT: this job never deletes autocut:{fid} cut lists — selections
 * outlive execution (plan decision #8). Only credentials are deleted, and
 * only after a franchise's cuts all verify.
 *
 * Env:
 *   UPSTASH_REDIS_REST_URL/TOKEN (or KV_* / STORAGE_* fallbacks)  required
 *   AUTOCUT_CRED_KEY       credential decryption key (live/validate modes)
 *   MFL_APIKEY             optional MFL API key for reads
 *   GROUPME_ROGER_BOT_ID   optional — validate/rehearse GroupMe touches
 */

import fs from 'node:fs';
import path from 'node:path';
import { getRedisConfig, redisCommand } from './lib/redis.mjs';
import { mflFetch, fetchExport, mflHostPrefix } from './lib/mfl-api.mjs';
import { postToGroupMe } from './lib/groupme.mjs';
import { getPtDateString } from './lib/pt-date.mjs';
import {
  getAugustCutdownDate,
  calendarDaysUntilCutdown,
  ptDateParts,
  deriveCredentialKey,
  decryptCredentialRecord,
  isCredentialFresh,
} from './lib/august-cutdown.mjs';
import {
  MAX_ATTEMPTS,
  selectAutoMode,
  decideFranchiseAction,
  failedDoneValue,
  summarizeDoneHash,
  isRunComplete,
  completionCommands,
  buildSnapshotEntry,
  appendOutcome,
  mergeSnapshot,
  snapshotHasOutcomes,
} from './lib/august-cuts-logic.mjs';
import {
  selectAutoCuts,
  parseAcquisitionEvents,
  ACTIVE_ROSTER_STATUS,
} from '../src/utils/august-cut-selection-core.mjs';
import { getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';

const LEAGUE = getLeagueBySlug(DEFAULT_LEAGUE_SLUG);
const LEAGUE_ID = LEAGUE.id;
const TAG = '[apply-august-cuts]';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    dryRun: false,
    validateOnly: false,
    rehearse: false,
    auto: false,
    year: null,
    franchise: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--validate-only') args.validateOnly = true;
    else if (a === '--rehearse') args.rehearse = true;
    else if (a === '--auto') args.auto = true;
    else if (a === '--year') args.year = parseInt(argv[++i], 10);
    else if (a === '--franchise') args.franchise = argv[++i];
    else throw new Error(`Unknown flag: ${a}`);
  }
  if (args.validateOnly && args.rehearse) throw new Error('--validate-only and --rehearse are mutually exclusive');
  if (args.auto && (args.validateOnly || args.rehearse)) throw new Error('--auto picks its own mode; drop the explicit mode flag');
  return args;
}

// ---------------------------------------------------------------------------
// Redis helpers (raw REST — the .ts storage utils gate on process.env.VERCEL)
// ---------------------------------------------------------------------------

function pad4(franchiseId) {
  const trimmed = `${franchiseId ?? ''}`.trim();
  return /^\d+$/.test(trimmed) ? trimmed.padStart(4, '0') : trimmed;
}

const cutListKey = (fid) => `autocut:${pad4(fid)}`;
const credKey = (fid) => `autocut:cred:${pad4(fid)}`;

/** GET a key whose value was written as JSON (by @upstash/redis in the app). */
async function redisGetJson(redis, key) {
  const raw = await redisCommand(redis, ['GET', key]);
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // plain-string value (e.g. the paused flag)
  }
}

/** HGETALL as a plain object. */
async function redisHGetAll(redis, key) {
  const result = await redisCommand(redis, ['HGETALL', key]);
  const obj = {};
  if (Array.isArray(result)) {
    for (let i = 0; i < result.length; i += 2) obj[result[i]] = result[i + 1];
  }
  return obj;
}

// ---------------------------------------------------------------------------
// MFL reads
// ---------------------------------------------------------------------------

/** MFL returns a bare object instead of a one-element array — normalize. */
function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function apiKeyExtra() {
  const key = process.env.MFL_APIKEY || process.env.MFL_API_KEY;
  return key ? `&APIKEY=${encodeURIComponent(key)}` : '';
}

async function fetchLeagueExport(year, type, extra = '') {
  return fetchExport(
    { host: mflHostPrefix(LEAGUE.mflHost), leagueId: LEAGUE_ID, year, type, extra: `${extra}${apiKeyExtra()}` },
    {
      retries: 2,
      sleepMs: 750,
      onFetch: (url) => console.log(`${TAG} fetch ${url.replace(/APIKEY=[^&]+/, 'APIKEY=***')}`),
      onRetry: (url, attempt) => console.warn(`${TAG} 429 from MFL (attempt ${attempt + 1}) — backing off`),
    },
  );
}

/**
 * Fetch rosters → Map fid → player[{ id, status, salary }]. Throws on a
 * degraded/empty response (same guard philosophy as cut-player.ts:121-151):
 * an empty roster set would make every player look already-dropped.
 */
async function fetchRosters(year, franchiseId = null) {
  const extra = franchiseId ? `&FRANCHISE=${pad4(franchiseId)}` : '';
  const data = await fetchLeagueExport(year, 'rosters', extra);
  const franchises = toArray(data?.rosters?.franchise);
  if (franchises.length === 0) {
    throw new Error(`degraded rosters response from MFL (no franchises)${franchiseId ? ` for ${franchiseId}` : ''}`);
  }
  const map = new Map();
  for (const fr of franchises) {
    const players = toArray(fr?.player).map((p) => ({
      id: `${p.id}`,
      status: `${p.status ?? ''}`,
      ...(p.salary !== undefined ? { salary: p.salary } : {}),
    }));
    map.set(pad4(fr.id), players);
  }
  return map;
}

async function fetchAcquisitions(year) {
  const data = await fetchLeagueExport(year, 'transactions');
  return parseAcquisitionEvents(toArray(data?.transactions?.transaction));
}

async function fetchFranchiseNames(year) {
  const names = new Map();
  try {
    const data = await fetchLeagueExport(year, 'league');
    for (const fr of toArray(data?.league?.franchises?.franchise)) {
      names.set(pad4(fr.id), fr.name || pad4(fr.id));
    }
  } catch (err) {
    console.warn(`${TAG} could not fetch franchise names (${err.message}) — using ids`);
  }
  return names;
}

/**
 * Cross-check the transactions feed for a drop marker when the rosters
 * endpoint looks stale (docs/claude/insights/domains/mfl-api.md:188-232 —
 * rosters can lag drops; transactions are authoritative). Drop-only format
 * is `|{playerId},`.
 */
async function dropConfirmedByTransactions(year, franchiseId, playerId, sinceEpochSeconds) {
  try {
    const data = await fetchLeagueExport(year, 'transactions', `&TRANS_TYPE=FREE_AGENT&FRANCHISE=${pad4(franchiseId)}`);
    for (const txn of toArray(data?.transactions?.transaction)) {
      const ts = parseInt(txn?.timestamp, 10);
      if (!Number.isFinite(ts) || ts < sinceEpochSeconds) continue;
      if (`${txn?.transaction ?? ''}`.includes(`|${playerId},`)) return true;
    }
  } catch (err) {
    console.warn(`${TAG} transactions cross-check failed for ${franchiseId}/${playerId}: ${err.message}`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// MFL write — the add_drop page handler (ported from src/pages/api/cut-player.ts)
// ---------------------------------------------------------------------------

/**
 * Drop one player owner-mode via MFL's add_drop page handler.
 *
 * INVARIANT: owner-mode only. NEVER send FRANCHISE_ID, and never attach the
 * commissioner cookie — MFL's lockout-impersonation check silently no-ops
 * the drop when a franchise id rides along on an owner request
 * (docs/claude/insights/features/roster-actions.md:19). The cookie alone
 * identifies the franchise.
 */
async function postAddDrop({ year, playerId, ownerCookie }) {
  const addDropUrl = `https://${LEAGUE.mflHost}/${year}/add_drop`;
  const params = new URLSearchParams({
    L: LEAGUE_ID,
    add_settings: '',
    PROJSRC: 'mfl',
    add_pid: '',
    drop_pid: `${playerId}`,
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
    text.match(/<error[^>]*>(.*?)<\/error>/s);
  if (errMatch) {
    const errorMsg = (errMatch[1] || errMatch[0] || '').trim() || 'MFL rejected the cut request';
    return { ok: false, error: errorMsg };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// GroupMe (Roger touch machinery — bot id from env)
// ---------------------------------------------------------------------------

async function postRogerTouch(text, dryRun) {
  return postToGroupMe({
    botId: process.env.GROUPME_ROGER_BOT_ID,
    text,
    dryRun,
    checkStatus: true,
    onDryRun: () => console.log(`${TAG} [dry-run] GroupMe:\n${text}`),
    onMissingBotId: () => console.warn(`${TAG} GROUPME_ROGER_BOT_ID not set — skipping GroupMe post:\n${text}`),
    onPosted: () => console.log(`${TAG} GroupMe touch posted`),
    onHttpError: (status) => console.warn(`${TAG} GroupMe post failed: HTTP ${status}`),
    onFetchError: (err) => console.warn(`${TAG} GroupMe post failed: ${err.message}`),
  });
}

// ---------------------------------------------------------------------------
// Shared plan computation
// ---------------------------------------------------------------------------

/**
 * Compute the over-limit franchises and each one's slate from live data.
 * Marked lists from a different league year are ignored (stale — never
 * silently executed).
 */
async function computePlans({ redis, year, rosters, acquisitions, franchiseFilter }) {
  const plans = [];
  for (const [fid, players] of rosters) {
    if (franchiseFilter && pad4(franchiseFilter) !== fid) continue;
    const activeCount = players.filter((p) => p.status === ACTIVE_ROSTER_STATUS).length;
    const list = await redisGetJson(redis, cutListKey(fid));
    const markedList = list && typeof list === 'object' && list.year === year ? list : null;
    const slate = selectAutoCuts({
      activeRoster: players,
      markedPlayerIds: markedList?.playerIds ?? [],
      acquisitions,
      franchiseId: fid,
    });
    if (slate.overage > 0) {
      plans.push({ franchiseId: fid, players, markedList, slate, activeCount });
    }
  }
  plans.sort((a, b) => a.franchiseId.localeCompare(b.franchiseId));
  return plans;
}

function slateSalaryTotal(plan) {
  const byId = new Map(plan.players.map((p) => [p.id, p]));
  let total = 0;
  for (const cut of plan.slate.cuts) {
    const salary = parseFloat(byId.get(cut.playerId)?.salary ?? '');
    if (Number.isFinite(salary)) total += salary;
  }
  return total;
}

const fmtMillions = (n) => `$${(n / 1_000_000).toFixed(1)}M`;

// ---------------------------------------------------------------------------
// Report file (committed back by the workflow — permanent audit record)
// ---------------------------------------------------------------------------

function writeReportFile({ year, mode, snapshot, summary, cutdownDate }) {
  const reportDir = path.join(LEAGUE.dataPath, 'august-cuts');
  const reportPath = path.join(reportDir, `${year}-report.json`);
  fs.mkdirSync(reportDir, { recursive: true });
  const report = {
    version: 1,
    year,
    mode,
    generatedAt: new Date().toISOString(),
    cutdownDeadline: cutdownDate.toISOString(),
    summary,
    franchises: snapshot?.franchises ?? {},
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${TAG} report written: ${reportPath}`);
  return reportPath;
}

// ---------------------------------------------------------------------------
// Mode: --validate-only (T-7 / T-2)
// ---------------------------------------------------------------------------

async function runValidateOnly({ redis, year, plans, names, daysUntil, dryRun }) {
  const credentialKeyBuf = deriveCredentialKey();
  if (!credentialKeyBuf) {
    console.warn(`${TAG} AUTOCUT_CRED_KEY not set — every credential will read as missing`);
  }

  const results = [];
  for (const plan of plans) {
    const fid = plan.franchiseId;
    const name = names.get(fid) ?? fid;
    const record = await redisGetJson(redis, credKey(fid));
    const cred = record ? decryptCredentialRecord(record, credentialKeyBuf) : null;

    let status;
    if (!cred) {
      status = 'missing';
    } else if (!isCredentialFresh(cred.capturedAt)) {
      status = 'stale';
    } else {
      // Cheap authenticated read: a dead cookie returns {"leagues":{}}.
      try {
        const res = await mflFetch({
          url: `https://api.myfantasyleague.com/${year}/export?TYPE=myleagues&JSON=1`,
          cookies: { MFL_USER_ID: cred.cookie },
        });
        const body = res.ok ? await res.json().catch(() => null) : null;
        const leagues = toArray(body?.leagues?.league);
        status = leagues.length > 0 ? 'ok' : 'dead';
      } catch (err) {
        console.warn(`${TAG} myleagues check errored for ${fid}: ${err.message}`);
        status = 'dead';
      }
      await sleep(500);
    }
    results.push({ franchiseId: fid, name, status, overage: plan.slate.overage });
    console.log(`${TAG} credential ${status.padEnd(7)} ${fid} ${name} (over by ${plan.slate.overage})`);
  }

  const needLogin = results.filter((r) => r.status !== 'ok');
  if (plans.length === 0) {
    console.log(`${TAG} no over-limit franchises — nothing to validate.`);
  } else if (needLogin.length === 0) {
    console.log(`${TAG} all ${results.length} over-limit franchises have live credentials.`);
  } else {
    // PRIVACY (plan decision #10): shared-channel messages name TEAMS that
    // need to log in — never any team's marked players.
    const teams = needLogin.map((r) => r.name).join(', ');
    const when = daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
    const text =
      `🚨 Roster cutdown is ${when} (8:45pm PT). ${plans.length} team(s) are over the 22-man limit. ` +
      `Auto-cuts are set to run at the deadline, but these teams need to log in at theleague.us once so their cuts can execute: ${teams}. ` +
      `Review your plan at theleague.us/theleague/rosters.`;
    await postRogerTouch(text, dryRun);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Mode: --rehearse (T-1)
// ---------------------------------------------------------------------------

async function runRehearse({ redis, year, plans, cutdownDate, dryRun }) {
  let totalCuts = 0;
  let totalSalary = 0;
  for (const plan of plans) {
    const salary = slateSalaryTotal(plan);
    totalCuts += plan.slate.cuts.length;
    totalSalary += salary;
    console.log(
      `${TAG} rehearse ${plan.franchiseId}: ${plan.slate.activeCount} active, ` +
        `${plan.slate.cuts.length} cut(s) [${plan.slate.cuts.map((c) => `${c.playerId}(${c.reason})`).join(', ')}] ` +
        `freeing ${fmtMillions(salary)}`,
    );
  }
  console.log(`${TAG} rehearse totals: ${plans.length} team(s) over, ${totalCuts} cut(s), ${fmtMillions(totalSalary)} in salary`);

  // Exercise the snapshot format end-to-end (minus MFL writes + credential
  // deletes). Never clobber a snapshot that already has real outcomes.
  const snapshot = await buildAndMaybeStoreSnapshot({ redis, year, plans, mode: 'rehearse', persist: !dryRun });

  // PRIVACY (plan decision #10): the shared channel gets COUNTS ONLY — never
  // another team's marked players.
  if (plans.length > 0) {
    const text =
      `📋 Roster cutdown is tomorrow at 8:45pm PT. ${plans.length} team(s) are over the 22-man limit — ` +
      `${totalCuts} player(s) will be cut automatically at the deadline. ` +
      `Check your Cutdown Plan at theleague.us/theleague/rosters before then.`;
    await postRogerTouch(text, dryRun);
  } else {
    console.log(`${TAG} rehearse: every roster is at/under the limit — no GroupMe summary needed.`);
  }

  const summary = {
    overLimit: plans.length,
    plannedCuts: totalCuts,
    plannedSalaryFreed: totalSalary,
  };
  writeReportFile({ year, mode: 'rehearse', snapshot, summary, cutdownDate });
}

async function buildAndMaybeStoreSnapshot({ redis, year, plans, names = new Map(), mode, persist }) {
  const entries = plans.map((plan) =>
    buildSnapshotEntry({
      franchiseId: plan.franchiseId,
      franchiseName: names.get(plan.franchiseId),
      markedList: plan.markedList,
      roster: plan.players,
      slate: plan.slate,
    }),
  );
  const existing = await redisGetJson(redis, `autocut:snapshot:${year}`);
  const snapshot = mergeSnapshot(existing, entries, { year, mode, generatedAt: new Date().toISOString() });
  if (persist) {
    if (mode !== 'live' && existing && snapshotHasOutcomes(existing)) {
      console.warn(`${TAG} existing snapshot already has execution outcomes — not overwriting it in ${mode} mode`);
      return existing;
    }
    await redisCommand(redis, ['SET', `autocut:snapshot:${year}`, JSON.stringify(snapshot)]);
    console.log(`${TAG} snapshot stored (autocut:snapshot:${year}, ${entries.length} franchise(s))`);
  }
  return snapshot;
}

async function saveSnapshot(redis, year, snapshot) {
  await redisCommand(redis, ['SET', `autocut:snapshot:${year}`, JSON.stringify(snapshot)]);
}

// ---------------------------------------------------------------------------
// Mode: live / --dry-run execution
// ---------------------------------------------------------------------------

async function runExecution({ redis, year, plans, names, acquisitions, cutdownDate, dryRun }) {
  const runStartEpochSeconds = Math.floor(Date.now() / 1000);
  const doneKey = `autocut:done:${year}`;
  const doneHash = await redisHGetAll(redis, doneKey);
  const franchiseIds = plans.map((p) => p.franchiseId);

  if (plans.length === 0) {
    console.log(`${TAG} no over-limit franchises — cutdown already satisfied.`);
    return { failed: [], skipped: [], done: [] };
  }

  if (isRunComplete(doneHash, franchiseIds)) {
    const summary = summarizeDoneHash(doneHash, franchiseIds);
    console.log(`${TAG} run already complete: ${summary.done.length} done, ${summary.exhausted.length} exhausted.`);
    return { failed: summary.exhausted, skipped: [], done: summary.done };
  }

  // AUDIT TRAIL: freeze the snapshot BEFORE any MFL write. A crash on
  // franchise 1 must still leave every over-limit franchise's plan readable.
  // (Skipped in dry-run: a dry-run performs no Redis writes at all.)
  let snapshot = await buildAndMaybeStoreSnapshot({ redis, year, plans, names, mode: dryRun ? 'dry-run' : 'live', persist: !dryRun });

  const credentialKeyBuf = deriveCredentialKey();
  if (!credentialKeyBuf && !dryRun) {
    console.warn(`${TAG} AUTOCUT_CRED_KEY not set — every franchise will be skipped (no-credential)`);
  }

  const results = { done: [], failed: [], skipped: [] };

  for (const plan of plans) {
    const fid = plan.franchiseId;
    const name = names.get(fid) ?? fid;
    const decision = decideFranchiseAction(doneHash[fid]);
    if (decision.action === 'skip-done') {
      console.log(`${TAG} ${fid} ${name}: already done — skipping`);
      results.done.push(fid);
      continue;
    }
    if (decision.action === 'skip-exhausted') {
      console.warn(`${TAG} ${fid} ${name}: failed ${decision.attempts}x (max ${MAX_ATTEMPTS}) — leaving for the commissioner`);
      results.failed.push(fid);
      continue;
    }

    console.log(`${TAG} ${fid} ${name}: attempt ${decision.attempt}/${MAX_ATTEMPTS}`);
    let entry = snapshot.franchises[fid] ?? buildSnapshotEntry({
      franchiseId: fid,
      franchiseName: names.get(fid),
      markedList: plan.markedList,
      roster: plan.players,
      slate: plan.slate,
    });

    const finishFranchise = async (doneValue, { deleteCredential = false } = {}) => {
      snapshot.franchises[fid] = entry;
      if (dryRun) {
        console.log(`${TAG} [dry-run] would record ${fid} → ${doneValue}${deleteCredential ? ' and delete its credential' : ''}`);
        return;
      }
      // INVARIANT: completionCommands never deletes autocut:{fid} cut lists —
      // selections outlive execution; credentials are the only key deleted.
      for (const cmd of completionCommands({ year, franchiseId: fid, doneValue, deleteCredential })) {
        await redisCommand(redis, cmd);
      }
      await saveSnapshot(redis, year, snapshot);
    };

    try {
      // Re-read this franchise's LIVE roster — the batch fetch may be minutes
      // old, and the owner may have self-served with "cut now".
      const freshRosters = await fetchRosters(year, fid);
      const freshPlayers = freshRosters.get(fid);
      if (!freshPlayers) throw new Error('degraded roster read (franchise missing)');

      const slate = selectAutoCuts({
        activeRoster: freshPlayers,
        markedPlayerIds: plan.markedList?.playerIds ?? [],
        acquisitions,
        franchiseId: fid,
      });

      if (slate.overage <= 0) {
        // Owner got under the limit on their own — done with zero cuts.
        entry = appendOutcome(entry, { status: 'no-cuts-needed', activeCount: slate.activeCount, at: new Date().toISOString() });
        await finishFranchise('done');
        results.done.push(fid);
        console.log(`${TAG} ${fid} ${name}: at/under limit (${slate.activeCount}) — done, zero cuts`);
        continue;
      }

      // Decrypt the owner's stored credential. Missing/undecryptable →
      // skipped, never attempted (the commissioner handles it manually).
      const record = await redisGetJson(redis, credKey(fid));
      const cred = record ? decryptCredentialRecord(record, credentialKeyBuf) : null;
      if (!cred) {
        entry = appendOutcome(entry, { status: 'skipped: no-credential', at: new Date().toISOString() });
        await finishFranchise(failedDoneValue(decision.attempt));
        results.skipped.push(fid);
        console.warn(`${TAG} ${fid} ${name}: no usable credential — skipped (owner must log in, or commissioner cuts manually)`);
        continue;
      }

      let rosterIds = new Set(freshPlayers.map((p) => p.id));
      let franchiseFailed = false;

      for (const cut of slate.cuts) {
        const pid = cut.playerId;

        if (!rosterIds.has(pid)) {
          // Already gone (traded/cut between reads) — success, like the
          // KeeperPlanner batch loop treats 409s.
          entry = appendOutcome(entry, { playerId: pid, reason: cut.reason, status: 'already-gone', at: new Date().toISOString() });
          continue;
        }

        if (dryRun) {
          // DRY-RUN SENTINEL: execution stops here — no MFL write is ever
          // attempted with --dry-run (tests/apply-august-cuts.test.ts greps
          // for this guard).
          console.log(`${TAG} [dry-run] would POST add_drop drop_pid=${pid} (${cut.reason}) for ${fid} ${name}`);
          entry = appendOutcome(entry, { playerId: pid, reason: cut.reason, status: 'dry-run: would cut', at: new Date().toISOString() });
          continue;
        }

        console.log(`${TAG} ${fid} ${name}: cutting ${pid} (${cut.reason})`);
        const write = await postAddDrop({ year, playerId: pid, ownerCookie: cred.cookie });
        if (!write.ok) {
          entry = appendOutcome(entry, { playerId: pid, reason: cut.reason, status: `failed: ${write.error}`, at: new Date().toISOString() });
          franchiseFailed = true;
          break; // stop this franchise; retry next tick
        }

        await sleep(750);

        // Verify by re-reading the roster; if the read looks stale, fall back
        // to the transactions feed (the authoritative record for drops).
        let verified = false;
        let verifyStatus = 'cut-verified';
        try {
          const afterRosters = await fetchRosters(year, fid);
          const after = afterRosters.get(fid) ?? [];
          verified = !after.some((p) => p.id === pid);
          if (verified) rosterIds = new Set(after.map((p) => p.id));
        } catch (err) {
          console.warn(`${TAG} verify roster read failed for ${fid}: ${err.message}`);
        }
        if (!verified) {
          if (await dropConfirmedByTransactions(year, fid, pid, runStartEpochSeconds - 60)) {
            verified = true;
            verifyStatus = 'cut-verified-via-transactions';
            rosterIds.delete(pid);
          }
        }

        if (verified) {
          entry = appendOutcome(entry, { playerId: pid, reason: cut.reason, status: verifyStatus, at: new Date().toISOString() });
        } else {
          entry = appendOutcome(entry, { playerId: pid, reason: cut.reason, status: 'failed: MFL did not confirm the drop', at: new Date().toISOString() });
          franchiseFailed = true;
          break;
        }
      }

      if (franchiseFailed) {
        await finishFranchise(failedDoneValue(decision.attempt));
        results.failed.push(fid);
        console.error(`${TAG} ${fid} ${name}: attempt ${decision.attempt} failed — will retry next tick (up to ${MAX_ATTEMPTS})`);
      } else {
        // All cuts verified → done; delete the credential (and ONLY the
        // credential — cut lists are never deleted by this job).
        await finishFranchise('done', { deleteCredential: true });
        results.done.push(fid);
        console.log(`${TAG} ${fid} ${name}: complete (${slate.cuts.length} cut(s)) — credential deleted`);
      }
    } catch (err) {
      entry = appendOutcome(entry, { status: `failed: ${err.message}`, at: new Date().toISOString() });
      await finishFranchise(failedDoneValue(decision.attempt));
      results.failed.push(fid);
      console.error(`${TAG} ${fid} ${name}: error — ${err.message}`);
    }

    await sleep(1_000);
  }

  const summary = {
    overLimit: plans.length,
    done: results.done,
    failed: results.failed,
    skipped: results.skipped,
  };
  writeReportFile({ year, mode: dryRun ? 'dry-run' : 'live', snapshot, summary, cutdownDate });
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const year = args.year ?? ptDateParts(now).year;
  const cutdownDate = getAugustCutdownDate(year);
  const daysUntil = calendarDaysUntilCutdown(year, now);

  console.log(
    `${TAG} year=${year} deadline=${cutdownDate.toISOString()} (PT days until: ${daysUntil})` +
      `${args.dryRun ? ' [dry-run]' : ''}${args.franchise ? ` [franchise ${pad4(args.franchise)}]` : ''}`,
  );

  const redis = getRedisConfig();
  if (!redis) {
    const err = new Error(
      'No Redis config found. Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.',
    );
    err.expected = true;
    throw err;
  }

  // Kill switch — halts every mode. Toggled from the commissioner audit page.
  const paused = await redisCommand(redis, ['GET', `autocut:paused:${year}`]);
  if (paused !== null && paused !== undefined && `${paused}` !== '') {
    console.log(`::warning::${TAG} autocut:paused:${year} is set — kill switch engaged, exiting without action.`);
    return;
  }

  // Resolve the mode.
  let mode;
  let autoTouch = null;
  if (args.validateOnly) {
    mode = 'validate-only';
  } else if (args.rehearse) {
    mode = 'rehearse';
  } else if (args.auto) {
    const fired = await redisHGetAll(redis, `autocut:touches:${year}`);
    const decision = selectAutoMode({ now, cutdownDate, daysUntil, firedTouches: new Set(Object.keys(fired)) });
    if (decision.mode === 'noop') {
      console.log(`${TAG} --auto: nothing to do today (T-${daysUntil}) — exiting.`);
      return;
    }
    mode = decision.mode;
    autoTouch = decision.touch ?? null;
    console.log(`${TAG} --auto resolved mode: ${mode}${autoTouch ? ` (touch ${autoTouch})` : ''}`);
  } else {
    mode = 'live';
  }

  // NEVER EARLY: live execution (and its dry-run preview) requires the
  // deadline instant to have passed. validate/rehearse run pre-deadline by
  // design and skip this gate.
  if (mode === 'live' && now.getTime() < cutdownDate.getTime()) {
    console.log(
      `::warning::${TAG} refusing to run live before the deadline ` +
        `(now=${now.toISOString()}, deadline=${cutdownDate.toISOString()}). Never early.`,
    );
    return;
  }

  // Live data.
  const rosters = await fetchRosters(year);
  const acquisitions = await fetchAcquisitions(year);
  const names = await fetchFranchiseNames(year);
  const plans = await computePlans({ redis, year, rosters, acquisitions, franchiseFilter: args.franchise });
  console.log(`${TAG} ${plans.length} over-limit franchise(s): ${plans.map((p) => `${p.franchiseId}(+${p.slate.overage})`).join(', ') || 'none'}`);

  if (mode === 'validate-only') {
    await runValidateOnly({ redis, year, plans, names, daysUntil, dryRun: args.dryRun });
  } else if (mode === 'rehearse') {
    await runRehearse({ redis, year, plans, cutdownDate, dryRun: args.dryRun });
  } else {
    const results = await runExecution({ redis, year, plans, names, acquisitions, cutdownDate, dryRun: args.dryRun });
    const problems = [...results.failed, ...results.skipped];
    if (!args.dryRun && problems.length > 0) {
      console.error(
        `::error::${TAG} ${problems.length} franchise(s) failed or were skipped: ${problems.join(', ')}. ` +
          `See the report and /theleague/admin/cutdown-report.`,
      );
      process.exitCode = 1;
    }
  }

  // Record the auto-mode touch as fired (dedupe) — skipped in dry-run so a
  // manual dry-run can't suppress the real scheduled touch.
  if (autoTouch && !args.dryRun) {
    await redisCommand(redis, ['HSET', `autocut:touches:${year}`, autoTouch, getPtDateString(now)]);
    console.log(`${TAG} touch ${autoTouch} recorded for ${getPtDateString(now)}`);
  }
}

main().catch((err) => {
  // Expected config failures (e.g. missing Redis env) get a clean one-line
  // message for ops logs; unexpected errors keep the full stack.
  if (err && err.expected) {
    console.error(`${TAG} Fatal error: ${err.message}`);
  } else {
    console.error(`${TAG} Fatal error:`, err);
  }
  process.exit(1);
});
