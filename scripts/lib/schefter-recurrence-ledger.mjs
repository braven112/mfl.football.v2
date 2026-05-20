/**
 * Schefter rumor-recurrence ledger.
 *
 * Tracks which gossip bucket fingerprints have already been posted about in
 * each ISO calendar week. A fingerprint that's been posted in two consecutive
 * prior weeks is "stale" — the next time it shows up, the normal rumor lane
 * skips it and lets fresher tips through. Stale fingerprints still surface
 * via Friday mailbag so nothing expires unseen.
 *
 * The user's pain point: when the same rumor cycles for weeks ("Geeks are
 * shopping Jefferson"), fresh tips get stuck behind it. The ledger lets the
 * scanner age repeats out of the normal lane after three weeks.
 *
 * Reset boundary: Labor Day (NFL season rollover). When a new season starts
 * the whole ledger drops to a clean slate.
 *
 * Pure helpers — file I/O is isolated to load/save so the rest is testable
 * without touching disk.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

// Bump from 1 → 2: ledger entries now also carry a sorted unique list of
// tipsterHashes (the distinct hashedOwnerIds that have ever contributed to
// this fingerprint). The list is the data source for HARD RULE 25 (cross-
// week memory recall — "three weeks ago a source mentioned X; tonight a
// different voice circled back"). Old v1 files load cleanly: missing
// tipsterHashes fields are treated as empty arrays.
export const LEDGER_VERSION = 2;
export const STALE_WEEK_THRESHOLD = 2;
// Hashes are SHA-256 hex (64 chars). We keep the per-fingerprint roster
// bounded so a heavily-recurring bucket can't grow the ledger without
// limit — the prompt only needs the COUNT, not the identities.
const MAX_TIPSTERS_PER_FINGERPRINT = 64;

export function isoWeekLabel(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function isoWeekMinus(label, n) {
  const date = isoWeekToDate(label);
  date.setUTCDate(date.getUTCDate() - n * 7);
  return isoWeekLabel(date);
}

function isoWeekToDate(label) {
  const m = /^(\d{4})-W(\d{2})$/.exec(label);
  if (!m) throw new Error(`Invalid ISO week label: ${label}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return target;
}

// Labor Day (first Monday of September) is the season-rollover boundary —
// matches the convention used elsewhere in scripts/ for season detection.
export function currentSeasonYear(now = new Date()) {
  const calYear = now.getUTCFullYear();
  const sep1 = new Date(Date.UTC(calYear, 8, 1));
  const sep1Day = sep1.getUTCDay();
  const offset = sep1Day === 1 ? 0 : sep1Day === 0 ? 1 : 8 - sep1Day;
  const laborDay = new Date(Date.UTC(calYear, 8, 1 + offset));
  return now >= laborDay ? calYear : calYear - 1;
}

export function emptyLedger(season) {
  return {
    version: LEDGER_VERSION,
    season,
    fingerprints: {},
  };
}

/**
 * Migrate a loaded ledger to the current schema in-place. Idempotent.
 * Backfills missing tipsterHashes arrays (v1 → v2 upgrade) so callers that
 * loaded a pre-feature-10 file don't crash on getMemoryRecall.
 */
function migrateLedgerInPlace(ledger) {
  if (!ledger || typeof ledger !== 'object') return ledger;
  ledger.version = LEDGER_VERSION;
  if (!ledger.fingerprints || typeof ledger.fingerprints !== 'object') {
    ledger.fingerprints = {};
    return ledger;
  }
  for (const fp of Object.keys(ledger.fingerprints)) {
    const entry = ledger.fingerprints[fp];
    if (!entry || typeof entry !== 'object') {
      ledger.fingerprints[fp] = { weeksSeen: [], tipsterHashes: [] };
      continue;
    }
    if (!Array.isArray(entry.weeksSeen)) entry.weeksSeen = [];
    if (!Array.isArray(entry.tipsterHashes)) entry.tipsterHashes = [];
  }
  return ledger;
}

/**
 * A fingerprint is stale iff the ledger has entries for BOTH of the two
 * preceding ISO weeks. The current week's entry is written only AFTER a post
 * is consumed, so two consecutive prior weeks means this cycle's consume
 * would make three.
 */
export function isFingerprintStale(ledger, fingerprint, currentWeek) {
  const entry = ledger?.fingerprints?.[fingerprint];
  if (!entry) return false;
  const weeks = new Set(entry.weeksSeen ?? []);
  const w1 = isoWeekMinus(currentWeek, 1);
  const w2 = isoWeekMinus(currentWeek, 2);
  return weeks.has(w1) && weeks.has(w2);
}

/**
 * Length of the consecutive ISO-week streak this fingerprint has, INCLUDING
 * the current week as if it were already marked. Used both for stale
 * detection (>=3 = stale) and for the mailbag prompt's "week N now" framing.
 *
 * Walks backward from currentWeek as long as each preceding week is in
 * weeksSeen. Returns 1 if the fingerprint has never been seen (current
 * week is the first appearance).
 */
