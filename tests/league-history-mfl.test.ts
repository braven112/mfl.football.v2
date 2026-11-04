import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	championFromBracket,
	cleanMflName,
	finalFromBracket,
	finalFromGames,
	isMflHost,
	laterBrackets,
	mflErrorText,
	parseFranchises,
	parseLeagueName,
	parseSeasonChain,
	pickChampionshipBracketId,
	rankChampionshipBrackets,
	tallyChampions,
	type SeasonChampion,
} from '../src/utils/league-history/mfl-champions';
import { crawlMflSeason, exportUrl, planMflLeague, type ExportRequest } from '../src/utils/league-history/mfl-crawl';

/**
 * League History — reading any MFL league's champions
 * (src/utils/league-history/, docs/plans/league-history-free-page.md).
 *
 * The fixtures are REAL MFL responses (tests/fixtures/league-history/),
 * chosen because each one broke a first draft of the rules:
 *  - theleague-2026-league: the season chain, where the league id changed
 *    nine times before settling.
 *  - afl-2024-brackets: AL and NL "Championship" brackets feed the AFL
 *    Championship; the widest championship bracket is a conference's.
 *  - afl-2016-brackets: a 16-team "NIT Championship" finishes after the
 *    real title game; the latest-finishing championship is the NIT's.
 *  - theleague-2026-bracket-1-unplayed: a final with no teams yet.
 * Added after a live run over other public leagues (2026-11-04):
 *  - two-conference-2016-brackets: bracket 1 is "Conf 1"; the title is a
 *    two-team "Superb Owl" fed by both conferences.
 *  - conference-2025-brackets: bracket 1 is a conference bracket TITLED
 *    "Mountain div. champ"; the title is "TWD League Championship".
 *  - conference-2020-brackets: an 8-team "War Games League Championship" the
 *    league set up and never played finishes after the real final.
 *  - placeholder-seed-final: an unplayed final MFL fills with `SEED1` and
 *    blank points, once read as a tie.
 *  - division-names-2011-*: bracket 1 ("NOLL") is a division's; its winner
 *    plays on in the later two-team "FANTASY BOWL", the title.
 *  - seeds-only-<year>-bracket-1 + -weekly: a league whose every bracket
 *    exports seeds only; the champion is read from the recorded games (2022
 *    has a tied semifinal).
 * Live, the crawler matched both hand-checked champion files: TheLeague
 * 19/19 seasons and the AFL 22/22 (2026-10-04).
 */

const FIX = join(__dirname, 'fixtures', 'league-history');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIX, `${name}.json`), 'utf8'));

describe('parseSeasonChain', () => {
	const chain = parseSeasonChain(fixture('theleague-2026-league'), 2026);

	it('lists every season oldest first, each with its own id and host', () => {
		expect(chain[0]).toEqual({ year: 2007, leagueId: '76273', host: 'www42.myfantasyleague.com' });
		expect(chain.find((s) => s.year === 2015)?.leagueId).toBe('28077');
		expect(chain.find((s) => s.year === 2016)?.leagueId).toBe('13522');
		expect(chain.map((s) => s.year)).toEqual([...chain.map((s) => s.year)].sort((a, b) => a - b));
	});

	it('includes the export year even when history does not list it', () => {
		expect(chain.at(-1)?.year).toBe(2026);
	});

	it('drops rows whose url is not an MFL league home', () => {
		const forged = {
			league: {
				id: '12345',
				baseURL: 'https://www44.myfantasyleague.com',
				history: {
					league: [
						{ year: '2020', url: 'https://evil.example.com/2020/home/12345' },
						{ year: '2021', url: 'https://www44.myfantasyleague.com/2021/home/12345' },
						{ year: '2019', url: 'https://www44.myfantasyleague.com/2022/home/12345' },
					],
				},
			},
		};
		expect(parseSeasonChain(forged, 2022).map((s) => s.year)).toEqual([2021, 2022]);
	});
});

