/**
 * Former-name callbacks — Schefter referring to a renamed franchise by the
 * name it just retired ("Dead Cap Walking, the former Heavy Chevy…").
 *
 * The bit works because it's a callback, and callbacks decay: a rename is
 * funny the season after it happens and confusing two years later, when half
 * the reference pool has no idea who that was. So eligibility is a WINDOW,
 * not a property of the name:
 *
 *   offseason of the following season   → occasional  (every once in a while)
 *   preseason (Aug 1 → Labor Day)       → frequent    (the rename is fresh news)
 *   regular-season weeks 1–3            → frequent
 *   week 4 onward                       → never again
 *
 * Applies to EVERY kind of rename, not just the AFL's last-place punitive
 * rebrands — `punitive` is a flavor flag on the payload, never a gate.
 *
 * Everything here is pure and clock-injectable so the window math is testable
 * without touching the system clock.
 */

import { getPtDateString } from './pt-date.mjs';

/** Phase names, in window order. `closed` means no callback, ever. */
export const CALLBACK_PHASES = ['offseason', 'preseason', 'early-season', 'closed'];

/**
 * Callback probability per phase. "Every once in a while" in the offseason,
 * roughly double that while the rename is still news.
 *
 * These are per-POST odds on an already-eligible franchise, and only a small
 * slice of posts name an eligible franchise at all — so the reader sees the
 * bit occasionally, which is the point. A callback in every post is a tic.
 */
export const CALLBACK_ODDS = {
  offseason: 1 / 6,
  preseason: 1 / 3,
  'early-season': 1 / 3,
  closed: 0,
};

/** Weeks 1–3 of the regular season, measured from Labor Day. */
const EARLY_SEASON_DAYS = 21;
/** Preseason opens Aug 1 — camp bodies, cutdowns, and rename chatter. */
const PRESEASON_START_MONTH = 8;

/** First Monday of September, as a {y, m, d} tuple. */
function laborDay(year) {
  const sep1Dow = new Date(Date.UTC(year, 8, 1)).getUTCDay();
  const offset = sep1Dow === 1 ? 0 : sep1Dow === 0 ? 1 : 8 - sep1Dow;
  return { y: year, m: 9, d: 1 + offset };
}

function toTuple(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  return { y, m, d };
}

function daysBetween(a, b) {
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86400000);
}

/**
 * Which callback phase are we in, and which season does it belong to?
 *
 * `season` is the season being approached or played — NOT the same as the
 * league-year clock. A name retired at the end of season S is eligible while
 * `season === S + 1`, which covers the whole stretch from the rename through
 * week 3 of the next season.
 */
export function resolveCallbackPhase(now = new Date()) {
  const today = toTuple(getPtDateString(now));
  const ld = laborDay(today.y);
  const sinceLaborDay = daysBetween(ld, today);

  if (sinceLaborDay >= EARLY_SEASON_DAYS) {
    // Week 4 onward. The window for THIS season's callbacks has closed, and
    // it does not reopen — next January starts a new rename's window, not
    // this one's.
    return { phase: 'closed', season: today.y };
  }
  if (sinceLaborDay >= 0) return { phase: 'early-season', season: today.y };
  if (today.m >= PRESEASON_START_MONTH) return { phase: 'preseason', season: today.y };
  return { phase: 'offseason', season: today.y };
}

function nameForms(entry) {
  return ['name', 'nameMedium', 'nameShort', 'abbrev']
    .map((f) => entry?.[f])
    .filter((v) => typeof v === 'string' && v.trim().length >= 2)
    .map((v) => v.trim());
}

