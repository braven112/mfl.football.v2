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
import { mflAssetLabel, mflMoves, mflTradePlayerIds, sleeperMoves } from '../src/utils/season-video/moves';
import { busiest, weekTrades } from '../src/utils/season-video/league-recap';

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
		expect(mfl.playoffsStarted).toBe(true);
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
		const scenes = leagueStory(mfl, awards, 'trophy', 'season', undefined, 'final');
		expect(scenes[0]).toMatchObject({ type: 'title', headline: ['2025', 'RECAP'], noCrest: true });
		expect(scenes.filter((s) => s.type === 'award')).toHaveLength(awards.length);
		expect(scenes.at(-1)?.type).toBe('end');
		expect(storyDuration(scenes)).toBeLessThanOrEqual(MAX_STORY_SECONDS + 1e-9);
		const champ = scenes.find((s) => s.type === 'award' && s.kicker.endsWith('Champion'));
		expect(champ && 'effect' in champ && champ.effect).toBeTruthy();
	});
	it('mid-season and the regular season name no champion', () => {
		const awards = leagueAwards({ ...mfl }, 'season', undefined);
		const regular = leagueStory(mfl, awards, 'trophy', 'season', undefined, 'regular');
		expect(regular[0]).toMatchObject({ headline: ['REGULAR', 'SEASON'] });
		expect(regular.some((s) => s.type === 'award' && s.kicker.endsWith('Champion'))).toBe(false);
		const mid = leagueStory(mfl, awards, 'trophy', 'season', undefined, 'mid');
		expect(mid[0]).toMatchObject({ headline: ['SEASON', 'SO FAR'] });
		expect(mid.some((s) => s.type === 'award' && s.kicker.endsWith('Champion'))).toBe(false);
	});
	it('names a week recap after its week', () => {
		const scenes = leagueStory(small, leagueAwards(small, 'week', 2), 'bling', 'week', 2, 'mid');
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
		expect(lf.playoffsStarted).toBe(true);
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
		expect(lf.playoffsStarted).toBe(true);
	});
});

describe('trades and waiver/free agent moves', () => {
	const tx = read('transactions.json');
	const moves = mflMoves(tx, 2025, (id) => `Player ${id}`)!;
	it('counts the MFL year: every trade, and its waiver and free agent pickups (auctions are not counted)', () => {
		expect(moves.tradeCount).toBe(18);
		expect(moves.waiverMoves).toBe(188 + 45);
		expect(busiest(moves, 'trades')?.count).toBeGreaterThan(1);
		expect(mflTradePlayerIds(tx)).toContain('13630');
	});
	it('gives each side what the other gave up, in the NFL week it was made', () => {
		// 2025-11-15: 0005 sent a 2026 3rd for 0011's player 13630.
		const t = moves.trades!.find((x) => x.sides[0].teamId === '0005' && x.sides[1].teamId === '0011')!;
		expect(t.week).toBe(11);
		expect(t.sides).toEqual([
			{ teamId: '0005', gets: ['Player 13630'] },
			{ teamId: '0011', gets: ['2026 3rd-round pick'] },
		]);
		// Offseason trades belong to no week's recap.
		expect(moves.trades!.filter((x) => x.week === 0).length).toBeGreaterThan(0);
	});
	it('spells out picks and blind-bid dollars', () => {
		expect(mflAssetLabel('DP_0_11', 2025, () => null)).toBe('2025 pick 1.12');
		expect(mflAssetLabel('FP_0009_2026_1', 2025, () => null)).toBe('2026 1st-round pick');
		expect(mflAssetLabel('BB_12.5', 2025, () => null)).toBe('$12.50 in blind-bid dollars');
		expect(mflAssetLabel('ZZ', 2025, () => null)).toBeNull();
	});
	it('reads Sleeper trades, picks and FAAB; only completed moves count', () => {
		const m = sleeperMoves(
			[
				{ type: 'trade', status: 'complete', leg: 2, roster_ids: [1, 2], adds: { '4046': 1, '6794': 2 }, draft_picks: [{ season: '2026', round: 2, owner_id: 2, previous_owner_id: 1 }], waiver_budget: [{ sender: 2, receiver: 1, amount: 10 }] },
				{ type: 'waiver', status: 'complete', leg: 2, roster_ids: [1] },
				{ type: 'free_agent', status: 'complete', leg: 3, roster_ids: [2] },
				{ type: 'free_agent', status: 'failed', leg: 3, roster_ids: [2] },
			],
			(id) => ({ '4046': 'Jalen Hurts' })[id] ?? null,
		);
		expect(m.tradeCount).toBe(1);
		expect(m.waiverMoves).toBe(2);
		expect(m.trades![0]).toEqual({ week: 2, sides: [{ teamId: '1', gets: ['Jalen Hurts', '$10 in FAAB'] }, { teamId: '2', gets: ['A player', '2026 2nd-round pick'] }] });
	});
	it('reads ESPN counts only: each trade is on both teams', () => {
		const lf = espnLeagueFacts({ seasonId: 2025, teams: [{ id: 1, transactionCounter: { trades: 2, acquisitions: 30 } }, { id: 2, transactionCounter: { trades: 2, acquisitions: 12 } }] });
		expect(lf.moves).toMatchObject({ trades: null, tradeCount: 2, waiverMoves: 42 });
		expect(espnLeagueFacts({ seasonId: 2025, teams: [{ id: 1 }] }).moves).toBeNull();
	});
});

