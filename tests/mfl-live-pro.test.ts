import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasMflLivePro } from '../src/utils/mfl-live-pro';
import { ALL_LEAGUES } from '../src/config/leagues';
import { MFL_LIVE_PILOT_LEAGUE_IDS } from '../src/config/leagues-data.mjs';
import {
	FREE_STANDINGS_MODE,
	initialStandingsMode,
	isStandingsModeLocked,
} from '../src/utils/live/standings-projection';

/**
 * Owner Suite Pro on MFL Live: Live and Projected standings are Pro, Final is
 * free. Pro is included for every owner of a full-management league we run
 * (TheLeague, the AFL); best-ball and pilot-league owners are on the free tier.
 */

const user = (leagueId: string) =>
	({ leagueId, franchiseId: '0001', role: 'owner' }) as Parameters<typeof hasMflLivePro>[0];

describe('hasMflLivePro', () => {
	it('includes Pro for every full-management league in the registry', () => {
		const full = ALL_LEAGUES.filter((l) => !l.bestBall);
		expect(full.map((l) => l.slug)).toEqual(expect.arrayContaining(['theleague', 'afl-fantasy']));
		for (const league of full) expect(hasMflLivePro(user(league.id)), league.slug).toBe(true);
	});

	it('leaves best-ball, pilot-league and signed-out viewers on the free tier', () => {
		for (const league of ALL_LEAGUES.filter((l) => l.bestBall)) {
			expect(hasMflLivePro(user(league.id)), league.slug).toBe(false);
		}
		for (const id of MFL_LIVE_PILOT_LEAGUE_IDS) expect(hasMflLivePro(user(id)), id).toBe(false);
		expect(hasMflLivePro(null)).toBe(false);
	});
});

describe('standings views by tier', () => {
	it('keeps Final free and locks Live and Projected without Pro', () => {
		expect(FREE_STANDINGS_MODE).toBe('final');
		expect(isStandingsModeLocked('final', true)).toBe(false);
		expect(isStandingsModeLocked('live', true)).toBe(true);
		expect(isStandingsModeLocked('projected', true)).toBe(true);
		expect(isStandingsModeLocked('live', false)).toBe(false);
	});

	it('opens a locked table on Final and an unlocked one on its preference', () => {
		expect(initialStandingsMode(true)).toBe('final');
		expect(initialStandingsMode(false)).toBe('live');
		expect(initialStandingsMode(false, 'projected')).toBe('projected');
	});
});

describe('only MFL Live locks anything', () => {
	// The league sites render the same LiveBoard; a lock there would take a
	// view away from owners whose league already includes Pro.
	const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

	it('every /live surface that shows standings passes the lock from hasMflLivePro', () => {
		for (const page of ['src/pages/live/index.astro', 'src/pages/live/league/[id].astro', 'src/pages/live/standings.astro']) {
			expect(read(page), page).toMatch(/ProLocked=\{!hasMflLivePro\(authUser\)\}|proLocked=\{!hasMflLivePro\(authUser\)\}/);
		}
	});

	it('the league-site board never passes it', () => {
		expect(read('src/components/shared/live/LiveBoardPage.astro')).not.toMatch(/proLocked|ProLocked/);
	});
});

describe('the locked switch, rendered', async () => {
	const { createElement } = await import('react');
	const { renderToStaticMarkup } = await import('react-dom/server');
	const { default: LvStandings } = await import('../src/components/shared/live/LvStandings');
	const rows = [
		{ franchiseId: '0001', name: 'A', rank: 1, wins: 3, losses: 1, ties: 0, pointsFor: 400 },
		{ franchiseId: '0002', name: 'B', rank: 2, wins: 2, losses: 2, ties: 0, pointsFor: 380 },
	] as never;

	it('draws Live and Projected disabled with a Pro badge, and opens on Final', () => {
		const html = renderToStaticMarkup(createElement(LvStandings, { rows, leagueName: 'L', proLocked: true }));
		expect(html.match(/disabled=""/g)?.length).toBe(2);
		expect(html.match(/lv-pro-badge/g)?.length).toBe(2);
		expect(html).toMatch(/aria-pressed="true"[^>]*>Final/);
		expect(html).toContain('lv-pro-note');
	});

	it('locks nothing without the flag', () => {
		const html = renderToStaticMarkup(createElement(LvStandings, { rows, leagueName: 'L' }));
		expect(html).not.toMatch(/disabled=""|lv-pro-badge|lv-pro-note/);
	});
});
