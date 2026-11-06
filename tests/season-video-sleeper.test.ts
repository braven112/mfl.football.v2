/**
 * Season video — Sleeper. Sleeper is unreachable from CI, so these drive the
 * parser with a small hand-built league in Sleeper's documented shapes
 * (https://docs.sleeper.com): rosters, users, winners_bracket, matchups.
 */
import { describe, expect, it } from 'vitest';
import { formatRecord, pickVideoKind } from '../src/utils/season-video/season';
import { fromSleeper, listSleeperLeagues, loadSleeperSeason, rankRosters, roundWeeks } from '../src/utils/season-video/sleeper-source';

const roster = (id: number, owner: string, wins: number, losses: number, fpts: number, dec = 0) => ({
	roster_id: id,
	owner_id: owner,
	settings: { wins, losses, ties: 0, fpts, fpts_decimal: dec },
});
const rosters = [roster(1, 'u1', 10, 4, 1700, 55), roster(2, 'u2', 9, 5, 1650), roster(3, 'u3', 9, 5, 1600), roster(4, 'u4', 2, 12, 1300, 10)];
const users = [
	{ user_id: 'u1', display_name: 'alpha', avatar: 'abc123', metadata: { team_name: 'Alpha Dogs' } },
	{ user_id: 'u2', display_name: 'bravo', avatar: null, metadata: { team_name: 'Bravo Six', avatar: 'https://sleepercdn.com/uploads/bravo.png' } },
	{ user_id: 'u3', display_name: 'charlie', avatar: null, metadata: null },
	{ user_id: 'u4', display_name: 'delta', avatar: null, metadata: { team_name: 'Delta Force' } },
];
// Semis in week 15, the final and third-place game in week 16.
const bracket = [
	{ r: 1, m: 1, t1: 1, t2: 4, w: 1, l: 4 },
	{ r: 1, m: 2, t1: 2, t2: 3, w: 3, l: 2 },
	{ r: 2, m: 3, t1: 1, t2: 3, w: 3, l: 1, p: 1 },
	{ r: 2, m: 4, t1: 4, t2: 2, w: 2, l: 4, p: 3 },
];
const week = (pairs: [number, number, number][]) =>
	pairs.map(([roster_id, matchup_id, points]) => ({ roster_id, matchup_id, points }));
const matchups = new Map([
	[1, week([[1, 1, 150.2], [2, 1, 100], [3, 2, 90], [4, 2, 70.5]])],
	[2, week([[1, 1, 88], [3, 1, 120], [2, 2, 110], [4, 2, 140]])],
	[15, week([[1, 1, 130], [4, 1, 99], [2, 2, 101], [3, 2, 111]])],
	[16, week([[1, 1, 115.4], [3, 1, 120.6], [4, 2, 80], [2, 2, 95]])],
]);
const league = { name: 'Sunday Sweats', season: '2025', status: 'complete', settings: { playoff_week_start: 15, playoff_round_type: 0 } };

