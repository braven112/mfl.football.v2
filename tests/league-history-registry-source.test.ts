/**
 * A league on our platform (TheLeague, the AFL, Archie's) shows the SAME
 * champions on its free History page as on its own site, read from the
 * site's compiled history and never from a second MFL crawl — and no visit
 * can start a rebuild of it (registry-source.ts).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../src/config/leagues';
import { recordFromRegistryDataset } from '../src/utils/league-history/registry-source';
import { advanceMflHistory, readMflHistory, seasonsToCrawl } from '../src/utils/league-history/store';

const dataset = (dataPath: string) => JSON.parse(readFileSync(`${dataPath}/derived/league-history.json`, 'utf8'));

describe('recordFromRegistryDataset', () => {
	const league = { name: 'Test League', host: 'www1.myfantasyleague.com' };
	const rec = recordFromRegistryDataset('12345', league, {
		seasons: [
			{ y: 2024, done: 1, teams: { '0001': { n: 'Aces', r: 'C' }, '0002': { n: 'Bees', r: 'R' }, '0003': { n: 'Cats', r: 'M' } } },
			{ y: 2025, done: 1, teams: { '0001': { n: 'Aces', r: 'M' }, '0002': { n: 'Bees', r: 'M' } } },
			{ y: 2026, done: 0, teams: { '0001': { n: 'Aces 2', r: 'C' }, '0002': { n: 'Bees', r: 'R' } } },
		],
	}, '2026-11-05T00:00:00.000Z');

	it('names the champion and runner-up of a finished season', () => {
		expect(rec.seasons['2024'].champion).toEqual({ id: '0001', name: 'Aces' });
		expect(rec.seasons['2024'].runnerUp).toEqual({ id: '0002', name: 'Bees' });
		expect(rec.seasons['2024'].method).toBe('bracket');
	});

	it('leaves a season with no champion, or one still being played, not on record', () => {
		expect(rec.seasons['2025'].champion).toBeNull();
		expect(rec.seasons['2026'].champion).toBeNull();
		expect(rec.seasons['2026'].note).toBe('season in progress');
	});

	it('is marked as the site’s own history and is never crawled', () => {
		expect(rec.source).toBe('site');
		expect(rec.chain.map((c) => c.year)).toEqual([2024, 2025, 2026]);
		expect(rec.latestNames['0001']).toBe('Aces 2');
		expect(seasonsToCrawl(rec, Date.now())).toEqual([]);
	});
});

describe('registry leagues read their own site history', () => {
	for (const slug of ['theleague', 'afl-fantasy', 'archies'] as const) {
		const league = LEAGUES[slug];
		it(`${slug}: the free page's champions are the site's champions`, async () => {
			const record = await readMflHistory(league.id);
			expect(record?.source).toBe('site');
			const data = dataset(league.dataPath);
			for (const s of data.seasons.filter((x: any) => x.done)) {
				const champ = Object.entries(s.teams).find(([, t]: any) => t.r === 'C')?.[0] ?? null;
				expect(record!.seasons[String(s.y)].champion?.id ?? null).toBe(champ);
			}
		});

		it(`${slug}: a build step never crawls it`, async () => {
			const fetchExport = async () => {
				throw new Error('must not reach MFL');
			};
			const result = await advanceMflHistory(league.id, { fetchExport, leagueYear: 2026 });
			expect(result.status).toBe('done');
		});
	}
});
