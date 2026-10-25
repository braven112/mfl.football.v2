/**
 * Record Book — the share card for one record, 1200×630 PNG (satori + resvg,
 * the same pipeline and fonts as the champion card).
 *
 * The holder on the left with their value; the next four on the right as bars
 * on one scale (the "gap" chart, so the card says whether #1 is out on their
 * own). Always dark, so it reads the same in every chat client. The team logo
 * is drawn only when it is one of OUR files under public/ (a league's own
 * asset), never fetched from elsewhere.
 */
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
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
}

const INK = '#0f1115';
const GOLD = '#d4a93c';
const MUTED = 'rgba(255,255,255,0.62)';
const TRACK = 'rgba(255,255,255,0.12)';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/** A logo under public/ as a data URI, or null (remote, missing or a format satori can't draw). */
export function localLogo(icon: string | null): string | null {
	if (!icon || !icon.startsWith('/') || icon.startsWith('//')) return null;
	const mime = MIME[extname(icon).toLowerCase()];
	if (!mime) return null;
	const publicDir = join(process.cwd(), 'public');
	const file = normalize(join(publicDir, icon));
	if (!file.startsWith(publicDir) || !existsSync(file)) return null;
	return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
}

export function buildRecordCardTree(input: RecordCardInput): Node {
	const [lead, ...rest] = input.rows;
	const chasers = rest.slice(0, 4);
	const logo = localLogo(lead.icon);
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