/**
 * The name this franchise wore LAST SEASON and no longer wears, or null.
 *
 * `lastSeason` is required and is the only season considered — not "the most
 * recent rename", which is a different and wrong question. A franchise that
 * renamed three years ago has no callback available at all; the bit is a
 * callback to something the league just lived through, and a name from two
 * seasons back reads as trivia. Enforcing that here rather than at the call
 * site means this function cannot hand back an out-of-window name for a
 * caller to forget to check.
 *
 * Two kinds of `history[]` entry look like renames and are not:
 *
 *  1. **Re-skins.** Most franchises carry history rows that repeat the
 *     current name with a different icon/banner (Pacific Pigskins 2007-2012
 *     AND 2013-2024). Calling those a former name yields "the Pigskins,
 *     formerly the Pigskins."
 *  2. **Names that moved between franchises.** "Midwestside Connection" is
 *     0010's old name and 0011's CURRENT one. A callback there points at a
 *     live team that isn't the subject — worse than no callback.
 *
 * `nameOwners` maps each in-use name/alias (lower-cased) to the set of
 * franchise ids using it. It must be an OWNERSHIP map rather than a flat set
 * of taken names, because a franchise routinely keeps its own retired name in
 * `aliases` so people can still search by it — AFL 0014 carries "Thundering
 * Herd" that way. A flat set can't tell "another team has this name" from
 * "this team kept its own old nickname", so it suppressed 0014's callback
 * entirely: the league's current punitive rename, silently ineligible.
 */
export function pickFormerName(team, nameOwners, { lastSeason, franchiseId } = {}) {
  if (!Number.isInteger(lastSeason)) return null;
  const history = Array.isArray(team?.history) ? team.history : [];
  if (history.length === 0) return null;

  const ownCurrent = new Set(nameForms(team).map((n) => n.toLowerCase()));
  const ownAliases = new Set(
    (Array.isArray(team?.aliases) ? team.aliases : [])
      .filter((a) => typeof a === 'string')
      .map((a) => a.trim().toLowerCase()),
  );

  /** Is this name in use by a franchise OTHER than the subject? */
  const claimedByAnotherTeam = (lower) => {
    if (nameOwners instanceof Map) {
      const owners = nameOwners.get(lower);
      if (!owners) return false;
      return [...owners].some((id) => id !== franchiseId);
    }
    // Set / array fallback: no ownership information, so the best we can do is
    // treat the subject's own aliases as its own and everything else as taken.
    // Both shapes get lower-cased — a Set of display-cased names was silently
    // never matching, which quietly re-enabled callbacks to names another live
    // franchise owns.
    const flat = new Set(
      [...(nameOwners ?? [])].map((n) => String(n).trim().toLowerCase()),
    );
    return flat.has(lower) && !ownAliases.has(lower);
  };

  const candidates = history
    .filter((h) => typeof h?.name === 'string' && h.name.trim().length >= 2)
    // Last season and last season only. Not `>=`, not "most recent".
    .filter((h) => h.yearEnd === lastSeason)
    .filter((h) => !ownCurrent.has(h.name.trim().toLowerCase()))
    .filter((h) => !claimedByAnotherTeam(h.name.trim().toLowerCase()));

  return candidates[0] ?? null;
}

/**
 * Build the callback payload for a franchise Schefter is allowed to name, or
 * null when the bit shouldn't fire — out of window, no real rename, or the
 * dice said no this post.
 *
 * Returning null is the common case by design. The payload is the ONLY
 * channel the former name reaches the prompt through (tip text gets the name
 * normalized away by the redactor), so no payload means the LLM cannot reach
 * for it even if the tipster typed it.
 *
 * @param {any} team
 * @param {{ currentName?: string, nameOwners?: Map<string, unknown>, franchiseId?: string,
 *   now?: Date, rng?: () => number }} [options] Annotated because the defaults on
 *   `now`/`rng` otherwise make TS infer the options shape from those two alone and
 *   drop `currentName`, `nameOwners` and `franchiseId` — flagging every caller that
 *   passes them, including the one this function gates on at its first line.
 */
export function buildFormerNameCallback(team, {
  currentName,
  nameOwners,
  franchiseId,
  now = new Date(),
  rng = Math.random,
} = {}) {
  if (!team || typeof currentName !== 'string' || currentName.trim().length === 0) return null;

  const { phase, season } = resolveCallbackPhase(now);
  if (phase === 'closed') return null;

  // The ONLY name in play is the one the franchise wore last season. The
  // window is the season after the rename, one season, and then the name is
  // retired from the bit for good.
  const former = pickFormerName(team, nameOwners, {
    lastSeason: season - 1,
    franchiseId: franchiseId ?? team.franchiseId,
  });
  if (!former) return null;

  const odds = CALLBACK_ODDS[phase] ?? 0;
  if (rng() >= odds) return null;

  return {
    current: currentName,
    former: former.name.trim(),
    lastSeason: former.yearEnd,
    punitive: former.rebrand?.reason === 'last-place',
    phase,
  };
}
