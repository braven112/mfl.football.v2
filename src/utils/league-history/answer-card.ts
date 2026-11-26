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
 * What it draws is the saved answer only (ask-store.ts) — the question (and,
 * for a follow-up, the question its conversation started with), the headline
 * stat, the answer in words, its chart as a few bars — so the endpoint cannot be used to draw
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
	/**
	 * The answer's team logos as data URIs (record-card logoDataUri): one for
	 * an answer about one team, every tied team's side by side for a tie
	 * (Brandon, 2026-11-12), none when no team is named.
	 */
	logos?: string[];
	/** Where to ask your own, shown in the footer: "theleague.us/history/ask". */
	askAt: string;
	/**
	 * A follow-up's conversation opener, drawn above the question so the
	 * picture never lands in the chat without its context (Brandon,
	 * 2026-11-26: "first question + latest answer").
	 */
	context?: string | null;
	/** The answer's chart as plain bars (cardBars), drawn under the answer. */
	bars?: CardBar[];
}

export interface CardBar {
	name: string;
	display: string;
	/** 0..1 of the longest bar. */
	share: number;
}

/** Most bars the card draws; past this they crowd the answer. */
export const MAX_CARD_BARS = 5;

/**
 * The answer's Record Book chart as a few plain bars for the card: its top
 * rows, longest bar = the largest value. Only the ranking chart: a stacked,
 * career or what-if chart does not survive being flattened, so the card
 * shows none rather than a wrong one.
 */
