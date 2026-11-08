/**
 * Season video — the storyboard: which cards a season gets, in what order,
 * what each one says and how long it holds. Pure, so the copy is tested
 * (tests/season-video.test.ts) and the canvas renderer (draw.ts) only draws.
 *
 * Two choices make a video (Brandon, 2026-11-05), and any pairing works:
 *  - the STORY, what it says: champion, season recap, mid-season report,
 *    master of mediocrity, last place;
 *  - the LOOK, how it looks: Trophy Room (navy and gold, confetti), Bling
 *    (black and gold, money rain), Retro (a 70s trading card), Princess and
 *    Poop.
 * A look owns the colours, the crown effect and the badge; a story owns the
 * cards and the words, with a few lines that lean into the look they wear
 * (a princess champion, a poop last place). Every one ends on the MFL
 * Football end card, prominently branded.
 *
 * The music beds are 50 seconds, so a story never runs longer
 * (`MAX_STORY_SECONDS`): a long playoff run shortens its game cards first,
 * then drops the statement-game card.
 */
import { lookOf, type ChampionStyle, type LastPlaceTheme, type SeasonFacts, type SeasonGame, type SeasonStage, type SeasonVideoKind, type VideoLook } from './season';
import { busiest, weekTrades, type Award, type LeagueFacts, type LeagueMoves } from './league-recap';
import { formatPoints, formatRecord, formatScore, ordinal, positionLabel, seasonAllPlay, type StarterLine, type WeekLine } from './season';

export const MAX_STORY_SECONDS = 50;

export interface Palette {
	bg: string;
	ink: string;
	muted: string;
	accent: string;
	good: string;
	bad: string;
}

export type CrownEffect =
	| 'confetti'
	| 'retro'
	| 'money'
	| 'sparkles'
	| 'poop'
	| 'clown'
	| 'jackass'
	| 'dumpster'
	| 'crybaby'
	| 'snail'
	| 'potato'
	| 'bombs'
	| 'flex'
	| 'riot'
	| 'goat'
	| 'none';

interface SceneBase {
	duration: number;
	palette: Palette;
	kicker: string;
}

export type BigNumber =
	| { kind: 'record'; wins: number; losses: number; ties: number }
	| { kind: 'number'; value: number; decimals: number };

export type Scene =
	| (SceneBase & { type: 'title'; headline: [string, string]; sub: string; noCrest?: boolean })
	| (SceneBase & {
			type: 'stat';
			big: BigNumber;
			line?: string;
			tiles?: { value: string; label: string }[];
	  })
	| (SceneBase & { type: 'game'; game: SeasonGame; won: boolean; line: string; bars: boolean })
	| (SceneBase & { type: 'final'; game: SeasonGame; won: boolean; line: string; teamName: string })
	| (SceneBase & { type: 'crown'; name: string; line: string; effect: CrownEffect; badge?: string })
	| (SceneBase & { type: 'end'; line: string })
	/** A league recap's award: one team, its logo by team id (`DrawAssets.logos`). */
	| (SceneBase & { type: 'award'; name: string; teamId: string; value: string; badge: string; effect?: CrownEffect })
	/** A league recap's trade: every side, its logo by team id, and what it got. */
	| (SceneBase & { type: 'trade'; sides: { teamId: string; name: string; gets: string[] }[] })
	/** A league recap's season counts: big numbers, no team. */
	| (SceneBase & { type: 'tally'; tiles: { value: number; label: string }[]; line: string });

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

const BLING = {
	black: { bg: '#0a0a0a', ink: '#ffffff', muted: '#d9cfae', accent: '#f5c542', good: '#7ee08a', bad: '#ff6b5e' },
	onyx: { bg: '#1c1a17', ink: '#ffffff', muted: '#d9cfae', accent: '#f5c542', good: '#7ee08a', bad: '#ff8f85' },
	green: { bg: '#0f3d2e', ink: '#ffffff', muted: '#cfe6d8', accent: '#f5c542', good: '#9ff0ad', bad: '#ffb4ab' },
	gold: { bg: '#d4a017', ink: '#0a0a0a', muted: '#3a2c0a', accent: '#0a0a0a', good: '#0a0a0a', bad: '#7a1f12' },
} satisfies Record<string, Palette>;

const RETRO = {
	cream: { bg: '#f3e6c8', ink: '#3b2314', muted: '#7a5a3c', accent: '#d1601a', good: '#2a7f7a', bad: '#b8321a' },
	orange: { bg: '#e2711d', ink: '#fff8e8', muted: '#ffe2c2', accent: '#3b2314', good: '#fff8e8', bad: '#3b2314' },
	brown: { bg: '#5a3a22', ink: '#fff8e8', muted: '#e6cfae', accent: '#f2b134', good: '#9fd8c8', bad: '#ffab85' },
	teal: { bg: '#2a7f7a', ink: '#fff8e8', muted: '#d5efe9', accent: '#f2b134', good: '#fff8e8', bad: '#ffcf9e' },
	mustard: { bg: '#f2b134', ink: '#3b2314', muted: '#5a3a22', accent: '#3b2314', good: '#3b2314', bad: '#8a2a12' },
} satisfies Record<string, Palette>;

const CLOWN = {
	red: { bg: '#d62839', ink: '#ffffff', muted: '#ffd9dc', accent: '#ffd23f', good: '#ffffff', bad: '#ffd23f' },
	yellow: { bg: '#ffd23f', ink: '#1b1b3a', muted: '#4a3d10', accent: '#d62839', good: '#1b6b3a', bad: '#b0101f' },
	blue: { bg: '#1d6fd8', ink: '#ffffff', muted: '#d6e6fb', accent: '#ffd23f', good: '#b8f5c4', bad: '#ffd23f' },
	night: { bg: '#1b1b3a', ink: '#ffffff', muted: '#d0d0ec', accent: '#ffd23f', good: '#8ee59c', bad: '#ff6b7a' },
} satisfies Record<string, Palette>;

const JACKASS = {
	dust: { bg: '#3a3026', ink: '#f6ecd9', muted: '#cdbb9c', accent: '#e9a23b', good: '#b6d38a', bad: '#ff8f6b' },
	hide: { bg: '#6b5a48', ink: '#ffffff', muted: '#eadcc4', accent: '#ffcf6b', good: '#cfe8a8', bad: '#ffb39a' },
	hay: { bg: '#d9c08a', ink: '#2e2418', muted: '#5a4a30', accent: '#8a3b12', good: '#2f5f1f', bad: '#8a1f12' },
	barn: { bg: '#7a2e1f', ink: '#fff2df', muted: '#f0cdb8', accent: '#ffcf6b', good: '#d8efb0', bad: '#ffcf6b' },
} satisfies Record<string, Palette>;

const DUMPSTER = {
	smoke: { bg: '#1f1f1f', ink: '#ffffff', muted: '#cfcfcf', accent: '#ffb000', good: '#9be37a', bad: '#ff6b3d' },
	fire: { bg: '#d9480f', ink: '#ffffff', muted: '#ffe0cc', accent: '#ffe066', good: '#ffffff', bad: '#1f1f1f' },
	ember: { bg: '#7a1f0a', ink: '#ffffff', muted: '#f3c9b8', accent: '#ffb000', good: '#c8f0a8', bad: '#ffb000' },
	ash: { bg: '#4a4a4a', ink: '#ffffff', muted: '#dddddd', accent: '#ffb000', good: '#b6eb98', bad: '#ff8a5c' },
} satisfies Record<string, Palette>;

