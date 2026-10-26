import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Ask the History — saved answers and the History home's "most shared" shelf
 * (src/utils/league-history/ask-store.ts), against an in-memory Redis.
 */

const mem = new Map<string, unknown>();
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
	zincrby: async (k: string, by: number, member: string) => {
		const z = zsets.get(k) ?? new Map();
		z.set(member, (z.get(member) ?? 0) + by);
		zsets.set(k, z);
		return z.get(member)!;
	},
	zrem: async (k: string, ...members: string[]) => members.filter((m) => zsets.get(k)?.delete(m)).length,
	// Upstash's withScores shape: a flat [member, score, member, score, ...].
	zrange: async (k: string, start: number, stop: number, opts?: { rev?: boolean; withScores?: boolean }) => {
		const rows = [...(zsets.get(k) ?? new Map()).entries()].sort((a, b) => (opts?.rev ? b[1] - a[1] : a[1] - b[1])).slice(start, stop + 1);
		return opts?.withScores ? rows.flat() : rows.map(([m]) => m);
	},
};

vi.mock('../src/utils/redis-client', () => ({ getRedis: async () => fakeRedis }));

const { saveAnswer, readAnswer, countAnswerOpen, popularAnswers } = await import('../src/utils/league-history/ask-store');

const ask = (league: string, question: string, franchiseId = '0001') =>
	saveAnswer({ league, question, answer: 'Yes.', table: null, steps: [], asOf: '', records: [], askedBy: { franchiseId, name: 'Asker' } });

beforeEach(() => {
	mem.clear();
	zsets.clear();
});

describe('most shared shelf', () => {
	it('counts each other owner once, and never the asker', async () => {
		const a = (await ask('theleague', 'first?'))!;
		const b = (await ask('theleague', 'second?'))!;
		await countAnswerOpen(a, '0001'); // the asker
		await countAnswerOpen(a, null); // signed out
		await countAnswerOpen(a, '0002');
		await countAnswerOpen(a, '0002'); // a refresh
		await countAnswerOpen(b, '0002');
		await countAnswerOpen(b, '0003');
		const shelf = await popularAnswers('theleague');
		expect(shelf.map((p) => [p.answer.question, p.opens])).toEqual([
			['second?', 2],
			['first?', 1],
		]);
	});

	it('keeps leagues apart and drops an answer that has expired', async () => {
		const tl = (await ask('theleague', 'tl?'))!;
		const afl = (await ask('afl-fantasy', 'afl?'))!;
		await countAnswerOpen(tl, '0002');
		await countAnswerOpen(afl, '0002');
		expect((await popularAnswers('afl-fantasy')).map((p) => p.answer.question)).toEqual(['afl?']);
		mem.delete(`history-ask:theleague:${tl.id}`);
		expect(await popularAnswers('theleague')).toEqual([]);
		expect(zsets.get('history-ask:theleague:popular')?.size ?? 0).toBe(0);
		expect(await readAnswer('theleague', afl.id)).toBeNull();
	});
});