describe('league export helpers', () => {
	it('reads the name and the franchises', () => {
		const league = fixture('theleague-2026-league');
		expect(parseLeagueName(league)).toBe('The League');
		expect(parseFranchises(league).size).toBe(16);
	});

	it('treats MFL errors-as-200 as errors', () => {
		expect(mflErrorText({ error: { $t: 'Invalid league ID' } })).toBe('Invalid league ID');
		expect(mflErrorText({ league: {} })).toBeNull();
		expect(mflErrorText(null)).toBe('empty response');
	});

	it('only accepts MFL hosts', () => {
		expect(isMflHost('www49.myfantasyleague.com')).toBe(true);
		expect(isMflHost('api.myfantasyleague.com')).toBe(true);
		expect(isMflHost('www49.myfantasyleague.com.evil.com')).toBe(false);
		expect(isMflHost('example.com')).toBe(false);
	});
});

describe('pickChampionshipBracketId', () => {
	it("TheLeague: bracket 1, not the toilet bowl", () => {
		expect(pickChampionshipBracketId(fixture('theleague-2024-brackets'))).toBe('1');
	});

	it('AFL 2024: the AFL Championship, not the wider AL/NL conference brackets', () => {
		expect(pickChampionshipBracketId(fixture('afl-2024-brackets'))).toBe('1');
	});

	it('AFL 2016: the AFL Championship, not the later-finishing NIT Championship', () => {
		expect(pickChampionshipBracketId(fixture('afl-2016-brackets'))).toBe('1');
	});

	it('when bracket 1 is not a championship, the latest-finishing championship wins', () => {
		const brackets = {
			playoffBrackets: {
				playoffBracket: [
					{ id: '1', name: 'Toilet Bowl', bracketWinnerTitle: 'Last place', startWeek: '15', teamsInvolved: '4' },
					{ id: '2', name: 'Division Title', bracketWinnerTitle: 'Division Champion', startWeek: '14', teamsInvolved: '4' },
					{ id: '3', name: 'League Final', bracketWinnerTitle: 'League Champion', startWeek: '16', teamsInvolved: '2' },
				],
			},
		};
		expect(pickChampionshipBracketId(brackets)).toBe('3');
	});

	it('returns null when there are no brackets', () => {
		expect(pickChampionshipBracketId({ playoffBrackets: {} })).toBeNull();
	});
});

describe('the final', () => {
	const franchises = parseFranchises(fixture('theleague-2026-league'));

	it('TheLeague 2024: 0009 beat 0002 in the final', () => {
		expect(finalFromBracket(fixture('theleague-2024-bracket-1'))).toEqual({ winnerId: '0009', loserId: '0002' });
		const season = championFromBracket(2024, fixture('theleague-2024-bracket-1'), franchises);
		expect(season.method).toBe('bracket');
		expect(season.champion?.id).toBe('0009');
		expect(season.runnerUp?.id).toBe('0002');
	});

	it('an unplayed final is unknown, never guessed', () => {
		const season = championFromBracket(2026, fixture('theleague-2026-bracket-1-unplayed'), franchises);
		expect(season.method).toBe('unknown');
		expect(season.champion).toBeNull();
		expect(season.note).toMatch(/not been set/);
	});

	it('a tied final is unknown', () => {
		const tied = {
			playoffBracket: {
				playoffRound: [
					{ week: '17', playoffGame: { home: { franchise_id: '0001', points: '100' }, away: { franchise_id: '0002', points: '100' } } },
				],
			},
		};
		expect(finalFromBracket(tied)).toEqual({ reason: 'the final is recorded as a tie' });
	});
});

describe('crawlMflSeason', () => {
	const ref = { year: 2025, leagueId: '10105', host: 'www44.myfantasyleague.com' };

	it('never guesses a season with no playoff brackets: it is unknown, standings are not read', async () => {
		// Archie's runs its own playoff structure, so first place is not assumed
		// to be the champion; the admin sets those seasons.
		const asked: string[] = [];
		const { result, franchises } = await crawlMflSeason(ref, async (req) => {
			asked.push(req.type);
			if (req.type === 'league') return { league: { franchises: { franchise: [{ id: '0001', name: 'Croc' }] } } };
			if (req.type === 'playoffBrackets') return { playoffBrackets: {} };
			throw new Error(`unexpected ${req.type}`);
		});
		expect(result).toMatchObject({ method: 'unknown', champion: null, note: 'MFL has no playoff bracket for this season' });
		expect(asked).toEqual(['league', 'playoffBrackets']);
		expect(franchises).toEqual([{ id: '0001', name: 'Croc' }]);
	});
});