export function cardBars(chart: { kind?: string; rows?: Array<{ value: number; display: string; name: string; context?: string }> } | null | undefined): CardBar[] {
	if (!chart || chart.kind || !Array.isArray(chart.rows)) return [];
	const rows = chart.rows.filter((r) => Number.isFinite(r?.value)).slice(0, MAX_CARD_BARS);
	if (rows.length < 2) return [];
	const max = Math.max(...rows.map((r) => Math.abs(r.value)));
	if (!(max > 0)) return [];
	return rows.map((r) => ({
		name: clipWords(r.context ? `${r.name} · ${r.context}` : r.name, 34),
		display: clipWords(String(r.display ?? r.value), 12),
		share: Math.max(0.04, Math.abs(r.value) / max),
	}));
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

/** Most logos a tie shows; past this the row would crowd the headline. */
export const MAX_TIE_LOGOS = 4;

interface TieTable {
	rows?: Array<{ cells: Array<string | number | boolean | null>; franchiseId: string | null; year: number | null }>;
}

/**
 * The teams the card should show: the answer's top row, plus every row tied
 * with it on the headline's number. The tie is read from the engine's own
 * table: the column whose top value IS the headline's number, and the rows
 * that share that value. When the headline names no number in the top row,
 * only the top row's team is shown, as before.
 */
export function cardTeams(
	table: TieTable | null | undefined,
	headline: { value: string } | null | undefined,
): Array<{ franchiseId: string; year: number | null }> {
	const rows = table?.rows ?? [];
	const top = rows[0];
	if (!top?.franchiseId) return [];
	const one = [{ franchiseId: top.franchiseId, year: top.year }];
	const m = headline?.value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
	if (!m) return one;
	const n = Number(m[0]);
	const col = top.cells.findIndex((c) => typeof c === 'number' && Math.abs(c - n) < 1e-9);
	if (col < 0) return one;
	const out: Array<{ franchiseId: string; year: number | null }> = [];
	const seen = new Set<string>();
	for (const r of rows) {
		if (r.cells[col] !== top.cells[col]) break;
		if (!r.franchiseId || seen.has(r.franchiseId)) continue;
		seen.add(r.franchiseId);
		out.push({ franchiseId: r.franchiseId, year: r.year });
		if (out.length === MAX_TIE_LOGOS) break;
	}
	return out;
}

const img = (src: string, size: number, style: Record<string, unknown>): Node =>
	({ type: 'img', props: { src, width: size, height: size, style: { objectFit: 'contain', ...style } } }) as Node;

export function buildAnswerCardTree(input: AnswerCardInput): Node {
	const logos = (input.logos ?? []).slice(0, MAX_TIE_LOGOS);
	const logo = logos.length === 1 ? logos[0] : null;
	// A tie: every tied team side by side, in a row of their own above the stat.
	const tieRow =
		logos.length > 1
			? [el('div', { display: 'flex', alignItems: 'center', marginBottom: 28 }, logos.map((src, i) => img(src, 120, { marginLeft: i ? 24 : 0 })))]
			: [];
	const head = input.headline;
	// With a headline the answer is the supporting line; without one it IS the
	// card, so it gets the room and the bigger type.
	const bars = (input.bars ?? []).slice(0, MAX_CARD_BARS);
	const context = input.context ? clipWords(input.context, 90) : '';
	// Bars and a conversation opener take room from the answer's words.
	const room = (bars.length ? 110 : 0) + (context ? 40 : 0);
	const answer = clipWords(input.answer, (head ? 260 : 360) - room);
	const answerSize = head ? 36 : answer.length > 220 ? 44 : 52;
	const barRows: Node[] = bars.length
		? [
				el(
					'div',
					{ display: 'flex', flexDirection: 'column', marginTop: 40 },
					bars.map((b, i) =>
						el('div', { display: 'flex', flexDirection: 'column', marginTop: i ? 16 : 0 }, [
							el('div', { display: 'flex', justifyContent: 'space-between', fontSize: 28, color: MUTED, marginBottom: 6 }, [
								el('div', { display: 'flex' }, b.name),
								el('div', { display: 'flex', color: '#ffffff', fontWeight: 700 }, b.display),
							]),
							el('div', { display: 'flex', width: '100%', height: 18, background: 'rgba(255,255,255,0.08)', borderRadius: 9 }, [
								el('div', { display: 'flex', width: `${Math.round(b.share * 100)}%`, height: 18, background: i ? 'rgba(212,169,60,0.55)' : GOLD, borderRadius: 9 }),
							]),
						]),
					),
				),
			]
		: [];

	const middle: Node[] = head
		? [
				...tieRow,
				el('div', { display: 'flex', alignItems: 'center' }, [
					...(logo ? [img(logo, 150, { marginRight: 32 })] : []),
					el(
						'div',
						{ display: 'flex', fontFamily: 'UFC Sans Condensed', fontWeight: 700, fontSize: headlineSize(head.value), lineHeight: 1, color: '#ffffff' },
						clipWords(head.value, 18),
					),
				]),
				el('div', { display: 'flex', fontSize: 44, fontWeight: 500, color: GOLD, marginTop: 20, lineHeight: 1.2 }, clipWords(head.label, 70)),
				el('div', { display: 'flex', fontSize: answerSize, lineHeight: 1.35, color: '#ffffff', marginTop: 44 }, answer),
				...barRows,
			]
		: [
				...tieRow,
				...(logo ? [img(logo, 130, { marginBottom: 36 })] : []),
				el('div', { display: 'flex', fontSize: answerSize, fontWeight: 500, lineHeight: 1.3, color: '#ffffff' }, answer),
				...barRows,
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
				...(context
					? [
							el('div', { display: 'flex', fontSize: 30, lineHeight: 1.3, color: MUTED, marginTop: 44 }, `It started with “${context}”`),
							el('div', { display: 'flex', fontSize: 40, lineHeight: 1.3, color: '#ffffff', marginTop: 14 }, `Then: “${clipWords(input.question, 120)}”`),
						]
					: [
							el(
								'div',
								{ display: 'flex', fontSize: 40, lineHeight: 1.3, color: MUTED, marginTop: 56 },
								`“${clipWords(input.question, 150)}”`,
							),
						]),
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
