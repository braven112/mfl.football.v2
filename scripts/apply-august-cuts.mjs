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
import { mflFetch, fetchExport, mflHostPrefix, extractMyLeagues } from './lib/mfl-api.mjs';
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
  SKIPPED_NO_CRED,
  selectAutoMode,
  decideFranchiseAction,
  parseDoneValue,
  failedDoneValue,
  summarizeDoneHash,
  isRunComplete,
  completionCommands,
  buildSnapshotEntry,
  appendOutcome,
  mergeSnapshot,
  snapshotHasOutcomes,
  foldFranchiseIntoStored,
} from '../src/utils/august-cuts-logic.mjs';
import {
  selectAutoMoves,
  parseAcquisitionEvents,
  buildRookiePriorityFromFeeds,
  ACTIVE_ROSTER_STATUS,
} from '../src/utils/august-cut-selection-core.mjs';
import { getLeagueBySlug, DEFAULT_LEAGUE_SLUG, leagueUrl } from '../src/config/leagues-data.mjs';
// Shared franchise-id normalization (matches auth.ts / autocut-storage.ts).
import { normalizeFranchiseId as pad4 } from '../src/utils/franchise-id.mjs';

const LEAGUE = getLeagueBySlug(DEFAULT_LEAGUE_SLUG);
const LEAGUE_ID = LEAGUE.id;
const TAG = '[apply-august-cuts]';

// Owner-facing links in the Roger touches. leagueUrl drops the redundant
// league path prefix on the league's own apex host (the apex serves the bare
// path; the prefixed form only resolves via a 301) and pins the canonical
// cookie-safe www host, so the link doesn't open logged-out.
const ROSTERS_URL = leagueUrl(LEAGUE, `/${LEAGUE.slug}/rosters`);
const SITE_HOST = new URL(leagueUrl(LEAGUE)).host;

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
    else if (a === '--year') {
      const raw = argv[++i];
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed)) {
        throw new Error(`--year requires a numeric year (got: ${raw ?? '<missing>'})`);
      }
      args.year = parsed;
    }
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

/**
 * League-wide rookie ids in taxi-priority order (first = first to get a
 * practice-squad spot). Rookies are MFL's own classification (`status: 'R'`
 * in the players export — same gate as /api/move-to-practice, and the gate
 * MFL itself enforces on the taxi_squad import). Priority is this year's
 * league rookie-draft order, so an owner's premium picks win the spots when
 * rookies outnumber the room; undrafted rookies (FA/waiver adds) follow.
 *
 * Failure here degrades gracefully: an empty list means zero taxi moves and
 * pure cut behavior — never a blocked run.
 */
