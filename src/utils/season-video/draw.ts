/**
 * Season video — draws one frame of a storyboard (story.ts) onto a 1080×1920
 * canvas. Browser only, and nothing here reads the network: every image is
 * handed in already decoded, and every one is same-origin (a data: or blob:
 * URL, or one of our own assets), because a single cross-origin image
 * taints the canvas and MediaRecorder then refuses to record it.
 *
 * Layout keeps to the vertical-video safe zone: nothing important above
 * y=250 or below y=1500 (TikTok, Shorts and Reels put their own buttons
 * there), and a wider right margin for the like/share rail.
 *
 * The motion is the original Computer Jocks cut's: each card rises and fades
 * in over half a second, numbers count up with an ease-out, and each card
 * lifts away in its last 0.4 s.
 */
import type { CrownEffect, Palette, Scene } from './story';
import { formatRecord, formatScore } from './season';

export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;

const CX = 515; // centre of the safe zone (left 90, right 140)
const MAX_W = 840;
const DISPLAY = '"SVCond", "UFC Sans Condensed", "Arial Narrow", Impact, sans-serif';
const TEXT = 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif';

export type Img = CanvasImageSource & { width: number; height: number };

export interface DrawAssets {
	team: Img | null;
	/** Opponent logos keyed by the game's `oppLogo` string. */
	opponents: Map<string, Img>;
	/** The MFL.football mark, and the wordmark's lettering alone (dark-ground cuts): the end card shows the mark once. */
	mark: Img | null;
	wordmark: Img | null;
	/** False draws the team logo without its circle. Left out, the circle. */
	teamCircle?: boolean;
	/** A league recap's logos, by team id. */
	logos?: Map<string, Img>;
}

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const rnd = (i: number) => {
	const x = Math.sin(i * 999.13) * 43758.5453;
	return x - Math.floor(x);
};

/** Where `t` falls: the scene, its index and the time into it. */
export function sceneAt(scenes: readonly Scene[], t: number): { scene: Scene; index: number; p: number } {
	let start = 0;
	for (let i = 0; i < scenes.length; i++) {
		const d = scenes[i].duration;
		if (t < start + d || i === scenes.length - 1) return { scene: scenes[i], index: i, p: Math.max(0, t - start) };
		start += d;
	}
	return { scene: scenes[0], index: 0, p: 0 };
}

// ── text ──────────────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;

function font(ctx: Ctx, size: number, kind: 'display' | 'text' | 'kicker') {
	ctx.font = kind === 'display' ? `700 ${size}px ${DISPLAY}` : `${kind === 'kicker' ? 700 : 600} ${size}px ${TEXT}`;
	const spacing = kind === 'kicker' ? `${Math.round(size * 0.2)}px` : '0px';
	if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = spacing;
}

/** The largest size ≤ `size` at which `text` fits `max` wide. */
function fit(ctx: Ctx, text: string, max: number, size: number, min: number, kind: 'display' | 'text' | 'kicker'): number {
	let s = size;
	for (; s > min; s -= 4) {
		font(ctx, s, kind);
		if (ctx.measureText(text).width <= max) return s;
	}
	font(ctx, min, kind);
	return min;
}

function wrap(ctx: Ctx, text: string, max: number): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = '';
	for (const w of words) {
		const next = line ? `${line} ${w}` : w;
		if (ctx.measureText(next).width > max && line) {
			lines.push(line);
			line = w;
		} else line = next;
	}
	if (line) lines.push(line);
	return lines;
}

function centered(ctx: Ctx, text: string, y: number, color: string, x = CX) {
	ctx.fillStyle = color;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';
	ctx.fillText(text, x, y);
}

/** A paragraph, centred, up to `maxLines`; returns the y below it. */
function paragraph(ctx: Ctx, text: string, y: number, size: number, color: string, max = MAX_W - 40, maxLines = 3): number {
	font(ctx, size, 'text');
	let lines = wrap(ctx, text, max);
	let s = size;
	while (lines.length > maxLines && s > 30) {
		s -= 4;
		font(ctx, s, 'text');
		lines = wrap(ctx, text, max);
	}
	lines.slice(0, maxLines).forEach((l, i) => centered(ctx, l, y + i * s * 1.25, color));
	return y + lines.length * s * 1.25;
}

