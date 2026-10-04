/**
 * League History — the shareable champion card, 1200×630 PNG (satori +
 * resvg, the same pipeline as the reporter's OG images in schefter-og.ts).
 *
 * One card per league season: year, "Champion", the team's name AS IT WAS
 * that season, and the runner-up. Always dark, so it reads the same in every
 * chat client. Text only, no art: a free league has no logo on file, and the
 * card must never show another league's marks.
 *
 * The footer says "League History" and nothing more until the product has a
 * name (an open question in the business plan); it must not lead with "MFL".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

type Node = { type: string; props: Record<string, unknown> & { children?: Node | Node[] | string } };

const el = (type: string, style: Record<string, unknown>, children?: Node | Node[] | string): Node => ({
	type,
	props: { style, ...(children !== undefined ? { children } : {}) },
});

let fonts: { name: string; data: Buffer; weight: 400 | 500 | 700; style: 'normal' }[] | null = null;
function loadFonts() {
	if (fonts) return fonts;
	const load = (file: string) => readFileSync(join(process.cwd(), 'src/assets/fonts/og', file));
	fonts = [
		{ name: 'UFC Sans', data: load('UFCSans-Regular.ttf'), weight: 400, style: 'normal' },
		{ name: 'UFC Sans', data: load('UFCSans-Medium.ttf'), weight: 500, style: 'normal' },
		{ name: 'UFC Sans Condensed', data: load('UFCSans-CondensedBold.ttf'), weight: 700, style: 'normal' },
	];
	return fonts;
}

export interface ChampionCardInput {
	leagueName: string;
	year: number;
	champion: string;
	runnerUp: string | null;
	/** How many titles the champion's franchise has on record, this one included. */
	titleNumber: number;
	/** A final was played ('final') or the title went to first place ('standings'). */
	decidedBy: 'final' | 'standings';
}

const INK = '#0f1115';
const GOLD = '#d4a93c';
const MUTED = 'rgba(255,255,255,0.62)';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function buildChampionCardTree(input: ChampionCardInput): Node {
	const name = clip(input.champion, 34);
	const nameSize = name.length > 24 ? 76 : name.length > 16 ? 96 : 116;
	const ordinal = (n: number) => {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
	};
	const titleLine =
		input.titleNumber > 1 ? `${ordinal(input.titleNumber)} league title` : 'First league title';

	return el(
		'div',
		{
			width: CARD_WIDTH,
			height: CARD_HEIGHT,
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'space-between',
			padding: '56px 72px',
			background: `linear-gradient(135deg, ${INK} 0%, #1c1f27 60%, #2a2412 100%)`,
			color: '#ffffff',
			fontFamily: 'UFC Sans',
		},
		[
			el('div', { display: 'flex', flexDirection: 'column' }, [
				el('div', { fontSize: 30, fontWeight: 500, color: MUTED, letterSpacing: '0.04em' }, clip(input.leagueName, 48)),
				el('div', { display: 'flex', alignItems: 'center', marginTop: 18 }, [
					el('div', { width: 64, height: 8, background: GOLD, borderRadius: 4, marginRight: 20 }),
					el(
						'div',
						{ fontFamily: 'UFC Sans Condensed', fontWeight: 700, fontSize: 44, color: GOLD, letterSpacing: '0.08em' },
						`${input.year} CHAMPION`,
					),
				]),
			]),
			el(
				'div',
				{
					fontFamily: 'UFC Sans Condensed',
					fontWeight: 700,
					fontSize: nameSize,
					lineHeight: 1.02,
					letterSpacing: '-0.01em',
				},
				name,
			),
			el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }, [
				el('div', { display: 'flex', flexDirection: 'column' }, [
					el('div', { fontSize: 30, fontWeight: 500 }, titleLine),
					el(
						'div',
						{ fontSize: 26, color: MUTED, marginTop: 8 },
						!input.runnerUp
							? ' '
							: input.decidedBy === 'final'
								? `Beat ${clip(input.runnerUp, 40)} in the final`
								: `Finished ahead of ${clip(input.runnerUp, 40)}`,
					),
				]),
				el('div', { fontSize: 24, color: MUTED, letterSpacing: '0.06em' }, 'LEAGUE HISTORY'),
			]),
		],
	);
}

export async function renderChampionCardPng(input: ChampionCardInput): Promise<Buffer> {
	const svg = await satori(buildChampionCardTree(input) as never, {
		width: CARD_WIDTH,
		height: CARD_HEIGHT,
		fonts: loadFonts(),
	});
	return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } }).render().asPng());
}
