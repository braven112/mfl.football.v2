/**
 * Season video — the storyboard: which cards a season gets, in what order,
 * what each one says and how long it holds. Pure, so the copy is tested
 * (tests/season-video.test.ts) and the canvas renderer (draw.ts) only draws.
 *
 * Three videos (Brandon, 2026-11-05):
 *  - champion: Trophy Room dark-and-gold, every playoff game, the final, the
 *    crown with confetti.
 *  - recap: everyone between first and last, same look, ending on how far
 *    they got.
 *  - last: the last-place team, as a princess or a poop video.
 * Every one ends on the MFL Football end card, prominently branded.
 *
 * The music beds are 50 seconds, so a story never runs longer
 * (`MAX_STORY_SECONDS`): a long playoff run shortens its game cards first,
 * then drops the statement-game card.
 */
import type { LastPlaceTheme, SeasonFacts, SeasonGame, SeasonVideoKind } from './season';
import { formatPoints, formatScore, ordinal } from './season';

export const MAX_STORY_SECONDS = 50;

export interface Palette {
	bg: string;
	ink: string;
	muted: string;
	accent: string;
	good: string;
	bad: string;
}

export type CrownEffect = 'confetti' | 'sparkles' | 'poop' | 'none';

interface SceneBase {
	duration: number;
	palette: Palette;
	kicker: string;
}

export type BigNumber =
	| { kind: 'record'; wins: number; losses: number; ties: number }
	| { kind: 'number'; value: number; decimals: number };

export type Scene =
	| (SceneBase & { type: 'title'; headline: [string, string]; sub: string })
	| (SceneBase & {
			type: 'stat';
			big: BigNumber;
			line?: string;
			tiles?: { value: string; label: string }[];
	  })
	| (SceneBase & { type: 'game'; game: SeasonGame; won: boolean; line: string; bars: boolean })
	| (SceneBase & { type: 'final'; game: SeasonGame; won: boolean; line: string; teamName: string })
	| (SceneBase & { type: 'crown'; name: string; line: string; effect: CrownEffect; badge?: string })
	| (SceneBase & { type: 'end'; line: string });

export type SceneType = Scene['type'];

// ── palettes ──────────────────────────────────────────────────────────────

const TROPHY = {
	navy: { bg: '#0b1420', ink: '#ffffff', muted: '#c4cfdc', accent: '#e8c46a', good: '#8ee59c', bad: '#ff6b5e' },
	slate: { bg: '#111d2c', ink: '#ffffff', muted: '#c4cfdc', accent: '#e8c46a', good: '#8ee59c', bad: '#ff6b5e' },
	blue: { bg: '#1c497c', ink: '#ffffff', muted: '#d7e3f2', accent: '#e8c46a', good: '#8ee59c', bad: '#ffb4ab' },
	plum: { bg: '#3b1530', ink: '#ffffff', muted: '#e6cfe0', accent: '#e8c46a', good: '#8ee59c', bad: '#ff8f85' },
	gold: { bg: '#e8c46a', ink: '#0b1420', muted: '#3a2c0a', accent: '#0b1420', good: '#0b1420', bad: '#7a1f12' },
} satisfies Record<string, Palette>;

const PRINCESS = {
	pink: { bg: '#ff5fa2', ink: '#ffffff', muted: '#ffe3f0', accent: '#fff2a8', good: '#ffffff', bad: '#5a1846' },
	blush: { bg: '#ffd1e8', ink: '#5a1846', muted: '#8a3a72', accent: '#d6337f', good: '#2f7a4f', bad: '#d6337f' },
	plum: { bg: '#3a1233', ink: '#ffffff', muted: '#f1c9e4', accent: '#ffd76a', good: '#ffd76a', bad: '#ff8fc4' },
	lilac: { bg: '#a77bf3', ink: '#ffffff', muted: '#f0e6ff', accent: '#fff2a8', good: '#ffffff', bad: '#3a1233' },
} satisfies Record<string, Palette>;

const POOP = {
	dark: { bg: '#2b1d12', ink: '#f5e6c8', muted: '#cbb491', accent: '#d9a441', good: '#a8c66c', bad: '#e2794f' },
	brown: { bg: '#5c3d1e', ink: '#fff4dc', muted: '#e5cfa7', accent: '#ffd36b', good: '#c5e08a', bad: '#ffab85' },
	mustard: { bg: '#b8892f', ink: '#24170b', muted: '#4a3417', accent: '#24170b', good: '#24170b', bad: '#6b1d0c' },
	mud: { bg: '#3d2a17', ink: '#f5e6c8', muted: '#cbb491', accent: '#d9a441', good: '#a8c66c', bad: '#e2794f' },
} satisfies Record<string, Palette>;

