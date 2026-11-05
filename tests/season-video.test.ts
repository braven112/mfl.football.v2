/**
 * Season video generator (/champion-video): the facts read from MFL and the
 * story built from them. Driven by TheLeague's recorded 2025 feeds, the
 * season the original Computer Jocks video was cut from, so the numbers
 * here are the ones that video showed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	formatRecord,
	fromMflExports,
	ordinal,
	pickVideoKind,
	roundLabel,
	type SeasonFacts,
} from '../src/utils/season-video/season';
import { buildStory, storyDuration } from '../src/utils/season-video/story';
import { exportPath, loadMflSeason } from '../src/utils/season-video/mfl-source';

const dir = path.resolve(__dirname, '../data/theleague/mfl-feeds/2025');
const read = (f: string) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
const league = read('league.json');
const standings = read('standings.json');
const brackets = read('playoff-brackets.json');
const schedule = read('schedule.json');

const season = (franchiseId: string) =>
	fromMflExports({
		leagueName: 'The League',
		season: 2025,
		franchiseId,
		league,
		standings,
		brackets: { playoffBrackets: brackets.playoffBrackets },
		championshipBracket: brackets.brackets['1'],
		schedule,
	});

describe('fromMflExports', () => {
	it('reads the champion: record, points, every playoff game and the title', () => {
		const r = season('0010')!;
		expect(r.complete).toBe(true);
		expect(r.facts.teamName).toBe('Computer Jocks');
		expect(formatRecord(r.facts)).toBe('13–5');
		expect(r.facts.outcome).toBe('champion');
		expect(r.facts.seed).toBe(6);
		expect(r.facts.playoffs.map((g) => [g.label, g.score, g.oppScore])).toEqual([
			['Quarterfinal', 125.6, 110.13],
			['Semifinal', 110.35, 81.69],
			['The Final', 132.29, 96.78],
		]);
		expect(r.facts.bestGame?.label).toMatch(/^Week \d+$/);
		expect(r.logoIds.team).toBe('0010');
	});

	it('reads the runner-up', () => {
		expect(season('0015')!.facts.outcome).toBe('runner-up');
	});

	it('names the last row of MFL standings last, without re-sorting', () => {
		const ids = standings.leagueStandings.franchise.map((f: { id: string }) => f.id);
		const r = season(ids[ids.length - 1])!;
		expect(r.facts.finish).toBe(ids.length);
		expect(r.facts.teams).toBe(ids.length);
		expect(r.facts.outcome).toBe('missed');
		expect(pickVideoKind(r.facts)).toBe('last');
	});

	it('is null for a franchise not in the standings', () => {
		expect(season('0099')).toBeNull();
	});

	it('marks a season incomplete while the final is unplayed', () => {
		const unplayed = JSON.parse(JSON.stringify(brackets.brackets['1']));
		const rounds = unplayed.playoffBracket.playoffRound;
		delete rounds[rounds.length - 1].playoffGame.home.points;
		const r = fromMflExports({
			leagueName: 'The League',
			season: 2025,
			franchiseId: '0010',
			league,
			standings,
			brackets: { playoffBrackets: brackets.playoffBrackets },
			championshipBracket: unplayed,
			schedule,
		})!;
		expect(r.complete).toBe(false);
		expect(r.facts.outcome).toBe('playoffs');
	});
});

describe('pickVideoKind', () => {
	it('champion, then last place, then the recap', () => {
		expect(pickVideoKind({ outcome: 'champion', finish: 12, teams: 12 })).toBe('champion');
		expect(pickVideoKind({ outcome: 'missed', finish: 12, teams: 12 })).toBe('last');
		expect(pickVideoKind({ outcome: 'runner-up', finish: 3, teams: 12 })).toBe('recap');
		expect(pickVideoKind({ outcome: 'missed', finish: null, teams: null })).toBe('recap');
	});
});

describe('helpers', () => {
	it('ordinals', () => {
		expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(ordinal)).toEqual([
			'1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '112th',
		]);
	});
	it('round labels count back from the final', () => {
		expect([0, 1, 2, 3].map((i) => roundLabel(i, 4))).toEqual(['Wild Card', 'Quarterfinal', 'Semifinal', 'The Final']);
	});
});

const base: SeasonFacts = {
	leagueName: 'The League',
	season: 2025,
	teamName: 'Computer Jocks',
	teamLogo: 'data:image/png;base64,x',
	wins: 13,
	losses: 5,
	ties: 0,
	pointsFor: 1871.4,
	finish: 4,
	teams: 16,
	seed: 6,
	outcome: 'champion',
	playoffs: [
		{ label: 'Quarterfinal', score: 125.6, oppName: 'Bring the Pain', oppScore: 110.13 },
		{ label: 'The Final', score: 132.29, oppName: 'Dark Magicians', oppScore: 96.78 },
	],
	bestGame: { label: 'Week 11', score: 166.14, oppName: 'Bring the Pain', oppScore: 76.46 },
};

describe('buildStory', () => {
	it('every video ends on the MFL Football end card', () => {
		for (const kind of ['champion', 'recap', 'last'] as const) {
			for (const theme of ['princess', 'poop'] as const) {
				const scenes = buildStory(base, { kind, theme });
				expect(scenes[scenes.length - 1].type).toBe('end');
			}
		}
	});

	it('the champion video plays every playoff game and crowns the team', () => {
		const scenes = buildStory(base, { kind: 'champion', theme: 'princess' });
		const types = scenes.map((s) => s.type);
		// The statement game, then the quarterfinal; the final is its own card.
		expect(scenes.filter((s) => s.type === 'game' && !s.bars)).toHaveLength(1);
		expect(scenes.filter((s) => s.type === 'game' && s.bars)).toHaveLength(1);
		expect(types).toContain('final');
		expect(types).toContain('crown');
	});

	it('the last-place video wears the chosen theme', () => {
		const princess = buildStory({ ...base, outcome: 'missed', finish: 16 }, { kind: 'last', theme: 'princess' });
		const poop = buildStory({ ...base, outcome: 'missed', finish: 16 }, { kind: 'last', theme: 'poop' });
		expect(princess[0].palette).not.toEqual(poop[0].palette);
		expect(princess.find((s) => s.type === 'crown')?.effect).toBe('sparkles');
		expect(poop.find((s) => s.type === 'crown')?.effect).toBe('poop');
	});

	it('fits the 50-second music bed even with a long playoff run', () => {
		const many = { ...base, playoffs: Array.from({ length: 6 }, (_, i) => ({ ...base.playoffs[0], label: `Round ${i}` })) };
		expect(storyDuration(buildStory(many, { kind: 'champion', theme: 'poop' }))).toBeLessThanOrEqual(50);
	});

	it('never prints a player', () => {
		const text = JSON.stringify(buildStory(base, { kind: 'champion', theme: 'poop' }));
		expect(text).not.toMatch(/player/i);
	});
});

describe('loadMflSeason', () => {
	const answers = (year: number, finalPlayed: boolean) => (req: { type: string; year: number }) => {
		if (req.type === 'league') return league;
		if (req.type === 'leagueStandings') return standings;
		if (req.type === 'playoffBrackets') return { playoffBrackets: brackets.playoffBrackets };
		if (req.type === 'schedule') return schedule;
		const b = JSON.parse(JSON.stringify(brackets.brackets['1']));
		if (!finalPlayed && req.year === year) {
			const rounds = b.playoffBracket.playoffRound;
			delete rounds[rounds.length - 1].playoffGame.home.points;
		}
		return b;
	};
	const owner = { leagueId: '13522', leagueName: 'The League', franchiseId: '0010', year: 2026, host: 'https://www49.myfantasyleague.com' };

	it('falls back to last season while this one is still being played, with logos embedded', async () => {
		const seen: number[] = [];
		const fetchAnswer = answers(2026, false);
		const out = await loadMflSeason({
			league: owner,
			fetchExport: async (req) => {
				if (req.type === 'leagueStandings') seen.push(req.year);
				return fetchAnswer(req);
			},
			fetchLogo: async (url) => `data:image/png;base64,${Buffer.from(url).toString('base64')}`,
		});
		if (!out.ok) throw new Error(out.message);
		expect(seen).toEqual([2026, 2025]);
		expect(out.facts.season).toBe(2025);
		expect(out.kind).toBe('champion');
		expect(out.facts.teamLogo).toMatch(/^data:image\/png/);
		expect(out.facts.playoffs.every((g) => g.oppLogo?.startsWith('data:'))).toBe(true);
	});

	it('only ever asks MFL hosts', async () => {
		expect(() => exportPath({ host: 'evil.example.com', year: 2025, leagueId: '13522', type: 'league' })).toThrow();
		expect(exportPath({ host: 'www49.myfantasyleague.com', year: 2025, leagueId: '13522', type: 'playoffBracket', bracketId: '1' })).toBe(
			'https://www49.myfantasyleague.com/2025/export?TYPE=playoffBracket&L=13522&JSON=1&BRACKET_ID=1',
		);
	});
});

describe('sharedHostLoginUrl', () => {
	it('returns to a same-origin path, and never to anything else', async () => {
		const { sharedHostLoginUrl } = await import('../src/utils/login-redirect');
		expect(sharedHostLoginUrl('/champion-video')).toBe('/login?next=%2Fchampion-video');
		expect(sharedHostLoginUrl('https://evil.example')).toBe('/login');
		expect(sharedHostLoginUrl('//evil.example')).toBe('/login');
		expect(sharedHostLoginUrl('/login')).toBe('/login');
	});
});
