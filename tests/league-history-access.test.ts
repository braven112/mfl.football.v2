import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEAGUE_HISTORY_PUBLIC, canFixLeagueHistory, canViewLeagueHistory } from '../src/utils/league-history/access';

/**
 * League History — who can see it before launch, and that every surface asks.
 * A page or endpoint that forgets the gate is public the day it merges.
 */

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const GATED = {
	view: [
		'src/pages/history/index.astro',
		'src/pages/history/mfl/[id].astro',
		'src/pages/api/league-history/mfl/build.ts',
		'src/pages/api/og/league-history/mfl/[id]/[year].png.ts',
	],
	fix: ['src/pages/api/league-history/mfl/override.ts'],
};

describe('League History access', () => {
	it('stays admin-only until launch', () => {
		// Flipping this is the launch: also add a page-directory entry for
		// /history and make the league pages indexable, then update this test.
		expect(LEAGUE_HISTORY_PUBLIC).toBe(false);
	});

	it('refuses signed-out visitors and ordinary owners', () => {
		expect(canViewLeagueHistory(null)).toBe(false);
		expect(canFixLeagueHistory(null)).toBe(false);
		const owner = { id: 'u', name: 'n', franchiseId: '0005', leagueId: '00000', role: 'owner' } as const;
		expect(canViewLeagueHistory(owner)).toBe(false);
		expect(canFixLeagueHistory(owner)).toBe(false);
	});

	it.each(GATED.view)('%s checks canViewLeagueHistory', (file) => {
		expect(read(file)).toMatch(/canViewLeagueHistory\(getAuthUser\((Astro\.)?request\)\)|canViewLeagueHistory\(authUser\)/);
	});

	it.each(GATED.fix)('%s checks canFixLeagueHistory', (file) => {
		expect(read(file)).toMatch(/canFixLeagueHistory\(getAuthUser\(request\)\)/);
	});

	it('the fix form only renders for the fixing seat', () => {
		expect(read('src/pages/history/mfl/[id].astro')).toMatch(/\{canFix && \(\s*<HistoryFixForm/);
	});
});
