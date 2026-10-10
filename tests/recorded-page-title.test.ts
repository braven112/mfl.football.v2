import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { recordedPageTitle } from '../src/utils/recorded-page-title';
import { getLeagueTeamConfigs } from '../src/utils/league-team-brands';
import type { SchefterFeed } from '../src/types/schefter';

/**
 * Owner Activity printed `Sf_2026_auction_recap` and `0008` for an article and
 * a franchise page — the directory lists routes, not records, so it has no
 * name for either. The record behind the id does.
 *
 * Runs against the real committed feed and config (ids picked dynamically).
 */

const feed = JSON.parse(readFileSync('src/data/theleague/schefter-feed.json', 'utf-8')) as SchefterFeed;

describe('recordedPageTitle', () => {
	it("names a franchise page after the franchise's current name, in each league", () => {
		for (const league of ['theleague', 'afl-fantasy'] as const) {
			const team = getLeagueTeamConfigs(league)[0];
			const prefix = league === 'theleague' ? '/theleague' : '/afl-fantasy';
			expect(recordedPageTitle(`${prefix}/franchises/${team.franchiseId}`, league)).toBe(
				`Franchise: ${team.name}`,
			);
		}
	});

	it('names an article after its headline', () => {
		const post = feed.posts.find((p) => p.type === 'article' && p.headline);
		expect(post).toBeDefined();
		expect(recordedPageTitle(`/theleague/news/${post!.id}`, 'theleague')).toBe(`Schefter: ${post!.headline}`);
	});

	it('finds an article that has rotated into the season archive', () => {
		const title = recordedPageTitle('/theleague/news/sf_2026_auction_recap', 'theleague');
		expect(title).toMatch(/^Schefter: /);
	});

	it('falls back to a generic name rather than the raw id', () => {
		expect(recordedPageTitle('/theleague/news/no_such_post_xyz', 'theleague')).toBe('Schefter article');
		expect(recordedPageTitle('/theleague/news/%3Cscript%3E', 'theleague')).toBe('Schefter article');
		expect(recordedPageTitle('/theleague/franchises/9999', 'theleague')).toBe('Franchise 9999');
	});

	it('names a shared mock draft', () => {
		expect(recordedPageTitle('/theleague/draft/mock/mond4dsvh0c8rh', 'theleague')).toBe('Shared mock draft');
	});

	it('leaves every other path to the caller', () => {
		expect(recordedPageTitle('/theleague/standings', 'theleague')).toBeNull();
	});
});