export function getStreakLength(ledger, fingerprint, currentWeek) {
  const entry = ledger?.fingerprints?.[fingerprint];
  if (!entry) return 1;
  const weeks = new Set(entry.weeksSeen ?? []);
  let streak = 1;
  let probe = isoWeekMinus(currentWeek, 1);
  // Bound the walk at 24 weeks — well past any meaningful streak — to keep
  // the loop trivially terminating even on a corrupt ledger.
  while (weeks.has(probe) && streak < 24) {
    streak += 1;
    probe = isoWeekMinus(probe, 1);
  }
  return streak;
}

export function markFingerprintSeen(ledger, fingerprint, currentWeek, nowIso, tipsterHashes = []) {
  if (!ledger.fingerprints) ledger.fingerprints = {};
  const entry = ledger.fingerprints[fingerprint] ?? { weeksSeen: [], tipsterHashes: [] };
  if (!Array.isArray(entry.tipsterHashes)) entry.tipsterHashes = [];
  if (!entry.weeksSeen.includes(currentWeek)) {
    entry.weeksSeen.push(currentWeek);
    entry.weeksSeen.sort();
    if (entry.weeksSeen.length > 12) {
      entry.weeksSeen = entry.weeksSeen.slice(-12);
    }
  }
  // Merge new tipster hashes; keep the list sorted-unique and bounded.
  const seen = new Set(entry.tipsterHashes);
  for (const h of tipsterHashes ?? []) {
    if (typeof h === 'string' && h.length > 0) seen.add(h);
  }
  entry.tipsterHashes = [...seen].sort();
  if (entry.tipsterHashes.length > MAX_TIPSTERS_PER_FINGERPRINT) {
    // Trim from the front — older sorted hashes age out first. The COUNT
    // (what the prompt uses) is preserved as the trimmed length.
    entry.tipsterHashes = entry.tipsterHashes.slice(-MAX_TIPSTERS_PER_FINGERPRINT);
  }
  entry.lastUpdated = nowIso ?? new Date().toISOString();
  ledger.fingerprints[fingerprint] = entry;
  return ledger;
}

/**
 * Cross-week memory recall — feature 10 from the bot-intelligence brainstorm.
 *
 * Returns a `memoryRecall` payload when:
 *   - the fingerprint has been touched in ≥ 2 distinct prior weeks
 *   - AT LEAST ONE of the current cycle's tipsterHashes was NOT in the
 *     ledger's recorded roster for this fingerprint (a "different voice
 *     circled back")
 *
 * Returns null when memory recall is not warranted. The caller surfaces the
 * payload on the anonymized tip so HARD RULE 25 can drive the phrasing.
 *
 * Privacy: only counts surface — the individual hashes are never echoed.
 */
export function getMemoryRecall(ledger, fingerprint, currentTipsterHashes, currentWeek) {
  if (!fingerprint) return null;
  const entry = ledger?.fingerprints?.[fingerprint];
  if (!entry) return null;
  const weeksSeen = Array.isArray(entry.weeksSeen) ? entry.weeksSeen : [];
  if (weeksSeen.length < 2) return null;

  const prior = new Set(Array.isArray(entry.tipsterHashes) ? entry.tipsterHashes : []);
  const current = Array.isArray(currentTipsterHashes) ? currentTipsterHashes : [];
  const hasFreshVoice = current.some((h) => typeof h === 'string' && h.length > 0 && !prior.has(h));
  if (!hasFreshVoice) return null;

  // Weeks-since-first-seen, as a calendar-week diff between the earliest
  // recorded ISO-week and the current one. We compute by walking the
  // ordered weeksSeen list — the first entry is the oldest.
  const earliest = weeksSeen[0];
  let weeksAgo = 0;
  let probe = currentWeek;
  while (probe !== earliest && weeksAgo < 52) {
    probe = isoWeekMinus(probe, 1);
    weeksAgo += 1;
  }

  // Combined distinct-voices count = prior roster ∪ current new voices.
  // Cap at 64 so the count stays in a sensible range for prompts.
  const combined = new Set(prior);
  for (const h of current) {
    if (typeof h === 'string' && h.length > 0) combined.add(h);
  }
  return {
    weeksSinceFirstSeen: weeksAgo,
    totalWeeksSeen: weeksSeen.length,
    distinctVoicesAcrossTime: combined.size,
  };
}

export function rolloverForSeason(ledger, season) {
  if (!ledger || ledger.season !== season) {
    return [emptyLedger(season), true];
  }
  return [ledger, false];
}

export const LEDGER_PATH = path.join('data', 'schefter', 'topic-recurrence.json');

export function loadLedger(filePath = LEDGER_PATH) {
  if (!existsSync(filePath)) {
    return emptyLedger(currentSeasonYear());
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return emptyLedger(currentSeasonYear());
    }
    // Accept v1 (pre-feature-10) and v2; migrate in place so getMemoryRecall
    // sees a uniform shape. A version we don't recognize at all gets
    // discarded — that's a corrupt/future file, safer to start fresh.
    if (parsed.version !== 1 && parsed.version !== 2) {
      return emptyLedger(currentSeasonYear());
    }
    return migrateLedgerInPlace(parsed);
  } catch {
    return emptyLedger(currentSeasonYear());
  }
}

export function saveLedger(ledger, filePath = LEDGER_PATH) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
}
