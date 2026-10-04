import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	championFromBracket,
	championFromStandings,
	finalFromBracket,
	isMflHost,
	mflErrorText,
	parseFranchises,
	parseLeagueName,
	parseSeasonChain,
	pickChampionshipBracketId,
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
 *  - archies-2025-standings-top5: a league with no brackets at all.
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

describe('standings fallback', () => {
	it('takes MFL’s own first and second place, unsorted', () => {
		const season = championFromStandings(2025, fixture('archies-2025-standings-top5'), new Map());
		expect(season.method).toBe('standings');
		expect(season.champion?.id).toBe(fixture('archies-2025-standings-top5').leagueStandings.franchise[0].id);
	});
});

describe('crawlMflSeason', () => {
	const ref = { year: 2025, leagueId: '10105', host: 'www44.myfantasyleague.com' };
	const noBrackets = async (req: ExportRequest) => {
		if (req.type === 'league') return { league: { franchises: { franchise: [] } } };
		if (req.type === 'playoffBrackets') return { playoffBrackets: {} };
		if (req.type === 'leagueStandings') return fixture('archies-2025-standings-top5');
		throw new Error(`unexpected ${req.type}`);
	};

	it('decides a finished no-bracket season by standings', async () => {
		expect((await crawlMflSeason(ref, noBrackets, 2026)).result.method).toBe('standings');
	});

	it('never names a champion from standings while the season is being played', async () => {
		const { result } = await crawlMflSeason({ ...ref, year: 2026 }, noBrackets, 2026);
		expect(result.method).toBe('unknown');
		expect(result.note).toMatch(/still being played/);
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
	const s = (year: number, champ: string, ru: string): SeasonChampion => ({
		year,
		method: 'bracket',
		champion: { id: champ, name: `old ${champ}` },
		runnerUp: { id: ru, name: `old ${ru}` },
	});

	it('counts titles per franchise id, most first, using today’s names', () => {
		const tally = tallyChampions([s(2020, 'A', 'B'), s(2021, 'B', 'A'), s(2022, 'B', 'C')], new Map([['B', 'New B']]));
		expect(tally.map((t) => [t.franchiseId, t.titles.length])).toEqual([
			['B', 2],
			['A', 1],
			['C', 0],
		]);
		expect(tally[0].name).toBe('New B');
		expect(tally[1].name).toBe('old A');
		// A title won under an earlier name says so; one under today's name does not.
		expect(tally[0].titledAs).toEqual({ 2021: 'old B', 2022: 'old B' });
		expect(tally[1].titledAs).toEqual({});
	});
});
