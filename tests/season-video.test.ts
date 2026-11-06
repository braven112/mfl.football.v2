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
	pointsRankOf,
	buildWeekLines,
	seasonAllPlay,
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
		// Every regular-season week, ranked against the league's scores that week.
		expect(r.facts.weeks?.length).toBeGreaterThan(10);
		expect(r.facts.weeks!.every((w) => w.week < 15 && w.rank >= 1 && w.rank <= w.teams && w.teams === 16)).toBe(true);
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
	const STORIES = ['champion', 'recap', 'midseason', 'weekly', 'beatdown', 'tiger', 'mid', 'last'] as const;
	const LOOKS = ['trophy', 'bling', 'retro', 'princess', 'poop', 'clown', 'jackass'] as const;

	it('every story wears every look, and every one ends on the MFL Football end card', () => {
		for (const kind of STORIES) {
			for (const look of LOOKS) {
				const scenes = buildStory(base, { kind, look });
				expect(scenes[scenes.length - 1].type).toBe('end');
				expect(scenes[0].type).toBe('title');
				expect(storyDuration(scenes)).toBeLessThanOrEqual(50);
			}
		}
	});

	it('the champion video plays every playoff game and crowns the team', () => {
		const scenes = buildStory(base, { kind: 'champion', look: 'trophy' });
		const types = scenes.map((s) => s.type);
		// The statement game, then the quarterfinal; the final is its own card.
		expect(scenes.filter((s) => s.type === 'game' && !s.bars)).toHaveLength(1);
		expect(scenes.filter((s) => s.type === 'game' && s.bars)).toHaveLength(1);
		expect(types).toContain('final');
		expect(types).toContain('crown');
	});

	it('the look sets the colours and the crown effect, whatever the story', () => {
		const last = { ...base, outcome: 'missed' as const, finish: 16 };
		const princess = buildStory(last, { kind: 'last', look: 'princess' });
		const poop = buildStory(last, { kind: 'last', look: 'poop' });
		expect(princess[0].palette).not.toEqual(poop[0].palette);
		expect(princess.find((s) => s.type === 'crown')?.effect).toBe('sparkles');
		expect(poop.find((s) => s.type === 'crown')?.effect).toBe('poop');
		// A champion can be called a princess, and a mid team can wear bling.
		expect(buildStory(base, { kind: 'champion', look: 'princess' }).find((s) => s.type === 'crown')?.effect).toBe('sparkles');
		expect(buildStory(base, { kind: 'mid', look: 'bling' })[0].palette.bg).toBe(buildStory(base, { kind: 'champion', look: 'bling' })[0].palette.bg);
	});

	it('the mid-season and mediocrity stories skip the playoffs and say what they are', () => {
		for (const kind of ['midseason', 'mid'] as const) {
			const scenes = buildStory(base, { kind, look: 'trophy' });
			expect(scenes.some((s) => s.type === 'final')).toBe(false);
		}
		const mid = JSON.stringify(buildStory(base, { kind: 'mid', look: 'trophy' }));
		expect(mid).toContain('MEDIOCRITY');
		const report = buildStory(base, { kind: 'midseason', look: 'trophy' }).find((s) => s.type === 'crown');
		expect(report && 'name' in report ? report.name : '').toMatch(/^GRADE: [ABCDF]$/);
	});

	it('only a celebration gets confetti', () => {
		const crown = (kind: (typeof STORIES)[number]) => buildStory({ ...base, outcome: 'missed', finish: 8 }, { kind, look: 'trophy' }).find((s) => s.type === 'crown');
		expect(buildStory(base, { kind: 'champion', look: 'trophy' }).find((s) => s.type === 'crown')?.effect).toBe('confetti');
		for (const kind of ['mid', 'last', 'recap'] as const) expect(crown(kind)?.effect).toBe('none');
	});

	it('a video saved before looks were split still replays in its old look', () => {
		const old = buildStory(base, { kind: 'last', theme: 'poop' });
		expect(old).toEqual(buildStory(base, { kind: 'last', look: 'poop' }));
		expect(buildStory(base, { kind: 'champion', style: 'bling' })).toEqual(buildStory(base, { kind: 'champion', look: 'bling' }));
	});

	it('fits the 50-second music bed even with a long playoff run', () => {
		const many = { ...base, playoffs: Array.from({ length: 6 }, (_, i) => ({ ...base.playoffs[0], label: `Round ${i}` })) };
		expect(storyDuration(buildStory(many, { kind: 'champion', look: 'poop' }))).toBeLessThanOrEqual(50);
	});

	it('never prints a player', () => {
		for (const kind of STORIES) expect(JSON.stringify(buildStory(base, { kind, look: 'poop' }))).not.toMatch(/player/i);
	});
});

