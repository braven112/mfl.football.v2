/**
 * Ask the History — the share card for one saved answer, a PORTRAIT
 * 1080×1350 PNG (4:5, satori + resvg, the same pipeline and fonts as the
 * champion and record cards).
 *
 * Portrait because it is made to be posted as a picture into a phone chat
 * (GroupMe): Brandon, 2026-11-12, the landscape Record Book cards "would look
 * good maybe as landscape, but [in] portrait view they don't look so good,
 * which is a better thing to use for sharing". A tall card fills a phone
 * chat's column; a 1.91:1 one is a strip.
 *
 * What it draws is the saved answer only (ask-store.ts) — the question, the
 * headline stat, the answer in words — so the endpoint cannot be used to draw
 * arbitrary text. The asker's name is never on it. Always dark, so it reads
 * the same in every chat client. The footer invites the reader to ask their
 * own, which is the point of sharing it.
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { loadFonts } from './champion-card';

export const ANSWER_CARD_WIDTH = 1080;
export const ANSWER_CARD_HEIGHT = 1350;

type Node = { type: string; props: Record<string, unknown> & { children?: Node | Node[] | string } };

const el = (type: string, style: Record<string, unknown>, children?: Node | Node[] | string): Node => ({
	type,
	props: { style, ...(children !== undefined ? { children } : {}) },
});

export interface AnswerCardInput {
	leagueName: string;
	question: string;
	headline: { value: string; label: string } | null;
	answer: string;
	/** The answer's team logo as a data URI (record-card logoDataUri), or null. */
	logo?: string | null;
	/** Where to ask your own, shown in the footer: "theleague.us/history/ask". */
	askAt: string;
}

const INK = '#0f1115';
const GOLD = '#d4a93c';
const MUTED = 'rgba(255,255,255,0.66)';

/** Cut at a word boundary, with an ellipsis, so a long answer never overflows the card. */
export function clipWords(text: string, max: number): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (clean.length <= max) return clean;
	const cut = clean.slice(0, max - 1);
	const space = cut.lastIndexOf(' ');
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

/** The headline's font size: as big as fits one line of the card. */
export function headlineSize(value: string): number {
	const n = value.length;
	if (n <= 6) return 220;
	if (n <= 9) return 170;
	if (n <= 13) return 124;
	return 96;
}

/** The team's logo as it was in the answer's season (else its latest season on record). */
export function teamIcon(data: any, franchiseId: string | null, year: number | null): string | null {
	if (!franchiseId || !Array.isArray(data?.seasons)) return null;
	const seasons = data.seasons as Array<{ y: number; teams?: Record<string, { i?: string }> }>;
	const exact = year == null ? null : seasons.find((s) => s.y === year)?.teams?.[franchiseId]?.i;
	if (exact) return exact;
	for (let i = seasons.length - 1; i >= 0; i--) {
		const icon = seasons[i].teams?.[franchiseId]?.i;
		if (icon) return icon;
	}
	return null;
}

/** "theleague.us/history/ask" — the league's own ask page, without the scheme. */
export function askAtLabel(href: string): string {
	return href.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

export function buildAnswerCardTree(input: AnswerCardInput): Node {
	const logo = input.logo ?? null;
	const head = input.headline;
	// With a headline the answer is the supporting line; without one it IS the
	// card, so it gets the room and the bigger type.
	const answer = clipWords(input.answer, head ? 260 : 360);
	const answerSize = head ? 36 : answer.length > 220 ? 44 : 52;

	const middle: Node[] = head
		? [
				el('div', { display: 'flex', alignItems: 'center' }, [
					...(logo
						? [{ type: 'img', props: { src: logo, width: 150, height: 150, style: { objectFit: 'contain', marginRight: 32 } } } as Node]
						: []),
					el(
						'div',
						{ display: 'flex', fontFamily: 'UFC Sans Condensed', fontWeight: 700, fontSize: headlineSize(head.value), lineHeight: 1, color: '#ffffff' },
						clipWords(head.value, 18),
					),
				]),
				el('div', { display: 'flex', fontSize: 44, fontWeight: 500, color: GOLD, marginTop: 20, lineHeight: 1.2 }, clipWords(head.label, 70)),
				el('div', { display: 'flex', fontSize: answerSize, lineHeight: 1.35, color: '#ffffff', marginTop: 44 }, answer),
			]
		: [
				...(logo
					? [{ type: 'img', props: { src: logo, width: 130, height: 130, style: { objectFit: 'contain', marginBottom: 36 } } } as Node]
					: []),
				el('div', { display: 'flex', fontSize: answerSize, fontWeight: 500, lineHeight: 1.3, color: '#ffffff' }, answer),
			];

	return el(
		'div',
		{
			width: ANSWER_CARD_WIDTH,
			height: ANSWER_CARD_HEIGHT,
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'space-between',
			padding: '84px 80px 72px',
			background: `linear-gradient(160deg, ${INK} 0%, #1c1f27 58%, #2a2412 100%)`,
			color: '#ffffff',
			fontFamily: 'UFC Sans',
		},
		[
			el('div', { display: 'flex', flexDirection: 'column' }, [
				el('div', { display: 'flex', fontSize: 30, fontWeight: 500, color: MUTED, letterSpacing: '0.04em' }, clipWords(input.leagueName, 40)),
				el('div', { display: 'flex', alignItems: 'center', marginTop: 16 }, [
					el('div', { width: 64, height: 10, background: GOLD, borderRadius: 5, marginRight: 22 }),
					el('div', { display: 'flex', fontFamily: 'UFC Sans Condensed', fontWeight: 700, fontSize: 46, color: GOLD, letterSpacing: '0.06em' }, 'ASK THE HISTORY'),
				]),
				el(
					'div',
					{ display: 'flex', fontSize: 40, lineHeight: 1.3, color: MUTED, marginTop: 56 },
					`“${clipWords(input.question, 150)}”`,
				),
			]),
			el('div', { display: 'flex', flexDirection: 'column' }, middle),
			el('div', { display: 'flex', flexDirection: 'column', borderTop: '2px solid rgba(255,255,255,0.14)', paddingTop: 36 }, [
				el('div', { display: 'flex', fontSize: 38, fontWeight: 500, color: '#ffffff' }, 'Got a question? Ask your own.'),
				el('div', { display: 'flex', fontSize: 32, color: GOLD, marginTop: 10, letterSpacing: '0.02em' }, input.askAt),
			]),
		],
	);
}

export async function renderAnswerCardPng(input: AnswerCardInput): Promise<Buffer> {
	const svg = await satori(buildAnswerCardTree(input) as never, {
		width: ANSWER_CARD_WIDTH,
		height: ANSWER_CARD_HEIGHT,
		fonts: loadFonts(),
	});
	return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: ANSWER_CARD_WIDTH } }).render().asPng());
}
