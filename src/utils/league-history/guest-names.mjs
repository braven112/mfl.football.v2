/**
 * Owner names, hidden from visitors who are not signed in (Brandon,
 * 2026-11-07: "I don't want to make it possible for people to use our real
 * names").
 *
 * TheLeague's history is the public Ask the History demo: strangers ask
 * questions about a real league. Its owners are real people, so to anyone
 * without a session every owner's name becomes a stand-in built from the team
 * they are best known for ("Bring The Pain Owner"). Signed-in owners still
 * see real names.
 *
 * Two places apply it, both from this one module:
 *  - the middleware, on every HTML page of the history section
 *    (`isGuestMaskedPath`), so a page, a component, or a data island added
 *    later is covered without anyone remembering to mask it;
 *  - the ask endpoint, on the dataset itself, before a guest's question
 *    reaches the model, so the model never sees a real name and cannot
 *    give one out however it is asked.
 *
 * The name list is owner-tenures.json (displayName → dominantName), the same
 * file every owner page is built from. Plain JS so the middleware, the API
 * route and the tests share it.
 */

/** Leagues whose owner names are hidden from signed-out visitors. */
export const GUEST_MASKED_LEAGUES = ['theleague'];

/**
 * The history section of a masked league, as an INTERNAL path (after the
 * apex-host rewrite): history home, Record Book, ask + answers, franchise,
 * owner and rivalry pages.
 */
const SECTIONS = ['history', 'franchises', 'owners', 'rivalries'];

export function isGuestMaskedPath(pathname) {
  const m = /^\/([\w-]+)\/([\w-]+)(?:\/|$)/.exec(pathname ?? '');
  return Boolean(m && GUEST_MASKED_LEAGUES.includes(m[1]) && SECTIONS.includes(m[2]));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every spelling a name can reach the page in: as typed, HTML-escaped, JSON-escaped. */
function spellings(name) {
  const out = new Set([name]);
  if (/[’']/.test(name)) {
    for (const apos of ["'", '’', '&#39;', '&#x27;', '&apos;', '\\u2019']) out.add(name.replace(/[’']/g, apos));
  }
  return [...out];
}

/**
 * [realName, standIn] for every owner. The stand-in is the owner's best-known
 * team plus "Owner"; two owners of one team (co-owners, or one name held in two
 * tenures) share it, which is the truth of who they were.
 */
export function ownerStandIns(tenures) {
  const pairs = [];
  for (const o of tenures?.owners ?? []) {
    const real = String(o?.displayName ?? '').trim();
    const team = String(o?.dominantName ?? '').trim();
    if (real.length < 2 || !team) continue;
    pairs.push([real, `${team} Owner`]);
  }
  return pairs;
}

/**
 * A function that swaps every owner name in a string for its stand-in.
 * Full names first, so "Nate Rich" is replaced whole before the one-word
 * owner "Rich" is considered; whole words only, so "Dan" never eats "Dangsters".
 * Co-owners written "A & B" who share a stand-in collapse to "<Team> Owners".
 */
export function buildNameMasker(pairs) {
  const byName = new Map();
  for (const [real, standIn] of pairs) for (const s of spellings(real)) byName.set(s, standIn);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  if (!names.length) return (text) => text;
  const alt = (list) => list.map(escapeRe).join('|');
  const full = names.filter((n) => /\s/.test(n));
  // A one-word owner ("Mike", "Rich") is also half of many NFL players' names,
  // so it is masked only where it stands alone: never before another
  // capitalized word ("Mike Evans") and never after a comma ("Evans, Mike").
  const single = names.filter((n) => !/\s/.test(n));
  const res = [
    full.length && new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt(full)})(?![\\p{L}\\p{N}])`, 'gu'),
    single.length && new RegExp(`(?<![\\p{L}\\p{N}]|,\\s)(?:${alt(single)})(?![\\p{L}\\p{N}]|\\s+\\p{Lu})`, 'gu'),
  ].filter(Boolean);
  const pairRe = /([^<>"&\n]{1,80}?) Owner (?:&amp;|&|and|\+) \1 Owner\b/g;
  return (text) => {
    if (typeof text !== 'string' || !text) return text;
    let out = text;
    for (const re of res) out = out.replace(re, (m) => byName.get(m) ?? m);
    return out.replace(pairRe, '$1 Owners');
  };
}

/** Deep copy of a JSON value with every string masked. */
export function maskJson(value, mask) {
  if (typeof value === 'string') return mask(value);
  if (Array.isArray(value)) return value.map((v) => maskJson(v, mask));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskJson(v, mask);
    return out;
  }
  return value;
}
