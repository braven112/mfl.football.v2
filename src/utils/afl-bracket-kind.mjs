/**
 * Which tournament an AFL playoff bracket belongs to.
 *
 * MFL renumbered these brackets twice in the league's history, so the id is not
 * a stable key for "this is the NIT":
 *
 *   2003        1 Conference Championships, 2 NIT
 *   2004-2005   1 AFL Championships,        3 NIT
 *   2006        1 AFL Championships,        4 NIT
 *   2007-2017   1 AFL Championship,         5 NIT Championship
 *   2018+       1 AFL Championship, 2 AL, 3 NL, 6 NIT Championship
 *
 * The NAME has always carried "NIT", and AL/NL only ever appear as the modern
 * conference brackets, so classify on that. /afl-fantasy/playoffs previously
 * split the tabs on hardcoded id ranges (winners 1-5, toilet 6-9) — correct
 * only from 2018 on, which filed every pre-2018 NIT under the Championship tab
 * and left the NIT tab empty.
 *
 * WHY .mjs: the playoffs page (TypeScript) and
 * `scripts/reconstruct-afl-playoff-brackets.mjs` both classify brackets, and a
 * node script cannot import a .ts. Two copies would be free to drift on exactly
 * the seasons nobody looks at. Same pattern as division-aliases.mjs.
 *
 * @typedef {'al' | 'nl' | 'nit' | 'cup' | 'championship'} BracketKind
 */

/** Modern-era ids, used only when a bracket arrives with no name at all. */
function kindFromId(id) {
  if (['6', '7', '8', '9'].includes(id)) return 'nit';
  if (id === '2') return 'al';
  if (id === '3') return 'nl';
  return 'championship';
}

/**
 * @param {string | undefined} name
 * @param {string} id
 * @returns {BracketKind}
 */
export function bracketKindFromName(name, id) {
  const label = String(name ?? '').trim();
  if (!label) return kindFromId(String(id));
  if (/\bNIT\b/i.test(label)) return 'nit';
  // The AFL Cup (2012-2016) is an in-season knockout run over weeks 4-12, not
  // part of the postseason at all — its brackets sat on the NIT tab purely
  // because their ids happened to fall above 9.
  if (/\bAFL Cup\b/i.test(label)) return 'cup';
  if (/^AL\b/i.test(label)) return 'al';
  if (/^NL\b/i.test(label)) return 'nl';
  return 'championship';
}

/**
 * Build a `(bracketId) => BracketKind` lookup from whatever metas a season has.
 * Later sources win, so pass the live metas after the cached fallback ones.
 *
 * @param {...(Array<{id?: string | number, name?: string}> | null | undefined)} metaSources
 * @returns {(id: string | number) => BracketKind}
 */
export function buildBracketKindResolver(...metaSources) {
  const names = new Map();
  for (const metas of metaSources) {
    for (const meta of metas ?? []) {
      if (meta?.id == null || !meta?.name) continue;
      names.set(String(meta.id), String(meta.name));
    }
  }
  return (id) => bracketKindFromName(names.get(String(id)), String(id));
}

/**
 * True for the bracket that actually crowns the NIT champion, as opposed to its
 * consolation and placement rounds ("NIT Consolation 1", "NIT 3rd Place Game").
 *
 * @param {string | undefined} name
 */
export function isNitTitleBracket(name) {
  return /^NIT(\s+Championship)?$/i.test(String(name ?? '').trim());
}