describe('trades in the league story', () => {
	const withTrades = {
		...small,
		moves: {
			trades: [
				{ week: 2, sides: [{ teamId: 'a', gets: ['Q One'] }, { teamId: 'b', gets: ['2027 1st-round pick'] }] },
				{ week: 1, sides: [{ teamId: 'c', gets: ['T Two'] }, { teamId: 'd', gets: [] }] },
			],
			tradeCount: 2,
			waiverMoves: 9,
			byTeam: { a: { trades: 1, moves: 6 }, b: { trades: 1, moves: 3 } },
		},
	};
	it('shows that week\'s trades just before the low score', () => {
		expect(weekTrades(withTrades, undefined)).toHaveLength(1);
		const scenes = leagueStory(withTrades, leagueAwards(withTrades, 'week', 2), 'bling', 'week', 2, 'mid');
		const i = scenes.findIndex((s) => s.type === 'trade');
		expect(scenes[i]).toMatchObject({ kicker: 'Week 2 · Trade', sides: [{ name: 'Alpha', gets: ['Q One'] }, { name: 'Bravo' }] });
		expect(scenes[i + 1]).toMatchObject({ type: 'award', kicker: 'Week 2 · Low score' });
	});
	it('fits a week with a pile of trades inside the bed and says how many there were', () => {
		const many = { ...withTrades, moves: { ...withTrades.moves, trades: Array.from({ length: 20 }, () => withTrades.moves.trades[0]) } };
		const scenes = leagueStory(many, leagueAwards(many, 'week', 2), 'bling', 'week', 2, 'mid');
		expect(storyDuration(scenes)).toBeLessThanOrEqual(MAX_STORY_SECONDS + 1e-9);
		expect(scenes.find((s) => s.type === 'trade')?.kicker).toBe('Week 2 · Trade 1 of 20');
	});
	it('counts the season\'s moves just before the champion', () => {
		const done = { ...withTrades, championId: 'a' };
		const scenes = leagueStory(done, leagueAwards(done, 'season', undefined), 'trophy', 'season', undefined, 'final');
		const i = scenes.findIndex((s) => s.type === 'tally');
		expect(scenes[i]).toMatchObject({ tiles: [{ value: 2, label: 'Trades' }, { value: 9 }], line: 'Most trades: Alpha (1). Most pickups: Alpha (6).' });
		expect(scenes[i + 1]).toMatchObject({ type: 'award', kicker: '2026 · Champion' });
		expect(scenes.some((s) => s.type === 'trade')).toBe(false);
		expect(storyDuration(scenes)).toBeLessThanOrEqual(MAX_STORY_SECONDS + 1e-9);
	});
});