describe('planMflLeague', () => {
	it('falls back to the previous year when this year has no league yet', async () => {
		const seen: number[] = [];
		const plan = await planMflLeague('13522', 2027, async (req) => {
			seen.push(req.year);
			return req.year === 2027 ? { error: { $t: 'Invalid league ID' } } : fixture('theleague-2026-league');
		});
		expect(seen).toEqual([2027, 2026]);
		expect(plan.name).toBe('The League');
		expect(plan.seasons.length).toBeGreaterThan(15);
	});
});

describe('exportUrl', () => {
	it('builds only MFL urls from validated parts', () => {
		expect(exportUrl({ host: 'www49.myfantasyleague.com', year: 2024, type: 'playoffBracket', leagueId: '13522', bracketId: '1' })).toBe(
			'https://www49.myfantasyleague.com/2024/export?TYPE=playoffBracket&L=13522&JSON=1&BRACKET_ID=1',
		);
		expect(() => exportUrl({ host: 'evil.com', year: 2024, type: 'league', leagueId: '13522' })).toThrow();
		expect(() => exportUrl({ host: 'api.myfantasyleague.com', year: 2024, type: 'league', leagueId: '13522&X=1' })).toThrow();
		expect(() =>
			exportUrl({ host: 'api.myfantasyleague.com', year: 2024, type: 'rosters' as never, leagueId: '13522' }),
		).toThrow();
	});
});

describe('tallyChampions', () => {
	const s = (year: number, champ: string, ru: string, champId = champ, ruId = ru): SeasonChampion => ({
		year,
		method: 'bracket',
		champion: { id: champId, name: champ },
		runnerUp: { id: ruId, name: ru },
	});

	it('groups titles by the name they were won under, most first', () => {
		const tally = tallyChampions([s(2020, 'Croc', 'Ducks'), s(2021, 'Ducks', 'Croc'), s(2022, 'Ducks', 'Kings')]);
		expect(tally.map((t) => [t.name, t.titles])).toEqual([
			['Ducks', [2021, 2022]],
			['Croc', [2020]],
			['Kings', []],
		]);
	});

	it('never merges two names, even when MFL kept the same team slot', () => {
		// Slot 0001 won as Croc, then as Barracudas: possibly a new owner, so two entries.
		const tally = tallyChampions([s(2024, 'Croc', 'Ducks', '0001'), s(2025, 'Barracudas', 'Ducks', '0001')]);
		expect(tally.filter((t) => t.titles.length).map((t) => t.name).sort()).toEqual(['Barracudas', 'Croc']);
	});
});

describe('rankChampionshipBrackets — brackets for part of the league', () => {
	it('two conferences feeding a final: the final, not bracket 1 ("Conf 1")', () => {
		expect(pickChampionshipBracketId(fixture('two-conference-2016-brackets'))).toBe('3');
	});

	it('bracket 1 titled as a division champion does not beat the league championship', () => {
		expect(pickChampionshipBracketId(fixture('conference-2025-brackets'))).toBe('5');
	});

	it('an unplayed later bracket ranks first, and the real final is next in line', () => {
		const ranked = rankChampionshipBrackets(fixture('conference-2020-brackets'));
		expect(ranked[0]).toBe('12');
		expect(ranked.indexOf('5')).toBeGreaterThan(-1);
		// Conference, division and "Pride" (consolation) brackets are not candidates.
		for (const id of ['1', '2', '3', '4', '6', '7', '8', '9', '10']) expect(ranked).not.toContain(id);
	});

	it('when every bracket is a conference one, they are still ranked', () => {
		const onlyConferences = {
			playoffBrackets: {
				playoffBracket: [
					{ id: '1', name: 'AFC Playoffs', startWeek: '14', teamsInvolved: '4' },
					{ id: '2', name: 'NFC Playoffs', startWeek: '14', teamsInvolved: '4' },
				],
			},
		};
		expect(rankChampionshipBrackets(onlyConferences)).toEqual(['1', '2']);
	});

	it('keeps the earlier rulings for TheLeague and the AFL', () => {
		expect(pickChampionshipBracketId(fixture('theleague-2024-brackets'))).toBe('1');
		expect(pickChampionshipBracketId(fixture('afl-2024-brackets'))).toBe('1');
		expect(pickChampionshipBracketId(fixture('afl-2016-brackets'))).toBe('1');
	});
});

