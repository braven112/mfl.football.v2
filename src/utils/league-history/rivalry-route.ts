/**
 * The rivalry route's decisions, shared by both leagues' thin wrappers:
 * whether the slug names a real pairing, its canonical address (smaller
 * franchise id first, so a pairing has exactly one URL), and the league's own
 * names for its playoff rounds. The wrappers do the redirecting, because
 * `Astro.redirect()` only redirects from a page.
 */
import { parseRivalryPair } from '../rivalries';
import { franchiseList } from './franchise.mjs';

export type RivalryPairRoute =
  | { redirect: string; a?: undefined; b?: undefined; playoffRounds?: undefined }
  | { redirect: null; a: string; b: string; playoffRounds: Record<string, string> };

export function rivalryPairRoute(historyData: unknown, franchiseHistory: any, slug: string | undefined): RivalryPairRoute {
  const parsed = parseRivalryPair(slug ?? '');
  if (!parsed) return { redirect: 'index' };
  const [a, b] = [...parsed].sort();
  const known = new Set((franchiseList(historyData) as Array<{ franchiseId: string }>).map((f) => f.franchiseId));
  if (!known.has(a) || !known.has(b)) return { redirect: 'index' };
  if (`${a}-vs-${b}` !== slug) return { redirect: `${a}-vs-${b}` };

  // Round names from the league's franchise history ("Semifinal", the AFL's
  // "NL Conference Championship"). A bare "Playoffs" says less than the
  // page's own final-or-not call, so it is left out.
  const playoffRounds: Record<string, string> = {};
  for (const m of franchiseHistory?.franchises?.[a]?.matchupHistory?.[b] ?? []) {
    if (m.isPlayoff && m.playoffRound && m.playoffRound !== 'Playoffs') playoffRounds[`${m.year}-${m.week}`] = m.playoffRound;
  }
  return { redirect: null, a, b, playoffRounds };
}
