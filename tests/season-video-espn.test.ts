/**
 * Season video — ESPN. ESPN's league API is unreachable from CI (and from the
 * dev sandbox), so these drive the parser with a small hand-built season in
 * the v3 shapes src/utils/espn-history.ts reads: teams, schedule, settings.
 */
import { describe, expect, it } from 'vitest';
import { pickVideoKind } from '../src/utils/season-video/season';
import {
	buildEspnVideo,
	currentEspnSeason,
	espnVideoUrl,
	fromEspn,
	loadEspnSeason,
	parseEspnLeagueInput,
	rankEspnTeams,
	readEspnSeason,
	type EspnSeasonRaw,
} from '../src/utils/season-video/espn-source';

const team = (id: number, name: string, wins: number, losses: number, pointsFor: number, seed: number, extra: object = {}) => ({
	id,
	name,
	logo: `https://g.espncdn.com/lm-static/logo-packs/team${id}.svg`,
	playoffSeed: seed,
	record: { overall: { wins, losses, ties: 0, pointsFor } },
	...extra,
});
const game = (week: number, home: [number, number], away: [number, number] | null, winner: string, tier = 'NONE') => ({
	matchupPeriodId: week,
	home: { teamId: home[0], totalPoints: home[1] },
	...(away ? { away: { teamId: away[0], totalPoints: away[1] } } : {}),
	winner,
	playoffTierType: tier,
});

// Four teams, two regular-season weeks, then semis (week 3) and the final (week 4).
const season: EspnSeasonRaw = {
	id: 123456,
	seasonId: 2025,
	settings: { name: 'Gridiron Gang', scheduleSettings: { matchupPeriodCount: 2, playoffTeamCount: 4 } },
	teams: [
		team(1, 'Alpha Dogs', 2, 0, 260.5, 1, { rankCalculatedFinal: 2 }),
		team(2, 'Bravo Six', 1, 1, 240, 2),
		team(3, 'Charlie Horse', 1, 1, 230, 3, { rankCalculatedFinal: 1 }),
		team(4, 'Delta Force', 0, 2, 200, 4),
	],
	schedule: [
		game(1, [1, 140.5], [4, 90], 'HOME'),
		game(1, [2, 120], [3, 110], 'HOME'),
		game(2, [1, 120], [2, 100], 'HOME'),
		game(2, [3, 120], [4, 110], 'HOME'),
		game(3, [1, 130], [4, 100], 'HOME', 'WINNERS_BRACKET'),
		game(3, [2, 105], [3, 125], 'AWAY', 'WINNERS_BRACKET'),
		game(4, [1, 118.25], [3, 121.5], 'AWAY', 'WINNERS_BRACKET'),
		game(4, [2, 99], [4, 101], 'AWAY', 'WINNERS_CONSOLATION_LADDER'),
	],
	status: { isActive: false },
};

describe('ESPN league input', () => {
	it('takes a bare id or any ESPN league URL', () => {
		expect(parseEspnLeagueInput(' 123456 ')).toEqual({ leagueId: '123456', season: null });
		expect(parseEspnLeagueInput('https://fantasy.espn.com/football/league?leagueId=123456&seasonId=2024')).toEqual({
			leagueId: '123456',
			season: 2024,
		});
		expect(parseEspnLeagueInput('https://fantasy.espn.com/football/team?seasonId=2025&leagueId=99&teamId=3')).toEqual({
			leagueId: '99',
			season: 2025,
		});
		expect(parseEspnLeagueInput('my league')).toBeNull();
		expect(parseEspnLeagueInput('https://example.com/?leagueId=1234567890123')).toBeNull();
	});

	it('builds one link carrying every view the video needs', () => {
		const url = new URL(espnVideoUrl('123456', 2025));
		expect(url.host).toBe('lm-api-reads.fantasy.espn.com');
		expect(url.pathname).toBe('/apis/v3/games/ffl/seasons/2025/segments/0/leagues/123456');
		expect(url.searchParams.getAll('view')).toEqual(['mTeam', 'mMatchupScore', 'mSettings']);
	});

	it('numbers a season by the year it starts', () => {
		expect(currentEspnSeason(new Date('2026-11-05T00:00:00Z'))).toBe(2026);
		expect(currentEspnSeason(new Date('2027-01-20T00:00:00Z'))).toBe(2026);
	});
});