const CRYBABY = {
	sky: { bg: '#a8d8f0', ink: '#1c2f4a', muted: '#3c5677', accent: '#d6337f', good: '#1f6b45', bad: '#b0101f' },
	mint: { bg: '#bfe8d4', ink: '#1c2f4a', muted: '#3c5677', accent: '#d6337f', good: '#1f6b45', bad: '#b0101f' },
	night: { bg: '#2a3a5c', ink: '#ffffff', muted: '#d2dcef', accent: '#ffd1e8', good: '#a8f0c4', bad: '#ff9aa8' },
	cream: { bg: '#fff4e0', ink: '#1c2f4a', muted: '#4a5a72', accent: '#d6337f', good: '#1f6b45', bad: '#b0101f' },
} satisfies Record<string, Palette>;

const SNAIL = {
	moss: { bg: '#3d5a2a', ink: '#ffffff', muted: '#d7e6c6', accent: '#e0ff7a', good: '#e0ff7a', bad: '#ffb38a' },
	slime: { bg: '#9bc53d', ink: '#1f2a10', muted: '#3a4a1c', accent: '#5a2e0e', good: '#1f2a10', bad: '#7a1f12' },
	shell: { bg: '#8a5a2b', ink: '#fff6e6', muted: '#f0d9b8', accent: '#e0ff7a', good: '#e0ff7a', bad: '#ffc9a8' },
	mud: { bg: '#2b2a1a', ink: '#f2f0dc', muted: '#cfcca8', accent: '#9bc53d', good: '#c5e88a', bad: '#ff9a7a' },
} satisfies Record<string, Palette>;

const POTATO = {
	couch: { bg: '#5a4632', ink: '#fff6e6', muted: '#ead8bf', accent: '#ffcf6b', good: '#cfe8a8', bad: '#ffab8a' },
	spud: { bg: '#c9a26b', ink: '#2a1f12', muted: '#4a3a24', accent: '#7a2e1f', good: '#2f5f1f', bad: '#8a1f12' },
	tv: { bg: '#1e2a38', ink: '#ffffff', muted: '#cdd8e6', accent: '#6be0ff', good: '#9be3a0', bad: '#ff8a7a' },
	cushion: { bg: '#8a3b3b', ink: '#fff2ec', muted: '#f2cfc8', accent: '#ffcf6b', good: '#d8efb0', bad: '#ffcf6b' },
} satisfies Record<string, Palette>;

const BOMBS = {
	night: { bg: '#111111', ink: '#ffffff', muted: '#cccccc', accent: '#ff7a00', good: '#7ee08a', bad: '#ff5a4a' },
	blast: { bg: '#ff7a00', ink: '#111111', muted: '#3a2000', accent: '#111111', good: '#111111', bad: '#6b0f00' },
	smoke: { bg: '#3a3a3a', ink: '#ffffff', muted: '#dddddd', accent: '#ffe066', good: '#9be37a', bad: '#ff8a5c' },
	flash: { bg: '#ffe066', ink: '#111111', muted: '#3a3000', accent: '#c1121f', good: '#1f5f1f', bad: '#8a1f12' },
} satisfies Record<string, Palette>;

const FLEX = {
	steel: { bg: '#1c2530', ink: '#ffffff', muted: '#c9d3df', accent: '#ff4d5a', good: '#8ee59c', bad: '#ff8a8a' },
	iron: { bg: '#3a4654', ink: '#ffffff', muted: '#dbe2ea', accent: '#ff4d5a', good: '#a8f0b4', bad: '#ffb0b0' },
	pump: { bg: '#c1121f', ink: '#ffffff', muted: '#ffd6d9', accent: '#ffe066', good: '#ffffff', bad: '#1c2530' },
	chrome: { bg: '#d9dee5', ink: '#1c2530', muted: '#3a4654', accent: '#c1121f', good: '#1f6b3a', bad: '#a0101a' },
} satisfies Record<string, Palette>;

const RIOT = {
	red: { bg: '#b80c0c', ink: '#ffffff', muted: '#ffd2d2', accent: '#ffb703', good: '#ffffff', bad: '#ffb703' },
	blue: { bg: '#0b3fb8', ink: '#ffffff', muted: '#d2ddff', accent: '#ffb703', good: '#b8f5c4', bad: '#ffb703' },
	black: { bg: '#0c0c10', ink: '#ffffff', muted: '#cfcfd8', accent: '#ffb703', good: '#8ee59c', bad: '#ff5a5a' },
	amber: { bg: '#ffb703', ink: '#0c0c10', muted: '#3a2a00', accent: '#b80c0c', good: '#1f5f1f', bad: '#8a0c0c' },
} satisfies Record<string, Palette>;

const GOAT = {
	royal: { bg: '#2d1457', ink: '#ffffff', muted: '#ddd0f2', accent: '#d4af37', good: '#a8f0b4', bad: '#ff9aa8' },
	gold: { bg: '#d4af37', ink: '#1a1030', muted: '#3a2c0a', accent: '#2d1457', good: '#1a1030', bad: '#7a1f12' },
	white: { bg: '#f5f2ea', ink: '#1a1030', muted: '#4a4060', accent: '#8a6a10', good: '#1f6b3a', bad: '#a0101a' },
	night: { bg: '#141022', ink: '#ffffff', muted: '#d0cce0', accent: '#d4af37', good: '#8ee59c', bad: '#ff8a8a' },
} satisfies Record<string, Palette>;

/** One look: every card's colours, the crown effect and the badge. */
export interface Look {
	title: Palette;
	record: Palette;
	games: Palette[];
	best: Palette;
	low: Palette;
	stat: Palette;
	final: Palette;
	crown: Palette;
	effect: CrownEffect;
	badge: string;
}

