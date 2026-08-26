/**
 * Which playoff brackets a franchise ENTERS its league's championship
 * tournament through — the brackets whose combined field IS "made the
 * playoffs".
 *
 * Not, as the code assumed for years, bracket 1. That held until 2018 and then
 * quietly stopped: the AFL now seeds its eight playoff teams into TWO
 * conference brackets, `2 AL Championship` (4) and `3 NL Championship` (4), and
 * `1 AFL Championship` became the 2-team final between their winners. Reading
 * id 1 alone therefore reported a two-team playoff field for eight straight
 * seasons, which surfaced on the division report as four or five playoff
 * berths a year in a league that has seeded exactly EIGHT every year since
 * 2003.
 *
 * The AFL resolves by NAME and START WEEK, never by id, for the reason
 * afl-bracket-kind.mjs spells out: MFL renumbered its brackets twice. The rule
 * is "the championship-side title brackets that open in the FIRST postseason
 * week" — bracket 1 alone through 2017 (its consolation bracket opens a week
 * later), AL + NL from 2018 (the final opens two weeks later).
 *
 * TheLeague answers directly instead, because the week rule would be wrong
 * there: its Toilet Bowl Challenge is a full 7-team tournament starting the
 * SAME week as the championship, so a week-based rule would report a 14-team
 * playoff field in a 16-team league. Its bracket ids have never moved.
 *
 * WHY .mjs: `scripts/compute-franchise-history.mjs` derives every playoff
 * appearance in the repo from this, and `tests/playoff-field-size.test.ts`
 * checks the result against MFL's own declared field. A node script cannot
 * import a .ts, and two copies of this rule would be free to drift on exactly
 * the seasons nobody looks at.
 */
import { bracketKindFromName, isTitleBracket } from './afl-bracket-kind.mjs';

const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/**
 * Brackets a team can only reach by LOSING one it already entered.
 *
 * `bracketKindFromName` classifies anything AFL-side that is not NIT/Cup/AL/NL
 * as `championship`, which is a tab, not a promise — so "The Loser's Bracket"
 * and "The Toilet Bowl Challenge" fall through it as championship-side title
 * brackets and, both starting the same week as the championship, would be
 * picked up by the week rule below.
 *
 * That is not hypothetical. `fetch-mfl-feeds.mjs#generatePredictedBrackets`
 * hardcodes TheLeague's bracket shape and writes it into whichever league it
 * is fetching (roster-sync.yml loops the AFL through the same script), guarded
 * only by `hasRealBracketData`. Fed that payload, the AFL resolver without
 * this filter answers `['1','3','5']` — a nineteen-team playoff field in a
 * league that seeds eight, crediting berths through the Toilet Bowl.
 */
const NOT_AN_ENTRY = /\b(consolation|loser'?s?|toilet)\b/i;

const RESOLVERS = {
  theleague: () => ['1'],
  'afl-fantasy': (metas) => {
    const candidates = metas.filter((meta) => {
      const kind = bracketKindFromName(meta?.name, String(meta?.id));
      // `championship` is the fallthrough kind, so these two filters are what
      // keep "AFL 3rd Place Game", "AFL 5th Place Game" and the consolation
      // side out — a team is in any of those only by having already entered
      // through the championship, AL or NL.
      return (
        (kind === 'championship' || kind === 'al' || kind === 'nl') &&
        isTitleBracket(meta?.name) &&
        !NOT_AN_ENTRY.test(String(meta?.name ?? ''))
      );
    });
    const weeks = candidates.map((m) => Number(m.startWeek)).filter((n) => Number.isFinite(n));
    if (!weeks.length) return [];
    const firstWeek = Math.min(...weeks);
    return candidates.filter((m) => Number(m.startWeek) === firstWeek).map((m) => String(m.id));
  },
};

/**
 * The bracket metadata array, wherever MFL parked it this era — and empty for a
 * PREDICTED payload.
 *
 * `fetch-mfl-feeds.mjs` invents a bracket shape from the standings when a
 * season has no real one yet, stamping `predicted: true`. Those brackets carry
 * no franchise ids, so they can never name a participant; what they can do is
 * declare a field size, and it is a guess (and, for the AFL, a guess in another
 * league's shape). Refusing to read them means an unplayed season contributes
 * no playoff credit at all, which is the correct answer.
 */
export function bracketMetas(playoffBrackets) {
  if (playoffBrackets?.predicted) return [];
  return toArray(playoffBrackets?.playoffBrackets?.playoffBracket);
}

/**
 * True when the entry brackets were read off real metadata rather than guessed.
 *
 * `getEntryBracketIds` falls back to `['1']` when it has nothing to read, which
 * is right for TheLeague and WRONG for the modern AFL, where bracket 1 is the
 * two-team final. A caller about to resolve participants out of a bracket map
 * needs to know which of those it got — see the reconstruction fallback in
 * scripts/compute-franchise-history.mjs.
 */
export function hasDeclaredEntryBrackets(leagueSlug, playoffBrackets) {
  const metas = bracketMetas(playoffBrackets);
  if (!metas.length) return false;
  const resolve = RESOLVERS[leagueSlug] ?? RESOLVERS.theleague;
  return resolve(metas).length > 0;
}

/**
 * @param {string} leagueSlug
 * @param {object | null | undefined} playoffBrackets  MFL's playoff-brackets.json
 * @returns {string[]} bracket ids, never empty
 */
export function getEntryBracketIds(leagueSlug, playoffBrackets) {
  const metas = bracketMetas(playoffBrackets);
  const resolve = RESOLVERS[leagueSlug] ?? RESOLVERS.theleague;
  const ids = metas.length ? resolve(metas).map(String).filter(Boolean) : [];
  // A season whose export carries no metadata at all still has to answer the
  // question, and bracket 1 is right everywhere it is not overridden.
  return ids.length ? ids : ['1'];
}

/**
 * How many teams the league seeds — summed across the ENTRY brackets, which is
 * the field only because they are the ones teams enter through. Summing every
 * championship-side bracket would count the AFL's two conference winners a
 * second time in the final.
 *
 * @returns {number} 0 when the export declares no field at all
 */
export function getChampionshipFieldSize(leagueSlug, playoffBrackets) {
  const ids = new Set(getEntryBracketIds(leagueSlug, playoffBrackets));
  return bracketMetas(playoffBrackets)
    .filter((b) => ids.has(String(b.id)))
    .reduce((n, b) => n + (Number(b.teamsInvolved) || 0), 0);
}

/**
 * Everyone who appears in the entry brackets. Accepts MFL's export or a
 * reconstructed season, which mirrors its `brackets` map.
 *
 * @returns {Set<string>} franchise ids; empty when the export carries none
 */
export function getEntryBracketParticipants(playoffBrackets, entryBracketIds) {
  const participants = new Set();
  if (!playoffBrackets) return participants;
  const list =
    playoffBrackets.brackets || playoffBrackets.playoffBrackets?.brackets || playoffBrackets;
  if (!list || typeof list !== 'object') return participants;
  for (const id of entryBracketIds) {
    const bracket = list[id]?.playoffBracket;
    if (!bracket) continue;
    for (const round of toArray(bracket.playoffRound)) {
      for (const game of toArray(round.playoffGame)) {
        if (game.home?.franchise_id) participants.add(game.home.franchise_id);
        if (game.away?.franchise_id) participants.add(game.away.franchise_id);
      }
    }
  }
  return participants;
}