describe('finalFromBracket — placeholders', () => {
	it('a SEED1-vs-SEED2 final with blank points is unset, never a tie', () => {
		expect(finalFromBracket(fixture('placeholder-seed-final'))).toEqual({
			reason: 'the final has not been set yet',
			unresolved: true,
		});
	});
});

describe('finalFromGames — a seeds-only bracket read from the recorded games', () => {
	it('walks the bracket down from the one final-week game', () => {
		// Week 17: 0012 108, 0007 42; both semis and 0012's quarterfinal check out.
		expect(finalFromGames(fixture('seeds-only-2024-bracket-1'), fixture('seeds-only-2024-weekly'))).toEqual({
			winnerId: '0012',
			loserId: '0007',
		});
	});

	it('a tied semifinal is settled by who played on', () => {
		// Week 16: 0006 107, 0005 107; 0005 played (and won) the final.
		expect(finalFromGames(fixture('seeds-only-2022-bracket-1'), fixture('seeds-only-2022-weekly'))).toEqual({
			winnerId: '0005',
			loserId: '0009',
		});
	});

	it('is unknown when the games do not complete the bracket', () => {
		const noPlayoffGames = { allWeeklyResults: { weeklyResults: [{ week: '17', matchup: [] }] } };
		expect(finalFromGames(fixture('seeds-only-2024-bracket-1'), noPlayoffGames)).toHaveProperty('reason');
	});

	it('is unknown when two different finals fit (a same-shaped consolation bracket)', () => {
		const bracket = {
			playoffBracket: {
				playoffRound: [
					{ week: '16', playoffGame: [{ game_id: '1', home: { seed: '1' }, away: { seed: '4' } }, { game_id: '2', home: { seed: '2' }, away: { seed: '3' } }] },
					{ week: '17', playoffGame: { game_id: '3', home: { winner_of_game: '1' }, away: { winner_of_game: '2' } } },
				],
			},
		};
		const g = (a: string, sa: string, b: string, sb: string) => ({ franchise: [{ id: a, score: sa }, { id: b, score: sb }] });
		const weekly = {
			allWeeklyResults: {
				weeklyResults: [
					{ week: '16', matchup: [g('0001', '100', '0004', '90'), g('0002', '100', '0003', '90'), g('0005', '100', '0008', '90'), g('0006', '100', '0007', '90')] },
					{ week: '17', matchup: [g('0001', '120', '0002', '110'), g('0005', '120', '0006', '110')] },
				],
			},
		};
		expect(finalFromGames(bracket, weekly)).toEqual({ reason: 'more than one game fits the final' });
	});
});