export const LOOKS: Record<VideoLook, Look> = {
	trophy: {
		title: TROPHY.navy,
		record: TROPHY.navy,
		games: [TROPHY.blue, TROPHY.plum, TROPHY.slate],
		best: TROPHY.gold,
		low: TROPHY.plum,
		stat: TROPHY.blue,
		final: TROPHY.navy,
		crown: TROPHY.navy,
		effect: 'confetti',
		badge: '🏆',
	},
	bling: {
		title: BLING.black,
		record: BLING.onyx,
		games: [BLING.green, BLING.onyx, BLING.black],
		best: BLING.gold,
		low: BLING.green,
		stat: BLING.onyx,
		final: BLING.black,
		crown: BLING.black,
		effect: 'money',
		badge: '💎',
	},
	retro: {
		title: RETRO.cream,
		record: RETRO.orange,
		games: [RETRO.orange, RETRO.teal, RETRO.brown],
		best: RETRO.mustard,
		low: RETRO.teal,
		stat: RETRO.brown,
		final: RETRO.brown,
		crown: RETRO.cream,
		effect: 'retro',
		badge: '🏆',
	},
	princess: {
		title: PRINCESS.pink,
		record: PRINCESS.plum,
		games: [PRINCESS.pink, PRINCESS.lilac],
		best: PRINCESS.blush,
		low: PRINCESS.blush,
		stat: PRINCESS.lilac,
		final: PRINCESS.plum,
		crown: PRINCESS.plum,
		effect: 'sparkles',
		badge: '👑',
	},
	poop: {
		title: POOP.dark,
		record: POOP.brown,
		games: [POOP.brown, POOP.mud],
		best: POOP.mustard,
		low: POOP.mustard,
		stat: POOP.mud,
		final: POOP.dark,
		crown: POOP.dark,
		effect: 'poop',
		badge: '💩',
	},
	clown: {
		title: CLOWN.red,
		record: CLOWN.night,
		games: [CLOWN.blue, CLOWN.red, CLOWN.night],
		best: CLOWN.yellow,
		low: CLOWN.yellow,
		stat: CLOWN.blue,
		final: CLOWN.night,
		crown: CLOWN.night,
		effect: 'clown',
		badge: '🤡',
	},
	jackass: {
		title: JACKASS.dust,
		record: JACKASS.hide,
		games: [JACKASS.hide, JACKASS.barn, JACKASS.dust],
		best: JACKASS.hay,
		low: JACKASS.hay,
		stat: JACKASS.barn,
		final: JACKASS.dust,
		crown: JACKASS.dust,
		effect: 'jackass',
		badge: '🫏',
	},
	dumpster: {
		title: DUMPSTER.smoke,
		record: DUMPSTER.ember,
		games: [DUMPSTER.ash, DUMPSTER.ember, DUMPSTER.smoke],
		best: DUMPSTER.fire,
		low: DUMPSTER.fire,
		stat: DUMPSTER.ash,
		final: DUMPSTER.smoke,
		crown: DUMPSTER.smoke,
		effect: 'dumpster',
		badge: '🔥',
	},
	crybaby: {
		title: CRYBABY.sky,
		record: CRYBABY.night,
		games: [CRYBABY.mint, CRYBABY.night, CRYBABY.sky],
		best: CRYBABY.cream,
		low: CRYBABY.cream,
		stat: CRYBABY.night,
		final: CRYBABY.night,
		crown: CRYBABY.night,
		effect: 'crybaby',
		badge: '🍼',
	},
	snail: {
		title: SNAIL.moss,
		record: SNAIL.mud,
		games: [SNAIL.shell, SNAIL.moss, SNAIL.mud],
		best: SNAIL.slime,
		low: SNAIL.slime,
		stat: SNAIL.shell,
		final: SNAIL.mud,
		crown: SNAIL.mud,
		effect: 'snail',
		badge: '🐌',
	},
	potato: {
		title: POTATO.couch,
		record: POTATO.tv,
		games: [POTATO.cushion, POTATO.tv, POTATO.couch],
		best: POTATO.spud,
		low: POTATO.spud,
		stat: POTATO.cushion,
		final: POTATO.tv,
		crown: POTATO.tv,
		effect: 'potato',
		badge: '🥔',
	},
	bombs: {
		title: BOMBS.night,
		record: BOMBS.smoke,
		games: [BOMBS.smoke, BOMBS.night],
		best: BOMBS.blast,
		low: BOMBS.flash,
		stat: BOMBS.smoke,
		final: BOMBS.night,
		crown: BOMBS.night,
		effect: 'bombs',
		badge: '💣',
	},
	flex: {
		title: FLEX.steel,
		record: FLEX.iron,
		games: [FLEX.iron, FLEX.pump, FLEX.steel],
		best: FLEX.chrome,
		low: FLEX.chrome,
		stat: FLEX.iron,
		final: FLEX.steel,
		crown: FLEX.steel,
		effect: 'flex',
		badge: '💪',
	},
	riot: {
		title: RIOT.black,
		record: RIOT.red,
		games: [RIOT.blue, RIOT.red, RIOT.black],
		best: RIOT.amber,
		low: RIOT.amber,
		stat: RIOT.blue,
		final: RIOT.black,
		crown: RIOT.black,
		effect: 'riot',
		badge: '🚨',
	},
	goat: {
		title: GOAT.royal,
		record: GOAT.night,
		games: [GOAT.royal, GOAT.night],
		best: GOAT.gold,
		low: GOAT.white,
		stat: GOAT.royal,
		final: GOAT.night,
		crown: GOAT.night,
		effect: 'goat',
		badge: '🐐',
	},
};

/** Roast looks keep their own badge on the last-place video; the rest get the wooden spoon. */
const OWN_LAST_BADGE = new Set<VideoLook>(['princess', 'poop', 'clown', 'jackass', 'dumpster', 'crybaby', 'snail', 'potato']);

/** Words that change with the look, for the stories that lean into it. */
type ByLook<T> = Partial<Record<VideoLook, T>> & { default: T };
const byLook = <T>(table: ByLook<T>, look: VideoLook): T => table[look] ?? table.default;

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

function recordScene(f: SeasonFacts, palette: Palette, line?: string, kicker = 'Regular season'): Scene {
	const tiles = [{ value: formatPoints(f.pointsFor), label: 'Points' }];
	const finish = finishTile(f);
	if (finish) tiles.push(finish);
	return {
		type: 'stat',
		duration: 5,
		palette,
		kicker,
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

// ── the stories ───────────────────────────────────────────────────────────

const gamesPlayed = (f: SeasonFacts) => f.wins + f.losses + f.ties;
const perWeek = (f: SeasonFacts) => (gamesPlayed(f) > 0 ? f.pointsFor / gamesPlayed(f) : 0);

function perWeekScene(f: SeasonFacts, palette: Palette, line: string): Scene {
	return { type: 'stat', duration: 5, palette, kicker: 'Points per week', big: { kind: 'number', value: perWeek(f), decimals: 2 }, line };
}

function bestScene(g: SeasonGame, palette: Palette, kicker: string, line = bestGameLine(g)): Scene {
	return { type: 'game', duration: 5.5, palette, kicker: `${g.label} · ${kicker}`, game: g, won: won(g), line, bars: true };
}

function lowScene(g: SeasonGame, palette: Palette, kicker: string, line: string): Scene {
	return { type: 'game', duration: 5.5, palette, kicker: `${g.label} · ${kicker}`, game: g, won: won(g), line, bars: true };
}

const CHAMPION_WORDS: Record<'headline' | 'sub' | 'crownLine', ByLook<string | [string, string]>> = {
	headline: { default: ['TITLE', 'RUN'], bling: ['GOLD', 'STANDARD'], retro: ['HALL OF', 'FAME'], princess: ['CROWN', 'JEWEL'], poop: ['HOLY', 'CRAP'], clown: ['CIRCUS', 'CHAMPS'], jackass: ['LUCKY', 'JACKASS'], dumpster: ['FIRE', 'STARTER'], crybaby: ['STOP', 'CRYING'], snail: ['SLOW', 'AND STEADY'], potato: ['COUCH', 'CHAMPION'], bombs: ['BOMBS', 'AWAY'], flex: ['FLEX', 'SEASON'], riot: ['RAN THE', 'LEAGUE'], goat: ['THE', 'GOAT'] },
	sub: {
		default: 'Your season, wrapped.',
		bling: 'Your season, dripped out.',
		retro: 'A season worth framing.',
		princess: 'Your season, wrapped with a bow.',
		poop: 'Champions. Somehow.',
		clown: 'The whole league got clowned.',
		jackass: 'Dumb luck is still luck.',
		dumpster: 'Burned the whole league down.',
		crybaby: 'Everyone else can cry now.',
		snail: 'Took the long way. Got there.',
		potato: 'Won it from the couch.',
		bombs: 'Dropped bombs all season.',
		flex: 'Flexed all season. Earned it.',
		riot: 'Ran riot from start to finish.',
		goat: 'Greatest of this league. Say it.',
	},
	crownLine: {
		default: 'Bragging rights, secured.',
		bling: 'Paid in full. Pay up, league.',
		retro: 'A classic. Frame this one.',
		princess: 'All hail the queen of the league.',
		poop: 'Won ugly. Still counts.',
		clown: 'Ringleader of the circus.',
		jackass: 'Stubborn enough to win it all.',
		dumpster: 'Watch it all burn.',
		crybaby: 'Tissues for everyone else.',
		snail: 'Slow wins the race. Sometimes.',
		potato: 'Never left the couch. Still won.',
		bombs: 'Nothing left standing.',
		flex: 'Flex on them. You earned it.',
		riot: 'Lock up the trophy. Riot over.',
		goat: 'GOAT. No debate.',
	},
};

function championStory(f: SeasonFacts, look: VideoLook): Scene[] {
	const L = LOOKS[look];
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: L.title, kicker: `${f.leagueName} · ${f.season}`, headline: byLook(CHAMPION_WORDS.headline, look) as [string, string], sub: `${f.teamName}. ${byLook(CHAMPION_WORDS.sub, look)}` },
		recordScene(f, L.record),
	];
	if (f.bestGame) scenes.push(bestScene(f.bestGame, L.best, 'Statement game'));
	scenes.push(...gamesScenes(f, L.games, L.final));
	scenes.push({ type: 'crown', duration: 7, palette: L.crown, kicker: `${f.season} Champions of ${f.leagueName}`, name: f.teamName, line: byLook(CHAMPION_WORDS.crownLine, look) as string, effect: L.effect, badge: L.badge });
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
		// The owner called the season over before the data did (Season end on the form): tell it by place.
		default:
			return {
				name: f.finish ? `${ordinal(f.finish).toUpperCase()} PLACE` : 'NEXT YEAR',
				line: 'There’s always next year.',
			};
	}
}

