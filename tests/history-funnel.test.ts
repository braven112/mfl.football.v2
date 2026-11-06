import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The video → League History funnel (src/utils/history-funnel.ts and
 * /api/history-funnel). The endpoint needs no session, so what matters is that
 * a stranger can send only browser events from a closed list, and that the
 * import steps (the client list) are counted once per league, server-side.
 */

const sets = new Map<string, Set<string>>();
const hashes = new Map<string, Map<string, string>>();
const fakeRedis = {
	sadd: async (k: string, ...m: string[]) => {
		const s = sets.get(k) ?? new Set();
		m.forEach((x) => s.add(x));
		sets.set(k, s);
		return m.length;
	},
	scard: async (k: string) => sets.get(k)?.size ?? 0,
	hincrby: async (k: string, f: string, by: number) => {
		const h = hashes.get(k) ?? new Map();
		const v = Number(h.get(f) ?? 0) + by;
		h.set(f, String(v));
		hashes.set(k, h);
		return v;
	},
	hget: async (k: string, f: string) => hashes.get(k)?.get(f) ?? null,
	hset: async (k: string, fv: Record<string, string>) => {
		const h = hashes.get(k) ?? new Map();
		Object.entries(fv).forEach(([f, v]) => h.set(f, v));
		hashes.set(k, h);
		return 1;
	},
	hlen: async (k: string) => hashes.get(k)?.size ?? 0,
	hgetall: async (k: string) => (hashes.has(k) ? Object.fromEntries(hashes.get(k)!) : null),
	incr: async () => 1,
	expire: async () => 1,
};

vi.mock('../src/utils/redis-client', () => ({ getRedis: async () => fakeRedis }));

const mod = await import('../src/utils/history-funnel');
const { POST } = await import('../src/pages/api/history-funnel/index');

const post = (body: unknown, contentType = 'application/json') =>
	POST({
		request: new Request('http://x/api/history-funnel', {
			method: 'POST',
			headers: { 'Content-Type': contentType },
			body: JSON.stringify(body),
		}),
	} as any) as Promise<Response>;

const VISITOR = '0b6f1c1e-1111-4222-8333-444455556666';
const NOW = new Date('2026-11-05T20:00:00Z');

beforeEach(() => {
	sets.clear();
	hashes.clear();
});

describe('history funnel endpoint', () => {
	it('counts a browser event', async () => {
		expect((await post({ event: 'video_made', platform: 'espn', visitor: VISITOR })).status).toBe(200);
		const report = (await mod.readFunnelReport(30))!;
		const made = report.steps.find((s) => s.event === 'video_made')!;
		expect(made).toMatchObject({ total: 1, recent: 1, people: 1, byPlatform: { espn: 1 } });
	});

	it('refuses server-only events, unknown events, platforms and visitors', async () => {
		for (const body of [
			{ event: 'import_finished', platform: 'mfl', visitor: VISITOR },
			{ event: 'email_optin', platform: 'mfl', visitor: VISITOR },
			{ event: 'anything', platform: 'mfl', visitor: VISITOR },
			{ event: 'video_made', platform: 'yahoo!', visitor: VISITOR },
			{ event: 'video_made', platform: 'mfl', visitor: 'x' },
		]) {
			expect((await post(body)).status).toBe(400);
		}
		expect(hashes.size).toBe(0);
		expect(sets.size).toBe(0);
	});

	it('needs a JSON content type (no cross-site text/plain form posts)', async () => {
		expect((await post({ event: 'video_made', platform: 'mfl', visitor: VISITOR }, 'text/plain')).status).toBe(415);
	});
});

describe('imports and the client list', () => {
	it('counts a league start once and its finish once, however often it is rebuilt', async () => {
		await mod.recordImport('mfl', '54321', { name: 'Gridiron Gang', seasons: 3, finished: false }, NOW);
		await mod.recordImport('mfl', '54321', { name: 'Gridiron Gang', seasons: 9, finished: false }, NOW);
		await mod.recordImport('mfl', '54321', { name: 'Gridiron Gang', seasons: 12, finished: true }, NOW);
		await mod.recordImport('mfl', '54321', { name: 'Gridiron Gang', seasons: 12, finished: true }, NOW);
		const report = (await mod.readFunnelReport(30, NOW))!;
		const step = (e: string) => report.steps.find((s) => s.event === e)!;
		expect(step('import_started')).toMatchObject({ total: 1, people: 1 });
		expect(step('import_finished')).toMatchObject({ total: 1, people: 1 });
		expect(report.leads).toEqual([
			{
				platform: 'mfl',
				leagueId: '54321',
				name: 'Gridiron Gang',
				seasons: 12,
				startedAt: NOW.toISOString(),
				finishedAt: NOW.toISOString(),
			},
		]);
	});
});

describe('buildFunnelReport', () => {
	it('gives each step its share of the step above, by people', () => {
		const report = mod.buildFunnelReport({
			days: 7,
			totals: { 'video_made|mfl': 10, 'history_link_click|mfl': 4 },
			recent: [{ 'video_made|mfl': 2 }, null],
			people: { video_made: 8, history_link_click: 2, history_view: 0 },
			leads: [],
		});
		expect(report.steps.map((s) => s.fromPrevious)).toEqual([null, 0.25, 0, null, null]);
		expect(report.steps[0]).toMatchObject({ total: 10, recent: 2 });
	});
});

describe('leadsCsv', () => {
	it('quotes cells and defuses spreadsheet formulas', () => {
		const csv = mod.leadsCsv([
			{ platform: 'espn', leagueId: '1', name: '=HYPERLINK("x") "Bad"', seasons: 2, startedAt: 's' },
		]);
		expect(csv.split('\r\n')[1]).toBe(`"espn","1","'=HYPERLINK(""x"") ""Bad""","2","s",""`);
	});
});