async function fetchRookiePriority(year) {
  let playersFeed = null;
  try {
    playersFeed = await fetchLeagueExport(year, 'players', '&DETAILS=1');
  } catch (err) {
    console.warn(`${TAG} could not fetch player rookie flags (${err.message}) — skipping taxi moves this run`);
    return [];
  }
  let draftResultsFeed = null;
  try {
    draftResultsFeed = await fetchLeagueExport(year, 'draftResults');
  } catch (err) {
    console.warn(`${TAG} could not fetch draft results (${err.message}) — rookie priority falls back to feed order`);
  }
  return buildRookiePriorityFromFeeds({ playersFeed, draftResultsFeed });
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

/**
 * Move an active-roster rookie to the practice squad with the owner's own
 * cookie. Same endpoint + parameter names as the app's working owner-mode
 * move (src/utils/mfl-matchup-api.ts#movePlayerToTaxi, verified 2026-05-07
 * against MFL's api_info spec): POST import, TYPE=taxi_squad, DEMOTE=pid.
 * FRANCHISE_ID is deliberately NOT sent — owner-mode implies the franchise,
 * and sending it under league lockout is the impersonation failure class.
 */
async function postTaxiMove({ year, playerId, ownerCookie }) {
  const params = new URLSearchParams({
    TYPE: 'taxi_squad',
    L: LEAGUE_ID,
    DEMOTE: `${playerId}`,
  });

  const res = await mflFetch({
    url: `https://api.myfantasyleague.com/${year}/import`,
    method: 'POST',
    cookies: { MFL_USER_ID: ownerCookie },
    body: params.toString(),
    timeoutMs: 15_000,
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

  const errMatch =
    text.match(/<error[^>]*>(.*?)<\/error>/s) ||
    text.match(/"error"\s*:\s*"([^"]+)"/);
  if (errMatch) {
    return { ok: false, error: (errMatch[1] || '').trim() || 'MFL rejected the taxi move' };
  }
  if (text.includes('<html') || text.includes('<!DOCTYPE')) {
    return { ok: false, error: 'MFL did not process the taxi move' };
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
    onDryRun: (sent) => console.log(`${TAG} [dry-run] GroupMe:\n${sent}`),
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
async function computePlans({ redis, year, rosters, acquisitions, rookieIds = [], franchiseFilter }) {
  const plans = [];
  for (const [fid, players] of rosters) {
    if (franchiseFilter && pad4(franchiseFilter) !== fid) continue;
    const activeCount = players.filter((p) => p.status === ACTIVE_ROSTER_STATUS).length;
    const list = await redisGetJson(redis, cutListKey(fid));
    const markedList = list && typeof list === 'object' && list.year === year ? list : null;
    // Taxi moves first, cuts for the remainder — the slate carries both
    // (slate.taxiMoves + slate.cuts), and the snapshot stores it verbatim.
    const slate = selectAutoMoves({
      roster: players,
      rookieIds,
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

/** Serialize a report for comparison with `generatedAt` masked out, so a
 * tick that changed nothing but the timestamp compares equal. */
function reportContentSansTimestamp(report) {
  return JSON.stringify({ ...report, generatedAt: null }, null, 2);
}

function writeReportFile({ year, mode, snapshot, summary, cutdownDate, dryRun = false }) {
  const reportDir = path.join(LEAGUE.dataPath, 'august-cuts');
  const reportPath = path.join(reportDir, `${year}-report.json`);

  // DRY-RUN SENTINEL (report): a dry-run performs no persistent writes — it
  // must never create or overwrite the committed report file (mirrors the
  // zero-Redis-writes guarantee). Log the would-be write and bail.
  if (dryRun) {
    console.log(`${TAG} [dry-run] would write report: ${reportPath} (skipped — dry-run makes no persistent writes)`);
    return reportPath;
  }

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

  // NO-OP GUARD: every 15-min tick would otherwise rewrite this file with a
  // fresh generatedAt and produce an empty commit downstream. Skip the write
  // when nothing but the timestamp changed (compare serialized content with
  // generatedAt masked out).
  if (fs.existsSync(reportPath)) {
    try {
      const prior = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (reportContentSansTimestamp(prior) === reportContentSansTimestamp(report)) {
        console.log(`${TAG} report unchanged (only generatedAt would differ) — skipping write: ${reportPath}`);
        return reportPath;
      }
    } catch {
      /* unreadable/corrupt prior report — fall through and overwrite it */
    }
  }

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
    const cred = record ? decryptCredentialRecord(record, credentialKeyBuf, fid) : null;

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
        // MFL wraps this as either `myleagues` or `leagues` (host/year
        // dependent) — extractMyLeagues tolerates both, mirroring
        // src/pages/api/autocut-list.ts.
        const leagues = extractMyLeagues(body);
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
      `Auto-cuts are set to run at the deadline, but these teams need to log in at ${SITE_HOST} once so their cuts can execute: ${teams}. ` +
      `Review your plan at ${ROSTERS_URL}`;
    await postRogerTouch(text, dryRun);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Mode: --rehearse (T-1)
// ---------------------------------------------------------------------------

async function runRehearse({ redis, year, plans, cutdownDate, dryRun }) {
  let totalCuts = 0;
  let totalTaxi = 0;
  let totalSalary = 0;
  for (const plan of plans) {
    const salary = slateSalaryTotal(plan);
    const taxiMoves = plan.slate.taxiMoves ?? [];
    totalCuts += plan.slate.cuts.length;
    totalTaxi += taxiMoves.length;
    totalSalary += salary;
    console.log(
      `${TAG} rehearse ${plan.franchiseId}: ${plan.slate.activeCount} active, ` +
        `${taxiMoves.length} taxi move(s) [${taxiMoves.map((m) => m.playerId).join(', ')}], ` +
        `${plan.slate.cuts.length} cut(s) [${plan.slate.cuts.map((c) => `${c.playerId}(${c.reason})`).join(', ')}] ` +
        `freeing ${fmtMillions(salary)}`,
    );
  }
  console.log(`${TAG} rehearse totals: ${plans.length} team(s) over, ${totalTaxi} taxi move(s), ${totalCuts} cut(s), ${fmtMillions(totalSalary)} in salary`);

  // Exercise the snapshot format end-to-end (minus MFL writes + credential
  // deletes). Never clobber a snapshot that already has real outcomes.
  const snapshot = await buildAndMaybeStoreSnapshot({ redis, year, plans, mode: 'rehearse', persist: !dryRun });

  // PRIVACY (plan decision #10): the shared channel gets COUNTS ONLY — never
  // another team's marked players.
  if (plans.length > 0) {
    const taxiNote = totalTaxi > 0
      ? `${totalTaxi} rookie(s) will be moved to open practice-squad spots and ${totalCuts} player(s) cut automatically at the deadline. `
      : `${totalCuts} player(s) will be cut automatically at the deadline. `;
    const text =
      `📋 Roster cutdown is tomorrow at 8:45pm PT. ${plans.length} team(s) are over the 22-man limit — ` +
      taxiNote +
      `Check your Cutdown Plan before then: ${ROSTERS_URL}`;
    await postRogerTouch(text, dryRun);
  } else {
    console.log(`${TAG} rehearse: every roster is at/under the limit — no GroupMe summary needed.`);
  }

  const summary = {
    overLimit: plans.length,
    plannedTaxiMoves: totalTaxi,
    plannedCuts: totalCuts,
    plannedSalaryFreed: totalSalary,
  };
  writeReportFile({ year, mode: 'rehearse', snapshot, summary, cutdownDate, dryRun });
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

async function runExecution({ redis, year, plans, allFranchiseIds, names, acquisitions, rookieIds = [], cutdownDate, dryRun }) {
  const runStartEpochSeconds = Math.floor(Date.now() / 1000);
  const doneKey = `autocut:done:${year}`;
  const doneHash = await redisHGetAll(redis, doneKey);
  const planIds = new Set(plans.map((p) => p.franchiseId));

  // ONE-SHOT (plan decision #5, item D): the cutdown runs ONCE, at the
  // deadline. Completeness is measured across the WHOLE league, not just the
  // over-limit franchises — so that (a) the run can reach a terminal complete
  // state and (b) a franchise that drifts over the limit AFTER the deadline
  // tick (e.g. an Aug 25 waiver add) is NOT silently auto-cut by a later tick.
  // Every at/under-limit franchise is booked 'done' with zero cuts below.
  const completionIds = allFranchiseIds && allFranchiseIds.length ? allFranchiseIds : [...planIds];

  const results = { done: [], failed: [], skipped: [] };

  if (isRunComplete(doneHash, completionIds)) {
    const summary = summarizeDoneHash(doneHash, completionIds);
    console.log(`${TAG} run already complete: ${summary.done.length} done, ${summary.exhausted.length} exhausted.`);
    return { failed: summary.exhausted, skipped: [], done: summary.done };
  }

  // Book at/under-limit franchises as done-with-zero-cuts (the one-shot mark).
  // Skipped in dry-run (no Redis writes) and for franchises already recorded
  // in the done hash. These are not pushed onto results.done — the report
  // summary lists only the franchises that actually had a slate to execute.
  for (const fid of completionIds) {
    if (planIds.has(fid)) continue;
    if (parseDoneValue(doneHash[fid]).status === 'done') continue;
    if (!dryRun) {
      for (const cmd of completionCommands({ year, franchiseId: fid, doneValue: 'done' })) {
        await redisCommand(redis, cmd);
      }
      doneHash[fid] = 'done';
    } else {
      console.log(`${TAG} [dry-run] would book ${fid} → done (at/under limit, zero cuts)`);
    }
  }

  if (plans.length === 0) {
    console.log(`${TAG} no over-limit franchises — cutdown satisfied; every league franchise booked done.`);
    return results;
  }

  // AUDIT TRAIL: freeze the snapshot BEFORE any MFL write. A crash on
  // franchise 1 must still leave every over-limit franchise's plan readable.
  // (Skipped in dry-run: a dry-run performs no Redis writes at all.)
  let snapshot = await buildAndMaybeStoreSnapshot({ redis, year, plans, names, mode: dryRun ? 'dry-run' : 'live', persist: !dryRun });

  const credentialKeyBuf = deriveCredentialKey();
  if (!credentialKeyBuf && !dryRun) {
    console.warn(`${TAG} AUTOCUT_CRED_KEY not set — every franchise will be skipped (no-credential)`);
  }

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
      // MERGE-BEFORE-WRITE (item K): re-read the stored snapshot and fold in
      // ONLY this franchise's entry, so a manual-done the commissioner recorded
      // mid-tick for another franchise (via /api/admin/autocut-control) is not
      // clobbered by our stale in-memory copy of the whole snapshot.
      const stored = await redisGetJson(redis, `autocut:snapshot:${year}`);
      snapshot = foldFranchiseIntoStored(stored ?? snapshot, fid, entry, {
        year,
        mode: 'live',
        generatedAt: new Date().toISOString(),
      });
      await saveSnapshot(redis, year, snapshot);
    };

    try {
      // Re-read this franchise's LIVE roster — the batch fetch may be minutes
      // old, and the owner may have self-served with "cut now".
      const freshRosters = await fetchRosters(year, fid);
      const freshPlayers = freshRosters.get(fid);
      if (!freshPlayers) throw new Error('degraded roster read (franchise missing)');

      // LAST-ATTEMPT DEGRADATION: if earlier ticks failed (e.g. MFL keeps
      // rejecting the taxi write), the final attempt drops the taxi phase
      // (rookieIds: []) and runs pure cuts — the pre-taxi-rule behavior that
      // is known to work. A stuck taxi move must never leave a roster over
      // the limit when cutting alone could have fixed it.
      const finalAttempt = decision.attempt >= MAX_ATTEMPTS;
      if (finalAttempt) {
        console.warn(`${TAG} ${fid} ${name}: final attempt — skipping taxi phase, cuts only`);
      }
      const slate = selectAutoMoves({
        roster: freshPlayers,
        rookieIds: finalAttempt ? [] : rookieIds,
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
      const cred = record ? decryptCredentialRecord(record, credentialKeyBuf, fid) : null;
      if (!cred) {
        entry = appendOutcome(entry, { status: 'skipped: no-credential', at: new Date().toISOString() });
        // NOT a failed attempt — book the distinct SKIPPED_NO_CRED sentinel so
        // this franchise is re-checked every tick (a fresh owner login heals
        // it) instead of burning toward MAX_ATTEMPTS exhaustion.
        await finishFranchise(SKIPPED_NO_CRED);
        results.skipped.push(fid);
        console.warn(`${TAG} ${fid} ${name}: no usable credential — skipped (owner must log in, or commissioner cuts manually)`);
        continue;
      }

      let rosterIds = new Set(freshPlayers.map((p) => p.id));
      let franchiseFailed = false;

      // Phase 0 — rookie taxi moves (league rule, July 2026): every open
      // practice-squad spot filled by an active-roster rookie is a player
      // the owner KEEPS instead of losing, so these run before any cut. A
      // failed taxi move aborts the franchise for this tick — the cut slate
      // assumed the move succeeded, and cutting anyway would leave the
      // roster over the limit.
      const activeStatusById = new Map(freshPlayers.map((p) => [p.id, p.status]));
      for (const move of slate.taxiMoves) {
        const pid = move.playerId;

        if (activeStatusById.get(pid) !== ACTIVE_ROSTER_STATUS) {
          // Owner self-served (taxied or cut him) between reads — the goal
          // state is already true.
          entry = appendOutcome(entry, { playerId: pid, reason: move.reason, status: 'already-moved', at: new Date().toISOString() });
          continue;
        }

        if (dryRun) {
          // DRY-RUN SENTINEL: no MFL write is ever attempted with --dry-run.
          console.log(`${TAG} [dry-run] would POST taxi_squad DEMOTE=${pid} (${move.reason}) for ${fid} ${name}`);
          entry = appendOutcome(entry, { playerId: pid, reason: move.reason, status: 'dry-run: would taxi', at: new Date().toISOString() });
          continue;
        }

        console.log(`${TAG} ${fid} ${name}: taxiing rookie ${pid} (${move.reason})`);
        const write = await postTaxiMove({ year, playerId: pid, ownerCookie: cred.cookie });
        if (!write.ok) {
          entry = appendOutcome(entry, { playerId: pid, reason: move.reason, status: `failed: ${write.error}`, at: new Date().toISOString() });
          franchiseFailed = true;
          break;
        }

        await sleep(750);

        // Verify by re-reading the roster: the player must now be TAXI_SQUAD
        // (or off the active roster entirely, if the owner raced us). The
        // rosters endpoint can lag writes (documented for drops in
        // docs/claude/insights/domains/mfl-api.md), so retry the read once
        // before burning an attempt on a stale response.
        let verified = false;
        for (let read = 0; read < 2 && !verified; read += 1) {
          if (read > 0) await sleep(2_000);
          try {
            const afterRosters = await fetchRosters(year, fid);
            const after = afterRosters.get(fid) ?? [];
            const afterStatus = after.find((p) => p.id === pid)?.status;
            verified = afterStatus !== ACTIVE_ROSTER_STATUS;
          } catch (err) {
            console.warn(`${TAG} verify roster read failed for ${fid}: ${err.message}`);
          }
        }

        if (verified) {
          entry = appendOutcome(entry, { playerId: pid, reason: move.reason, status: 'taxi-verified', at: new Date().toISOString() });
        } else {
          entry = appendOutcome(entry, { playerId: pid, reason: move.reason, status: 'failed: MFL did not confirm the taxi move', at: new Date().toISOString() });
          franchiseFailed = true;
          break;
        }
      }

      if (franchiseFailed) {
        await finishFranchise(failedDoneValue(decision.attempt));
        results.failed.push(fid);
        console.error(`${TAG} ${fid} ${name}: attempt ${decision.attempt} failed during taxi phase — will retry next tick (up to ${MAX_ATTEMPTS})`);
        await sleep(1_000);
        continue;
      }

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
        console.log(`${TAG} ${fid} ${name}: complete (${slate.taxiMoves.length} taxi move(s), ${slate.cuts.length} cut(s)) — credential deleted`);
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
  writeReportFile({ year, mode: dryRun ? 'dry-run' : 'live', snapshot, summary, cutdownDate, dryRun });
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
  const rookieIds = await fetchRookiePriority(year);
  const plans = await computePlans({ redis, year, rosters, acquisitions, rookieIds, franchiseFilter: args.franchise });
  console.log(`${TAG} ${plans.length} over-limit franchise(s): ${plans.map((p) => `${p.franchiseId}(+${p.slate.overage})`).join(', ') || 'none'}`);

  // The full set of league franchise ids for one-shot completeness (item D).
  // A --franchise debug run narrows to just that franchise so it never books
  // the rest of the league done.
  const allFranchiseIds = args.franchise
    ? [pad4(args.franchise)]
    : [...rosters.keys()].sort();

  if (mode === 'validate-only') {
    await runValidateOnly({ redis, year, plans, names, daysUntil, dryRun: args.dryRun });
  } else if (mode === 'rehearse') {
    await runRehearse({ redis, year, plans, cutdownDate, dryRun: args.dryRun });
  } else {
    const results = await runExecution({ redis, year, plans, allFranchiseIds, names, acquisitions, rookieIds, cutdownDate, dryRun: args.dryRun });
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
