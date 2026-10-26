import { describe, it } from 'vitest';
import { expectClean, scanForbidden } from './helpers/scan-guard';

/**
 * A head-to-head record has ONE source: league-history/rivalry.mjs.
 *
 * Until Oct 2026 the site had two game lists and three definitions of a
 * pairing's record. franchise-history.json's `matchupHistory` counted
 * consolation games and stored every game twice (once from each side, each
 * side resolving its own owner history), so the matchup previews, the
 * schedule-release column, the owner map, Archie's front page and its Top
 * Rivals disagreed with the rivalry pages on 83 of TheLeague's 114 pairings
 * and 139 of the AFL's 218 (Da Dangsters vs Fullybaked read 16-14 on one page
 * and 13-14 on the next). Every one of those now reads the League History
 * dataset through `rivalryPairs` / `headToHeadMeetings` / `rivalEntries` /
 * `rivalrySeries`, and this fails on a file that goes back to the old list.
 *
 * Exemptions: the producer that writes `matchupHistory`, and the rivalry
 * route, which reads it only for the league's own NAMES of its playoff rounds
 * ("Semifinal") — a label, never a count. Comment lines are skipped: modules
 * that moved explain why. Tests are outside the scanned roots.
 */
describe('head-to-head records come from the League History dataset', () => {
  it('no file reads franchise-history.json#matchupHistory for a record', () => {
    const result = scanForbidden({
      roots: ['src', 'scripts'],
      extensions: ['.ts', '.tsx', '.mjs', '.astro'],
      forbidden: [
        { name: 'matchupHistory read', pattern: /\bmatchupHistory\b/ },
        // The tallies that walked it, deleted from rivalry-intensity.mjs.
        {
          name: 'old tally helper',
          pattern: /\b(?:currentOwnerMeetings|tallyMeetings|computeRivalEntries|rivalrySeriesByPair)\b/,
        },
      ],
      allowlist: [
        {
          file: 'scripts/compute-franchise-history.mjs',
          names: ['matchupHistory read'],
          reason: 'the producer that writes matchupHistory',
        },
        {
          file: 'src/utils/league-history/rivalry-route.ts',
          names: ['matchupHistory read'],
          reason: "reads only the league's playoff round names, a label shown beside the dataset's own games",
        },
      ],
      exempt: ({ line }) => {
        const t = line.trim();
        return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
      },
    });
    expectClean(result, 'Read head-to-head records from league-history/rivalry.mjs, never matchupHistory');
  });
});
