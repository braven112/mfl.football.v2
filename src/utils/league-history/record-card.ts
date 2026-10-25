/**
 * Record Book — the share card for one record, 1200×630 PNG (satori + resvg,
 * the same pipeline and fonts as the champion card).
 *
 * The holder on the left with their value; the next four on the right as bars
 * on one scale (the "gap" chart, so the card says whether #1 is out on their
 * own). Always dark, so it reads the same in every chat client. The team logo
 * is drawn only when it is one of OUR site's own paths (a league's asset under
 * /assets), fetched from the site itself; anything else, or a failed fetch,
 * draws the card without it.
 *
 * Never read public/ from disk here: a process.cwd() join into public/ makes
 * Vercel's file tracer ship all ~86 MB of it inside the server function, which
 * pushed it past the 250 MB limit and failed the deploy (2026-10-25).
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { CARD_HEIGHT, CARD_WIDTH, loadFonts } from './champion-card';

type Node = { type: string; props: Record<string, unknown> & { children?: Node | Node[] | string } };

const el = (type: string, style: Record<string, unknown>, children?: Node | Node[] | string): Node => ({
	type,
	props: { style, ...(children !== undefined ? { children } : {}) },
});

export interface RecordCardRow {
	rank: number;
	name: string;
	value: number;
	display: string;
	context: string;
	owner: string | null;
	icon: string | null;
}

export interface RecordCardInput {
	leagueName: string;
	title: string;
	/** "Playoffs", "Last 10 seasons"…, or null for the plain all-time board. */
	qualifier: string | null;
	unit: string | null;
	/** True when the record is the LOWEST value (fewest points, fastest to…). */
	asc: boolean;
	rows: RecordCardRow[];
	/** The holder's logo as a data URI (see logoDataUri), or null. */
	logo?: string | null;
}

const INK = '#0f1115';
const GOLD = '#d4a93c';
const MUTED = 'rgba(255,255,255,0.62)';
const TRACK = 'rgba(255,255,255,0.12)';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

/** True for one of our own asset paths in a format satori can draw. */
export function isOwnLogoPath(icon: string | null): icon is string {
	return !!icon && /^\/assets\/[A-Za-z0-9/_.-]+\.(png|jpe?g)$/i.test(icon) && !icon.includes('..');
}

/**
 * The holder's logo as a data URI, fetched from `origin` (the site serving
 * this request), or null when the path is not ours or the fetch fails.
 */
export async function logoDataUri(icon: string | null, origin: string): Promise<string | null> {
	if (!isOwnLogoPath(icon)) return null;
	try {
		const res = await fetch(new URL(icon, origin), { signal: AbortSignal.timeout(3000) });
		if (!res.ok) return null;
		const ext = icon.split('.').pop()!.toLowerCase();
		return `data:${MIME[ext]};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
	} catch {
		return null;
	}
}

export function buildRecordCardTree(input: RecordCardInput): Node {
	const [lead, ...rest] = input.rows;
	const chasers = rest.slice(0, 4);
	const logo = input.logo ?? null;
	const valueSize = lead.display.length > 9 ? 120 : 150;
	const vals = input.rows.slice(0, 5).map((r) => r.value);
	const best = input.asc ? Math.min(...vals) : Math.max(...vals);
	const worst = input.asc ? Math.max(...vals) : Math.min(...vals);
	// Bars on one scale: the record fills the track, the fifth keeps a stub.
	const width = (v: number) => (best === worst ? 100 : 30 + (70 * (v - worst)) / (best - worst));
	const sub = [lead.owner, lead.context].filter(Boolean).join(' · ');

	const bar = (r: RecordCardRow, isLead: boolean) =>
		el('div', { display: 'flex', flexDirection: 'column', marginBottom: 18 }, [
			el('div', { display: 'flex', width: '100%', justifyContent: 'space-between', fontSize: 24, marginBottom: 6 }, [
				el('div', { display: 'flex', color: isLead ? GOLD : '#ffffff', fontWeight: 500 }, `${r.rank}. ${clip(r.name, 22)}`),
				el('div', { display: 'flex', color: isLead ? GOLD : '#ffffff', fontFamily: 'UFC Sans Condensed', fontWeight: 700 }, r.display),
			]),
			el('div', { display: 'flex', width: '100%', height: 10, background: TRACK, borderRadius: 5 }, [
				el('div', { width: `${width(r.value)}%`, height: 10, background: isLead ? GOLD : 'rgba(255,255,255,0.78)', borderRadius: 5 }),
			]),
		]);

	return el(
		'div',
		{
			width: CARD_WIDTH,
			height: CARD_HEIGHT,
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'space-between',
			padding: '52px 64px',
			background: `linear-gradient(135deg, ${INK} 0%, #1c1f27 60%, #2a2412 100%)`,
			color: '#ffffff',
			fontFamily: 'UFC Sans',
		},
		[
			el('div', { display: 'flex', flexDirection: 'column' }, [
				el('div', { fontSize: 28, fontWeight: 500, color: MUTED, letterSpacing: '0.04em' }, clip(input.leagueName, 48)),
				el('div', { display: 'flex', alignItems: 'center', marginTop: 14 }, [
					el('div', { width: 56, height: 8, background: GOLD, borderRadius: 4, marginRight: 18 }),
					el(
						'div',
						{ fontFamily: 'UFC Sans Condensed', fontWeight: 700, fontSize: 38, color: GOLD, letterSpacing: '0.06em' },
						clip(`${input.title}${input.qualifier ? ` · ${input.qualifier}` : ''}`.toUpperCase(), 50),
					),
				]),
			]),
			el('div', { display: 'flex', alignItems: 'center' }, [
				el('div', { display: 'flex', flexDirection: 'column', width: 560 }, [
					el('div', { display: 'flex', alignItems: 'center' }, [
						...(logo
							? [{ type: 'img', props: { src: logo, width: 96, height: 96, style: { objectFit: 'contain', marginRight: 24 } } } as Node]
							: []),
						el(
							'div',
							{ fontFamily: 'UFC Sans Condensed', fontWeight: 700, fontSize: valueSize, lineHeight: 1 },
							lead.display + (input.unit ? ` ${input.unit}` : ''),
						),
					]),
					el('div', { fontSize: 44, fontWeight: 500, marginTop: 14 }, clip(lead.name, 26)),
					el('div', { fontSize: 24, lineHeight: 1.3, color: MUTED, marginTop: 8, maxWidth: 540 }, clip(sub, 96) || ' '),
				]),
				el(
					'div',
					{ display: 'flex', flexDirection: 'column', width: 464, marginLeft: 48 },
					[bar(lead, true), ...chasers.map((r) => bar(r, false))],
				),
			]),
			el('div', { display: 'flex', justifyContent: 'flex-end', fontSize: 22, color: MUTED, letterSpacing: '0.06em' }, 'RECORD BOOK'),
		],
	);
}

export async function renderRecordCardPng(input: RecordCardInput): Promise<Buffer> {
	const svg = await satori(buildRecordCardTree(input) as never, {
		width: CARD_WIDTH,
		height: CARD_HEIGHT,
		fonts: loadFonts(),
	});
	return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: CARD_WIDTH } }).render().asPng());
}