/** Celebratory effects belong to a celebration; other stories keep the look's mood without the party. */
function quietEffect(L: Look, celebrate: boolean): CrownEffect {
	if (celebrate) return L.effect;
	return L.effect === 'confetti' || L.effect === 'retro' ? 'none' : L.effect;
}

function recapStory(f: SeasonFacts, look: VideoLook): Scene[] {
	const L = LOOKS[look];
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: L.title, kicker: `${f.leagueName} · ${f.season}`, headline: ['SEASON', 'WRAPPED'], sub: `${f.teamName}. Your season, wrapped.` },
		recordScene(f, L.record),
	];
	if (f.bestGame) scenes.push(bestScene(f.bestGame, L.best, 'Best game'));
	scenes.push(...gamesScenes(f, L.games, L.final));
	const ending = recapEnding(f);
	scenes.push({ type: 'crown', duration: 6, palette: L.crown, kicker: `${f.leagueName} · ${f.season}`, name: ending.name, line: ending.line, effect: quietEffect(L, f.outcome === 'champion') });
	scenes.push(endScene());
	return scenes;
}

/**
 * The end of the regular season (Brandon, 2026-11-06): the record, the best
 * and worst weeks, and where the team finished. No playoff games and no claim
 * about how the season ends; that's the season-end video.
 */
function regularStory(f: SeasonFacts, look: VideoLook): Scene[] {
	const L = LOOKS[look];
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: L.title, kicker: `${f.leagueName} · ${f.season}`, headline: ['REGULAR', 'SEASON'], sub: `${f.teamName}. The regular season, wrapped.` },
		recordScene(f, L.record),
	];
	if (f.bestGame) scenes.push(bestScene(f.bestGame, L.best, 'Best week'));
	if (f.worstGame) {
		const g = f.worstGame;
		scenes.push(lowScene(g, L.low, 'Worst week', won(g) ? `Won anyway. ${g.oppName} scored ${formatScore(g.oppScore)}.` : `${g.oppName} won by ${formatScore(margin(g))}.`));
	}
	const first = f.finish === 1;
	const last = !!(f.finish && f.teams && f.finish >= f.teams);
	scenes.push({
		type: 'crown',
		duration: 6,
		palette: L.crown,
		kicker: `${f.leagueName} · ${f.season} regular season`,
		name: f.finish ? `${ordinal(f.finish).toUpperCase()} PLACE` : 'IN THE BOOKS',
		line: first ? 'Top of the table. Now win it all.' : last ? 'Rock bottom. There’s always next year.' : 'The regular season is in the books.',
		effect: quietEffect(L, first),
	});
	scenes.push(endScene());
	return scenes;
}

/** A report-card grade from the record and, when known, the standings. */
export function midseasonGrade(f: Pick<SeasonFacts, 'wins' | 'losses' | 'ties' | 'finish' | 'teams'>): { grade: string; line: string } {
	const games = f.wins + f.losses + f.ties;
	const pct = games > 0 ? (f.wins + f.ties / 2) / games : 0.5;
	// Where they sit in the table counts as much as the record.
	const place = f.finish && f.teams && f.teams > 1 ? 1 - (f.finish - 1) / (f.teams - 1) : pct;
	const score = (pct + place) / 2;
	if (score >= 0.8) return { grade: 'A', line: 'Top of the class. Don’t get cocky.' };
	if (score >= 0.6) return { grade: 'B', line: 'Solid work. Not done yet.' };
	if (score >= 0.4) return { grade: 'C', line: 'Average. Must try harder.' };
	if (score >= 0.2) return { grade: 'D', line: 'See me after class.' };
	return { grade: 'F', line: 'Your parents have been notified.' };
}

function midseasonStory(f: SeasonFacts, look: VideoLook): Scene[] {
	const L = LOOKS[look];
	const report = midseasonGrade(f);
	const week = gamesPlayed(f);
	const scenes: Scene[] = [
		{
			type: 'title',
			duration: 4,
			palette: L.title,
			kicker: `${f.leagueName} · ${f.season}${week ? ` · ${week} games in` : ''}`,
			headline: ['MID-SEASON', 'REPORT'],
			sub: `${f.teamName}. Here’s how it’s going.`,
		},
		recordScene(f, L.record, report.line, 'So far'),
	];
	if (f.bestGame) scenes.push(bestScene(f.bestGame, L.best, 'Best week so far'));
	if (f.worstGame) {
		const g = f.worstGame;
		scenes.push(lowScene(g, L.low, 'Worst week so far', won(g) ? `Won anyway. ${g.oppName} scored ${formatScore(g.oppScore)}.` : `${g.oppName} won by ${formatScore(margin(g))}. Yikes.`));
	}
	scenes.push(perWeekScene(f, L.stat, 'Halfway there. Make it count.'));
	scenes.push({ type: 'crown', duration: 6, palette: L.crown, kicker: 'Mid-season grade', name: `GRADE: ${report.grade}`, line: report.line, effect: quietEffect(L, report.grade === 'A'), badge: '📝' });
	scenes.push(endScene());
	return scenes;
}

const WEEKLY_WORDS: Record<'headline' | 'crownLine', ByLook<string | [string, string]>> = {
	headline: { default: ['CLOWN OF', 'THE WEEK'], bling: ['BANKRUPT', 'THIS WEEK'], retro: ['WORST', 'IN SHOW'], princess: ['DRAMA', 'QUEEN'], poop: ['WEEKLY', 'STINKER'], jackass: ['JACKASS OF', 'THE WEEK'], dumpster: ['DUMPSTER', 'FIRE'], crybaby: ['CRY', 'BABY'], snail: ['SLOW', 'DEATH'], potato: ['COUCH', 'POTATO'], bombs: ['BOMBED', 'OUT'], flex: ['NO', 'FLEX'], riot: ['TOTAL', 'MELTDOWN'], goat: ['NOT THE', 'GOAT'] },
	crownLine: {
		default: 'Honk honk. See you next week.',
		bling: 'Overdrawn. Again.',
		retro: 'Vintage bad. Collect them all.',
		princess: 'Off with their lineup.',
		poop: 'Flush it and set a lineup.',
		clown: 'Honk honk. Red nose, red numbers.',
		jackass: 'Hee-haw. Set a real lineup.',
		dumpster: 'Smells like burning lineups.',
		crybaby: 'Waaah. Set a lineup.',
		snail: 'Slime trail to the bottom.',
		potato: 'Get off the couch. Set a lineup.',
		bombs: 'Blew up in their face.',
		flex: 'Nothing to flex here.',
		riot: 'Somebody call the cops.',
		goat: 'Just a goat. Baa.',
	},
};

