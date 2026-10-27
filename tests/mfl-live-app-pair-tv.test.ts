/**
 * Guard: the MFL Live phone app can approve a TV.
 *
 * The app has no browser cookie. It signs in with `Authorization: Bearer`, so
 * `POST /api/broadcast-tv/approve` must read its owner through
 * `getMflLiveUser` (the one reader of that header), and every answer the
 * endpoint gives must be one the app's Pair a TV screen switches on
 * (`MflLiveAppPairTvResult`, packages/shared-types/src/mfl-live-app-pair-tv.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
	process.env.JWT_SECRET = 'mfl-live-app-pair-tv-test';
});

const state = vi.hoisted(() => ({
	store: null as unknown,
	allowed: true,
	selection: null as string | null,
	selectionReads: [] as (string | null)[],
}));

vi.mock('../src/utils/broadcast-tv-store', () => ({
	getPairingStore: async () => state.store,
}));
vi.mock('../src/utils/mfl-live-selection-store', () => ({
	readMflLiveSelection: async (_user: unknown, cookie: string | null) => {
		state.selectionReads.push(cookie);
		return state.selection;
	},
}));
vi.mock('../src/utils/rate-limit', () => ({
	checkRateLimit: async () => ({ allowed: state.allowed }),
}));

import type { MflLiveAppPairTvResult } from '../packages/shared-types/src/mfl-live-app-pair-tv';
import { POST } from '../src/pages/api/broadcast-tv/approve';
import { createSessionToken } from '../src/utils/session';
import { startPairing, pollPairing, readPass, type PairingStore } from '../src/utils/broadcast-tv-pairing';
import { getLeagueBySlug } from '../src/config/leagues';

// The mock above replaces the module, so pull the real Map store back in.
const { memoryPairingStore: realMemoryStore } = await vi.importActual<
	typeof import('../src/utils/broadcast-tv-store')
>('../src/utils/broadcast-tv-store');

const THELEAGUE_ID = getLeagueBySlug('theleague')!.id;
const token = () =>
	createSessionToken({ userId: 'u1', username: 'owner', franchiseId: '0001', leagueId: THELEAGUE_ID, role: 'owner' });

const APP_RESULTS: readonly MflLiveAppPairTvResult[] = [
	'approved',
	'expired',
	'already-used',
	'invalid',
	'signed-out',
	'slow-down',
	'unavailable',
];

async function approve(
	body: unknown,
	headers: Record<string, string> = { authorization: `Bearer ${token()}` },
	broadcastCookie?: string,
) {
	const request = new Request('https://mfl.football/api/broadcast-tv/approve', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
	// The app sends no cookies, so the broadcast's league-set cookie is absent.
	const cookies = { get: () => (broadcastCookie === undefined ? undefined : { value: broadcastCookie }) };
	const res = await POST({ request, cookies } as never);
	const json = (await res.json()) as { result: MflLiveAppPairTvResult };
	expect(APP_RESULTS).toContain(json.result);
	return { status: res.status, result: json.result };
}

describe('approving a TV from the phone app', () => {
	let store: PairingStore;
	beforeEach(() => {
		store = realMemoryStore();
		state.store = store;
		state.allowed = true;
		state.selection = null;
		state.selectionReads = [];
	});

	async function pairedLeagues(headers?: Record<string, string>, broadcastCookie?: string) {
		const { userCode, deviceCode } = await startPairing(store, { device: 'TV' });
		await approve({ code: userCode }, headers, broadcastCookie);
		const poll = await pollPairing(store, deviceCode);
		return (await readPass(store, poll.status === 'approved' ? poll.passToken : null))?.leagues;
	}

	it('accepts the Bearer token and hands the TV a pass for that owner', async () => {
		const { userCode, deviceCode } = await startPairing(store, { device: 'Android TV' });
		// Typed the way the TV prints it: lower case, with a space.
		const typed = `${userCode.slice(0, 3)} ${userCode.slice(3)}`.toLowerCase();
		expect(await approve({ code: typed })).toEqual({ status: 200, result: 'approved' });

		const poll = await pollPairing(store, deviceCode);
		expect(poll.status).toBe('approved');
		const pass = await readPass(store, poll.status === 'approved' ? poll.passToken : null);
		expect(pass?.user.leagueId).toBe(THELEAGUE_ID);
		expect(pass?.user.franchiseId).toBe('0001');
		// Nothing chosen in the app yet: the TV gets the broadcast's default set.
		expect(pass?.leagues).toBeNull();
	});

	it('gives the TV the leagues the owner watches in the app', async () => {
		state.selection = '13522,55555';
		expect(await pairedLeagues()).toBe('13522,55555');
		// The app has no cookie, so the account's stored choice is the one read.
		expect(state.selectionReads).toEqual([null]);
	});

	it('leaves a browser on its broadcast cookie, or the default without one', async () => {
		state.selection = '13522,55555';
		const browser = { cookie: `session_token=${token()}` };
		expect(await pairedLeagues(browser, '13522')).toBe('13522');
		expect(await pairedLeagues(browser)).toBeNull();
		// A browser never reads the account's MFL Live choice here: the TV must
		// match the league list `/live/broadcast/pair` previewed.
		expect(state.selectionReads).toEqual([]);
	});

	it('is signed-out without a Bearer token', async () => {
		const { userCode } = await startPairing(store, { device: 'TV' });
		expect(await approve({ code: userCode }, {})).toEqual({ status: 401, result: 'signed-out' });
	});

	it('is signed-out with a forged token', async () => {
		const forged = token().replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
		expect(await approve({ code: 'ABCDEF' }, { authorization: `Bearer ${forged}` })).toEqual({
			status: 401,
			result: 'signed-out',
		});
	});

	it('answers every other outcome with a result the app knows', async () => {
		expect(await approve({ code: 'O0O0O0' })).toEqual({ status: 400, result: 'invalid' });
		expect(await approve({})).toEqual({ status: 400, result: 'invalid' });
		expect(await approve({ code: 'ABCDEF' })).toEqual({ status: 410, result: 'expired' });

		const { userCode } = await startPairing(store, { device: 'TV' });
		await approve({ code: userCode });
		expect(await approve({ code: userCode })).toEqual({ status: 410, result: 'already-used' });

		state.allowed = false;
		expect(await approve({ code: 'ABCDEF' })).toEqual({ status: 429, result: 'slow-down' });

		state.allowed = true;
		state.store = null;
		expect(await approve({ code: 'ABCDEF' })).toEqual({ status: 503, result: 'unavailable' });
	});
});
