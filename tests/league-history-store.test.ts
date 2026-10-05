import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * League History — storage and the step-by-step build
 * (src/utils/league-history/store.ts), against an in-memory Redis.
 */

const mem = new Map<string, unknown>();
const hashes = new Map<string, Map<string, unknown>>();
const zsets = new Map<string, Map<string, number>>();

const fakeRedis = {
	get: async (k: string) => (mem.has(k) ? structuredClone(mem.get(k)) : null),
	set: async (k: string, v: unknown, opts?: { nx?: boolean }) => {
		if (opts?.nx && mem.has(k)) return null;
		mem.set(k, structuredClone(v));
		return 'OK';
	},
	del: async (k: string) => mem.delete(k),
	mget: async (...keys: string[]) => keys.map((k) => (mem.has(k) ? structuredClone(mem.get(k)) : null)),
	hgetall: async (k: string) => (hashes.has(k) ? Object.fromEntries(hashes.get(k)!) : null),
	hset: async (k: string, values: Record<string, unknown>) => {
		const h = hashes.get(k) ?? new Map();
		for (const [f, v] of Object.entries(values)) h.set(f, structuredClone(v));
		hashes.set(k, h);
		return 1;
	},
	hdel: async (k: string, f: string) => (hashes.get(k)?.delete(f) ? 1 : 0),
	zadd: async (k: string, { score, member }: { score: number; member: string }) => {
		const z = zsets.get(k) ?? new Map();
		z.set(member, score);
		zsets.set(k, z);
		return 1;
	},
	zrange: async (k: string, _s: number, _e: number, opts?: { rev?: boolean }) => {
		const rows = [...(zsets.get(k) ?? new Map()).entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
		return opts?.rev ? rows.reverse() : rows;
	},
};

vi.mock('../src/utils/redis-client', () => ({ getRedis: async () => fakeRedis }));

const { advanceMflHistory, effectiveSeasons, readMflHistory, readOverrides, seasonsToCrawl, writeOverride, listMflHistories, SEASONS_PER_STEP } =
	await import('../src/utils/league-history/store');
const { MflRetryLater } = await import('../src/utils/league-history/mfl-crawl');

const FIX = join(__dirname, 'fixtures', 'league-history');
const fixture = (name: string) => JSON.parse(readFileSync(join(FIX, `${name}.json`), 'utf8'));

/** A fake MFL: the real TheLeague season chain, every season won 0009 over 0002. */
function fakeMfl(opts: { throttleOnCall?: number } = {}) {
	let calls = 0;
	const fetchExport = async (req: { type: string; year: number }) => {
		calls++;
		if (opts.throttleOnCall && calls === opts.throttleOnCall) throw new MflRetryLater('429');
		if (req.type === 'league') return fixture('theleague-2026-league');
		if (req.type === 'playoffBrackets') return fixture('theleague-2024-brackets');
		if (req.type === 'playoffBracket') {
			return req.year === 2026 ? fixture('theleague-2026-bracket-1-unplayed') : fixture('theleague-2024-bracket-1');
		}
		throw new Error(`unexpected ${req.type}`);
	};
	return { fetchExport, calls: () => calls };
}

const deps = (fetchExport: unknown, now = Date.parse('2026-10-04T12:00:00Z')) => ({
	fetchExport: fetchExport as never,
	leagueYear: 2026,
	now: () => now,
});

beforeEach(() => {
	mem.clear();
	hashes.clear();
	zsets.clear();
});

describe('advanceMflHistory', () => {
	it('plans the league, then reads a few seasons per step until done', async () => {
		const mfl = fakeMfl();
		const first = await advanceMflHistory('13522', deps(mfl.fetchExport));
		expect(first).toMatchObject({ status: 'progress', name: 'The League', built: SEASONS_PER_STEP, total: 20 });

		let last = first;
		for (let i = 0; i < 20 && last.status !== 'done'; i++) last = await advanceMflHistory('13522', deps(mfl.fetchExport));
		expect(last).toMatchObject({ status: 'done', built: 20, total: 20 });

		const record = await readMflHistory('13522');
		expect(record?.seasons['2024']).toMatchObject({ method: 'bracket', champion: { id: '0009' } });
		expect(record?.seasons['2026']).toMatchObject({ method: 'unknown' });
		expect(await listMflHistories()).toEqual([{ leagueId: '13522', name: 'The League' }]);
	});

	it('never refetches a finished season', async () => {
		const mfl = fakeMfl();
		let r = await advanceMflHistory('13522', deps(mfl.fetchExport));
		while (r.status !== 'done') r = await advanceMflHistory('13522', deps(mfl.fetchExport));
		const before = mfl.calls();
		await advanceMflHistory('13522', deps(mfl.fetchExport));
		expect(mfl.calls()).toBe(before);
	});

	it('a throttle stores nothing for that season and says retry, keeping earlier seasons', async () => {
		const mfl = fakeMfl({ throttleOnCall: 5 });
		const r = await advanceMflHistory('13522', deps(mfl.fetchExport));
		expect(r.status).toBe('retry-later');
		const record = await readMflHistory('13522');
		expect(Object.keys(record!.seasons)).toEqual(['2007']);
	});

	it('answers busy while another build holds the lock', async () => {
		await fakeRedis.set('league-history:lock:mfl:13522', '1');
		const r = await advanceMflHistory('13522', deps(fakeMfl().fetchExport));
		expect(r.status).toBe('busy');
	});

	it('reports an unknown league as not found and stores nothing', async () => {
		const r = await advanceMflHistory('99999', deps(async () => ({ error: { $t: 'Invalid league ID' } })));
		expect(r).toMatchObject({ status: 'not-found', message: 'Invalid league ID' });
		expect(await readMflHistory('99999')).toBeNull();
	});
});

describe('seasonsToCrawl', () => {
	it('rechecks an undecided recent season after six hours, never an old one', async () => {
		const mfl = fakeMfl();
		const t0 = Date.parse('2026-10-04T12:00:00Z');
		let r = await advanceMflHistory('13522', deps(mfl.fetchExport, t0));
		while (r.status !== 'done') r = await advanceMflHistory('13522', deps(mfl.fetchExport, t0));
		const record = (await readMflHistory('13522'))!;
		expect(seasonsToCrawl(record, t0 + 60_000)).toEqual([]);
		expect(seasonsToCrawl(record, t0 + 7 * 3600_000).map((s) => s.year)).toEqual([2026]);
	});
});

describe('admin fixes', () => {
	it('override replaces the champion, keeps the crawled answer, and can be cleared', async () => {
		const mfl = fakeMfl();
		let r = await advanceMflHistory('13522', deps(mfl.fetchExport));
		while (r.status !== 'done') r = await advanceMflHistory('13522', deps(mfl.fetchExport));
		await writeOverride('13522', 2024, { championId: '0002', runnerUpId: '0009' });

		const record = (await readMflHistory('13522'))!;
		let seasons = effectiveSeasons(record, await readOverrides('13522'));
		const fixed = seasons.find((s) => s.year === 2024)!;
		expect(fixed.method).toBe('override');
		expect(fixed.champion?.id).toBe('0002');
		expect(fixed.crawled?.champion?.id).toBe('0009');
		expect(seasons[0].year).toBe(2026);

		await writeOverride('13522', 2024, null);
		seasons = effectiveSeasons(record, await readOverrides('13522'));
		expect(seasons.find((s) => s.year === 2024)?.method).toBe('bracket');
	});
});