/** The week the roast is about: the one asked for, else the latest one played. */
export function weekFor(f: SeasonFacts, week?: number): WeekLine | null {
	const weeks = f.weeks ?? [];
	return weeks.find((w) => w.week === week) ?? weeks[weeks.length - 1] ?? null;
}

/** A line about one week's points rank that stays true however the week went. */
function weekRankLine(w: WeekLine): string {
	const of = `${ordinal(w.rank)} of ${w.teams} this week.`;
	if (w.rank === w.teams) return `${of} Dead last. Everybody saw it.`;
	if (w.rank > w.teams / 2) return `${of} Bottom half, as usual.`;
	if (w.rank === 1) return `${of} Enjoy it. It won’t last.`;
	return `${of} Don’t let it go to your head.`;
}

/** The week's standout starter as a stat card: the worst one for a roast, the best for a brag. */
function starterScene(p: StarterLine, label: string, palette: Palette, worst: boolean): Scene {
	const pos = positionLabel(p.pos);
	const avg = p.avg !== null ? `${pos}s averaged ${p.avg.toFixed(1)}.` : '';
	const line = worst
		? p.pts <= 0
			? `${p.name}. Zero. Not a typo.`
			: `${p.name}. ${avg || 'Started. Sadly.'}`.trim()
		: `${p.name}. ${avg ? `${avg} Not this one.` : 'Carried the whole team.'}`;
	return { type: 'stat', duration: 5, palette, kicker: `${label} · ${worst ? 'Worst start' : 'Best start'} · ${pos}`, big: { kind: 'number', value: p.pts, decimals: 2 }, line };
}

function weeklyStory(f: SeasonFacts, look: VideoLook, weekNo?: number): Scene[] {
	const L = LOOKS[look];
	const w = weekFor(f, weekNo);
	// No week lines (typed in by hand): fall back to the worst game we know.
	const game: SeasonGame | null = w
		? { label: `Week ${w.week}`, score: w.score, oppName: w.oppName, oppScore: w.oppScore, oppId: w.oppId }
		: (f.worstGame ?? null);
	const label = game?.label ?? 'This week';
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: L.title, kicker: `${f.leagueName} · ${label}`, headline: byLook(WEEKLY_WORDS.headline, look) as [string, string], sub: `${f.teamName}. ${label}, roasted.` },
	];
	if (game) {
		const line = won(game)
			? `Won. ${game.oppName} just had it worse.`
			: margin(game) >= 40
				? `${game.oppName} won by ${formatScore(margin(game))}. Not close.`
				: `${game.oppName} won by ${formatScore(margin(game))}.`;
		scenes.push(lowScene(game, L.low, won(game) ? 'Lucky' : 'Took the L', line));
	}
	if (w?.worst) scenes.push(starterScene(w.worst, label, L.record, true));
	if (w) {
		scenes.push({ type: 'stat', duration: 5, palette: L.stat, kicker: `${label} points · league rank`, big: { kind: 'number', value: w.rank, decimals: 0 }, line: weekRankLine(w) });
		const beat = w.allPlay.wins;
		const others = w.teams - 1;
		scenes.push({
			type: 'stat',
			duration: 5,
			palette: L.record,
			kicker: `${label} · against every team`,
			big: { kind: 'record', ...w.allPlay },
			line: beat === 0 ? `Would have lost to all ${others}. Every single one.` : beat < others / 2 ? `Would have lost to ${w.allPlay.losses} of ${others}.` : `Beat ${beat} of ${others}. Still a clown.`,
		});
	}
	const tiles = [{ value: formatPoints(f.pointsFor), label: 'Points' }];
	if (f.weeks?.length) {
		const ap = seasonAllPlay(f.weeks);
		tiles.push({ value: formatRecord(ap), label: 'All-play' });
	}
	scenes.push({
		type: 'stat',
		duration: 5,
		palette: L.best,
		kicker: f.outcome === 'in-progress' ? 'The season so far' : 'The season',
		big: { kind: 'record', wins: f.wins, losses: f.losses, ties: f.ties },
		line: f.wins > f.losses ? 'The record can’t save you this week.' : 'And it’s not just this week.',
		tiles,
	});
	scenes.push({ type: 'crown', duration: 6, palette: L.crown, kicker: `${label} · ${f.leagueName}`, name: f.teamName, line: byLook(WEEKLY_WORDS.crownLine, look) as string, effect: quietEffect(L, false), badge: '🤡' });
	scenes.push(endScene());
	return scenes;
}

const BEATDOWN_WORDS: Record<'headline' | 'crownLine', ByLook<string | [string, string]>> = {
	headline: {
		default: ['BEAT', 'DOWN'],
		bling: ['MONEY', 'WEEK'],
		retro: ['INSTANT', 'CLASSIC'],
		princess: ['SLAY', 'QUEEN'],
		poop: ['DROPPED', 'A BOMB'],
		clown: ['CLOWNED', 'THEM'],
		jackass: ['KICKED LIKE', 'A MULE'],
		dumpster: ['BURNED', 'THEM DOWN'],
		crybaby: ['MADE THEM', 'CRY'],
		snail: ['SLOW', 'SQUASH'],
		potato: ['MASHED', 'THEM'],
		bombs: ['BOMBS', 'AWAY'],
		flex: ['FLEX', 'WEEK'],
		riot: ['RUNNING', 'RIOT'],
		goat: ['GOAT', 'WEEK'],
	},
	crownLine: {
		default: 'Sit down. Take notes.',
		bling: 'Cash it. Frame it. Brag about it.',
		retro: 'One for the highlight reel.',
		princess: 'Bow to your queen.',
		poop: 'Left them in the bowl.',
		clown: 'They were the joke this week.',
		jackass: 'Hee-haw. Get kicked.',
		dumpster: 'Left them in the dumpster.',
		crybaby: 'Somebody get them a bottle.',
		snail: 'Slow and steady crushed them.',
		potato: 'Mashed. Baked. Served.',
		bombs: 'Nothing left but the crater.',
		flex: 'Flexed on them. Twice.',
		riot: 'Riot gear required.',
		goat: 'GOAT behavior.',
	},
};

/** A brag about one week's points rank that stays true however the week went. */
function bragRankLine(w: WeekLine, wonIt: boolean): string {
	const of = `${ordinal(w.rank)} of ${w.teams} this week.`;
	if (w.rank === 1) return `${of} Top score in the league. Bow down.`;
	if (w.rank <= w.teams / 2) return `${of} Top half. Everybody noticed.`;
	return wonIt ? `${of} Didn’t need the best week. Just a better one.` : `${of} Rough one. The season says otherwise.`;
}

