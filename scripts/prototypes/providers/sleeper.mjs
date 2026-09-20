/**
 * PROTOTYPE — Sleeper adapter.
 *
 * Sleeper is read-only, unauthenticated and free for NON-COMMERCIAL use;
 * commercial use is a licensing conversation, not a prohibition
 * (docs.sleeper.com). Keeping it behind this interface means that
 * conversation can only ever cost us THIS FILE.
 *
 * Operational notes that are not obvious:
 * - `/players/nfl` is **14.6 MB** and Sleeper asks that it be called at most
 *   once per day. It is cached to disk here. Never put it in a request path.
 * - Rate limit is ~1000 calls/min before an IP block. A per-user poll loop
 *   would blow through that; a companion app must poll ONCE centrally and
 *   fan out (see docs/plans/companion-app-broadcast.md).
 * - `roster_id` is an integer; we stringify it (types.mjs rule 2).
 * - A username can change but `user_id` cannot — store the id.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { toCanonical } from './identity.mjs';

const BASE = 'https://api.sleeper.app/v1';
const PLAYERS_CACHE = '.cache/sleeper/players-nfl.json';

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`sleeper ${res.status} ${path}`);
  return res.json();
};

let playersCache = null;
async function players() {
  if (playersCache) return playersCache;
  if (existsSync(PLAYERS_CACHE)) {
    playersCache = JSON.parse(readFileSync(PLAYERS_CACHE, 'utf8'));
    return playersCache;
  }
  playersCache = await get('/players/nfl');
  mkdirSync(dirname(PLAYERS_CACHE), { recursive: true });
  writeFileSync(PLAYERS_CACHE, JSON.stringify(playersCache));
  return playersCache;
}

/** Sleeper marks empty lineup slots with '0' — not a player. */
const isRealPlayer = (id) => id && id !== '0';

/**
 * Sleeper roster entries are ALSO used for team defenses, where the "player
 * id" is a bare team code ('SF', 'KC'). Those never appear in a player-id
 * crosswalk, so they are resolved separately rather than counted as misses.
 */
const isTeamDefense = (id) => typeof id === 'string' && /^[A-Z]{2,3}$/.test(id);

/**
 * Resolve to a canonical id, or fall back to a PROVIDER-SCOPED id.
 *
 * Dropping an unresolved player is worse than keeping him. Measured on a real
 * 16-team Sleeper league: 33 of 321 rostered players are absent from the
 * community crosswalk, so a drop silently loses 10% of every roster — and the
 * page would render a 12-man roster as 11 with no error anywhere.
 *
 * Most of those 33 are camp bodies an autodraft scraped up (`team: 'FA'`,
 * `search_rank: 9999999`). But FIVE were real: Trey Smack (K, GB, rank 194),
 * Peter LeBlanc (294), Jalen Jackson (363). DynastyProcess is a community
 * dataset with a refresh lag, so every rookie season will produce a fresh
 * batch of these.
 *
 * The scoped form `sleeper:1234` is deliberately UNMISTAKABLE for a canonical
 * id — it cannot be compared against, or joined to, an MFL-keyed thing by
 * accident, which is the failure mode docs/claude/rules/live-scoring.md
 * exists to prevent. Such a player still renders correctly from the
 * provider's own name/team/position; he just cannot carry a contract, a
 * ranking, or one of our scores until the crosswalk catches up.
 */
const resolve = (id) => {
  if (isTeamDefense(id)) return `DEF:${id}`;
  return toCanonical('sleeper', id) ?? `sleeper:${id}`;
};

/** @type {import('./types.mjs').LeagueProvider} */
export const sleeperProvider = {
  kind: 'sleeper',

  async getLeague(leagueId) {
    const l = await get(`/league/${leagueId}`);
    return {
      provider: 'sleeper',
      providerLeagueId: String(leagueId),
      name: l.name,
      season: Number(l.season),
      teamCount: l.total_rosters ?? null,
      rosterPositions: l.roster_positions ?? [],
      usesSalaries: null,          // Sleeper has no cap concept — null, not false
      status: l.status ?? null,    // 'pre_draft' | 'drafting' | 'in_season' | 'complete'
      scoringSettings: l.scoring_settings ?? null,
    };
  },

  async getTeams(leagueId) {
    const [users, rosters] = await Promise.all([
      get(`/league/${leagueId}/users`),
      get(`/league/${leagueId}/rosters`),
    ]);
    const byUser = new Map(users.map((u) => [u.user_id, u]));
    return rosters.map((r) => {
      const u = byUser.get(r.owner_id);
      return {
        teamId: String(r.roster_id),
        name: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`,
        ownerName: u?.display_name ?? null,
        ownerId: r.owner_id ?? null,
        logo: u?.avatar ? `https://sleepercdn.com/avatars/${u.avatar}` : null,
      };
    });
  },

  async getRosters(leagueId) {
    await players();
    const rosters = await get(`/league/${leagueId}/rosters`);
    return rosters.map((r) => {
      const unmatched = [];
      const map = (ids) => (ids ?? []).filter(isRealPlayer).map((id) => {
        const c = resolve(id);
        // Still reported, so the gap is MEASURABLE — but the player is kept.
        if (c.startsWith('sleeper:')) unmatched.push(String(id));
        return c;
      });
      return {
        teamId: String(r.roster_id),
        playerIds: map(r.players),
        starterIds: map(r.starters),
        unmatched,
      };
    });
  },

  async getMatchups(leagueId, week) {
    const rows = await get(`/league/${leagueId}/matchups/${week}`);
    const grouped = new Map();
    for (const m of rows) {
      // matchup_id is null for a team on bye in a playoff week
      const key = m.matchup_id == null ? `bye-${m.roster_id}` : String(m.matchup_id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({
        teamId: String(m.roster_id),
        points: typeof m.points === 'number' ? m.points : null,
      });
    }
    return [...grouped].map(([matchupId, sides]) => ({ week, matchupId, sides }));
  },

  async getTransactions(leagueId, week) {
    const rows = await get(`/league/${leagueId}/transactions/${week}`);
    return rows.map((t) => {
      const teamIds = (t.roster_ids ?? []).map(String);
      const pairs = (obj) => Object.entries(obj ?? {}).map(([pid, rid]) => {
        const c = resolve(pid);
        return c ? { teamId: String(rid), playerId: c } : null;
      }).filter(Boolean);
      const type = t.type === 'free_agent' ? 'add'
        : t.type === 'waiver' ? 'waiver'
        : t.type === 'trade' ? 'trade' : 'other';
      return {
        id: String(t.transaction_id),
        type,
        timestamp: t.status_updated ?? t.created ?? null,
        teamIds,
        adds: pairs(t.adds),
        drops: pairs(t.drops),
      };
    });
  },
};
