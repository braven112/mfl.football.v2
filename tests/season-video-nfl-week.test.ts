import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUST_MIN_AVERAGE, fitScenesToVoice, formatPts, nflWeekPostCopy, nflWeekVideo, pickNflWeek, type PlayerInfo, type WeekStats } from '../src/utils/season-video/nfl-week';
import { MAX_STORY_SECONDS, storyDuration } from '../src/utils/season-video/story';

const players: Record<string, PlayerInfo> = {
	q1: { name: 'Quinn Arm', position: 'QB', team: 'BUF' },
	q2: { name: 'Bo Backup', position: 'QB', team: 'NYJ' },
	r1: { name: 'Rex Runner', position: 'RB', team: 'ATL' },
	r2: { name: 'Sam Star', position: 'RB', team: 'SF' },
	w1: { name: 'Wes Wideout', position: 'WR', team: 'CIN' },
	w2: { name: 'Gus Ghost', position: 'WR', team: 'DAL' },
	t1: { name: 'Ty End', position: 'TE', team: 'KC' },
	k1: { name: 'Kip Kicker', position: 'PK', team: 'BAL' },
};

const line = (pts_ppr: number, extra: Record<string, number> = {}) => ({ pts_ppr, gp: 1, ...extra });

const earlier: WeekStats[] = [1, 2, 3].map(() => ({ r2: line(22), w2: line(16), q1: line(20) }));
const stats: WeekStats = {
	q1: line(34.24),
	q2: line(12),
	r1: line(27.5),
	r2: line(3.1),
	w1: line(25),
	w2: line(9, { rec_tgt: 8, rec: 0 }),
	t1: line(18),
	k1: line(14),
	nobody: line(50), // not in the player map: skipped, never a name we cannot show
};

describe('pickNflWeek', () => {
	const f = pickNflWeek({ season: 2026, week: 4, stats, earlier, players });

	it('names the top PPR scorer at each position, in card order', () => {
		expect(f.booms.map((b) => [b.position, b.name])).toEqual([
			['QB', 'Quinn Arm'],
			['RB', 'Rex Runner'],
			['WR', 'Wes Wideout'],
			['TE', 'Ty End'],
		]);
	});

	it('the bust is the biggest drop below his own average', () => {
		expect(f.bust?.name).toBe('Sam Star');
		expect(f.bust?.average).toBe(22);
	});

	it('never calls a player a bust without a starter average over enough games', () => {
		const few = pickNflWeek({ season: 2026, week: 2, stats, earlier: earlier.slice(0, 1), players });
		expect(few.bust).toBeNull();
		const low = pickNflWeek({ season: 2026, week: 4, stats, earlier: [1, 2, 3].map(() => ({ r2: line(BUST_MIN_AVERAGE - 1) })), players });
		expect(low.bust).toBeNull();
	});

	it('finds the odd stat: targets with no catches', () => {
		expect(f.odd?.kind).toBe('targets-no-catches');
		expect(f.odd?.line).toContain('Gus Ghost');
	});

	it('a kicker who outscores every RB is the stat of the week', () => {
		const k = pickNflWeek({ season: 2026, week: 4, stats: { ...stats, k1: line(30) }, earlier, players });
		expect(k.odd?.kind).toBe('kicker-over-rbs');
	});
});

describe('nflWeekVideo', () => {
	const f = pickNflWeek({ season: 2026, week: 4, stats, earlier, players });
	const v = nflWeekVideo(f);

	it('fits the music bed and has a voice line slot per card', () => {
		expect(storyDuration(v.scenes)).toBeLessThanOrEqual(MAX_STORY_SECONDS);
		expect(v.voice).toHaveLength(v.scenes.length);
	});

	it('opens on the hook, roasts the bust and ends on the video maker link', () => {
		expect(v.scenes[0].type).toBe('title');
		expect(v.scenes.some((s) => s.type === 'player' && s.badge === '🤡')).toBe(true);
		expect(v.scenes.at(-1)?.type).toBe('end');
		expect(v.voice.at(-1)).toMatch(/slash video/);
	});

	it('player cards carry no picture at all: the score is the hero (Brandon, 2026-11-08)', () => {
		expect(v.scenes.some((s) => s.type === 'award')).toBe(false);
		const players = v.scenes.filter((s) => s.type === 'player');
		expect(players.length).toBeGreaterThanOrEqual(6);
	});

	it('scoreboard decimals', () => {
		expect(formatPts(34.24)).toBe('34.2');
		expect(formatPts(4)).toBe('4.0');
	});

	it('the post copy links the video maker on every platform', () => {
		for (const text of Object.values(nflWeekPostCopy(f))) expect(text).toContain('mfl.football/video');
	});
});

describe('fitScenesToVoice', () => {
	it('stretches a card to hold its line, never shrinks one', () => {
		const { scenes } = nflWeekVideo(pickNflWeek({ season: 2026, week: 4, stats, earlier, players }));
		const out = fitScenesToVoice(scenes, scenes.map((_, i) => (i === 0 ? 6 : i === 1 ? 1 : null)));
		expect(out[0].duration).toBe(6.4);
		expect(out[1].duration).toBe(scenes[1].duration);
	});
});

describe('ours only', () => {
	it('the public video maker never offers the NFL week recap', () => {
		const page = readFileSync('src/pages/video.astro', 'utf8');
		expect(page).not.toMatch(/season-video\/nfl-week|weekly-recap|nfl-week-recap/);
	});

	it('the recap page and both endpoints are behind the Site Insights seat', () => {
		for (const p of ['src/pages/live/weekly-recap.astro', 'src/pages/api/nfl-week-recap.ts', 'src/pages/api/nfl-week-voice.ts']) {
			expect(readFileSync(p, 'utf8')).toContain('canViewSiteInsights');
		}
		expect(readFileSync('src/data/page-directory.json', 'utf8')).not.toContain('/live/weekly-recap');
	});
});