function beatdownStory(f: SeasonFacts, look: VideoLook, weekNo?: number): Scene[] {
	const L = LOOKS[look];
	const w = weekFor(f, weekNo);
	// No week lines (typed in by hand): brag about the best game we know.
	const game: SeasonGame | null = w
		? { label: `Week ${w.week}`, score: w.score, oppName: w.oppName, oppScore: w.oppScore, oppId: w.oppId }
		: (f.bestGame ?? null);
	const label = game?.label ?? 'This week';
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: L.title, kicker: `${f.leagueName} · ${label}`, headline: byLook(BEATDOWN_WORDS.headline, look) as [string, string], sub: `${f.teamName}. ${label}, dominated.` },
	];
	const wonIt = !!game && won(game);
	if (game) {
		const line = wonIt
			? margin(game) >= 40
				? `Beat ${game.oppName} by ${formatScore(margin(game))}. A massacre.`
				: `Beat ${game.oppName} by ${formatScore(margin(game))}.`
			: `${formatScore(game.score)} points. ${game.oppName} got lucky.`;
		scenes.push(bestScene(game, L.best, wonIt ? 'Beatdown' : 'Robbed', line));
	}
	if (w?.best) scenes.push(starterScene(w.best, label, L.record, false));
	if (w) {
		scenes.push({ type: 'stat', duration: 5, palette: L.stat, kicker: `${label} points · league rank`, big: { kind: 'number', value: w.rank, decimals: 0 }, line: bragRankLine(w, wonIt) });
		const others = w.teams - 1;
		scenes.push({
			type: 'stat',
			duration: 5,
			palette: L.record,
			kicker: `${label} · against every team`,
			big: { kind: 'record', ...w.allPlay },
			line: w.allPlay.wins === others ? `Would have beaten all ${others}. Every single one.` : `Would have beaten ${w.allPlay.wins} of ${others}.`,
		});
	}
	const tiles = [{ value: formatPoints(f.pointsFor), label: 'Points' }];
	if (f.weeks?.length) {
		const ap = seasonAllPlay(f.weeks);
		tiles.push({ value: formatRecord(ap), label: 'All-play' });
	}
	scenes.push({
		type: 'stat',
		duration: 5,
		palette: L.games[0],
		kicker: f.outcome === 'in-progress' ? 'The season so far' : 'The season',
		big: { kind: 'record', wins: f.wins, losses: f.losses, ties: f.ties },
		line: f.wins >= f.losses ? 'And it’s not a one-off.' : 'The record lies. This week didn’t.',
		tiles,
	});
	scenes.push({ type: 'crown', duration: 6, palette: L.crown, kicker: `${label} · ${f.leagueName}`, name: f.teamName, line: byLook(BEATDOWN_WORDS.crownLine, look) as string, effect: quietEffect(L, wonIt), badge: '💪' });
	scenes.push(endScene());
	return scenes;
}

const TIGER_WORDS: Record<'sub' | 'crownLine', ByLook<string>> = {
	sub: {
		default: 'Scary on paper. Only on paper.',
		bling: 'Looks expensive. Isn’t.',
		retro: 'A collector’s item. Mint condition, never tested.',
		princess: 'A tiger in a tiara. Still a kitten.',
		poop: 'Looks scary. Smells like fear.',
		clown: 'Scary like a clown. Funny like one too.',
		jackass: 'Dressed as a tiger. Still a jackass.',
		dumpster: 'Looked hot. It was a fire.',
		crybaby: 'Big talk. Big tears.',
		snail: 'Fast start. Snail finish.',
		potato: 'Looked strong. Couch potato.',
		bombs: 'All the bombs were duds.',
		flex: 'All flex. No muscle.',
		riot: 'Big riot. Small crowd.',
		goat: 'Thought they were the GOAT.',
	},
	crownLine: {
		default: 'All roar. No bite.',
		bling: 'Counterfeit. Check the stitching.',
		retro: 'They don’t make ’em like this. Thankfully.',
		princess: 'Here, kitty kitty.',
		poop: 'Flushed when it counted.',
		clown: 'Squirting flower. No teeth.',
		jackass: 'Hee-haw. That’s not a roar.',
		dumpster: 'Up in smoke.',
		crybaby: 'Cry about it.',
		snail: 'Slow down. Oh wait.',
		potato: 'Back to the couch.',
		bombs: 'Dud.',
		flex: 'Flexed. Pulled a muscle.',
		riot: 'Riot cancelled.',
		goat: 'Just a goat.',
	},
};

/** Where those points sit in the league, and whether the record outran them. */
function tigerPoints(f: SeasonFacts): { rank: number; teams: number; lucky: boolean } | null {
	if (!f.pointsRank || !f.teams) return null;
	// A record better than the points behind it: the schedule did the work.
	return { rank: f.pointsRank, teams: f.teams, lucky: !!f.finish && f.pointsRank > f.finish };
}

/** The game that ended it: the last playoff loss, when the season ended in one. */
function tigerExit(f: SeasonFacts): SeasonGame | null {
	const last = f.playoffs[f.playoffs.length - 1];
	return last && !won(last) && f.outcome !== 'champion' ? last : null;
}

function tigerStory(f: SeasonFacts, look: VideoLook): Scene[] {
	const L = LOOKS[look];
	const pts = tigerPoints(f);
	const exit = tigerExit(f);
	const recordLine = f.wins > f.losses ? 'Looks scary. Look closer.' : 'Not even scary on paper.';
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: L.title, kicker: `${f.leagueName} · ${f.season}`, headline: ['PAPER', 'TIGER'], sub: `${f.teamName}. ${byLook(TIGER_WORDS.sub, look)}` },
		recordScene(f, L.record, recordLine, f.outcome === 'in-progress' ? 'So far' : 'Regular season'),
	];
	// Pick the angle the data makes true: a record the points don't back up,
	// a playoff exit, or at least the week the paper tore (Brandon, 2026-11-06).
	if (pts?.lucky) {
		scenes.push({
			type: 'stat',
			duration: 5,
			palette: L.stat,
			kicker: 'Points scored · league rank',
			big: { kind: 'number', value: pts.rank, decimals: 0 },
			line: `${ordinal(pts.rank)} of ${pts.teams} in points. The schedule did the work.`,
		});
	} else {
		scenes.push(perWeekScene(f, L.stat, 'Not as scary as the record says.'));
	}
	if (f.worstGame) {
		const g = f.worstGame;
		scenes.push(lowScene(g, L.low, 'The paper tore', won(g) ? `Won with ${formatScore(g.score)}. Lucky, not good.` : `${g.oppName} won by ${formatScore(margin(g))}. Paper tiger.`));
	}
	if (exit) {
		scenes.push(lowScene(exit, L.low, 'Then the playoffs happened', `${exit.oppName} called the bluff.`));
	}
	scenes.push({ type: 'crown', duration: 7, palette: L.crown, kicker: `${f.leagueName} · Paper Tiger`, name: f.teamName, line: byLook(TIGER_WORDS.crownLine, look), effect: quietEffect(L, false), badge: '🐯' });
	scenes.push(endScene());
	return scenes;
}

const ROAST_WORDS: Record<'headline' | 'sub' | 'crownLine', ByLook<string | [string, string]>> = {
	headline: { default: ['SEASON', 'ROAST'], princess: ['A ROYAL', 'DISASTER'], poop: ['WHAT A', 'STINKER'], bling: ['ALL FLASH', 'NO CASH'], clown: ['FULL', 'CIRCUS'], jackass: ['TOTAL', 'JACKASS'], dumpster: ['DUMPSTER', 'FIRE'], crybaby: ['CRY', 'BABY'], snail: ['SLOW', 'AND BAD'], potato: ['COUCH', 'POTATO'], bombs: ['TOTAL', 'BOMB'], flex: ['NOTHING', 'TO FLEX'], riot: ['TOTAL', 'MELTDOWN'], goat: ['NOT THE', 'GOAT'] },
	sub: {
		default: 'Your season, roasted.',
		princess: 'Your season, wrapped with a bow. A sad bow.',
		poop: 'Your season, flushed.',
		clown: 'The whole league came to watch.',
		jackass: 'Stubborn. And bad.',
		dumpster: 'Smoke everywhere. Nobody surprised.',
		crybaby: 'Here comes the crying.',
	},
	crownLine: {
		default: 'Better luck next year. You’ll need it.',
		princess: 'Off with their crown.',
		poop: 'Flush it. Start over.',
		bling: 'Repo man’s on the way.',
		retro: 'A classic. A classic mess.',
		clown: 'Honk honk. That’s you.',
		jackass: 'Hee-haw. Bad team.',
		dumpster: 'Burned it all down.',
		crybaby: 'Go ahead. Cry about it.',
		snail: 'Still crawling.',
		potato: 'Back to the couch.',
		bombs: 'Bombed.',
		flex: 'Nothing to see here.',
		riot: 'The riot was in your lineup.',
		goat: 'Baa. Bad team.',
	},
};

