/**
 * PROTOTYPE — prove the provider interface: identical normalized output from
 * two maximally different platforms.
 *
 *   node scripts/prototypes/provider-demo.mjs
 *   node scripts/prototypes/provider-demo.mjs --sleeper-league <id>
 *   node scripts/prototypes/provider-demo.mjs --sleeper-user <username>
 *
 * With no Sleeper argument it demos MFL and exercises every Sleeper endpoint
 * that does not need a league id.
 */
import { loadCrosswalk, toCanonical } from './providers/identity.mjs';
import { sleeperProvider } from './providers/sleeper.mjs';
import { mflProvider } from './providers/mfl.mjs';
import { LEAGUES } from '../../src/config/leagues-data.mjs';

const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const h = (t) => console.log(`\n${'─'.repeat(64)}\n${t}\n${'─'.repeat(64)}`);

async function dump(provider, leagueId, week) {
  const [league, teams, rosters, matchups] = await Promise.all([
    provider.getLeague(leagueId),
    provider.getTeams(leagueId),
    provider.getRosters(leagueId),
    provider.getMatchups(leagueId, week),
  ]);
  console.log(`  league      ${league.name}  (${league.season}, ${league.teamCount} teams)`);
  console.log(`  slots       ${league.rosterPositions.slice(0, 10).join(' ')}`);
  console.log(`  salaries    ${league.usesSalaries === null ? 'null (provider cannot say)' : league.usesSalaries}`);
  console.log(`  teams       ${teams.length}   e.g. ${teams[0]?.teamId} "${teams[0]?.name}" (${teams[0]?.ownerName})`);
  const totalPlayers = rosters.reduce((n, r) => n + r.playerIds.length, 0);
  const unmatched = rosters.flatMap((r) => r.unmatched);
  console.log(`  rosters     ${rosters.length} teams, ${totalPlayers} players resolved to canonical ids`);
  console.log(`  unmatched   ${unmatched.length}${unmatched.length ? `  ${unmatched.slice(0, 8).join(', ')}` : ''}`);
  const m = matchups[0];
  console.log(`  matchups wk${week}  ${matchups.length}   e.g. ${m?.sides.map((s) => `${s.teamId}:${s.points ?? '—'}`).join(' vs ')}`);
  return { league, teams, rosters, matchups };
}

await loadCrosswalk();

h('MFL — read from committed feeds');
const mflEntry = LEAGUES.theleague;
const mfl = mflProvider(2026);
const mflOut = await dump(mfl, mflEntry.id, 1);

h('SLEEPER — live API, no auth');
const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
console.log(`  NFL state   season ${state.season} ${state.season_type}, week ${state.week}`);

let sleeperLeague = arg('--sleeper-league');
const user = arg('--sleeper-user');
if (!sleeperLeague && user) {
  const u = await (await fetch(`https://api.sleeper.app/v1/user/${user}`)).json();
  if (!u?.user_id) { console.log(`  no such Sleeper user: ${user}`); }
  else {
    const ls = await (await fetch(`https://api.sleeper.app/v1/user/${u.user_id}/leagues/nfl/${state.season}`)).json();
    console.log(`  user        ${u.display_name} (${u.user_id}) — ${ls.length} league(s)`);
    sleeperLeague = ls[0]?.league_id ?? null;
  }
}

if (sleeperLeague) {
  const out = await dump(sleeperProvider, sleeperLeague, state.week);
  h('SHAPE EQUIVALENCE');
  const keys = (o) => Object.keys(o).sort().join(',');
  for (const [name, a, b] of [
    ['league', mflOut.league, out.league],
    ['team', mflOut.teams[0], out.teams[0]],
    ['roster', mflOut.rosters[0], out.rosters[0]],
    ['matchup', mflOut.matchups[0], out.matchups[0]],
  ]) {
    const same = keys(a) === keys(b);
    console.log(`  ${name.padEnd(9)} ${same ? 'IDENTICAL' : 'DIVERGENT'}  ${keys(a)}`);
    if (!same) console.log(`            sleeper: ${keys(b)}`);
  }
} else {
  console.log('  (no league id given — pass --sleeper-league <id> or --sleeper-user <name>)');
  h('CROSSWALK REACH (what a Sleeper league would resolve)');
  const sp = await (await fetch('https://api.sleeper.app/v1/players/nfl')).json();
  const all = Object.values(sp);
  const SKILL = new Set(['QB', 'RB', 'WR', 'TE', 'K']);
  // Tier it. The headline number depends entirely on the denominator, and the
  // naive one is misleading: Sleeper's "active" list carries ~2,400 camp
  // bodies who are in no crosswalk anywhere because no league rosters them.
  for (const [label, f] of [
    ['active, any skill position', (p) => p.active && SKILL.has(p.position)],
    ['...on an NFL team', (p) => p.active && SKILL.has(p.position) && p.team],
    ['...and Sleeper rank < 400', (p) => p.active && SKILL.has(p.position) && p.team
      && p.search_rank && p.search_rank < 400],
  ]) {
    const pool = all.filter(f);
    const hit = pool.filter((p) => toCanonical('sleeper', p.player_id)).length;
    console.log(`  ${label.padEnd(30)} ${String(pool.length).padStart(5)} players`
      + `   ${((100 * hit) / pool.length).toFixed(1)}% resolve`);
  }
  console.log('\n  The unresolved tail is all search_rank 9999999 — Sleeper\'s own');
  console.log('  "not fantasy relevant" sentinel. A second hop through espn_id /');
  console.log('  yahoo_id recovers exactly ZERO of them (measured), so do not build one.');
}
console.log();
