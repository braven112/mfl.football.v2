/**
 * PROTOTYPE — MFL adapter, reading the committed feeds (no network).
 *
 * Proves the interface against a provider whose shapes are maximally unlike
 * Sleeper's: XML-descended JSON, franchise ids that are zero-padded strings,
 * single-element arrays collapsed to bare objects, and a `starter` flag on
 * the player rather than a separate starters list.
 *
 * If one interface fits BOTH of these, it will fit ESPN and Yahoo too.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LEAGUES } from '../../../src/config/leagues-data.mjs';

/**
 * MFL collapses a one-element array into a bare object throughout its feeds.
 * Every single read has to survive that, which is why it is a helper and not
 * an inline `Array.isArray` at 20 call sites.
 */
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const entryFor = (leagueId) => Object.values(LEAGUES).find((l) => l.id === String(leagueId));

function feed(leagueId, year, file) {
  const entry = entryFor(leagueId);
  if (!entry) throw new Error(`no registry entry for MFL league ${leagueId}`);
  const path = join(entry.dataPath, 'mfl-feeds', String(year), file);
  if (!existsSync(path)) throw new Error(`missing feed ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** @type {import('./types.mjs').LeagueProvider} */
export function mflProvider(year) {
  return {
    kind: 'mfl',

    async getLeague(leagueId) {
      const l = feed(leagueId, year, 'league.json').league;
      return {
        provider: 'mfl',
        providerLeagueId: String(leagueId),
        name: l.name,
        season: Number(year),
        teamCount: list(l.franchises?.franchise).length,
        rosterPositions: list(l.starters?.position).map((p) => p.name ?? p),
        usesSalaries: l.usesSalaries === '1',
      };
    },

    async getTeams(leagueId) {
      const l = feed(leagueId, year, 'league.json').league;
      return list(l.franchises?.franchise).map((f) => ({
        teamId: String(f.id),                      // '0001' — leading zeros matter
        name: f.name,
        ownerName: f.owner_name ?? null,
        ownerId: f.owner_name ?? null,             // MFL exposes no stable owner id here
        logo: f.icon ?? f.logo ?? null,
      }));
    },

    async getRosters(leagueId) {
      const r = feed(leagueId, year, 'rosters.json').rosters;
      return list(r.franchise).map((f) => {
        const ps = list(f.player);
        return {
          teamId: String(f.id),
          playerIds: ps.map((p) => String(p.id)),
          // MFL marks starters with a flag ON THE PLAYER rather than a list
          starterIds: ps.filter((p) => p.status === 'STARTER').map((p) => String(p.id)),
          unmatched: [],                            // MFL ids ARE canonical
        };
      });
    },

    async getMatchups(leagueId, week) {
      const s = feed(leagueId, year, 'schedule.json').schedule;
      const wk = list(s.weeklySchedule).find((w) => String(w.week) === String(week));
      return list(wk?.matchup).map((m, i) => ({
        week: Number(week),
        matchupId: `${week}-${i}`,
        sides: list(m.franchise).map((f) => ({
          teamId: String(f.id),
          points: f.score === '' || f.score == null ? null : Number(f.score),
        })),
      }));
    },

    async getTransactions(leagueId, week) {
      const t = feed(leagueId, year, 'transactions.json').transactions;
      return list(t.transaction)
        .filter((x) => week == null || String(x.week) === String(week))
        .map((x, i) => ({
          id: `${x.timestamp}-${x.franchise}-${i}`,
          type: x.type === 'FREE_AGENT' ? 'add'
            : x.type === 'WAIVER' ? 'waiver'
            : x.type === 'TRADE' ? 'trade' : 'other',
          timestamp: x.timestamp ? Number(x.timestamp) * 1000 : null,
          teamIds: [String(x.franchise)].filter(Boolean),
          adds: [], drops: [],   // MFL packs these into a pipe-delimited string;
                                 // the real parser lives in src/utils/mfl-transactions.ts
        }));
    },
  };
}