/** A bad team, roasted for the season: not last, not a paper tiger, just bad. */
function roastStory(f: SeasonFacts, look: VideoLook): Scene[] {
	const L = LOOKS[look];
	const w = <T>(k: keyof typeof ROAST_WORDS) => byLook(ROAST_WORDS[k], look) as T;
	const exit = tigerExit(f);
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: L.title, kicker: `${f.leagueName} · ${f.season}`, headline: w<[string, string]>('headline'), sub: `${f.teamName}. ${w<string>('sub')}` },
		recordScene(f, L.record, f.wins > f.losses ? 'The record lies. Watch.' : 'The record says it all.', f.outcome === 'in-progress' ? 'So far' : 'Regular season'),
	];
	if (f.worstGame) {
		const g = f.worstGame;
		scenes.push(lowScene(g, L.low, 'The low point', won(g) ? `Somehow that was a win. ${g.oppName} scored ${formatScore(g.oppScore)}.` : `${g.oppName} put up ${formatScore(g.oppScore)}. Ouch.`));
	}
	if (f.pointsRank && f.teams && f.pointsRank > f.teams / 2) {
		scenes.push({
			type: 'stat',
			duration: 5,
			palette: L.stat,
			kicker: 'Points scored · league rank',
			big: { kind: 'number', value: f.pointsRank, decimals: 0 },
			line: `${ordinal(f.pointsRank)} of ${f.teams} in points.`,
		});
	} else {
		scenes.push(perWeekScene(f, L.stat, 'Not enough. Not close.'));
	}
	if (exit) scenes.push(lowScene(exit, L.low, 'Then the playoffs happened', `${exit.oppName} ended it.`));
	scenes.push({ type: 'crown', duration: 7, palette: L.crown, kicker: `${f.season} Season Roast · ${f.leagueName}`, name: f.teamName, line: w<string>('crownLine'), effect: quietEffect(L, false), badge: L.badge });
	scenes.push(endScene());
	return scenes;
}

const MID_WORDS: Record<'sub' | 'crownLine', ByLook<string>> = {
	sub: {
		default: 'Perfectly, painfully average.',
		bling: 'All that drip. All that mid.',
		retro: 'A timeless classic of average.',
		princess: 'Not a princess. Not a frog. Just… there.',
		poop: 'Not a stinker. Not good either.',
		clown: 'Not funny. Not good. Just a clown.',
		jackass: 'Stubborn. Average. Proud of it.',
		dumpster: 'Not a fire. Just warm garbage.',
		crybaby: 'Not bad enough to cry about. Yet.',
		snail: 'Going nowhere. Slowly.',
		potato: 'A whole season on the couch.',
		bombs: 'No bombs. No duds. Nothing.',
		flex: 'Average lift. Average everything.',
		riot: 'Not a riot. A shrug.',
		goat: 'Middle of the herd.',
	},
	crownLine: {
		default: 'A participation trophy for your participation.',
		bling: 'Fake gold. Real mid.',
		retro: 'Middle of the pack since day one.',
		princess: 'Lady-in-waiting. Forever waiting.',
		poop: 'Not the worst thing in the bowl.',
		clown: 'Middle seat at the circus.',
		jackass: 'Half a horse. All jackass.',
		dumpster: 'Lukewarm trash.',
		crybaby: 'A little sniffle of a season.',
		snail: 'Snail’s pace to the middle.',
		potato: 'Room-temperature potato.',
		bombs: 'Fizzled out.',
		flex: 'Nothing to flex. Nothing to hide.',
		riot: 'A quiet protest.',
		goat: 'Just another goat.',
	},
};

function midStory(f: SeasonFacts, look: VideoLook): Scene[] {
	const L = LOOKS[look];
	const even = f.wins === f.losses;
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: L.title, kicker: `${f.leagueName} · ${f.season}`, headline: ['MASTER OF', 'MEDIOCRITY'], sub: `${f.teamName}. ${byLook(MID_WORDS.sub, look)}` },
		recordScene(f, L.record, even ? 'Exactly .500. Of course it is.' : 'Not good. Not bad. Just mid.'),
	];
	if (f.bestGame) scenes.push(bestScene(f.bestGame, L.best, 'The one good week', 'Don’t get used to it.'));
	scenes.push(perWeekScene(f, L.stat, 'Right in the middle. Again.'));
	if (f.worstGame) {
		const g = f.worstGame;
		scenes.push(lowScene(g, L.low, 'And then this', won(g) ? 'Still won it. Mid luck.' : 'Back to normal.'));
	}
	scenes.push({ type: 'crown', duration: 7, palette: L.crown, kicker: `${f.leagueName} · Certified Mid`, name: f.teamName, line: byLook(MID_WORDS.crownLine, look), effect: quietEffect(L, false), badge: '🏅' });
	scenes.push(endScene());
	return scenes;
}

const LAST_WORDS: Record<'headline' | 'sub' | 'record' | 'perWeek' | 'kicker' | 'crownLine', ByLook<string | [string, string]>> = {
	headline: { default: ['DEAD', 'LAST'], princess: ['A ROYAL', 'DISASTER'], poop: ['WHAT A', 'STINKER'], bling: ['BROKE', 'AND LAST'], clown: ['FULL', 'CIRCUS'], jackass: ['DEAD LAST', 'JACKASS'], dumpster: ['DUMPSTER', 'FIRE'], crybaby: ['CRY', 'BABY'], snail: ['DEAD LAST', 'SLOWLY'], potato: ['COUCH', 'POTATO'], bombs: ['TOTAL', 'BOMB'], flex: ['NOTHING', 'TO FLEX'], riot: ['TOTAL', 'MELTDOWN'], goat: ['NOT THE', 'GOAT'] },
	sub: {
		default: 'Your season, wrapped. Barely.',
		princess: 'Your season, wrapped with a bow.',
		poop: 'Your season, flushed.',
		bling: 'All flash. No cash.',
	},
	record: { default: 'Dead last. Somebody had to be.', princess: 'Dead last, but make it fabulous.', poop: 'Dead last. Hold your nose.' },
	perWeek: { default: 'Not enough. Not close.', princess: 'Dainty. Delicate. Not enough.', poop: 'Smells about right.' },
	kicker: { default: 'Last Place', princess: 'Royal Highness of Last Place' },
	crownLine: {
		default: 'The only trophy you’re getting.',
		princess: 'Long may you reign. Down here.',
		poop: 'Flush it. Next season starts now.',
		bling: 'Repo man’s on the way.',
		retro: 'A classic. A classic disaster.',
		clown: 'The whole league is laughing. At you.',
		jackass: 'Hee-haw. See you at the bottom.',
		dumpster: 'The whole season, up in flames.',
		crybaby: 'Go ahead. Cry about it.',
		snail: 'Slowest team in the league.',
		potato: 'Never got off the couch.',
		bombs: 'Bombed. All season.',
		flex: 'Flex? Not this year.',
		riot: 'The riot was in your lineup.',
		goat: 'Baa. Last place.',
	},
};