describe('crawlMflSeason — a finished season', () => {
	const ref = { year: 2024, leagueId: '12345', host: 'www44.myfantasyleague.com' };
	const league = { league: { franchises: { franchise: [{ id: '0012', name: 'Winners' }, { id: '0007', name: 'Losers' }] } } };
	const brackets = { playoffBrackets: { playoffBracket: { id: '1', name: 'playoffs', bracketWinnerTitle: 'Champ', startWeek: '15', teamsInvolved: '6' } } };

	it('reads a seeds-only final from the games', async () => {
		const asked: string[] = [];
		const { result } = await crawlMflSeason(
			ref,
			async (req) => {
				asked.push(req.type);
				if (req.type === 'league') return league;
				if (req.type === 'playoffBrackets') return brackets;
				if (req.type === 'playoffBracket') return fixture('seeds-only-2024-bracket-1');
				return fixture('seeds-only-2024-weekly');
			},
			{ finished: true },
		);
		expect(result).toMatchObject({ method: 'bracket', champion: { id: '0012', name: 'Winners' }, runnerUp: { id: '0007' } });
		expect(asked).toEqual(['league', 'playoffBrackets', 'playoffBracket', 'weeklyResults']);
	});

	it('a season still being played never reads the games', async () => {
		const asked: string[] = [];
		const { result } = await crawlMflSeason(ref, async (req) => {
			asked.push(req.type);
			if (req.type === 'league') return league;
			if (req.type === 'playoffBrackets') return brackets;
			if (req.type === 'playoffBracket') return fixture('seeds-only-2024-bracket-1');
			throw new Error(`unexpected ${req.type}`);
		});
		expect(result.method).toBe('unknown');
		expect(asked).not.toContain('weeklyResults');
	});

	it('moves to the next-ranked bracket when the first was never played', async () => {
		const asked: string[] = [];
		const { result } = await crawlMflSeason(
			ref,
			async (req) => {
				if (req.type === 'league') return league;
				if (req.type === 'playoffBrackets') return fixture('conference-2020-brackets');
				if (req.type === 'weeklyResults') return { allWeeklyResults: { weeklyResults: [] } };
				asked.push(req.bracketId!);
				if (req.bracketId === '12') return fixture('theleague-2026-bracket-1-unplayed');
				return {
					playoffBracket: {
						playoffRound: { week: '16', playoffGame: { home: { franchise_id: '0007', points: '137.2' }, away: { franchise_id: '0012', points: '153.8' } } },
					},
				};
			},
			{ finished: true },
		);
		expect(asked.slice(0, 2)).toEqual(['12', '5']);
		expect(result).toMatchObject({ method: 'bracket', champion: { id: '0012' }, runnerUp: { id: '0007' } });
	});
});

describe('cleanMflName', () => {
	it('drops the HTML MFL lets owners put in a team name', () => {
		expect(cleanMflName('<font color=0101DF>Fleece</font> <font color=FF4000>City</font>')).toBe('Fleece City');
		expect(cleanMflName('  Tom &amp; Jerry&#39;s  ')).toBe("Tom & Jerry's");
	});

	it('is what parseFranchises and parseLeagueName return', () => {
		const exp = { league: { name: '<b>Big</b> League', franchises: { franchise: [{ id: '0003', name: '<i>Fleece</i> City' }] } } };
		expect(parseLeagueName(exp)).toBe('Big League');
		expect(parseFranchises(exp).get('0003')).toBe('Fleece City');
	});
});

describe('crawlMflSeason — a bracket winner who plays on', () => {
	const ref = { year: 2011, leagueId: '12345', host: 'www45.myfantasyleague.com' };
	const league = { league: { franchises: { franchise: [{ id: '0008', name: 'Hitmen' }, { id: '0021', name: 'Massacre' }, { id: '0007', name: 'Pollocks' }] } } };

	const fetchWith = (bracket3: unknown) => async (req: ExportRequest) => {
		if (req.type === 'league') return league;
		if (req.type === 'playoffBrackets') return fixture('division-names-2011-brackets');
		if (req.type === 'playoffBracket') return req.bracketId === '3' ? bracket3 : fixture(`division-names-2011-bracket-${req.bracketId}`);
		return { allWeeklyResults: { weeklyResults: [] } };
	};

	it('a division bracket 1 with a plain name is followed to the later title game', async () => {
		expect(laterBrackets(fixture('division-names-2011-brackets'), '1')).toEqual(['3']);
		const { result } = await crawlMflSeason(ref, fetchWith(fixture('division-names-2011-bracket-3')), { finished: true });
		// Bracket 1 alone said 0008 over 0007; the FANTASY BOWL was 0008 over 0021.
		expect(result).toMatchObject({ method: 'bracket', champion: { id: '0008' }, runnerUp: { id: '0021' } });
	});

	it('is unknown while the later title game is unplayed, never the division winner', async () => {
		const unplayed = {
			playoffBracket: {
				playoffRound: { week: '16', playoffGame: { home: { franchise_id: '0021', points: '' }, away: { franchise_id: '0008', points: '' } } },
			},
		};
		const { result } = await crawlMflSeason(ref, fetchWith(unplayed));
		expect(result.method).toBe('unknown');
		expect(result.note).toMatch(/title bracket/);
	});
});
