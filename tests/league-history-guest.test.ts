import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The public Ask the History demo (Brandon, 2026-11-07): signed-out visitors
 * never see a real owner name (guest-names.mjs), and may ask TheLeague 3
 * questions a day, 3 more for an email (guest-ask.ts).
 */

const mem = new Map<string, number>();
let redisUp = true;
const fakeRedis = {
	get: async (k: string) => (mem.has(k) ? mem.get(k)! : null),
	set: async (k: string, v: number) => {
		mem.set(k, v);
		return 'OK';
	},
	incr: async (k: string) => {
		mem.set(k, (mem.get(k) ?? 0) + 1);
		return mem.get(k)!;
	},
	decr: async (k: string) => {
		mem.set(k, (mem.get(k) ?? 0) - 1);
		return mem.get(k)!;
	},
	expire: async () => 1,
};
vi.mock('../src/utils/redis-client', () => ({ getRedis: async () => (redisUp ? fakeRedis : null) }));

const { buildNameMasker, ownerStandIns, isGuestMaskedPath, maskJson } = await import('../src/utils/league-history/guest-names.mjs');
const guest = await import('../src/utils/league-history/guest-ask');

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const tenures = read('data/theleague/derived/owner-tenures.json');
const realNames: string[] = tenures.owners.map((o: { displayName: string }) => o.displayName);
const mask = buildNameMasker(ownerStandIns(tenures));

/**
 * Every real name still present in `text` as a whole word. A one-word owner
 * ("Mike") counts only standing alone, the masker's own rule: "Mike Evans" is
 * a player, not the owner.
 */
const leaks = (text: string) =>
	realNames.filter((n) => {
		const name = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[’']/g, "[’']");
		const single = !/\s/.test(n);
		const before = single ? '(?<![\\p{L}\\p{N}]|,\\s)' : '(?<![\\p{L}\\p{N}])';
		const after = single ? '(?![\\p{L}\\p{N}]|\\s+\\p{Lu})' : '(?![\\p{L}\\p{N}])';
		return new RegExp(`${before}${name}${after}`, 'u').test(text);
	});

describe('owner name masking', () => {
	it('gives every owner a stand-in from their best-known team', () => {
		expect(mask('Todd Gibel won it all')).toBe('Bring The Pain Owner won it all');
		expect(ownerStandIns(tenures)).toHaveLength(realNames.length);
	});

	it('replaces the longest name first and only whole words', () => {
		const m = buildNameMasker([
			['Nate Rich', 'Gridiron Geeks Owner'],
			['Rich', 'Music City Mafia Owner'],
			['Dan', 'Some Team Owner'],
		]);
		expect(m('Nate Rich beat Rich')).toBe('Gridiron Geeks Owner beat Music City Mafia Owner');
		expect(m('Da Dangsters')).toBe('Da Dangsters');
		expect(m('Richardson')).toBe('Richardson');
	});

	it('leaves NFL players who share a one-word owner’s name alone', () => {
		const m = buildNameMasker([['Mike', 'Fire Ready Aim Owner']]);
		expect(m('Mike Evans')).toBe('Mike Evans');
		expect(m('Evans, Mike (WR)')).toBe('Evans, Mike (WR)');
		expect(m('<td>Mike</td>')).toBe('<td>Fire Ready Aim Owner</td>');
		expect(m('owned by Mike since 2019')).toBe('owned by Fire Ready Aim Owner since 2019');
	});

	it('catches HTML- and JSON-escaped apostrophes', () => {
		const m = buildNameMasker([['Rick O’Keefe', 'X Owner']]);
		expect(m('Rick O&#39;Keefe')).toBe('X Owner');
		expect(m("Rick O'Keefe")).toBe('X Owner');
		expect(m('"Rick O\\u2019Keefe"')).toBe('"X Owner"');
	});

	it('collapses co-owners who share a stand-in', () => {
		const m = buildNameMasker([
			['Ross Lawrence', 'Cowboy Up Owner'],
			['Shawn Klezovich', 'Cowboy Up Owner'],
		]);
		expect(m('Ross Lawrence & Shawn Klezovich')).toBe('Cowboy Up Owners');
		expect(m('Ross Lawrence &amp; Shawn Klezovich')).toBe('Cowboy Up Owners');
	});

	it('leaves no real name anywhere in the datasets a guest question reaches', () => {
		for (const file of ['league-history', 'league-history-moves', 'league-history-players']) {
			const masked = JSON.stringify(maskJson(read(`data/theleague/derived/${file}.json`), mask));
			expect(leaks(masked), file).toEqual([]);
		}
	});

	it('leaves no real name in the owner pages’ own data', () => {
		for (const file of ['owner-tenures', 'franchise-history']) {
			expect(leaks(mask(readFileSync(`data/theleague/derived/${file}.json`, 'utf8'))), file).toEqual([]);
		}
	});

	it('covers TheLeague’s history section, and nothing else', () => {
		for (const p of ['/theleague/history', '/theleague/history/record-book', '/theleague/history/ask/abc', '/theleague/owners/x', '/theleague/franchises', '/theleague/rivalries/a-b']) {
			expect(isGuestMaskedPath(p), p).toBe(true);
		}
		for (const p of ['/theleague/rosters', '/afl-fantasy/history', '/history', '/theleague', '/theleague/historyx']) {
			expect(isGuestMaskedPath(p), p).toBe(false);
		}
	});
});