/** The end card is the brand's, whatever the video: dark navy and gold. */
export const END_PALETTE: Palette = TROPHY.navy;

// ── copy helpers ──────────────────────────────────────────────────────────

const won = (g: SeasonGame) => g.score > g.oppScore;
const margin = (g: SeasonGame) => Math.abs(g.score - g.oppScore);

function playoffLine(g: SeasonGame): string {
	return won(g)
		? `Beat ${g.oppName}, ${formatScore(g.score)} to ${formatScore(g.oppScore)}.`
		: `${g.oppName} ended it, ${formatScore(g.oppScore)} to ${formatScore(g.score)}.`;
}

function finalLine(g: SeasonGame): string {
	return won(g)
		? `Over ${g.oppName}. Championship secured.`
		: `${g.oppName} took the title, ${formatScore(g.oppScore)} to ${formatScore(g.score)}.`;
}

function bestGameLine(g: SeasonGame): string {
	if (!won(g)) return `And ${g.oppName} still won. Fantasy is cruel.`;
	const m = margin(g);
	return m >= 40
		? `${g.oppName} scored ${formatScore(g.oppScore)}. A ${Math.round(m)}-point beating.`
		: `${g.oppName} scored ${formatScore(g.oppScore)}. Not even close.`;
}

function finishTile(f: SeasonFacts): { value: string; label: string } | null {
	if (f.finish && f.teams) return { value: ordinal(f.finish), label: `of ${f.teams}` };
	if (f.seed) return { value: ordinal(f.seed), label: 'Seed' };
	return null;
}

function recordScene(f: SeasonFacts, palette: Palette, line?: string): Scene {
	const tiles = [{ value: formatPoints(f.pointsFor), label: 'Points' }];
	const finish = finishTile(f);
	if (finish) tiles.push(finish);
	return {
		type: 'stat',
		duration: 5,
		palette,
		kicker: 'Regular season',
		big: { kind: 'record', wins: f.wins, losses: f.losses, ties: f.ties },
		tiles,
		...(line ? { line } : {}),
	};
}

function endScene(): Scene {
	return { type: 'end', duration: 5, palette: END_PALETTE, kicker: 'Made with', line: 'Make your league’s season video, free.' };
}

function gamesScenes(f: SeasonFacts, palettes: Palette[], finalPalette: Palette): Scene[] {
	const out: Scene[] = [];
	f.playoffs.forEach((g, i) => {
		const isFinal = g.label === 'The Final' && i === f.playoffs.length - 1;
		if (isFinal) {
			out.push({ type: 'final', duration: 6, palette: finalPalette, kicker: 'The Final', game: g, won: won(g), line: finalLine(g), teamName: f.teamName });
		} else {
			out.push({ type: 'game', duration: 5, palette: palettes[i % palettes.length], kicker: g.label, game: g, won: won(g), line: playoffLine(g), bars: false });
		}
	});
	return out;
}

// ── the three stories ─────────────────────────────────────────────────────

function championStory(f: SeasonFacts): Scene[] {
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: TROPHY.navy, kicker: `${f.leagueName} · ${f.season}`, headline: ['TITLE', 'RUN'], sub: `${f.teamName}. Your season, wrapped.` },
		recordScene(f, TROPHY.navy),
	];
	if (f.bestGame) {
		scenes.push({ type: 'game', duration: 5.5, palette: TROPHY.gold, kicker: `${f.bestGame.label} · Statement game`, game: f.bestGame, won: won(f.bestGame), line: bestGameLine(f.bestGame), bars: true });
	}
	scenes.push(...gamesScenes(f, [TROPHY.blue, TROPHY.plum, TROPHY.slate], TROPHY.navy));
	scenes.push({ type: 'crown', duration: 7, palette: TROPHY.navy, kicker: `${f.season} Champions of ${f.leagueName}`, name: f.teamName, line: 'Bragging rights, secured.', effect: 'confetti', badge: '🏆' });
	scenes.push(endScene());
	return scenes;
}

function recapEnding(f: SeasonFacts): { name: string; line: string } {
	switch (f.outcome) {
		case 'runner-up':
			return { name: 'SO CLOSE', line: `Runner-up in ${f.leagueName}. Next year it’s yours.` };
		case 'playoffs':
			return { name: 'PLAYOFF TEAM', line: `A playoff run in ${f.leagueName}. Run it back.` };
		case 'champion':
			return { name: 'CHAMPIONS', line: `${f.season} champions of ${f.leagueName}.` };
		default:
			return {
				name: f.finish ? `${ordinal(f.finish).toUpperCase()} PLACE` : 'NEXT YEAR',
				line: 'There’s always next year.',
			};
	}
}