function kicker(ctx: Ctx, text: string, y: number, color: string) {
	const s = fit(ctx, text.toUpperCase(), MAX_W, 40, 24, 'kicker');
	font(ctx, s, 'kicker');
	centered(ctx, text.toUpperCase(), y, color);
}

function display(ctx: Ctx, text: string, y: number, size: number, color: string, max = MAX_W, x = CX) {
	fit(ctx, text, max, size, Math.min(size, 70), 'display');
	centered(ctx, text, y, color, x);
}

// ── crests ────────────────────────────────────────────────────────────────

function initials(name: string): string {
	const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
	return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

function crest(ctx: Ctx, img: Img | null, name: string, x: number, y: number, r: number, pal: Palette, ring?: string, circle = true) {
	if (!circle && img && img.width && img.height) {
		// A logo already cut out to its shape: drawn whole, no disc, no ring.
		const scale = Math.min((2 * r) / img.width, (2 * r) / img.height);
		const w = img.width * scale;
		const h = img.height * scale;
		ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
		return;
	}
	ctx.save();
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.closePath();
	ctx.fillStyle = '#000000';
	ctx.fill();
	ctx.clip();
	if (img && img.width && img.height) {
		// Contain, not cover: a crest is usually a whole mark, and cropping
		// its edges loses the lettering.
		const scale = Math.min((2 * r) / img.width, (2 * r) / img.height);
		const w = img.width * scale;
		const h = img.height * scale;
		ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
	} else {
		ctx.fillStyle = pal.accent;
		ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
		font(ctx, r * 0.8, 'display');
		ctx.fillStyle = pal.bg;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(initials(name), x, y + r * 0.04);
	}
	ctx.restore();
	if (ring) {
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.lineWidth = Math.max(5, r * 0.06);
		ctx.strokeStyle = ring;
		ctx.stroke();
	}
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

// ── scenes ────────────────────────────────────────────────────────────────

type SceneOf<T extends Scene['type']> = Extract<Scene, { type: T }>;

function drawTitle(ctx: Ctx, s: SceneOf<'title'>, p: number, a: DrawAssets, teamName: string) {
	const pal = s.palette;
	if (!s.noCrest) crest(ctx, a.team, teamName, CX, 430, 110, pal, pal.accent, a.teamCircle !== false);
	kicker(ctx, s.kicker, 640, pal.accent);
	const sc = 1 + (1 - easeOut(p / 0.35)) * 0.25;
	ctx.save();
	ctx.translate(CX, 900);
	ctx.scale(sc, sc);
	ctx.translate(-CX, -900);
	display(ctx, s.headline[0], 860, 250, pal.ink);
	display(ctx, s.headline[1], 1090, 250, pal.accent);
	ctx.restore();
	paragraph(ctx, s.sub, 1230, 50, pal.muted);
}

function drawStat(ctx: Ctx, s: SceneOf<'stat'>, p: number, a: DrawAssets, teamName: string) {
	const pal = s.palette;
	crest(ctx, a.team, teamName, CX, 450, 110, pal, pal.accent, a.teamCircle !== false);
	kicker(ctx, s.kicker, 650, pal.accent);
	const k = easeOut((p - 0.3) / 1.4);
	const big =
		s.big.kind === 'record'
			? formatRecord({ wins: Math.round(s.big.wins * k), losses: Math.round(s.big.losses * k), ties: Math.round(s.big.ties * k) })
			: (s.big.value * k).toFixed(s.big.decimals);
	display(ctx, big, 930, 300, pal.ink);
	let y = 1000;
	if (s.tiles?.length) {
		const w = 360;
		const gap = 28;
		const total = s.tiles.length * w + (s.tiles.length - 1) * gap;
		s.tiles.forEach((tile, i) => {
			ctx.save();
			ctx.globalAlpha *= easeOut((p - 1 - i * 0.4) / 0.4);
			const x = CX - total / 2 + i * (w + gap);
			roundRect(ctx, x, y, w, 200, 26);
			ctx.fillStyle = 'rgba(255,255,255,0.08)';
			ctx.fill();
			ctx.lineWidth = 2;
			ctx.strokeStyle = 'rgba(255,255,255,0.18)';
			ctx.stroke();
			display(ctx, tile.value, y + 110, 100, pal.accent, w - 40, x + w / 2);
			font(ctx, 30, 'kicker');
			centered(ctx, tile.label.toUpperCase(), y + 165, pal.muted, x + w / 2);
			ctx.restore();
		});
		y += 260;
	}
	if (s.line) paragraph(ctx, s.line, y + 50, 48, pal.ink);
}

function drawGame(ctx: Ctx, s: SceneOf<'game'>, p: number, a: DrawAssets, teamName: string) {
	const pal = s.palette;
	const g = s.game;
	const opp = g.oppLogo ? a.opponents.get(g.oppLogo) ?? null : null;
	kicker(ctx, s.kicker, 560, pal.accent === pal.ink ? pal.muted : pal.accent);
	display(ctx, formatScore(g.score * easeOut((p - 0.3) / 1.6)), 830, 300, pal.ink);

	if (s.bars) {
		const k = easeOut((p - 0.5) / 1.6);
		const top = Math.max(g.score, g.oppScore, 1);
		const rows: [Img | null, string, number, string][] = [
			[a.team, teamName, g.score, pal.ink],
			[opp, g.oppName, g.oppScore, pal.ink],
		];
		rows.forEach(([img, name, score, color], i) => {
			const y = 940 + i * 120;
			crest(ctx, img, name, 170, y + 40, 46, pal, undefined, i === 0 ? a.teamCircle !== false : true);
			ctx.save();
			ctx.globalAlpha *= i === 0 ? 1 : 0.4;
			roundRect(ctx, 240, y + 12, Math.max(56, 680 * (score / top) * k), 56, 28);
			ctx.fillStyle = color;
			ctx.fill();
			ctx.restore();
		});
		paragraph(ctx, s.line, 1250, 48, pal.ink);
		return;
	}

	const fade = easeOut((p - 2.2) / 0.5);
	ctx.save();
	ctx.globalAlpha *= s.won ? 1 : 1 - 0.65 * fade;
	crest(ctx, a.team, teamName, CX - 230, 1010, 90, pal, s.won ? pal.good : undefined, a.teamCircle !== false);
	ctx.restore();
	font(ctx, 60, 'display');
	centered(ctx, 'VS', 1032, pal.muted);
	ctx.save();
	ctx.globalAlpha *= s.won ? 1 - 0.65 * fade : 1;
	crest(ctx, opp, g.oppName, CX + 230, 1010, 90, pal, s.won ? undefined : pal.bad);
	ctx.restore();
	paragraph(ctx, s.line, 1220, 48, pal.ink);
}

function drawFinal(ctx: Ctx, s: SceneOf<'final'>, p: number, a: DrawAssets) {
	const pal = s.palette;
	const g = s.game;
	const opp = g.oppLogo ? a.opponents.get(g.oppLogo) ?? null : null;
	kicker(ctx, s.kicker, 470, pal.accent);
	const k = easeOut((p - 0.6) / 2.6);
	const reveal = easeOut((p - 3.4) / 0.4);
	const cols: [Img | null, string, number, boolean][] = [
		[a.team, s.teamName, g.score, s.won],
		[opp, g.oppName, g.oppScore, !s.won],
	];
	cols.forEach(([img, name, score, isWinner], i) => {
		const x = CX + (i === 0 ? -215 : 215);
		ctx.save();
		ctx.globalAlpha *= isWinner ? 1 : 1 - 0.55 * reveal;
		crest(ctx, img, name, x, 690, 130, pal, isWinner && reveal > 0.5 ? pal.accent : undefined, i === 0 ? a.teamCircle !== false : true);
		const sc = isWinner ? 1 + 0.12 * reveal : 1;
		ctx.translate(x, 960);
		ctx.scale(sc, sc);
		ctx.translate(-x, -960);
		display(ctx, formatScore(score * k), 960, 150, isWinner && reveal > 0.5 ? pal.accent : pal.ink, 400, x);
		ctx.restore();
		// Long names shrink before they wrap past three lines; nothing is cut.
		let size = 30;
		font(ctx, size, 'kicker');
		let lines = wrap(ctx, name.toUpperCase(), 380);
		while (lines.length > 3 && size > 20) {
			size -= 2;
			font(ctx, size, 'kicker');
			lines = wrap(ctx, name.toUpperCase(), 380);
		}
		lines.forEach((l, j) => centered(ctx, l, 1040 + j * size * 1.35, pal.muted, x));
	});
	paragraph(ctx, s.line, 1240, 48, pal.ink);
}

function drawCrown(ctx: Ctx, s: SceneOf<'crown'>, p: number, a: DrawAssets, teamName: string) {
	const pal = s.palette;
	// The effect falls BEHIND the crest and the words, so it never hides them.
	drawEffect(ctx, s.effect, p);
	kicker(ctx, s.kicker, 400, pal.accent);
	const sc = 0.6 + 0.4 * easeOut(p / 0.6);
	ctx.save();
	ctx.translate(CX, 720);
	ctx.scale(sc, sc);
	// The halo is part of the circle: a logo drawn without one gets no background at all.
	if (a.teamCircle !== false || !a.team) {
		ctx.beginPath();
		ctx.arc(0, 0, 236, 0, Math.PI * 2);
		ctx.fillStyle = hexAlpha(pal.accent, 0.16);
		ctx.fill();
	}
	ctx.translate(-CX, -720);
	crest(ctx, a.team, teamName, CX, 720, 200, pal, pal.accent, a.teamCircle !== false);
	ctx.restore();
	if (s.badge) {
		const b = easeOut((p - 0.5) / 0.5);
		ctx.save();
		ctx.globalAlpha *= b;
		ctx.font = `120px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(s.badge, CX + 175, 540 - (1 - b) * 60);
		ctx.restore();
	}
	const name = s.name.toUpperCase();
	const size = fit(ctx, name, MAX_W, 150, 90, 'display');
	const lines = ctx.measureText(name).width > MAX_W ? wrap(ctx, name, MAX_W).slice(0, 2) : [name];
	lines.forEach((l, i) => centered(ctx, l, 1080 + i * size * 0.95, pal.ink));
	paragraph(ctx, s.line, 1110 + lines.length * size * 0.95, 48, pal.muted);
}

/** A league recap's award: the badge, the team's crest, its name and its numbers. */
function drawAward(ctx: Ctx, s: SceneOf<'award'>, p: number, a: DrawAssets) {
	const pal = s.palette;
	if (s.effect) drawEffect(ctx, s.effect, p);
	kicker(ctx, s.kicker, 400, pal.accent);
	const sc = 0.6 + 0.4 * easeOut(p / 0.5);
	ctx.save();
	ctx.translate(CX, 720);
	ctx.scale(sc, sc);
	ctx.translate(-CX, -720);
	crest(ctx, a.logos?.get(s.teamId) ?? null, s.name, CX, 720, 200, pal, pal.accent);
	ctx.restore();
	const b = easeOut((p - 0.4) / 0.4);
	ctx.save();
	ctx.globalAlpha *= b;
	ctx.font = `120px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(s.badge, CX + 175, 540 - (1 - b) * 60);
	ctx.restore();
	const name = s.name.toUpperCase();
	const size = fit(ctx, name, MAX_W, 130, 80, 'display');
	const lines = ctx.measureText(name).width > MAX_W ? wrap(ctx, name, MAX_W).slice(0, 2) : [name];
	lines.forEach((l, i) => centered(ctx, l, 1060 + i * size * 0.95, pal.ink));
	paragraph(ctx, s.value, 1090 + lines.length * size * 0.95, 48, pal.muted);
}

function drawTrade(ctx: Ctx, s: SceneOf<'trade'>, p: number, a: DrawAssets) {
	const pal = s.palette;
	kicker(ctx, s.kicker, 400, pal.accent);
	const sides = s.sides.slice(0, 3);
	const n = sides.length;
	const colW = MAX_W / n;
	const r = n === 2 ? 125 : 95;
	const crestY = 610;
	const sc = 0.6 + 0.4 * easeOut(p / 0.5);
	sides.forEach((side, i) => {
		const x = CX - MAX_W / 2 + colW * (i + 0.5);
		ctx.save();
		ctx.translate(x, crestY);
		ctx.scale(sc, sc);
		ctx.translate(-x, -crestY);
		crest(ctx, a.logos?.get(side.teamId) ?? null, side.name, x, crestY, r, pal, pal.accent);
		ctx.restore();
		const name = side.name.toUpperCase();
		fit(ctx, name, colW - 30, 64, 34, 'display');
		centered(ctx, name, crestY + r + 85, pal.ink, x);
		ctx.save();
		ctx.globalAlpha *= easeOut((p - 0.5) / 0.4);
		font(ctx, 30, 'kicker');
		centered(ctx, 'GETS', crestY + r + 150, pal.muted, x);
		// Every asset, wrapped to the column; past eight lines the rest is counted.
		font(ctx, n === 2 ? 38 : 32, 'text');
		const lines: string[] = [];
		side.gets.forEach((g, j) => {
			const wrapped = wrap(ctx, g, colW - 30);
			if (lines.length + wrapped.length > 8) {
				if (!lines.at(-1)?.startsWith('+')) lines.push(`+${side.gets.length - j} more`);
				return;
			}
			lines.push(...wrapped);
		});
		if (!side.gets.length) lines.push('Nothing');
		lines.forEach((l, j) => centered(ctx, l, crestY + r + 215 + j * 50, pal.ink, x));
		ctx.restore();
	});
	if (n === 2) {
		const b = easeOut((p - 0.3) / 0.4);
		ctx.save();
		ctx.globalAlpha *= b;
		ctx.font = `96px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('🤝', CX, crestY);
		ctx.restore();
	}
}

function drawTally(ctx: Ctx, s: SceneOf<'tally'>, p: number) {
	const pal = s.palette;
	kicker(ctx, s.kicker, 400, pal.accent);
	const k = easeOut((p - 0.2) / 1.2);
	s.tiles.slice(0, 2).forEach((tile, i) => {
		const y = 480 + i * 330;
		ctx.save();
		ctx.globalAlpha *= easeOut((p - i * 0.3) / 0.4);
		roundRect(ctx, CX - MAX_W / 2, y, MAX_W, 290, 30);
		ctx.fillStyle = 'rgba(255,255,255,0.08)';
		ctx.fill();
		ctx.lineWidth = 2;
		ctx.strokeStyle = 'rgba(255,255,255,0.18)';
		ctx.stroke();
		display(ctx, Math.round(tile.value * k).toLocaleString('en-US'), y + 165, 190, pal.accent);
		font(ctx, 34, 'kicker');
		centered(ctx, tile.label.toUpperCase(), y + 245, pal.muted);
		ctx.restore();
	});
	if (s.line) {
		ctx.save();
		ctx.globalAlpha *= easeOut((p - 1) / 0.5);
		paragraph(ctx, s.line, 1200, 44, pal.ink);
		ctx.restore();
	}
}

function drawEnd(ctx: Ctx, s: SceneOf<'end'>, p: number, a: DrawAssets) {
	const pal = s.palette;
	kicker(ctx, s.kicker, 480, pal.muted);
	const k = easeOut(p / 0.6);
	if (a.mark) {
		const size = 320 * (0.85 + 0.15 * k);
		ctx.drawImage(a.mark, CX - size / 2, 720 - size / 2, size, size);
	}
	if (a.wordmark) {
		const w = 760;
		const h = (w * a.wordmark.height) / a.wordmark.width;
		ctx.drawImage(a.wordmark, CX - w / 2, 960 - h / 2, w, h);
	} else display(ctx, 'MFL.football', 990, 160, pal.ink);
	ctx.save();
	ctx.globalAlpha *= easeOut((p - 0.8) / 0.5);
	paragraph(ctx, s.line, 1150, 46, pal.ink);
	display(ctx, 'mfl.football/video', 1290, 64, pal.accent);
	ctx.restore();
}

function hexAlpha(hex: string, alpha: number): string {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!m) return hex;
	return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

/** Effects that rain emoji down the crown card, by look. Sparkles twinkle instead. */
const FALLING: Partial<Record<CrownEffect, string[]>> = {
	poop: ['💩', '🪰', '💩', '🧻'],
	money: ['💵', '💸', '💰', '💎', '💵'],
	clown: ['🤡', '🎈', '🎪', '🤡', '🔴'],
	jackass: ['🫏', '🥕', '🫏', '💥'],
	dumpster: ['🔥', '🗑️', '🔥', '💨'],
	crybaby: ['🍼', '😭', '💧', '🧸'],
	snail: ['🐌', '🐌', '🌿', '💤'],
	potato: ['🥔', '📺', '🛋️', '🥔'],
	bombs: ['💣', '💥', '🔥', '💣'],
	flex: ['💪', '🏋️', '💪', '🔥'],
	riot: ['🚨', '🔥', '⚡', '🚨'],
	goat: ['🐐', '👑', '🏆', '🐐'],
};

function drawEffect(ctx: Ctx, effect: CrownEffect, p: number) {
	if (effect === 'none') return;
	if (effect === 'confetti' || effect === 'retro') {
		const cols = effect === 'retro' ? ['#e2711d', '#f2b134', '#2a7f7a', '#f3e6c8'] : ['#e8c46a', '#2e8b57', '#ffffff', '#8ee59c'];
		for (let i = 0; i < 80; i++) {
			const q = p - (0.3 + rnd(i) * 1.5);
			if (q < 0) continue;
			const x = rnd(i + 100) * VIDEO_WIDTH + Math.sin(q * 3 + i) * 40;
			const y = -60 + q * (380 + rnd(i + 200) * 320);
			if (y > VIDEO_HEIGHT) continue;
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate((q * 300 * (rnd(i + 3) - 0.5) * Math.PI) / 180);
			ctx.fillStyle = cols[i % 4];
			ctx.fillRect(-8, -14, 16, 28);
			ctx.restore();
		}
		return;
	}
	const glyphs = FALLING[effect] ?? ['✨', '💖', '👑', '✨', '🌸'];
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	for (let i = 0; i < 34; i++) {
		const q = p - (0.2 + rnd(i) * 2);
		if (q < 0) continue;
		const size = 56 + rnd(i + 7) * 60;
		ctx.font = `${Math.round(size)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
		ctx.save();
		if (FALLING[effect]) {
			// Falls, tumbling.
			const x = rnd(i + 100) * VIDEO_WIDTH;
			const y = -80 + q * (300 + rnd(i + 200) * 260);
			if (y > VIDEO_HEIGHT + 80) {
				ctx.restore();
				continue;
			}
			ctx.translate(x, y);
			ctx.rotate(Math.sin(q * 2 + i) * 0.5);
		} else {
			// Twinkles in place, drifting up, along the edges so the words stay clear.
			const side = rnd(i + 100);
			const x = side < 0.5 ? 30 + side * 2 * 170 : VIDEO_WIDTH - 200 + (side - 0.5) * 2 * 170;
			const y = 300 + rnd(i + 300) * 1300 - q * 40;
			ctx.globalAlpha *= 0.4 + 0.6 * Math.abs(Math.sin(q * 3 + i));
			ctx.translate(x, y);
			ctx.scale(easeOut(q / 0.4), easeOut(q / 0.4));
		}
		ctx.fillText(glyphs[i % glyphs.length], 0, 0);
		ctx.restore();
	}
}

/** Draw the frame at time `t` (seconds). */
export function drawFrame(ctx: Ctx, scenes: readonly Scene[], t: number, assets: DrawAssets, teamName: string) {
	const { scene, index, p } = sceneAt(scenes, t);
	const pal = scene.palette;
	ctx.save();
	ctx.globalAlpha = 1;
	ctx.fillStyle = pal.bg;
	ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
	// A soft glow behind the content, so a flat ground still has depth.
	const glow = ctx.createRadialGradient(CX, 820, 60, CX, 820, 1100);
	glow.addColorStop(0, 'rgba(255,255,255,0.10)');
	glow.addColorStop(1, 'rgba(0,0,0,0.22)');
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);

	const d = scene.duration;
	const last = index === scenes.length - 1;
	let alpha = easeOut(p / 0.45);
	let y = (1 - easeOut(p / 0.5)) * 120;
	if (!last && p > d - 0.4) {
		const q = (p - (d - 0.4)) / 0.4;
		alpha *= 1 - q;
		y -= q * 160;
	}
	ctx.globalAlpha = alpha;
	ctx.translate(0, y);
	switch (scene.type) {
		case 'title':
			drawTitle(ctx, scene, p, assets, teamName);
			break;
		case 'stat':
			drawStat(ctx, scene, p, assets, teamName);
			break;
		case 'game':
			drawGame(ctx, scene, p, assets, teamName);
			break;
		case 'final':
			drawFinal(ctx, scene, p, assets);
			break;
		case 'crown':
			drawCrown(ctx, scene, p, assets, teamName);
			break;
		case 'end':
			drawEnd(ctx, scene, p, assets);
			break;
		case 'award':
			drawAward(ctx, scene, p, assets);
			break;
		case 'trade':
			drawTrade(ctx, scene, p, assets);
			break;
		case 'tally':
			drawTally(ctx, scene, p);
			break;
	}
	ctx.restore();

	// A small credit on every card but the end card, inside the safe zone.
	if (scene.type !== 'end') {
		ctx.save();
		ctx.globalAlpha = 0.7;
		font(ctx, 28, 'kicker');
		centered(ctx, 'MFL.FOOTBALL', 1490, pal.muted);
		ctx.restore();
	}
}