describe('guest question limits', () => {
	const req = (hop = '1.2.3.4') => new Request('https://theleague.us/api/league-history/ask', { headers: { 'x-forwarded-for': hop } });
	beforeEach(() => {
		mem.clear();
		redisUp = true;
	});

	it('allows 3 a day, then asks for an email', async () => {
		const id = guest.newGuestId();
		for (let i = 1; i <= 3; i++) {
			const r = await guest.spendGuestQuestion('theleague', id, req());
			expect(r.ok && r.allowance.used).toBe(i);
		}
		const fourth = await guest.spendGuestQuestion('theleague', id, req());
		expect(fourth.ok).toBe(false);
		expect(!fourth.ok && fourth.reason).toBe('need-email');
	});

	it('gives 3 more after an email, then stops', async () => {
		const id = guest.newGuestId();
		for (let i = 0; i < 3; i++) await guest.spendGuestQuestion('theleague', id, req());
		await guest.unlockWithEmail(id);
		for (let i = 0; i < 3; i++) expect((await guest.spendGuestQuestion('theleague', id, req())).ok).toBe(true);
		const r = await guest.spendGuestQuestion('theleague', id, req());
		expect(!r.ok && r.reason).toBe('out');
		expect(await guest.guestAllowance('theleague', id)).toEqual({ used: 6, limit: 6, hasEmail: true });
	});

	it('a refund gives the question back', async () => {
		const id = guest.newGuestId();
		const r = await guest.spendGuestQuestion('theleague', id, req());
		if (r.ok) await r.refund();
		expect((await guest.guestAllowance('theleague', id))?.used).toBe(0);
	});

	it('clearing the cookie does not get past the address ceiling', async () => {
		for (let i = 0; i < guest.GUEST_PER_ADDRESS; i++) expect((await guest.spendGuestQuestion('theleague', guest.newGuestId(), req())).ok).toBe(true);
		const r = await guest.spendGuestQuestion('theleague', guest.newGuestId(), req());
		expect(!r.ok && r.reason).toBe('address');
	});

	it('holds a site-wide daily ceiling', async () => {
		let n = 0;
		while (n < guest.GUEST_DAILY_CEILING) {
			expect((await guest.spendGuestQuestion('theleague', guest.newGuestId(), req(`10.0.${Math.floor(n / 20)}.${n % 20}`))).ok).toBe(true);
			n++;
		}
		const r = await guest.spendGuestQuestion('theleague', guest.newGuestId(), req('9.9.9.9'));
		expect(!r.ok && r.reason).toBe('busy');
	});

	it('fails closed without Redis', async () => {
		redisUp = false;
		const r = await guest.spendGuestQuestion('theleague', guest.newGuestId(), req());
		expect(!r.ok && r.reason).toBe('unavailable');
	});

	it('only the demo league takes guest questions', () => {
		expect(guest.canGuestAsk('theleague')).toBe(true);
		expect(guest.canGuestAsk('afl-fantasy')).toBe(false);
	});

	it('reads the visitor id only from a well-formed cookie', () => {
		const id = guest.newGuestId();
		expect(guest.guestIdFrom(new Request('https://x', { headers: { cookie: `a=1; ${guest.GUEST_COOKIE}=${id}` } }))).toBe(id);
		expect(guest.guestIdFrom(new Request('https://x', { headers: { cookie: `${guest.GUEST_COOKIE}=../../etc` } }))).toBeNull();
	});
});

describe('guest question screen', () => {
	it('passes ordinary questions', () => {
		for (const q of ['Who has the most championships?', 'Biggest blowout ever?', 'Who won the most lopsided trade?', 'Most points by a QB in a playoff game?']) {
			expect(guest.isCleanQuestion(q), q).toBe(true);
		}
	});
	it('refuses slurs and profanity, including dressed-up spellings', () => {
		for (const q of ['who is the biggest f@ggot', 'why does this team suck sh1t', 'F U C K this league', 'kill yourself']) {
			expect(guest.isCleanQuestion(q), q).toBe(false);
		}
	});
});