function recapStory(f: SeasonFacts): Scene[] {
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: TROPHY.navy, kicker: `${f.leagueName} · ${f.season}`, headline: ['SEASON', 'WRAPPED'], sub: `${f.teamName}. Your season, wrapped.` },
		recordScene(f, TROPHY.navy),
	];
	if (f.bestGame) {
		scenes.push({ type: 'game', duration: 5.5, palette: TROPHY.gold, kicker: `${f.bestGame.label} · Best game`, game: f.bestGame, won: won(f.bestGame), line: bestGameLine(f.bestGame), bars: true });
	}
	scenes.push(...gamesScenes(f, [TROPHY.blue, TROPHY.plum, TROPHY.slate], TROPHY.slate));
	const ending = recapEnding(f);
	scenes.push({ type: 'crown', duration: 6, palette: TROPHY.navy, kicker: `${f.leagueName} · ${f.season}`, name: ending.name, line: ending.line, effect: f.outcome === 'champion' ? 'confetti' : 'none' });
	scenes.push(endScene());
	return scenes;
}

function lastStory(f: SeasonFacts, theme: LastPlaceTheme): Scene[] {
	const p = theme === 'princess' ? PRINCESS : null;
	const pal = (princess: Palette, poop: Palette) => (p ? princess : poop);
	const games = f.wins + f.losses + f.ties;
	const perWeek = games > 0 ? f.pointsFor / games : 0;

	const scenes: Scene[] = [
		{
			type: 'title',
			duration: 4,
			palette: pal(PRINCESS.pink, POOP.dark),
			kicker: `${f.leagueName} · ${f.season}`,
			headline: p ? ['A ROYAL', 'DISASTER'] : ['WHAT A', 'STINKER'],
			sub: p ? `${f.teamName}. Your season, wrapped with a bow.` : `${f.teamName}. Your season, flushed.`,
		},
		recordScene(f, pal(PRINCESS.plum, POOP.brown), p ? 'Dead last, but make it fabulous.' : 'Dead last. Hold your nose.'),
	];
	if (f.worstGame) {
		const g = f.worstGame;
		scenes.push({
			type: 'game',
			duration: 5.5,
			palette: pal(PRINCESS.blush, POOP.mustard),
			kicker: `${g.label} · The low point`,
			game: g,
			won: won(g),
			line: won(g) ? `Somehow that was a win. ${g.oppName} scored ${formatScore(g.oppScore)}.` : `${g.oppName} put up ${formatScore(g.oppScore)}. Ouch.`,
			bars: true,
		});
	}
	scenes.push({
		type: 'stat',
		duration: 5,
		palette: pal(PRINCESS.lilac, POOP.mud),
		kicker: 'Points per week',
		big: { kind: 'number', value: perWeek, decimals: 2 },
		line: p ? 'Dainty. Delicate. Not enough.' : 'Smells about right.',
	});
	scenes.push(...gamesScenes(f, [pal(PRINCESS.pink, POOP.brown)], pal(PRINCESS.plum, POOP.dark)));
	scenes.push({
		type: 'crown',
		duration: 7,
		palette: pal(PRINCESS.plum, POOP.dark),
		kicker: p ? 'Royal Highness of Last Place' : `${f.season} Last Place · ${f.leagueName}`,
		name: f.teamName,
		line: p ? 'Long may you reign. Down here.' : 'Flush it. Next season starts now.',
		effect: p ? 'sparkles' : 'poop',
		badge: p ? '👑' : '💩',
	});
	scenes.push(endScene());
	return scenes;
}

export interface StoryOptions {
	kind: SeasonVideoKind;
	theme: LastPlaceTheme;
}

export function storyDuration(scenes: readonly Scene[]): number {
	return scenes.reduce((sum, s) => sum + s.duration, 0);
}

/** The storyboard for one season, fitted to the music bed. */
export function buildStory(facts: SeasonFacts, opts: StoryOptions): Scene[] {
	let scenes =
		opts.kind === 'champion' ? championStory(facts) : opts.kind === 'last' ? lastStory(facts, opts.theme) : recapStory(facts);

	// Too long for the bed: shorten the playoff game cards, down to 3.5 s each…
	const over = () => storyDuration(scenes) - MAX_STORY_SECONDS;
	const gameCards = scenes.filter((s) => s.type === 'game' && !('bars' in s && s.bars));
	if (over() > 0 && gameCards.length) {
		const each = Math.max(3.5, 5 - over() / gameCards.length);
		scenes = scenes.map((s) => (gameCards.includes(s) ? { ...s, duration: each } : s));
	}
	// …then drop the statement-game card, then the earliest playoff games.
	if (over() > 0) scenes = scenes.filter((s) => !(s.type === 'game' && s.bars));
	while (over() > 0) {
		const i = scenes.findIndex((s) => s.type === 'game');
		if (i < 0) break;
		scenes = scenes.filter((_, j) => j !== i);
	}
	return scenes;
}