function lastStory(f: SeasonFacts, look: VideoLook): Scene[] {
	const L = LOOKS[look];
	const w = <T>(k: keyof typeof LAST_WORDS) => byLook(LAST_WORDS[k], look) as T;
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: L.title, kicker: `${f.leagueName} · ${f.season}`, headline: w<[string, string]>('headline'), sub: `${f.teamName}. ${w<string>('sub')}` },
		recordScene(f, L.record, w<string>('record')),
	];
	if (f.worstGame) {
		const g = f.worstGame;
		scenes.push(lowScene(g, L.low, 'The low point', won(g) ? `Somehow that was a win. ${g.oppName} scored ${formatScore(g.oppScore)}.` : `${g.oppName} put up ${formatScore(g.oppScore)}. Ouch.`));
	}
	scenes.push(perWeekScene(f, L.stat, w<string>('perWeek')));
	scenes.push(...gamesScenes(f, L.games, L.final));
	const kicker = w<string>('kicker');
	scenes.push({
		type: 'crown',
		duration: 7,
		palette: L.crown,
		kicker: kicker === 'Last Place' ? `${f.season} Last Place · ${f.leagueName}` : kicker,
		name: f.teamName,
		line: w<string>('crownLine'),
		effect: quietEffect(L, false),
		badge: OWN_LAST_BADGE.has(look) ? L.badge : '🥄',
	});
	scenes.push(endScene());
	return scenes;
}

export interface StoryOptions {
	kind: SeasonVideoKind;
	/** How it looks. Left out, a video saved before looks were split uses its old `theme`/`style`. */
	look?: VideoLook;
	/** @deprecated The last-place look before looks were split from stories. */
	theme?: LastPlaceTheme;
	/** @deprecated The champion look before looks were split from stories. */
	style?: ChampionStyle;
	/** The weekly roast's week; left out, the latest week played. */
	week?: number;
}

const STORIES: Record<SeasonVideoKind, (f: SeasonFacts, look: VideoLook, week?: number) => Scene[]> = {
	champion: championStory,
	recap: recapStory,
	midseason: midseasonStory,
	regular: regularStory,
	weekly: weeklyStory,
	beatdown: beatdownStory,
	tiger: tigerStory,
	roast: roastStory,
	mid: midStory,
	last: lastStory,
};

export function storyDuration(scenes: readonly Scene[]): number {
	return scenes.reduce((sum, s) => sum + s.duration, 0);
}

/** The storyboard for one season, fitted to the music bed. */
export function buildStory(facts: SeasonFacts, opts: StoryOptions): Scene[] {
	let scenes = (STORIES[opts.kind] ?? recapStory)(facts, lookOf(opts), opts.week);

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

// ── the league recap ──────────────────────────────────────────────────────

/**
 * A league recap: a title card, one card per award, the end card. The
 * champion closes it with the look's own effect. Award cards share what is
 * left of the bed under MAX_STORY_SECONDS, never under 2.5 s each.
 */
export function leagueStory(
	lf: Pick<LeagueFacts, 'leagueName' | 'season' | 'teams' | 'games' | 'moves'>,
	awards: readonly Award[],
	look: VideoLook,
	span: 'week' | 'season',
	week: number | undefined,
	stage: SeasonStage,
): Scene[] {
	const L = LOOKS[look];
	const label = span === 'week' ? `Week ${week ?? ''}`.trim() : String(lf.season);
	const headline: [string, string] =
		span === 'week' ? [label.toUpperCase(), 'RECAP'] : stage === 'mid' ? ['SEASON', 'SO FAR'] : stage === 'regular' ? ['REGULAR', 'SEASON'] : [label, 'RECAP'];
	// A champion belongs to the season end; mid-season and the regular season name none.
	if (span === 'season' && stage !== 'final') awards = awards.filter((a) => a.id !== 'champion');
	const nameOf = (id: string) => lf.teams.find((t) => t.id === id)?.name ?? '';
	const trades = span === 'week' ? weekTrades(lf, week) : [];
	const tally = span === 'season' && lf.moves ? lf.moves : null;
	const fixed = 4 + 5 + (awards.some((a) => a.id === 'champion') ? 5 : 0) + (tally ? 4 : 0);
	const others = awards.filter((a) => a.id !== 'champion').length;
	// Floored to a tenth so rounding never tips the total over the bed. Trades
	// get the longer cards (there is more to read); a week with more trades
	// than the bed holds shows as many as fit, and each kicker says "of N".
	const tenth = (x: number) => Math.floor(x * 10) / 10;
	const budget = MAX_STORY_SECONDS - fixed;
	const room = budget - others * 2.5;
	const shown = Math.max(0, Math.min(trades.length, Math.floor(room / 3.5)));
	const tradeEach = shown ? Math.max(3.5, Math.min(4.5, tenth(room / shown))) : 0;
	const each = others ? Math.max(2.5, Math.min(4, tenth((budget - shown * tradeEach) / others))) : 4;
	const scenes: Scene[] = [
		{ type: 'title', duration: 4, palette: L.title, kicker: lf.leagueName, headline, sub: span === 'week' ? 'The good, the bad and the ugly.' : 'Every award. No mercy.', noCrest: true },
	];
	const tradeScenes: Scene[] = trades.slice(0, shown).map((t, i) => ({
		type: 'trade',
		duration: tradeEach,
		palette: L.stat,
		kicker: trades.length > 1 ? `${label} · Trade ${i + 1} of ${trades.length}` : `${label} · Trade`,
		sides: t.sides.map((sd) => ({ teamId: sd.teamId, name: nameOf(sd.teamId), gets: sd.gets })),
	}));
	for (const a of awards) {
		const champ = a.id === 'champion';
		// The trades run just before the low score, so the week still ends on its roast.
		if (a.id === 'low-score') scenes.push(...tradeScenes.splice(0));
		if (champ && tally) scenes.push(tallyScene(tally, label, L.stat, nameOf));
		scenes.push({
			type: 'award',
			duration: champ ? 5 : each,
			palette: champ ? L.crown : a.tone === 'good' ? L.best : L.low,
			kicker: `${label} · ${a.title}`,
			name: nameOf(a.teamId),
			teamId: a.teamId,
			value: a.value,
			badge: a.badge,
			...(champ ? { effect: L.effect } : {}),
		});
	}
	scenes.push(...tradeScenes);
	if (tally && !awards.some((a) => a.id === 'champion')) scenes.push(tallyScene(tally, label, L.stat, nameOf));
	scenes.push(endScene());
	return scenes;
}

/** The season's trades and waiver/free agent moves, and who made the most of each. */
function tallyScene(m: LeagueMoves, label: string, palette: Palette, nameOf: (id: string) => string): Scene {
	const trader = busiest(m, 'trades');
	const picker = busiest(m, 'moves');
	const line = [
		trader && nameOf(trader.teamId) ? `Most trades: ${nameOf(trader.teamId)} (${trader.count}).` : '',
		picker && nameOf(picker.teamId) ? `Most pickups: ${nameOf(picker.teamId)} (${picker.count}).` : '',
	]
		.filter(Boolean)
		.join(' ');
	return {
		type: 'tally',
		duration: 4,
		palette,
		kicker: `${label} · Moves`,
		tiles: [
			{ value: m.tradeCount, label: m.tradeCount === 1 ? 'Trade' : 'Trades' },
			{ value: m.waiverMoves, label: 'Waiver & free agent moves' },
		],
		line,
	};
}
