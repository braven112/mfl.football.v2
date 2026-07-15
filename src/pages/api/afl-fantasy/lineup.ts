/**
 * AFL Lineup API — thin re-export of the merged /api/lineup route.
 *
 * Phase 2 registry sweep: api/lineup.ts and this file were 92% identical
 * (only the hardcoded league id and year-rollover function differed). The
 * merged route in ../lineup.ts resolves the league from the session user's
 * `leagueId` via the registry and picks the correct year-rollover clock
 * (`getLeagueYearForSlug`), so this file just re-exports its handlers to
 * keep the /api/afl-fantasy/lineup path working for existing clients.
 */

export { GET, POST } from '../lineup';
