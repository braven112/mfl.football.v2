/**
 * Speculation History Ledger — file-backed rotation gate.
 *
 * Every time we publish a trade-speculation post we append a row here so the
 * next run can:
 *   - Reject candidates that have been speculation-posted in the last 30 days
 *     (rotation — no spamming the same trade twice in a month)
 *   - Reject candidates whose participants have BOTH been featured in a
 *     speculation post in the last 7 days (per-franchise rotation)
 *   - Track when the last post was published to honor fractional cadences
 *     (1 every N days windows)
 *
 * The ledger lives at `data/theleague/derived/speculation-history.json` and
 * is committed to the repo by the cron job, the same way schefter-feed.json
 * is. Old entries are pruned when they age out of the longest window.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

const SAME_TRADE_ROTATION_MS = 30 * DAY_MS;
const SAME_FRANCHISE_ROTATION_MS = 7 * DAY_MS;
const PRUNE_HORIZON_MS = 35 * DAY_MS;

export const SPECULATION_HISTORY_REL_PATH = path.join(
  'data',
  'theleague',
  'derived',
  'speculation-history.json',
);

export function defaultLedgerPath(projectRoot) {
  return path.join(projectRoot, SPECULATION_HISTORY_REL_PATH);
}

export async function loadLedger(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return parsed;
  } catch {
    return { version: 1, entries: [] };
  }
}

export async function saveLedger(filePath, ledger, { now = new Date() } = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const pruned = pruneLedger(ledger, now);
  await fs.writeFile(filePath, JSON.stringify(pruned, null, 2) + '\n');
  return pruned;
}

export function pruneLedger(ledger, now = new Date()) {
  const cutoff = now.getTime() - PRUNE_HORIZON_MS;
  const entries = (ledger.entries ?? []).filter(
    (e) => Number(e.postedAt) >= cutoff,
  );
  return { version: ledger.version ?? 1, entries };
}

/**
 * A "trade signature" is the canonical representation of a candidate trade —
 * the sorted-and-joined player IDs from both sides plus the franchise pair.
 * Two candidates with the same signature are the same trade for rotation
 * purposes.
 */
export function tradeSignature({ seller, buyer, marqueeId, returnPkgIds }) {
  const sellerIds = [String(marqueeId)].sort();
  const buyerIds = [...returnPkgIds.map(String)].sort();
  const franchisePair = [String(seller), String(buyer)].sort().join('::');
  return `${franchisePair}|${sellerIds.join(',')}|${buyerIds.join(',')}`;
}

export function recentlyPostedTrade(ledger, signature, now = new Date()) {
  const cutoff = now.getTime() - SAME_TRADE_ROTATION_MS;
  return (ledger.entries ?? []).some(
    (e) => e.signature === signature && Number(e.postedAt) >= cutoff,
  );
}

export function franchiseInRecentRotation(ledger, franchiseId, now = new Date()) {
  const cutoff = now.getTime() - SAME_FRANCHISE_ROTATION_MS;
  const fid = String(franchiseId);
  return (ledger.entries ?? []).some(
    (e) =>
      Number(e.postedAt) >= cutoff &&
      Array.isArray(e.franchiseIds) &&
      e.franchiseIds.map(String).includes(fid),
  );
}

export function postsToday(ledger, now = new Date()) {
  // Use PT calendar day so we line up with the rumor-mill counter behavior.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const today = fmt.format(now);
  return (ledger.entries ?? []).filter(
    (e) => fmt.format(new Date(Number(e.postedAt) || 0)) === today,
  ).length;
}

export function lastPostAt(ledger) {
  let max = 0;
  for (const e of ledger.entries ?? []) {
    if (Number(e.postedAt) > max) max = Number(e.postedAt);
  }
  return max > 0 ? new Date(max) : null;
}

export function appendEntry(ledger, entry) {
  const next = {
    version: ledger.version ?? 1,
    entries: [...(ledger.entries ?? []), entry],
  };
  return next;
}

export const __testing__ = {
  SAME_TRADE_ROTATION_MS,
  SAME_FRANCHISE_ROTATION_MS,
  PRUNE_HORIZON_MS,
};
