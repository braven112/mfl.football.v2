/**
 * Guard: MFL Live OPEN sign-in (`MFL_LIVE_OPEN_SIGN_IN`).
 *
 * With the switch on, an owner of ANY MyFantasyLeague league may sign in on the
 * shared host's /login. Such a session is MFL-Live-ONLY:
 *
 * - `getAuthUser` still refuses it, so every endpoint outside /live treats the
 *   visitor as signed out. Several of those key on franchiseId alone or fall
 *   back to TheLeague for a league they do not know (the suggestion board,
 *   Schefter replies), which is why the line is drawn here rather than per
 *   endpoint.
 * - `getMflLiveUser` accepts it, always as a plain owner, and only the /live
 *   surfaces call it (the allowlist below).
 * - `isCommissionerOrAdmin` is false for any league outside the registry.
 *
 * With the switch off (the shipped state), `getMflLiveUser` is exactly
 * `getAuthUser`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// A fixed secret: `loadAuth` re-imports the session module, which would
// otherwise mint a fresh random secret and refuse the tokens minted here.
vi.hoisted(() => {
	process.env.JWT_SECRET = 'mfl-live-open-sign-in-test';
});
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createSessionToken } from '../src/utils/session';
import { getLeagueBySlug } from '../src/config/leagues';
import { pickOpenSignInLeague } from '../src/utils/mfl-login';

const ROOT = join(__dirname, '..');
const THELEAGUE_ID = getLeagueBySlug('theleague')!.id;
const FOREIGN_ID = '54321';

const requestWith = (leagueId: string, role: 'owner' | 'commissioner' = 'owner') =>
	new Request('https://example.test/', {
		headers: {
			cookie: `session_token=${createSessionToken({
				userId: 'u1',
				username: 'owner',
				franchiseId: '0001',
				leagueId,
				role,
			})}`,
		},
	});

/** auth.ts loaded against a registry whose switch is forced to `open`. */
async function loadAuth(open: boolean) {
	vi.resetModules();
	vi.doMock('../src/config/leagues-data.mjs', async (importOriginal) => ({
		...(await importOriginal<Record<string, unknown>>()),
		MFL_LIVE_OPEN_SIGN_IN: open,
	}));
	return import('../src/utils/auth');
}

afterEach(() => {
	vi.doUnmock('../src/config/leagues-data.mjs');
	vi.resetModules();
});

describe('the switch ships OFF', () => {
	it('is false in the registry', async () => {
		const data = await import('../src/config/leagues-data.mjs');
		expect(data.MFL_LIVE_OPEN_SIGN_IN).toBe(false);
	});

	it('off, getMflLiveUser refuses a foreign league exactly as getAuthUser does', async () => {
		const auth = await loadAuth(false);
		expect(auth.getAuthUser(requestWith(FOREIGN_ID))).toBeNull();
		expect(auth.getMflLiveUser(requestWith(FOREIGN_ID))).toBeNull();
		expect(auth.getMflLiveUser(requestWith(THELEAGUE_ID))).toEqual(auth.getAuthUser(requestWith(THELEAGUE_ID)));
	});
});

describe('switch ON: a foreign session is MFL-Live-only', () => {
	it('getAuthUser still refuses it', async () => {
		const auth = await loadAuth(true);
		expect(auth.getAuthUser(requestWith(FOREIGN_ID))).toBeNull();
	});

	it('getMflLiveUser accepts it, demoted to a plain owner', async () => {
		const auth = await loadAuth(true);
		const user = auth.getMflLiveUser(requestWith(FOREIGN_ID, 'commissioner'));
		expect(user).toMatchObject({ leagueId: FOREIGN_ID, franchiseId: '0001', role: 'owner' });
	});

	it('refuses a league id that is not an MFL number', async () => {
		const auth = await loadAuth(true);
		expect(auth.getMflLiveUser(requestWith('theleague'))).toBeNull();
	});

	it('leaves a registry session untouched, commissioner role included', async () => {
		const auth = await loadAuth(true);
		expect(auth.getMflLiveUser(requestWith(THELEAGUE_ID, 'commissioner'))).toMatchObject({
			leagueId: THELEAGUE_ID,
			role: 'commissioner',
		});
	});
});

