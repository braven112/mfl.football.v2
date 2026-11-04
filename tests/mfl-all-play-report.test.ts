import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { computeAllPlayReport, formatLuck, formatPct } from '../src/utils/mfl-all-play-report';
import { loadAllPlay, parseLeagueIdInput } from '../src/utils/mfl-all-play-load';
import { exportUrl, type ExportRequest } from '../src/utils/league-history/mfl-crawl';

/**
 * The free all-play tool (/mfl-all-play-standings). Its numbers are published
 * about other people's leagues, so the record it prints must be MFL's own
 * record, and a week still being played must never move the table.
 */
const feed = (league: string, file: string) =>
	JSON.parse(readFileSync(path.resolve(__dirname, '..', 'data', league, 'mfl-feeds', '2025', file), 'utf8'));

const side = (id: string, score: number, result?: string) => ({ id, score: String(score), ...(result ? { result } : {}) });
const game = (a: ReturnType<typeof side>, b: ReturnType<typeof side>, regularSeason = '1') => ({ regularSeason, franchise: [a, b] });

describe('computeAllPlayReport', () => {
	it.each(['theleague', 'afl-fantasy'])('%s 2025: every real record equals MFL’s own h2h record', (league) => {
		const report = computeAllPlayReport(feed(league, 'weekly-results-raw.json'), {});
		const standings = feed(league, 'standings.json').leagueStandings.franchise as Array<{ id: string; h2hwlt: string }>;
		expect(report.rows.length).toBe(standings.length);
		for (const row of report.rows) {
			const mfl = standings.find((s) => s.id === row.id)!.h2hwlt.replace(/-0$/, '');
			expect(row.record, row.id).toBe(mfl);
		}
	});

	it('skips a week whose games are not final, and playoff games', () => {
		const body = {
			allWeeklyResults: {
				weeklyResults: [
					{ week: '1', matchup: [game(side('A', 100, 'W'), side('B', 90, 'L')), game(side('C', 80, 'W'), side('D', 70, 'L'))] },
					{ week: '2', matchup: [game(side('A', 10), side('B', 99)), game(side('C', 50), side('D', 40))] },
					{ week: '15', matchup: [game(side('A', 120, 'W'), side('C', 60, 'L'), '0')] },
				],
			},
		};
		const report = computeAllPlayReport(body, { A: 'Alpha' });
		expect(report.weeks).toEqual([1]);
		const a = report.rows.find((r) => r.id === 'A')!;
		expect(a.name).toBe('Alpha');
		expect(a.record).toBe('1-0');
		expect(a.allPlayRecord).toBe('3-0');
		expect(a.pointsFor).toBe(100);
		expect(report.rows.map((r) => r.id)).toEqual(['A', 'B', 'C', 'D']);
	});

	it('counts a doubleheader as two games but its points once', () => {
		const body = {
			allWeeklyResults: {
				weeklyResults: [
					{ week: '1', matchup: [game(side('A', 100, 'W'), side('B', 90, 'L')), game(side('A', 100, 'W'), side('C', 80, 'L'))] },
				],
			},
		};
		const a = computeAllPlayReport(body, {}).rows.find((r) => r.id === 'A')!;
		expect(a.record).toBe('2-0');
		expect(a.pointsFor).toBe(100);
		expect(a.allPlayRecord).toBe('2-0');
	});

	it('luck is real wins minus all-play-expected wins', () => {
		// B loses to A (the top score) but beats C and D on all-play: unlucky.
		const body = {
			allWeeklyResults: {
				weeklyResults: [
					{ week: '1', matchup: [game(side('A', 100, 'W'), side('B', 90, 'L')), game(side('C', 50, 'W'), side('D', 40, 'L'))] },
				],
			},
		};
		const rows = computeAllPlayReport(body, {}).rows;
		const by = (id: string) => rows.find((r) => r.id === id)!;
		expect(by('B').luck).toBeCloseTo(0 - 2 / 3);
		expect(by('C').luck).toBeCloseTo(1 - 1 / 3);
		expect(formatLuck(by('B').luck)).toBe('−0.7');
		expect(formatPct(2 / 3)).toBe('.667');
	});
});

describe('parseLeagueIdInput', () => {
	it('takes a bare id or a pasted league address, and nothing else', () => {
		expect(parseLeagueIdInput(' 13522 ')).toBe('13522');
		expect(parseLeagueIdInput('https://www49.myfantasyleague.com/2026/home/13522#0')).toBe('13522');
		expect(parseLeagueIdInput('13522&TYPE=rosters')).toBeNull();
		expect(parseLeagueIdInput('abc')).toBeNull();
		expect(parseLeagueIdInput(null)).toBeNull();
	});
});

describe('weeklyResults export', () => {
	it('asks MFL for every week so far', () => {
		expect(exportUrl({ host: 'www49.myfantasyleague.com', year: 2025, type: 'weeklyResults', leagueId: '13522' })).toBe(
			'https://www49.myfantasyleague.com/2025/export?TYPE=weeklyResults&L=13522&JSON=1&W=YTD',
		);
	});
});

describe('loadAllPlay', () => {
	it('reaches an older season through the league’s own history chain, never today’s id', async () => {
		const calls: ExportRequest[] = [];
		const fetchExport = async (req: ExportRequest) => {
			calls.push(req);
			if (req.type === 'league' && req.host === 'api.myfantasyleague.com') {
				return {
					league: {
						id: '22222',
						name: 'Test League',
						baseURL: 'https://www44.myfantasyleague.com',
						history: { league: [{ year: '2024', url: 'https://www40.myfantasyleague.com/2024/home/11111' }] },
						franchises: { franchise: [] },
					},
				};
			}
			if (req.type === 'league') return { league: { name: 'Test League', franchises: { franchise: [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Beta' }] } } };
			return { allWeeklyResults: { weeklyResults: [{ week: '1', matchup: game(side('A', 10, 'W'), side('B', 5, 'L')) }] } };
		};
		const report = await loadAllPlay('22222', 2024, 2026, fetchExport);
		const seasonCalls = calls.filter((c) => c.host !== 'api.myfantasyleague.com');
		expect(seasonCalls.every((c) => c.leagueId === '11111' && c.host === 'www40.myfantasyleague.com')).toBe(true);
		expect(report.rows[0].name).toBe('Alpha');
		expect(report.leagueName).toBe('Test League');
	});
});