describe('fromSleeper', () => {
	it('reads the champion from the bracket and the scores from the matchups', () => {
		const r = fromSleeper({ league, rosters, users, bracket, matchups, rosterId: 3 })!;
		expect(r.complete).toBe(true);
		expect(r.facts.teamName).toBe('charlie');
		expect(r.facts.outcome).toBe('champion');
		expect(r.facts.playoffs.map((g) => [g.label, g.score, g.oppName, g.oppScore])).toEqual([
			['Semifinal', 111, 'Bravo Six', 101],
			['The Final', 120.6, 'Alpha Dogs', 115.4],
		]);
		expect(pickVideoKind(r.facts)).toBe('champion');
	});

	it('ranks each regular-season week against every roster that week', () => {
		const r = fromSleeper({ league, rosters, users, bracket, matchups, rosterId: 3 })!;
		expect(r.facts.weeks?.map((w) => [w.week, w.score, w.rank, w.allPlay.wins])).toEqual([
			[1, 90, 3, 1],
			[2, 120, 2, 2],
		]);
	});

	it('the runner-up, with record and points from roster settings', () => {
		const r = fromSleeper({ league, rosters, users, bracket, matchups, rosterId: 1 })!;
		expect(r.facts.outcome).toBe('runner-up');
		expect(formatRecord(r.facts)).toBe('10–4');
		expect(r.facts.pointsFor).toBe(1700.55);
		expect(r.facts.finish).toBe(1);
		expect(r.facts.bestGame).toMatchObject({ label: 'Week 1', score: 150.2, oppName: 'Bravo Six' });
		expect(r.facts.worstGame).toMatchObject({ label: 'Week 2', score: 88 });
	});

	it('leaves placement games out, and last place gets the last-place video', () => {
		const r = fromSleeper({ league, rosters, users, bracket, matchups, rosterId: 4 })!;
		expect(r.facts.playoffs.map((g) => g.label)).toEqual(['Semifinal']);
		expect(r.facts.finish).toBe(4);
		expect(pickVideoKind(r.facts)).toBe('last');
	});

	it('ranks by wins, then points', () => {
		expect(rankRosters(rosters).map((r) => r.roster_id)).toEqual([1, 2, 3, 4]);
	});

	it('an unfinished final is not complete', () => {
		const open = bracket.map((m) => (m.p === 1 ? { ...m, w: null, l: null } : m));
		const r = fromSleeper({ league, rosters, users, bracket: open, matchups: new Map([...matchups].filter(([w]) => w < 16)), rosterId: 3 })!;
		expect(r.complete).toBe(false);
		expect(r.facts.outcome).toBe('playoffs');
	});

	it('is null for a roster not in the league', () => {
		expect(fromSleeper({ league, rosters, users, bracket, matchups, rosterId: 9 })).toBeNull();
	});
});

describe('roundWeeks', () => {
	it('one week a round, a two-week final, or two weeks every round', () => {
		expect(roundWeeks(1, 3, 15, 0)).toEqual([15]);
		expect(roundWeeks(3, 3, 15, 1)).toEqual([17, 18]);
		expect(roundWeeks(2, 2, 14, 2)).toEqual([16, 17]);
	});
});

describe('loadSleeperSeason', () => {
	const get = async (path: string): Promise<unknown> => {
		if (path === '/league/123456789') return league;
		if (path.endsWith('/rosters')) return rosters;
		if (path.endsWith('/users')) return users;
		if (path.endsWith('/winners_bracket')) return bracket;
		const m = /\/matchups\/(\d+)$/.exec(path);
		if (m) return matchups.get(Number(m[1])) ?? [];
		return undefined;
	};

	it('finds the user’s own team and embeds logos', async () => {
		const out = await loadSleeperSeason({
			leagueId: '123456789',
			userId: 'u2',
			get,
			fetchLogo: async (url) => `data:image/png;base64,${Buffer.from(url).toString('base64')}`,
		});
		if (!out.ok) throw new Error(out.message);
		expect(out.rosterId).toBe(2);
		expect(out.facts.teamName).toBe('Bravo Six');
		expect(Buffer.from(out.facts.teamLogo!.split(',')[1], 'base64').toString()).toBe('https://sleepercdn.com/uploads/bravo.png');
		expect(out.teams).toHaveLength(4);
	});

	it('refuses an id that is not a Sleeper league id', async () => {
		const out = await loadSleeperSeason({ leagueId: '../user/x', userId: null, get, fetchLogo: async () => null });
		expect(out.ok).toBe(false);
	});
});

describe('listSleeperLeagues', () => {
	it('lists finished seasons first', async () => {
		const rows = await listSleeperLeagues('u1', new Date('2026-11-05'), async (path) =>
			path.endsWith('/2026')
				? [{ league_id: '222222222', name: 'Now', season: '2026', status: 'in_season' }]
				: [{ league_id: '111111111', name: 'Then', season: '2025', status: 'complete' }],
		);
		expect(rows.map((r) => r.name)).toEqual(['Then', 'Now']);
	});
});
