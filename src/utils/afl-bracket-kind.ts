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
 */
export type BracketKind = 'al' | 'nl' | 'nit' | 'cup' | 'championship';

export interface BracketMetaLike {
  id?: string | number;
  name?: string;
}

/** Modern-era ids, used only when a bracket arrives with no name at all. */
function kindFromId(id: string): BracketKind {
  if (['6', '7', '8', '9'].includes(id)) return 'nit';
  if (id === '2') return 'al';
  if (id === '3') return 'nl';
  return 'championship';
}

export function bracketKindFromName(name: string | undefined, id: string): BracketKind {
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
 */
export function buildBracketKindResolver(
  ...metaSources: Array<BracketMetaLike[] | undefined | null>
): (id: string | number) => BracketKind {
  const names = new Map<string, string>();
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
 */
export function isNitTitleBracket(name: string | undefined): boolean {
  return /^NIT(\s+Championship)?$/i.test(String(name ?? '').trim());
}
