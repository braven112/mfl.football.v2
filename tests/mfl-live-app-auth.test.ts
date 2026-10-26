/**
 * Guard: the MFL Live mobile app's sign-in transport.
 *
 * The app keeps its session in the device keystore and sends it back as
 * `Authorization: Bearer <token>`. That is the SAME signed JWT the browser's
 * httpOnly cookie carries — a second transport, never a second identity
 * source — and it is read by `getMflLiveUser` alone, so the header reaches
 * the /live surfaces and nothing else on the site.
 */

import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
	process.env.JWT_SECRET = 'mfl-live-app-auth-test';
});
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSessionToken, getSessionTokenFromAuthorization } from '../src/utils/session';
import { getAuthUser, getMflLiveUser } from '../src/utils/auth';
import { getLeagueBySlug } from '../src/config/leagues';

const ROOT = join(__dirname, '..');
const THELEAGUE_ID = getLeagueBySlug('theleague')!.id;

const token = (leagueId = THELEAGUE_ID) =>
	createSessionToken({ userId: 'u1', username: 'owner', franchiseId: '0001', leagueId, role: 'owner' });

const bearer = (value: string) =>
	new Request('https://example.test/', { headers: { authorization: value } });

describe('getSessionTokenFromAuthorization', () => {
	it('reads a Bearer token, any case', () => {
		expect(getSessionTokenFromAuthorization('Bearer abc.def.ghi')).toBe('abc.def.ghi');
		expect(getSessionTokenFromAuthorization('bearer abc')).toBe('abc');
	});

	it('refuses anything else', () => {
		expect(getSessionTokenFromAuthorization(null)).toBeNull();
		expect(getSessionTokenFromAuthorization('Basic abc')).toBeNull();
		expect(getSessionTokenFromAuthorization('Bearer')).toBeNull();
		expect(getSessionTokenFromAuthorization('Bearer a b')).toBeNull();
	});
});

describe('the Bearer header', () => {
	it('signs in to MFL Live', () => {
		const user = getMflLiveUser(bearer(`Bearer ${token()}`));
		expect(user?.leagueId).toBe(THELEAGUE_ID);
		expect(user?.franchiseId).toBe('0001');
	});

	it('is NOT a site session — getAuthUser ignores it', () => {
		expect(getAuthUser(bearer(`Bearer ${token()}`))).toBeNull();
	});

	it('passes the same signature check as the cookie', () => {
		const forged = token().replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
		expect(getMflLiveUser(bearer(`Bearer ${forged}`))).toBeNull();
	});

	it('obeys the same league rules — a best-ball session is not MFL Live', () => {
		const bestBall = getLeagueBySlug('best-ball-1')!.id;
		expect(getMflLiveUser(bearer(`Bearer ${token(bestBall)}`))).toBeNull();
	});
});

describe('the login route', () => {
	const login = readFileSync(join(ROOT, 'src/pages/api/auth/login.ts'), 'utf8');

	it('returns the token in the body only to the app, only on the mfl-live scope', () => {
		expect(login).toMatch(
			/const appToken = scope === 'mfl-live' && client === MFL_LIVE_APP_CLIENT \? \{ token: sessionToken \} : \{\};/,
		);
		// Exactly one place puts the token in a body.
		expect(login.match(/token: sessionToken/g)).toHaveLength(1);
	});
});
