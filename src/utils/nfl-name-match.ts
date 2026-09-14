/**
 * Fantasy team name → NFL club, for the MFL Live board's artwork fallback.
 *
 * Rung 2 of the identity ladder (docs/plans/mfl-live-app.md): a league this
 * site does not run has no config and therefore no crests, but plenty of
 * owners name their team after a real club. When the name IS an NFL team, that
 * club's mark and brand colour stand in. When it is not, the board falls back
 * to text — never to a guess.
 *
 * ── THE RULE, AND WHY IT IS THIS STRICT ───────────────────────────────────
 * Match only when the ENTIRE name resolves, after lowercasing, folding
 * punctuation to spaces, dropping a leading "the", and collapsing whitespace.
 * The full name (`dallas cowboys`) and the bare nickname (`cowboys`) both
 * count; a name that merely CONTAINS a nickname never does.
 *
 * That is not caution for its own sake. Run any substring or fuzzy rule over
 * the 40 real franchise names in TheLeague and the AFL and every single hit is
 * a false positive:
 *
 *   "The Boondock Saints"  → NO   (a film)
 *   "Cowboy Up"            → DAL  (not a Cowboys reference at all)
 *   "Titsburgh Feelers"    → PIT  (a joke name, under fuzzy matching)
 *   "Music City Mafia"     → TEN  (under a city-alias rule)
 *
 * Under the rule below, all four correctly resolve to null, and the count of
 * matches across all 40 is ZERO. `tests/nfl-name-match.test.ts` pins that: it
 * is the property that makes this feature safe to ship, and any future alias
 * has to keep it true.
 *
 * The bare-nickname rung is only safe because all 32 nicknames are unique —
 * also pinned by the test, since a future league expansion could break it.
 *
 * ── FEED IT THE FULL NAME. NEVER A SHORT NAME OR AN ABBREVIATION ──────────
 * This is a rule, not a preference, and the repo already contains the proof:
 * the AFL's "The Boondock Saints" carries `nameShort: "Saints"` and
 * `abbrev: "SAINTS"`. The full name correctly matches nothing; both of the
 * shortened forms match NEW ORLEANS. A short name is a lossy label an owner
 * picked for column widths, so matching one asks a question its author never
 * answered — and the failure is silent and plausible on screen, which is the
 * whole class of bug this module exists to avoid.
 *
 * MFL's `myleagues` gives `franchiseName`, the full name, so the correct input
 * is the one the board already has. `tests/nfl-name-match.test.ts` pins the
 * hazard with that exact franchise so nobody re-derives it the hard way.
 *
 * ── WHAT IS DELIBERATELY ABSENT ───────────────────────────────────────────
 * No fuzzy matching, no edit distance, and NO nickname aliases (`Niners`,
 * `Bucs`, `Pats`, `Da Bears`). `NFL_LEGACY_NAMES` below is the extension
 * point and ships holding relocations and renames only. Owner feedback decides
 * what gets added — a deliberate call, not an oversight.
 */

import { NFL_TEAM_NAMES } from './nfl-logo';

/**
 * Former names that resolve to the club's CURRENT code.
 *
 * People still name teams "Oakland Raiders". `TEAM_CODE_MAP` in `nfl-logo.ts`
 * already does exactly this for legacy team CODES, so this extends an
 * established idea to legacy NAMES rather than inventing a mechanism.
 *
 * Keys are already normalized (see `normalizeTeamName`) — no punctuation, no
 * leading article — because that is the form they are looked up in.
 */
export const NFL_LEGACY_NAMES: Readonly<Record<string, string>> = {
  'oakland raiders': 'LV',
  'los angeles raiders': 'LV',
  'san diego chargers': 'LAC',
  'st louis rams': 'LAR',
  'saint louis rams': 'LAR',
  'houston oilers': 'TEN',
  'tennessee oilers': 'TEN',
  'washington redskins': 'WSH',
  'washington football team': 'WSH',
};

/**
 * Leading words dropped before matching.
 *
 * Just the definite article. "The Cowboys" is the same team as "Cowboys";
 * "Da Bears" is NOT in here, because that is a nickname alias and those are
 * the extension point above, not a normalization rule. Keeping the list at one
 * word is what stops this quietly becoming fuzzy matching.
 */
const LEADING_ARTICLES = new Set(['the']);

/**
 * Fold a franchise name to its comparable form.
 *
 * Exported for the guard test, which asserts against the normalized shape.
 */
export function normalizeTeamName(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const folded = raw
    .toLowerCase()
    // Punctuation becomes a SPACE, not nothing: "st. louis" must fold to
    // "st louis" rather than "stlouis", and an apostrophe in a possessive
    // should split the word the same way a space would.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!folded) return '';

  const words = folded.split(' ');
  if (words.length > 1 && LEADING_ARTICLES.has(words[0])) words.shift();
  return words.join(' ');
}

/**
 * name → code, built once. Full names and bare nicknames share the index;
 * a collision between the two would be a real ambiguity, and there is none
 * (no club's nickname is another club's full name).
 */
const NAME_INDEX: Record<string, string> = (() => {
  const index: Record<string, string> = {};
  for (const [code, fullName] of Object.entries(NFL_TEAM_NAMES)) {
    const full = normalizeTeamName(fullName);
    if (full) index[full] = code;

    // The nickname is the last word of the full name for all 32 clubs —
    // including "49ers", which is why normalization keeps digits.
    const nickname = full.split(' ').pop();
    if (nickname) index[nickname] = code;
  }
  // Legacy names last: a former name must never be shadowed by a current
  // club's nickname, and none of them collide today.
  for (const [name, code] of Object.entries(NFL_LEGACY_NAMES)) {
    index[name] = code;
  }
  return index;
})();

/**
 * The NFL club a franchise name names, or `null`.
 *
 * `null` is the common case and is not a failure — it is rung 3 of the ladder
 * (text-only), which is a correct outcome rather than a fallback from an
 * error.
 */
export function matchNflTeamName(raw: string | null | undefined): string | null {
  const normalized = normalizeTeamName(raw);
  if (!normalized) return null;
  return NAME_INDEX[normalized] ?? null;
}

/**
 * Every name form the matcher accepts, for tests and for anyone auditing what
 * this will and will not match. Sorted so the output is stable.
 */
export function knownNflTeamNames(): string[] {
  return Object.keys(NAME_INDEX).sort();
}