describe('midseasonGrade', () => {
	it('grades the record and the standings together', async () => {
		const { midseasonGrade } = await import('../src/utils/season-video/story');
		expect(midseasonGrade({ wins: 8, losses: 1, ties: 0, finish: 1, teams: 12 }).grade).toBe('A');
		expect(midseasonGrade({ wins: 5, losses: 4, ties: 0, finish: 6, teams: 12 }).grade).toBe('C');
		expect(midseasonGrade({ wins: 1, losses: 8, ties: 0, finish: 12, teams: 12 }).grade).toBe('F');
		expect(midseasonGrade({ wins: 0, losses: 0, ties: 0, finish: null, teams: null }).grade).toBe('C');
	});
});

describe('pickVideoKind', () => {
	it('suggests the mid-season report while the regular season is still being played', () => {
		const f = { outcome: 'missed' as const, finish: 4, teams: 12, playoffs: [] };
		expect(pickVideoKind(f, false)).toBe('midseason');
		expect(pickVideoKind(f, true)).toBe('recap');
		expect(pickVideoKind({ ...f, playoffs: [base.playoffs[0]] }, false)).toBe('recap');
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

describe('sniffImageType', () => {
	it('reads the real type from the bytes, whatever the label said', async () => {
		const { sniffImageType } = await import('../src/utils/season-video/fetch-logo');
		expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))).toBe('image/jpeg');
		expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png');
		expect(sniffImageType(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
	});
});

describe('looks', () => {
	it('each look changes the colours and the words, and Trophy Room is the default', async () => {
		const { buildStory } = await import('../src/utils/season-video/story');
		const { VIDEO_LOOKS, defaultLook } = await import('../src/utils/season-video/season');
		const f = { leagueName: 'L', season: 2025, teamName: 'T', wins: 10, losses: 4, ties: 0, pointsFor: 1500, finish: 1, teams: 12, outcome: 'champion' as const, playoffs: [] };
		const crown = (look?: 'trophy' | 'bling' | 'retro' | 'princess' | 'poop') => buildStory(f, { kind: 'champion', look }).find((s) => s.type === 'crown')!;
		expect(VIDEO_LOOKS.map((s) => s.id)).toEqual(['trophy', 'bling', 'retro', 'princess', 'poop', 'clown', 'jackass']);
		expect(crown()).toEqual(crown('trophy'));
		const looks = (['trophy', 'bling', 'retro', 'princess', 'poop'] as const).map((s) => crown(s));
		expect(new Set(looks.map((s) => s.palette.bg)).size).toBe(5);
		expect(looks.map((s) => (s as { effect: string }).effect)).toEqual(['confetti', 'money', 'retro', 'sparkles', 'poop']);
		expect(defaultLook('last')).toBe('princess');
		expect(defaultLook('mid')).toBe('trophy');
	});
});

describe('paper tiger', () => {
	const text = (s: unknown) => JSON.stringify(s);
	it('calls out a record the points do not back up', () => {
		const scenes = buildStory({ ...base, outcome: 'in-progress', playoffs: [], finish: 2, pointsRank: 9, worstGame: { label: 'Week 3', score: 71.2, oppName: 'Dark Magicians', oppScore: 140 } }, { kind: 'tiger', look: 'trophy' });
		expect(text(scenes)).toContain('PAPER');
		expect(text(scenes)).toContain('9th of 16 in points. The schedule did the work.');
		expect(text(scenes)).not.toContain('Then the playoffs happened');
	});
	it('roasts the playoff exit when the season ended in one', () => {
		const scenes = buildStory({ ...base, outcome: 'playoffs', pointsRank: 1, playoffs: [{ label: 'Quarterfinal', score: 90, oppName: 'Bring the Pain', oppScore: 120 }] }, { kind: 'tiger', look: 'poop' });
		expect(text(scenes)).toContain('Then the playoffs happened');
		expect(text(scenes)).not.toContain('The schedule did the work');
	});
	it('ranks points with ties sharing the better rank', () => {
		expect(pointsRankOf(100, [120, 100, 100, 80])).toBe(2);
		expect(pointsRankOf(80, [])).toBeNull();
	});
	it('a season still being played suggests the mid-season report', () => {
		expect(pickVideoKind({ outcome: 'in-progress', finish: 3, teams: 12 })).toBe('midseason');
	});
});

describe('weekly roast', () => {
	const scores = new Map([
		[1, [80, 120, 100, 90]],
		[2, [150, 60, 110, 70]],
	]);
	const weeks = buildWeekLines(
		[
			{ week: 2, score: 60, oppId: '0002', oppScore: 150 },
			{ week: 1, score: 120, oppId: '0003', oppScore: 80 },
		],
		scores,
		(id) => `Team ${id}`,
	);
	it('ranks each week against the league and keeps an all-play record', () => {
		expect(weeks.map((w) => w.week)).toEqual([1, 2]);
		expect(weeks[1]).toMatchObject({ rank: 4, teams: 4, allPlay: { wins: 0, losses: 3, ties: 0 }, oppName: 'Team 0002' });
		expect(seasonAllPlay(weeks)).toEqual({ wins: 3, losses: 3, ties: 0 });
	});
	it('roasts the week asked for, and the latest by default', () => {
		const f = { ...base, outcome: 'in-progress' as const, playoffs: [], weeks };
		const latest = JSON.stringify(buildStory(f, { kind: 'weekly', look: 'trophy' }));
		expect(latest).toContain('Week 2');
		expect(latest).toContain('Dead last');
		expect(latest).toContain('Would have lost to all 3');
		expect(latest).toContain('3–3'); // season all-play tile
		const wk1 = JSON.stringify(buildStory(f, { kind: 'weekly', look: 'poop', week: 1 }));
		expect(wk1).toContain('Week 1');
		expect(wk1).not.toContain('Dead last');
	});
	it('falls back to the worst game when the season was typed in', () => {
		const scenes = buildStory({ ...base, worstGame: { label: 'Week 7', score: 61, oppName: 'Bring the Pain', oppScore: 140 } }, { kind: 'weekly', look: 'retro' });
		expect(JSON.stringify(scenes)).toContain('Week 7');
	});
});

describe('beatdown', () => {
	const weeks = buildWeekLines(
		[
			{ week: 1, score: 150, oppId: '0002', oppScore: 80 },
			{ week: 2, score: 90, oppId: '0003', oppScore: 100 },
		],
		new Map([
			[1, [150, 80, 100, 90]],
			[2, [90, 100, 120, 130]],
		]),
		(id) => `Team ${id}`,
	);
	const f = { ...base, outcome: 'in-progress' as const, playoffs: [], weeks };
	it('brags about the week picked, only with what is true', () => {
		const wk1 = JSON.stringify(buildStory(f, { kind: 'beatdown', look: 'trophy', week: 1 }));
		expect(wk1).toContain('Beat Team 0002 by 70.00. A massacre.');
		expect(wk1).toContain('Top score in the league');
		expect(wk1).toContain('Would have beaten all 3');
		const wk2 = JSON.stringify(buildStory(f, { kind: 'beatdown', look: 'clown', week: 2 }));
		expect(wk2).toContain('Robbed');
		expect(wk2).not.toContain('Top score');
	});
});
