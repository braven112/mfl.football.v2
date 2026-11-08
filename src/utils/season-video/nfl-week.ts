/**
 * NFL week recap — the weekly video for our own social accounts (Brandon,
 * 2026-11-08). Not a league's video: it recaps the whole NFL week in
 * standard PPR scoring, so no owner or team is ever on camera.
 *
 * OURS ONLY. It is never offered on the public video maker (/video); the one
 * page that makes it is /live/weekly-recap, behind the Site Insights seat.
 *
 * Pure: the stats come in (Sleeper's weekly stat lines, read by
 * /api/nfl-week-recap), the facts, the storyboard, the voiceover script and
 * the post copy come out — so every word is tested
 * (tests/season-video-nfl-week.test.ts) and the canvas (draw.ts) only draws.
 *
 * Takedown-safe by construction: no game footage, no team logos, no player
 * photos. A player card is his name, his numbers and a lettered disc.
 *
 * The voice is "The Commish", an ORIGINAL character: a deadpan, overconfident
 * studio analyst. Never a real reporter's name or catchphrase.
 */
import { END_PALETTE, LOOKS, type Scene } from './story';

/** The positions a recap names a boom at, in card order. */
export const BOOM_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;
export type BoomPosition = (typeof BOOM_POSITIONS)[number];

/** One Sleeper weekly stat line, the fields the recap reads. */
export interface StatLine {
	pts_ppr?: number;
	gp?: number;
	rec?: number;
	rec_tgt?: number;
	[k: string]: number | undefined;
}

/** Sleeper's weekly stats: player id → stat line. */
export type WeekStats = Record<string, StatLine>;

export interface PlayerInfo {
	name: string;
	/** MFL vocabulary: QB RB WR TE PK Def … */
	position: string;
	team: string;
}

export interface PlayerWeek {
	id: string;
	name: string;
	position: string;
	team: string;
	points: number;
}

export interface Bust extends PlayerWeek {
	/** His average over the weeks he played BEFORE this one. */
	average: number;
	gamesBefore: number;
}

export interface OddStat {
	kind: 'kicker-over-rbs' | 'targets-no-catches' | 'top-score';
	value: number;
	decimals: number;
	line: string;
	/** What The Commish says over it. */
	voice: string;
}

export interface NflWeekFacts {
	season: number;
	week: number;
	booms: (PlayerWeek & { position: BoomPosition })[];
	bust: Bust | null;
	odd: OddStat | null;
}

/** A bust has to be a player people were starting: an average this high over this many games. */
export const BUST_MIN_AVERAGE = 14;
export const BUST_MIN_GAMES = 3;

const pts = (s: StatLine | undefined) => (typeof s?.pts_ppr === 'number' && Number.isFinite(s.pts_ppr) ? s.pts_ppr : null);
const played = (s: StatLine | undefined) => !!s && ((s.gp ?? 0) > 0 || pts(s) !== null);
const round1 = (x: number) => Math.round(x * 10) / 10;

/** One decimal, the way a scoreboard shows it ("34.2", "4.0"). */
export const formatPts = (x: number) => round1(x).toFixed(1);

/**
 * The week's facts from Sleeper's stat lines.
 *
 * `earlier` is every week BEFORE this one (any order); a player's average
 * counts only the weeks he played, so a bye or an injury week never drags it.
 */
