/**
 * Season video — the league recap (Brandon, 2026-11-06): no team picked, the
 * data hands out the awards, anyone can give an award to someone else.
 * MFL is driven by TheLeague's recorded 2025 feeds (four divisions, a
 * finished bracket); Sleeper and ESPN by small hand-built leagues.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allPlayRecords, leagueAwards, leagueGroups, leagueWeeks, mflGroups, mflLeagueFacts, type LeagueFacts } from '../src/utils/season-video/league-recap';
import { leagueStory, MAX_STORY_SECONDS, storyDuration } from '../src/utils/season-video/story';
import { sleeperLeagueFacts } from '../src/utils/season-video/sleeper-source';
import { espnLeagueFacts } from '../src/utils/season-video/espn-source';

const dir = path.resolve(__dirname, '../data/theleague/mfl-feeds/2025');
const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
const league = read('league.json');
const standings = read('standings.json');
const brackets = read('playoff-brackets.json');
const schedule = read('schedule.json');

const mfl = mflLeagueFacts({
	leagueName: 'The League',
	season: 2025,
	franchiseId: '0001',
	league,
	standings,
	brackets: { playoffBrackets: brackets.playoffBrackets },
	championshipBracket: brackets.brackets['1'],
	schedule,
});

describe('MFL league facts', () => {
	it('keeps the standings order, every team, its division and the champion', () => {
		expect(mfl.teams).toHaveLength(16);
		expect(mfl.teams[0].id).toBe(standings.leagueStandings.franchise[0].id);
		expect(mfl.groupKind).toBe('division');
		expect(leagueGroups(mfl)).toHaveLength(4);
		expect(mfl.championId).toMatch(/^\d{4}$/);
	});
	it('keeps only regular-season games', () => {
		const weeks = leagueWeeks(mfl);
		expect(weeks[0]).toBe(1);
		expect(weeks.length).toBeGreaterThanOrEqual(13);
		expect(mfl.games.every((g) => g.a !== g.b)).toBe(true);
	});
	it('falls back to conferences when a league has no divisions', () => {
		const lg = { league: { conferences: { conference: [{ id: '00', name: 'AL' }, { id: '01', name: 'NL' }] }, franchises: { franchise: [{ id: '0001', conference: '00' }, { id: '0002', conference: '01' }] } } };
		expect(mflGroups(lg)).toEqual({ kind: 'conference', of: new Map([['0001', 'AL'], ['0002', 'NL']]) });
		expect(mflGroups({ league: { franchises: { franchise: [{ id: '0001' }] } } })).toBeNull();
	});
});

// A four-team league, two weeks, two divisions.
const small: LeagueFacts = {
	leagueName: 'Sunday Sweats',
	season: 2026,
	teams: [
		{ id: 'a', name: 'Alpha', wins: 2, losses: 0, ties: 0, pointsFor: 250, group: 'East' },
		{ id: 'b', name: 'Bravo', wins: 1, losses: 1, ties: 0, pointsFor: 260, group: 'West' },
		{ id: 'c', name: 'Charlie', wins: 1, losses: 1, ties: 0, pointsFor: 200, group: 'East' },
		{ id: 'd', name: 'Delta', wins: 0, losses: 2, ties: 0, pointsFor: 150, group: 'West' },
	],
	games: [
		{ week: 1, a: 'a', aScore: 120, b: 'b', bScore: 119 },
		{ week: 1, a: 'c', aScore: 110, b: 'd', bScore: 60 },
		{ week: 2, a: 'a', aScore: 130, b: 'd', bScore: 90 },
		{ week: 2, a: 'b', aScore: 141, b: 'c', bScore: 90 },
	],
	groupKind: 'division',
	championId: null,
	bestStarts: { 1: { a: { name: 'Q One', pos: 'QB', pts: 35, avg: 20 }, c: { name: 'T Two', pos: 'TE', pts: 20, avg: 8 } } },
};

describe('weekly recap awards', () => {
	it('hands out every award from the data', () => {
		const by = Object.fromEntries(leagueAwards(small, 'week', 1).map((a) => [a.id, a]));
		expect(by['top-score'].teamId).toBe('a');
		expect(by['low-score'].teamId).toBe('d');
		expect(by.blowout).toMatchObject({ teamId: 'c', value: 'Beat Delta by 50.00.' });
		expect(by.closest).toMatchObject({ teamId: 'a', value: 'Beat Bravo by 1.00.' });
		expect(by.unlucky).toMatchObject({ teamId: 'b', value: '119.00 points. Lost to Alpha by 1.00.' });
		expect(by['best-start']).toMatchObject({ teamId: 'a', value: 'Q One, QB: 35.00 points. QBs averaged 20.0.' });
	});
	it('uses the latest week by default', () => {
		expect(leagueAwards(small, 'week', undefined).find((a) => a.id === 'top-score')?.teamId).toBe('b');
	});
	it('lets anyone give an award to someone else, and tells the truth about them', () => {
		const top = leagueAwards(small, 'week', 1, { 'top-score': 'c' }).find((a) => a.id === 'top-score')!;
		expect(top).toMatchObject({ pickedId: 'a', teamId: 'c', value: '110.00 points.' });
		// A team that isn't in the league is ignored.
		expect(leagueAwards(small, 'week', 1, { 'top-score': 'zz' }).find((a) => a.id === 'top-score')?.teamId).toBe('a');
	});
});

describe('season recap awards', () => {
	it('covers records, points, all-play and each division', () => {
		const awards = leagueAwards(small, 'season', undefined);
		const by = Object.fromEntries(awards.map((a) => [a.id, a]));
		expect(by['best-record'].teamId).toBe('a');
		expect(by['most-points'].teamId).toBe('b');
		expect(by['worst-record'].teamId).toBe('d');
		expect(by['fewest-points'].teamId).toBe('d');
		expect(by['group:East']).toMatchObject({ teamId: 'a', title: 'East division winner' });
		expect(by['group:West'].teamId).toBe('b');
		expect(by.champion).toBeUndefined(); // no final yet
		expect(allPlayRecords(small).get('a')).toEqual({ wins: 5, losses: 1, ties: 0 });
		expect(by['best-allplay'].value).toBe('5–1 against everyone');
	});
	it('closes on the champion once there is one, and anyone can change it', () => {
		const done = { ...small, championId: 'b' };
		const awards = leagueAwards(done, 'season', undefined, { champion: 'a' });
		expect(awards.at(-1)).toMatchObject({ id: 'champion', teamId: 'a', pickedId: 'b', value: '2026 champions · 2–0 record' });
	});
});

describe('league story', () => {
	it('is a title, one card per award and the end card, within the bed', () => {
		const awards = leagueAwards({ ...mfl }, 'season', undefined);
		const scenes = leagueStory(mfl, awards, 'trophy', 'season', undefined, false);
		expect(scenes[0]).toMatchObject({ type: 'title', headline: ['2025', 'RECAP'], noCrest: true });
		expect(scenes.filter((s) => s.type === 'award')).toHaveLength(awards.length);
		expect(scenes.at(-1)?.type).toBe('end');
		expect(storyDuration(scenes)).toBeLessThanOrEqual(MAX_STORY_SECONDS + 1e-9);
		const champ = scenes.find((s) => s.type === 'award' && s.kicker.endsWith('Champion'));
		expect(champ && 'effect' in champ && champ.effect).toBeTruthy();
	});
	it('names a week recap after its week', () => {
		const scenes = leagueStory(small, leagueAwards(small, 'week', 2), 'bling', 'week', 2, true);
		expect(scenes[0]).toMatchObject({ headline: ['WEEK 2', 'RECAP'] });
		expect(JSON.stringify(scenes)).toContain('"name":"Bravo"');
	});
});

describe('Sleeper and ESPN league facts', () => {
	it('reads Sleeper divisions, games and the champion', () => {
		const lf = sleeperLeagueFacts({
			league: { name: 'Sweats', season: '2025', settings: { playoff_week_start: 3, divisions: 2 }, metadata: { division_1: 'North', division_2: 'South' } },
			rosters: [
				{ roster_id: 1, owner_id: 'u1', settings: { wins: 2, losses: 0, fpts: 200, division: 1 } },
				{ roster_id: 2, owner_id: 'u2', settings: { wins: 0, losses: 2, fpts: 150, division: 2 } },
			],
			users: [{ user_id: 'u1', display_name: 'one' }, { user_id: 'u2', display_name: 'two' }],
			bracket: [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2, p: 1 }],
			matchups: new Map([
				[1, [{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 80 }]],
				[3, [{ roster_id: 1, matchup_id: 1, points: 90 }, { roster_id: 2, matchup_id: 1, points: 70 }]],
			]) as never,
		});
		expect(lf.teams.map((t) => t.group)).toEqual(['North', 'South']);
		expect(lf.games).toEqual([{ week: 1, a: '1', aScore: 100, b: '2', bScore: 80 }]);
		expect(lf.championId).toBe('1');
	});
	it('reads ESPN divisions, games and the champion', () => {
		const lf = espnLeagueFacts({
			seasonId: 2025,
			settings: { name: 'ESPN Lg', scheduleSettings: { matchupPeriodCount: 1, divisions: [{ id: 0, name: 'East' }, { id: 1, name: 'West' }] } },
			teams: [
				{ id: 1, name: 'One', divisionId: 0, playoffSeed: 1, record: { overall: { wins: 1, losses: 0, pointsFor: 100 } } },
				{ id: 2, name: 'Two', divisionId: 1, playoffSeed: 2, record: { overall: { wins: 0, losses: 1, pointsFor: 90 } } },
			],
			schedule: [
				{ matchupPeriodId: 1, home: { teamId: 1, totalPoints: 100 }, away: { teamId: 2, totalPoints: 90 }, playoffTierType: 'NONE' },
				{ matchupPeriodId: 2, home: { teamId: 2, totalPoints: 110 }, away: { teamId: 1, totalPoints: 95 }, playoffTierType: 'WINNERS_BRACKET', winner: 'HOME' },
			],
		});
		expect(lf.teams.map((t) => t.group)).toEqual(['East', 'West']);
		expect(lf.games).toHaveLength(1);
		expect(lf.championId).toBe('2');
	});
});
