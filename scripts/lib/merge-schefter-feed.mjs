/**
 * Concurrent-safe mergers for the Schefter JSON feeds.
 *
 * Five workflows (schefter-scan, schefter-rumor-scan, schefter-trade-speculation,
 * schefter-articles, backfill) all append to `schefter-feed.json` and
 * `post-history.json`. They run on overlapping crons, so a plain
 * `git pull --rebase` collides on these files — and because the feed is marked
 * `merge=binary`, the rebase can't auto-resolve, the push fails, and the post
 * never reaches the website (this is what froze the live feed for weeks).
 *
 * These feeds are APPEND-ONLY and keyed by a stable post `id`, so the correct
 * reconciliation is a union-by-id, not a textual merge. `commit-feed-and-push.mjs`
 * uses these functions to re-apply our newly written posts on top of the latest
 * origin before pushing, so nothing either side wrote is ever lost.
 */

/**
 * Pick the more-advanced of two watermark values. `lastProcessedMflTimestamp`
 * is an epoch-seconds string; the others are ISO-8601 strings. Numeric strings
 * compare numerically, ISO strings compare chronologically, and a missing side
 * loses to a present one.
 */
export function maxWatermark(a, b) {
  if (a === undefined || a === null || a === '') return b;
  if (b === undefined || b === null || b === '') return a;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    // Both look numeric (epoch seconds) — but only treat as numeric when the
    // raw strings are pure numbers, otherwise fall through to date compare.
    if (/^\d+$/.test(String(a).trim()) && /^\d+$/.test(String(b).trim())) {
      return na >= nb ? a : b;
    }
  }
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isFinite(da) && Number.isFinite(db)) return da >= db ? a : b;
  // Unparseable — fall back to lexical max (stable, deterministic).
  return String(a) >= String(b) ? a : b;
}

function postTimestamp(p) {
  return p?.timestamp ?? p?.publishedAt ?? p?.date ?? '';
}

/**
 * Union two posts arrays by `id`, newest-first. `ours` wins on a duplicate id
 * (it's the version we just generated this run). Entries without an id are
 * kept (de-duped by JSON identity) so malformed rows never silently vanish.
 */
function mergePostArrays(theirs, ours) {
  const byId = new Map();
  const noId = [];
  const seenNoId = new Set();
  const add = (p, oursSide) => {
    if (!p || typeof p !== 'object') return;
    if (typeof p.id === 'string' && p.id) {
      // ours added second so it overwrites theirs for the same id
      byId.set(p.id, p);
      return;
    }
    const key = JSON.stringify(p);
    if (seenNoId.has(key)) return;
    seenNoId.add(key);
    noId.push(p);
  };
  for (const p of Array.isArray(theirs) ? theirs : []) add(p, false);
  for (const p of Array.isArray(ours) ? ours : []) add(p, true);
  const merged = [...byId.values(), ...noId];
  merged.sort((x, y) => {
    const tx = Date.parse(postTimestamp(x));
    const ty = Date.parse(postTimestamp(y));
    const vx = Number.isFinite(tx) ? tx : -Infinity;
    const vy = Number.isFinite(ty) ? ty : -Infinity;
    if (vx !== vy) return vy - vx; // newest first
    // Stable tie-break by id so output is deterministic across runs.
    return String(y.id ?? '') < String(x.id ?? '') ? -1 : 1;
  });
  return merged;
}

const WATERMARK_KEYS = [
  'lastScanTimestamp',
  'lastProcessedMflTimestamp',
  'lastEspnTimestamp',
  'lastNflWireTimestamp',
];

/**
 * Merge two `schefter-feed.json` objects. `ours` is the version this run wrote;
 * `theirs` is the latest committed on origin. Posts union by id; watermarks take
 * the more-advanced value; `tradeBaitState` follows whichever side scanned more
 * recently; any other field prefers ours.
 */
export function mergeFeed(theirs, ours) {
  const t = theirs && typeof theirs === 'object' ? theirs : {};
  const o = ours && typeof ours === 'object' ? ours : {};
  const result = { ...t, ...o };

  for (const k of WATERMARK_KEYS) {
    if (k in t || k in o) result[k] = maxWatermark(t[k], o[k]);
  }

  // tradeBaitState is an opaque per-franchise object — don't field-merge it.
  // Keep the copy from whichever side scanned most recently.
  if ('tradeBaitState' in t || 'tradeBaitState' in o) {
    const oursIsNewer = maxWatermark(t.lastScanTimestamp, o.lastScanTimestamp) === o.lastScanTimestamp
      && o.lastScanTimestamp !== undefined;
    result.tradeBaitState = oursIsNewer ? o.tradeBaitState : (t.tradeBaitState ?? o.tradeBaitState);
  }

  result.posts = mergePostArrays(t.posts, o.posts);
  return result;
}

/**
 * Merge two `post-history.json` objects: union posts by id, newest-first,
 * capped to `_schema.maxEntries` (default 30). Schema/description metadata is
 * preserved (ours preferred).
 */
export function mergeHistory(theirs, ours) {
  const t = theirs && typeof theirs === 'object' ? theirs : {};
  const o = ours && typeof ours === 'object' ? ours : {};
  const result = { ...t, ...o };
  const cap = Number(o?._schema?.maxEntries ?? t?._schema?.maxEntries ?? 30) || 30;
  const merged = mergePostArrays(t.posts, o.posts);
  result.posts = merged.slice(0, cap);
  return result;
}

/** Dispatch by file path. Non-feed/-history files are taken verbatim (ours). */
export function mergeByPath(filePath, theirsText, oursText) {
  const isHistory = /post-history\.json$/.test(filePath);
  const isFeed = /schefter-feed\.json$/.test(filePath);
  if (!isHistory && !isFeed) return oursText; // take ours verbatim

  let theirs;
  let ours;
  try {
    theirs = JSON.parse(theirsText);
  } catch {
    theirs = null; // origin missing/corrupt — our version stands
  }
  try {
    ours = JSON.parse(oursText);
  } catch {
    return oursText; // can't parse ours — don't risk dropping content
  }
  if (theirs === null) return oursText;

  const merged = isHistory ? mergeHistory(theirs, ours) : mergeFeed(theirs, ours);
  return JSON.stringify(merged, null, 2) + '\n';
}
