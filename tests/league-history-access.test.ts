import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLeagueBySlug } from '../src/config/leagues';
import { LEAGUE_HISTORY_PUBLIC, canFixLeagueHistory, canUseHistoryProduct, canViewLeagueHistory } from '../src/utils/league-history/access';

/**
 * League History — who can see it before launch, and that every surface asks.
 * A page or endpoint that forgets the gate is public the day it merges.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const GATED = {
	product: [
		'src/pages/history/index.astro',
		'src/pages/history/mfl/[id].astro',
		'src/pages/api/league-history/mfl/build.ts',
		'src/pages/api/og/league-history/mfl/[id]/[year].png.ts',
	],
	view: [
		'src/pages/theleague/history/index.astro',
		'src/pages/theleague/history/record-book.astro',
		'src/pages/afl-fantasy/history/index.astro',
		'src/pages/afl-fantasy/history/record-book.astro',
		'src/pages/theleague/history/franchises/index.astro',
		'src/pages/afl-fantasy/history/franchises/index.astro',
		'src/pages/api/og/league-history/record.png.ts',
	],
	fix: ['src/pages/api/league-history/mfl/override.ts'],
};

describe('League History access', () => {
	it("opens our own leagues' history to every visitor", () => {
		// The owner announced it to both leagues (2026-10-25).
		expect(canViewLeagueHistory(null)).toBe(true);
		const owner = { id: 'u', name: 'n', franchiseId: '0005', leagueId: getLeagueBySlug('afl-fantasy')!.id, role: 'owner' } as const;
		expect(canViewLeagueHistory(owner)).toBe(true);
		expect(canFixLeagueHistory(owner)).toBe(false);
	});

	it('keeps the any-league product admin-only until launch', () => {
		// Flipping this is the launch: also add a page-directory entry for
		// /history and make the league pages indexable, then update this test.
		expect(LEAGUE_HISTORY_PUBLIC).toBe(false);
	});

	it('the product refuses signed-out visitors and ordinary owners', () => {
		expect(canUseHistoryProduct(null)).toBe(false);
		expect(canFixLeagueHistory(null)).toBe(false);
		const owner = { id: 'u', name: 'n', franchiseId: '0005', leagueId: '00000', role: 'owner' } as const;
		expect(canUseHistoryProduct(owner)).toBe(false);
		expect(canFixLeagueHistory(owner)).toBe(false);
	});

	it("lets the site owner's AFL commissioner seat use the product, but not fix", () => {
		const aflId = getLeagueBySlug('afl-fantasy')!.id;
		const seat = { id: 'u', name: 'n', franchiseId: '0001', leagueId: aflId, role: 'commissioner' } as const;
		expect(canUseHistoryProduct(seat)).toBe(true);
		expect(canFixLeagueHistory(seat)).toBe(false);
		// The franchise and the league both count. (0001 is on the nav config's
		// admin list, so isCommissionerOrAdmin admits it even without the role.)
		expect(canUseHistoryProduct({ ...seat, franchiseId: '0002' })).toBe(false);
		expect(canUseHistoryProduct({ ...seat, leagueId: '00000' })).toBe(false);
	});

	it.each(GATED.view)('%s checks canViewLeagueHistory', (file) => {
		expect(read(file)).toMatch(/canViewLeagueHistory\(getAuthUser\((Astro\.)?request\)\)|canViewLeagueHistory\(authUser\)/);
	});

	it.each(GATED.product)('%s checks canUseHistoryProduct', (file) => {
		expect(read(file)).toMatch(/canUseHistoryProduct\(getAuthUser\((Astro\.)?request\)\)|canUseHistoryProduct\(authUser\)/);
	});

	it.each(GATED.fix)('%s checks canFixLeagueHistory', (file) => {
		expect(read(file)).toMatch(/canFixLeagueHistory\(getAuthUser\(request\)\)/);
	});

	it('the fix form only renders for the fixing seat', () => {
		expect(read('src/pages/history/mfl/[id].astro')).toMatch(/\{canFix && \(\s*<HistoryFixForm/);
	});
});
