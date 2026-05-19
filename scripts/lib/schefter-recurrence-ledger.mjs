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

export const LEDGER_VERSION = 1;
export const STALE_WEEK_THRESHOLD = 2;

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

export function markFingerprintSeen(ledger, fingerprint, currentWeek, nowIso) {
  if (!ledger.fingerprints) ledger.fingerprints = {};
  const entry = ledger.fingerprints[fingerprint] ?? { weeksSeen: [] };
  if (!entry.weeksSeen.includes(currentWeek)) {
    entry.weeksSeen.push(currentWeek);
    entry.weeksSeen.sort();
    if (entry.weeksSeen.length > 12) {
      entry.weeksSeen = entry.weeksSeen.slice(-12);
    }
  }
  entry.lastUpdated = nowIso ?? new Date().toISOString();
  ledger.fingerprints[fingerprint] = entry;
  return ledger;
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
    if (!parsed || typeof parsed !== 'object' || parsed.version !== LEDGER_VERSION) {
      return emptyLedger(currentSeasonYear());
    }
    return parsed;
  } catch {
    return emptyLedger(currentSeasonYear());
  }
}

export function saveLedger(ledger, filePath = LEDGER_PATH) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
}