describe('a league outside the registry is never an admin here', () => {
	it('even with a commissioner role on the session', async () => {
		const auth = await loadAuth(true);
		expect(
			auth.isCommissionerOrAdmin({ id: 'u', name: 'n', franchiseId: '0001', leagueId: FOREIGN_ID, role: 'commissioner' }),
		).toBe(false);
		expect(
			auth.isCommissionerOrAdmin({ id: 'u', name: 'n', franchiseId: '0001', leagueId: FOREIGN_ID, role: 'admin' }),
		).toBe(false);
	});
});

describe('pickOpenSignInLeague', () => {
	it('takes the lowest-numbered league that names a franchise, whatever myleagues order', () => {
		const leagues = [
			{ id: '70000', franchise_id: '0003' },
			{ id: '12000', franchise_id: '' },
			{ id: '30000', franchise_id: '7' },
		];
		expect(pickOpenSignInLeague(leagues)).toEqual({ leagueId: '30000', franchiseId: '0007' });
		expect(pickOpenSignInLeague([...leagues].reverse())).toEqual({ leagueId: '30000', franchiseId: '0007' });
	});

	it('returns null when no league names a franchise', () => {
		expect(pickOpenSignInLeague([{ id: '1', franchise_id: '' }, { id: 'x', franchise_id: '0001' }])).toBeNull();
	});
});

describe('only the MFL Live surfaces read an open session', () => {
	// Every file allowed to call getMflLiveUser. Adding one is a claim that it
	// is safe for a session from a league this site does not run: it reads
	// only the owner's own MFL data and keys nothing on franchiseId alone.
	const ALLOWED = new Set([
		'src/utils/auth.ts',
		'src/layouts/MflAppLayout.astro',
		'src/pages/login.astro',
		'src/pages/live/index.astro',
		'src/pages/live/settings.astro',
		'src/pages/live/standings.astro',
		'src/pages/live/league/[id].astro',
		'src/pages/api/live-board.ts',
		'src/pages/api/live-standings.ts',
		'src/pages/api/live-leagues.ts',
		'src/pages/api/league-board.ts',
	]);

	function walk(dir: string, out: string[] = []): string[] {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			if (statSync(full).isDirectory()) walk(full, out);
			else if (/\.(ts|tsx|astro|mjs)$/.test(name)) out.push(relative(ROOT, full));
		}
		return out;
	}

	it('getMflLiveUser is called from the allowlist and nowhere else', () => {
		const callers = walk(join(ROOT, 'src')).filter((f) =>
			/getMflLiveUser\(/.test(readFileSync(join(ROOT, f), 'utf8')),
		);
		expect(callers.filter((f) => !ALLOWED.has(f))).toEqual([]);
	});

	it('/live/analytics stays on getAuthUser', () => {
		expect(readFileSync(join(ROOT, 'src/pages/live/analytics.astro'), 'utf8')).not.toContain('getMflLiveUser');
	});
});

describe('the login route', () => {
	const login = readFileSync(join(ROOT, 'src/pages/api/auth/login.ts'), 'utf8');

	it('opens only the mfl-live scope, and only while the switch is on', () => {
		expect(login).toMatch(/const openSignIn = scope === 'mfl-live' && MFL_LIVE_OPEN_SIGN_IN;/);
		expect(login).toMatch(/openFallback: openSignIn/);
	});

	it('mints an open session as a plain owner, with no commissioner cookie', () => {
		expect(login).toMatch(/role: openLeague \? 'owner'/);
		expect(login).toMatch(/openLeague \? undefined : mflResponse\.commishCookie/);
	});
});
