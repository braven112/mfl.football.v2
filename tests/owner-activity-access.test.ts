import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { decideOwnerActivityAccess } from '../src/utils/owner-activity-access';
import { getLeagueBySlug } from '../src/config/leagues';
import { PACKAGE_ROUTES } from '../src/config/package-league-routes.mjs';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import type { AuthUser } from '../src/utils/auth';

/**
 * Owner Activity is on every league and PRIVATE by default (owner's call,
 * Oct 2026): platform admins always, a league's commissioner only when an
 * admin switched it on, owners never.
 */
const theleague = getLeagueBySlug('theleague')!;
const afl = getLeagueBySlug('afl-fantasy')!;

const user = (over: Partial<AuthUser>): AuthUser => ({
	id: 'u',
	name: 'someone',
	franchiseId: '0005',
	leagueId: theleague.id,
	role: 'owner',
	...over,
});

describe('decideOwnerActivityAccess', () => {
	it('sends a signed-out visitor to sign in', () => {
		expect(decideOwnerActivityAccess(null, theleague, true)).toEqual({ kind: 'login' });
	});

	it('always lets a platform admin in, in any league, with the switch', () => {
		const admin = user({ name: 'braven112', leagueId: theleague.id });
		expect(decideOwnerActivityAccess(admin, afl, false)).toEqual({ kind: 'allow', canManage: true });
	});

	it('keeps a commissioner out until the switch is on', () => {
		const commish = user({ role: 'commissioner' });
		expect(decideOwnerActivityAccess(commish, theleague, false)).toEqual({ kind: 'forbidden' });
		expect(decideOwnerActivityAccess(commish, theleague, true)).toEqual({ kind: 'allow', canManage: false });
	});

	it("never opens one league's report to another league's commissioner", () => {
		const aflCommish = user({ role: 'commissioner', leagueId: afl.id });
		expect(decideOwnerActivityAccess(aflCommish, theleague, true)).toEqual({ kind: 'forbidden' });
	});

	it('never lets an owner in, switch or not', () => {
		expect(decideOwnerActivityAccess(user({}), theleague, true)).toEqual({ kind: 'forbidden' });
	});
});

describe('every league has the report, gated', () => {
	it('is a package route for every package league', () => {
		expect(PACKAGE_ROUTES['activity.astro']).toBeNull();
	});

	// EVERY registry league, best-ball included: "every league we create".
	const pageDirs = ALL_LEAGUES.map((l: any) => l.slug);

	it.each(pageDirs)('%s/activity.astro exists and asks the access gate', (slug) => {
		const file = path.join(process.cwd(), 'src/pages', slug, 'activity.astro');
		expect(existsSync(file)).toBe(true);
		const src = readFileSync(file, 'utf8');
		expect(src).toContain('resolveOwnerActivityAccess(');
		expect(src).toContain("forbiddenPathFor(league, 'admin')");
	});

	it('no route renders the report without the gate', () => {
		const offenders: string[] = [];
		const walk = (dir: string) => {
			for (const e of readdirSync(dir, { withFileTypes: true })) {
				const p = path.join(dir, e.name);
				if (e.isDirectory()) walk(p);
				else if (p.endsWith('.astro')) {
					const src = readFileSync(p, 'utf8');
					if (/OwnerActivity(Page|Report)\b/.test(src) && !src.includes('resolveOwnerActivityAccess(')) {
						offenders.push(path.relative(process.cwd(), p));
					}
				}
			}
		};
		walk(path.join(process.cwd(), 'src/pages'));
		expect(offenders).toEqual([]);
	});
});