export function pickNflWeek(input: {
	season: number;
	week: number;
	stats: WeekStats;
	earlier: readonly WeekStats[];
	players: Readonly<Record<string, PlayerInfo>>;
}): NflWeekFacts {
	const { season, week, stats, earlier, players } = input;
	const lines: PlayerWeek[] = [];
	for (const [id, s] of Object.entries(stats)) {
		const p = players[id];
		const points = pts(s);
		if (!p || points === null || !played(s)) continue;
		lines.push({ id, name: p.name, position: p.position, team: p.team, points });
	}
	// Ties break by name, so the same stats always make the same video.
	const byPoints = (a: PlayerWeek, b: PlayerWeek) => b.points - a.points || a.name.localeCompare(b.name);
	lines.sort(byPoints);

	const booms = BOOM_POSITIONS.map((pos) => lines.find((l) => l.position === pos))
		.filter((l): l is PlayerWeek => !!l)
		.map((l) => ({ ...l, position: l.position as BoomPosition }));

	let bust: Bust | null = null;
	for (const l of lines) {
		if (!(BOOM_POSITIONS as readonly string[]).includes(l.position)) continue;
		const before = earlier.map((w) => w[l.id]).filter((s) => played(s) && pts(s) !== null);
		if (before.length < BUST_MIN_GAMES) continue;
		const average = before.reduce((sum, s) => sum + (pts(s) ?? 0), 0) / before.length;
		if (average < BUST_MIN_AVERAGE) continue;
		const drop = average - l.points;
		const best = bust ? bust.average - bust.points : 0;
		if (drop > best || (drop === best && bust && l.name.localeCompare(bust.name) < 0)) {
			bust = { ...l, average: round1(average), gamesBefore: before.length };
		}
	}

	return { season, week, booms, bust, odd: oddStat(lines, stats, booms) };
}

/** One strange number from the week, the first of these that happened. */
function oddStat(lines: readonly PlayerWeek[], stats: WeekStats, booms: readonly PlayerWeek[]): OddStat | null {
	const topRb = booms.find((b) => b.position === 'RB');
	const kicker = lines.find((l) => l.position === 'PK');
	if (kicker && topRb && kicker.points > topRb.points) {
		return {
			kind: 'kicker-over-rbs',
			value: kicker.points,
			decimals: 1,
			line: `${kicker.name}, a kicker, outscored every running back in football.`,
			voice: `A kicker. ${kicker.name} outscored every running back in the league. Let that sink in.`,
		};
	}
	let ghost: { name: string; targets: number } | null = null;
	for (const l of lines) {
		const s = stats[l.id];
		const targets = s?.rec_tgt ?? 0;
		if (targets >= 7 && (s?.rec ?? 0) === 0 && (!ghost || targets > ghost.targets)) ghost = { name: l.name, targets };
	}
	if (ghost) {
		return {
			kind: 'targets-no-catches',
			value: ghost.targets,
			decimals: 0,
			line: `${ghost.name}: ${ghost.targets} targets. Zero catches.`,
			voice: `${ghost.name} saw ${ghost.targets} targets. Caught zero. That's not a stat line, that's a cry for help.`,
		};
	}
	const top = lines[0];
	if (!top) return null;
	return {
		kind: 'top-score',
		value: top.points,
		decimals: 1,
		line: `${top.name} put up the most PPR points of anybody this week.`,
		voice: `Top score of the whole week? ${top.name}. ${formatPts(top.points)}. Write it down.`,
	};
}

// ── the video ─────────────────────────────────────────────────────────────

/** A storyboard and the line The Commish reads over each card (null: music only). */
export interface NflWeekVideo {
	scenes: Scene[];
	voice: (string | null)[];
}

const BOOM_BADGE: Record<BoomPosition, string> = { QB: '🎯', RB: '🚂', WR: '🚀', TE: '🧱' };
const POSITION_WORD: Record<BoomPosition, string> = { QB: 'quarterback', RB: 'running back', WR: 'receiver', TE: 'tight end' };

/** The line The Commish reads over a boom card. */
function boomVoice(b: PlayerWeek & { position: BoomPosition }): string {
	const p = formatPts(b.points);
	switch (b.position) {
		case 'QB':
			return `Top quarterback this week: ${b.name}. ${p} points. If you had him, you're welcome.`;
		case 'RB':
			return `${b.name}, ${p} from the backfield.`;
		case 'WR':
			return `${b.name} with ${p} at receiver.`;
		default:
			return `And at tight end, ${b.name}, ${p}. Yes, a tight end.`;
	}
}

/**
 * The week's video: hook, a boom per position, the bust, the bust as a roast
 * (the demo: "send this to the league mate who started him"), one odd stat,
 * the end card. About 42 seconds, under the 50-second music bed.
 */