describe('fromEspn', () => {
	it('crowns the final’s winner, from the winners bracket only', () => {
		const out = fromEspn(season, 3)!;
		expect(out.complete).toBe(true);
		expect(out.facts.outcome).toBe('champion');
		expect(out.facts.playoffs.map((g) => [g.label, g.oppName, g.score, g.oppScore])).toEqual([
			['Semifinal', 'Bravo Six', 125, 105],
			['The Final', 'Alpha Dogs', 121.5, 118.25],
		]);
		expect(out.facts.leagueName).toBe('Gridiron Gang');
		expect(out.facts.season).toBe(2025);
		expect(pickVideoKind(out.facts)).toBe('champion');
	});

	it('reads the runner-up, record, finish and seed', () => {
		const f = fromEspn(season, 1)!.facts;
		expect(f.outcome).toBe('runner-up');
		expect([f.wins, f.losses, f.pointsFor, f.finish, f.teams, f.seed]).toEqual([2, 0, 260.5, 1, 4, 1]);
		expect(f.bestGame).toMatchObject({ label: 'Week 1', score: 140.5, oppName: 'Delta Force' });
		expect(f.worstGame).toMatchObject({ label: 'Week 2', score: 120, oppName: 'Bravo Six' });
	});

	it('leaves the consolation ladder out and makes the last seed the last-place video', () => {
		const f = fromEspn(season, 4)!.facts;
		expect(f.playoffs.map((g) => g.label)).toEqual(['Semifinal']);
		expect(f.finish).toBe(4);
		expect(f.outcome).toBe('playoffs');
		expect(pickVideoKind({ ...f, outcome: 'missed' })).toBe('last');
	});

	it('skips byes and unplayed games, and calls nobody champion before the final', () => {
		const live: EspnSeasonRaw = {
			...season,
			teams: season.teams!.map((t) => ({ ...t, rankCalculatedFinal: undefined })),
			schedule: [
				...season.schedule!.slice(0, 4),
				game(3, [1, 0], null, 'UNDECIDED', 'WINNERS_BRACKET'),
				game(3, [2, 0], [3, 0], 'UNDECIDED', 'WINNERS_BRACKET'),
			],
		};
		const out = fromEspn(live, 1)!;
		expect(out.complete).toBe(false);
		expect(out.facts.playoffs).toEqual([]);
		expect(out.facts.outcome).toBe('playoffs'); // seeded in, with a bye
	});

	it('falls back to wins then points when seeds are missing, and to location + nickname for names', () => {
		const teams = [
			{ id: 1, location: 'Big', nickname: 'Dogs', record: { overall: { wins: 5, pointsFor: 900 } } },
			{ id: 2, abbrev: 'BRV', record: { overall: { wins: 5, pointsFor: 950 } } },
		];
		expect(rankEspnTeams(teams).map((t) => t.id)).toEqual([2, 1]);
		expect(fromEspn({ teams }, 1)!.facts.teamName).toBe('Big Dogs');
		expect(fromEspn({ teams }, 2)!.facts.teamName).toBe('BRV');
		expect(fromEspn({ teams }, 9)).toBeNull();
	});
});

describe('readEspnSeason', () => {
	it('accepts what the link shows and refuses everything else', () => {
		expect(readEspnSeason(JSON.stringify(season), '123456').ok).toBe(true);
		expect(readEspnSeason('not json', '123456')).toMatchObject({ ok: false, error: 'not-json' });
		expect(readEspnSeason(JSON.stringify({ messages: ['You are not authorized'] }), '123456')).toMatchObject({ error: 'private' });
		expect(readEspnSeason(JSON.stringify({ id: 1 }), '1')).toMatchObject({ error: 'not-a-league' });
		expect(readEspnSeason(JSON.stringify(season), '999')).toMatchObject({ error: 'wrong-league' });
	});
});

describe('loading', () => {
	const fetchLogo = async (url: string) => `data:image/svg+xml;base64,${Buffer.from(url).toString('base64')}`;

	it('lists the teams first, then fills a picked team with logos', async () => {
		const none = await buildEspnVideo(season, null, fetchLogo);
		expect(none.facts).toBeNull();
		expect(none.teams.map((t) => t.name)).toEqual(['Alpha Dogs', 'Bravo Six', 'Charlie Horse', 'Delta Force']);
		const picked = await buildEspnVideo(season, 3, fetchLogo);
		expect(picked.kind).toBe('champion');
		expect(picked.facts!.teamLogo).toMatch(/^data:image\/svg/);
		expect(picked.facts!.playoffs.every((g) => g.oppLogo)).toBe(true);
	});

	it('hands back the paste link when ESPN says the league is private', async () => {
		const out = await loadEspnSeason({
			leagueId: '123456',
			season: 2025,
			teamId: null,
			get: async () => ({ status: 401, text: '' }),
			fetchLogo,
		});
		expect(out).toMatchObject({ ok: false, error: 'private', pasteUrl: espnVideoUrl('123456', 2025) });
	});

	it('reads a public league, and refuses bad ids and old seasons without asking ESPN', async () => {
		const asked: string[] = [];
		const get = async (u: string) => (asked.push(u), { status: 200, text: JSON.stringify(season) });
		expect(await loadEspnSeason({ leagueId: '123456', season: 2025, teamId: 3, get, fetchLogo })).toMatchObject({ ok: true, teamId: 3 });
		expect(await loadEspnSeason({ leagueId: '12ab', season: 2025, teamId: null, get, fetchLogo })).toMatchObject({ error: 'no-league' });
		expect(await loadEspnSeason({ leagueId: '123456', season: 2015, teamId: null, get, fetchLogo })).toMatchObject({ error: 'too-old' });
		expect(asked).toHaveLength(1);
	});
});
