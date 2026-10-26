import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Ask the History — saved answers, conversations, and the History home's
 * "The league is asking" (src/utils/league-history/ask-store.ts), against an
 * in-memory Redis.
 */

const mem = new Map<string, unknown>();
const zsets = new Map<string, Map<string, number>>();
const sets = new Map<string, Set<string>>();

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
	sadd: async (k: string, member: string) => {
		const set = sets.get(k) ?? new Set();
		sets.set(k, set);
		if (set.has(member)) return 0;
		set.add(member);
		return 1;
	},
	expire: async () => 1,
	zrem: async (k: string, ...members: string[]) => members.filter((m) => zsets.get(k)?.delete(m)).length,
	// Upstash's withScores shape: a flat [member, score, member, score, ...].
	zrange: async (k: string, start: number, stop: number, opts?: { rev?: boolean; withScores?: boolean }) => {
		const rows = [...(zsets.get(k) ?? new Map()).entries()].sort((a, b) => (opts?.rev ? b[1] - a[1] : a[1] - b[1])).slice(start, stop + 1);
		return opts?.withScores ? rows.flat() : rows.map(([m]) => m);
	},
};

vi.mock('../src/utils/redis-client', () => ({ getRedis: async () => fakeRedis }));

const { saveAnswer, readAnswer, countAnswerOpen, recordAsk, leagueIsAsking, turnsAfter, topicOf, askingWeek, MAX_TURNS } = await import(
	'../src/utils/league-history/ask-store'
);

const ask = async (league: string, question: string, franchiseId = '0001', extra: Record<string, unknown> = {}) => {
	const saved = (await saveAnswer({ league, question, answer: 'Yes.', table: null, steps: [], asOf: '', records: [], askedBy: { franchiseId, name: 'Asker' }, ...extra }))!;
	await recordAsk(saved);
	return saved;
};

beforeEach(() => {
	mem.clear();
	zsets.clear();
	sets.clear();
});

const MONDAY = new Date('2026-10-26T18:00:00Z');

describe('the league is asking', () => {
	it('ranks topics by distinct owners, counting askers and openers once each', async () => {
		vi.useFakeTimers({ now: MONDAY, toFake: ['Date'] });
		const a = await ask('theleague', 'first?');
		await ask('theleague', 'first?'); // the same owner again
		const b = await ask('theleague', 'second?', '0002');
		await countAnswerOpen(b, '0003');
		await countAnswerOpen(b, '0003'); // a refresh
		await countAnswerOpen(a, null); // signed out
		const { week, topics } = await leagueIsAsking('theleague', 4, MONDAY);
		expect(week).toBe('this');
		expect(topics.map((t) => [t.answer.question, t.owners])).toEqual([
			['second?', 2],
			['first?', 1],
		]);
		vi.useRealTimers();
	});

	it('puts differently worded questions on one card when they cite the same Record Book board', () => {
		const records = [{ title: 'Most wins', query: 'cat=season&board=wins', leader: '' }];
		expect(topicOf({ question: 'most wins ever?', table: null, records })).toBe(topicOf({ question: 'Who won the most games in a season', table: null, records }));
		expect(topicOf({ question: 'a', table: null, records: [] })).not.toBe(topicOf({ question: 'b', table: null, records: [] }));
	});

	it('falls back to last week early in a quiet week, and keeps leagues apart', async () => {
		vi.useFakeTimers({ now: new Date('2026-10-20T18:00:00Z'), toFake: ['Date'] });
		await ask('afl-fantasy', 'afl?');
		vi.useRealTimers();
		expect((await leagueIsAsking('theleague', 4, MONDAY)).topics).toEqual([]);
		const afl = await leagueIsAsking('afl-fantasy', 4, MONDAY);
		expect(afl.week).toBe('last');
		expect(afl.topics.map((t) => t.answer.question)).toEqual(['afl?']);
	});

	it('weeks start Monday, Pacific time', () => {
		expect(askingWeek(new Date('2026-10-26T06:59:00Z'))).toBe('2026-10-19'); // Sunday 11:59pm PT
		expect(askingWeek(new Date('2026-10-26T07:00:00Z'))).toBe('2026-10-26');
	});
});

describe('conversations', () => {
	it('carries the newest turns, oldest first, into a follow-up', async () => {
		let parent = await ask('theleague', 'q0');
		for (let i = 1; i <= MAX_TURNS + 1; i++) parent = await ask('theleague', `q${i}`, '0001', { parent: parent.id, turns: turnsAfter(parent) });
		const turns = turnsAfter(parent);
		expect(turns).toHaveLength(MAX_TURNS);
		expect(turns.map((t) => t.question)).toEqual(['q2', 'q3', 'q4', 'q5']);
		expect((await readAnswer('theleague', parent.id))?.turns?.map((t) => t.question)).toEqual(['q1', 'q2', 'q3', 'q4']);
		expect(await readAnswer('afl-fantasy', parent.id)).toBeNull();
	});
});