export function nflWeekVideo(f: NflWeekFacts): NflWeekVideo {
	const brag = LOOKS.bombs;
	const roast = LOOKS.dumpster;
	const clown = LOOKS.clown;
	const label = `Week ${f.week}`;
	const scenes: Scene[] = [];
	const voice: (string | null)[] = [];
	const add = (s: Scene, line: string | null) => {
		scenes.push(s);
		voice.push(line);
	};

	add(
		{ type: 'title', duration: 3.5, palette: brag.title, kicker: `NFL ${label} · PPR`, headline: [label.toUpperCase(), 'RECAP'], sub: 'Who carried you. Who ruined you.', noCrest: true },
		`${label}. I'm The Commish. Let's find out who carried you, and who ruined your week.`,
	);
	f.booms.forEach((b, i) =>
		add(
			{
				type: 'player',
				duration: b.position === 'QB' ? 4.5 : 3.5,
				palette: i % 2 ? brag.stat : brag.best,
				kicker: `${label} · Top ${POSITION_WORD[b.position]}`,
				points: b.points,
				unit: 'PPR points',
				name: b.name,
				sub: [b.position, b.team].filter(Boolean).join(' · '),
				badge: BOOM_BADGE[b.position],
			},
			boomVoice(b),
		),
	);
	if (f.bust) {
		const b = f.bust;
		add(
			{
				type: 'player',
				duration: 5,
				palette: roast.low,
				kicker: `${label} · Bust of the week`,
				points: b.points,
				unit: 'PPR points',
				name: b.name,
				sub: `He was averaging ${formatPts(b.average)}.`,
				badge: '📉',
			},
			`Bust of the week. ${b.name}. Averaging ${formatPts(b.average)}, gave you ${formatPts(b.points)}. I've seen better production from a bye week.`,
		);
		add(
			{
				type: 'player',
				duration: 5,
				palette: clown.crown,
				kicker: 'Started him? We see you.',
				points: b.points,
				unit: 'PPR points',
				name: b.name,
				sub: 'Got a league mate who started him? Send them one of these.',
				badge: '🤡',
				effect: clown.effect,
			},
			`Got a league mate who started him? Make them one of these. Takes a minute.`,
		);
	}
	if (f.odd) {
		add(
			{ type: 'stat', duration: 4.5, palette: roast.stat, kicker: `${label} · Stat of the week`, big: { kind: 'number', value: f.odd.value, decimals: f.odd.decimals }, line: f.odd.line },
			f.odd.voice,
		);
	}
	add(
		{ type: 'end', duration: 5, palette: END_PALETTE, kicker: 'Made with', line: 'Roast your league mate. Free.' },
		'Make yours free, at m f l dot football, slash video.',
	);
	return { scenes, voice };
}

/** The post's text per platform: one line, the link, a few tags. */
export function nflWeekPostCopy(f: NflWeekFacts): { x: string; tiktok: string; youtube: string } {
	const hook = f.bust
		? `Week ${f.week}'s biggest bust: ${f.bust.name}. Know someone who started him?`
		: `Week ${f.week} in fantasy: who carried you, who ruined you.`;
	const link = 'Roast your league mate free: mfl.football/video';
	return {
		x: `${hook} ${link} #FantasyFootball`,
		tiktok: `${hook} ${link} #fantasyfootball #nfl #ppr #fantasyfootballtiktok`,
		youtube: `Week ${f.week} Fantasy Recap (PPR) #shorts #fantasyfootball\n\n${hook}\n${link}`,
	};
}

/** Breathing room after a voiceover line before the next card cuts in. */
export const VOICE_TAIL_S = 0.4;

/**
 * Stretch each card to hold its voiceover line, so one line never talks over
 * the next card. `clipSeconds[i]` is card i's clip length (null: no clip).
 * Cards only grow, never shrink below their own timing.
 */
export function fitScenesToVoice(scenes: readonly Scene[], clipSeconds: readonly (number | null)[]): Scene[] {
	return scenes.map((s, i) => {
		const clip = clipSeconds[i];
		if (!clip || !Number.isFinite(clip)) return s;
		const need = Math.ceil((clip + VOICE_TAIL_S) * 10) / 10;
		return need > s.duration ? { ...s, duration: need } : s;
	});
}
