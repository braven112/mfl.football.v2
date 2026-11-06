/**
 * The free History page for a league that already lives on our platform
 * (TheLeague, the AFL, Archie's, any registry league): its champions come
 * from the history the league's own site keeps — `<dataPath>/derived/
 * league-history.json`, compiled from the curated championship files — never
 * from a second MFL crawl.
 *
 * Why: the crawl and the site must not tell two different stories about the
 * same league, and no visitor should ever trigger a rebuild of a league we
 * already hold (Brandon, 2026-11-05). A registry league is therefore never
 * written to the crawl store: the page, the champion card and the build
 * endpoint all read it through `readMflHistory`, which asks here first.
 *
 * Server-only (the league-data loader reads node:fs locally, Blob in prod).
 */
import { getLeagueById } from '../../config/leagues';
import { loadLeagueHistory } from './datasets';
import type { SeasonFranchise } from './mfl-champions';
import type { StoredLeagueHistory, StoredSeason } from './store';

/** The slice of league-history.json this reads (shape: dataset.mjs). */
export interface RegistryHistoryDataset {
	seasons: Array<{
		y: number;
		done?: number;
		teams: Record<string, { n?: string; r?: string }>;
	}>;
}

/** The registry league for an MFL id, when it has its own compiled history. */
export function registryLeagueFor(leagueId: string): { name: string; dataPath: string; host: string } | null {
	const league = getLeagueById(leagueId);
	if (!league?.dataPath) return null;
	return { name: league.name, dataPath: league.dataPath, host: league.mflHost };
}

/**
 * Pure: the site's compiled history as the free page's record. A finished
 * season names the team marked `C` champion and `R` runner-up; a season
 * still being played (or one the site has no champion for) reads "Not on
 * record", exactly as the site's own pages show it.
 */
export function recordFromRegistryDataset(
	leagueId: string,
	league: { name: string; host: string },
	dataset: RegistryHistoryDataset,
	stamp: string,
): StoredLeagueHistory {
	const seasons: Record<string, StoredSeason> = {};
	const latestNames: Record<string, string> = {};
	const ordered = [...dataset.seasons].sort((a, b) => a.y - b.y);
	for (const s of ordered) {
		const franchises: SeasonFranchise[] = Object.entries(s.teams).map(([id, t]) => ({ id, name: t.n || `Franchise ${id}` }));
		for (const f of franchises) latestNames[f.id] = f.name;
		const pick = (code: string) => franchises.find((f) => s.teams[f.id]?.r === code) ?? null;
		const champion = s.done ? pick('C') : null;
		seasons[String(s.y)] = {
			year: s.y,
			method: champion ? 'bracket' : 'unknown',
			champion,
			runnerUp: champion ? pick('R') : null,
			note: champion ? undefined : s.done ? 'no champion on record at the league site' : 'season in progress',
			franchises,
			crawledAt: stamp,
		};
	}
	return {
		platform: 'mfl',
		source: 'site',
		leagueId,
		name: league.name,
		chain: ordered.map((s) => ({ year: s.y, leagueId, host: league.host })),
		latestNames,
		seasons,
		createdAt: stamp,
		updatedAt: stamp,
	};
}

/** The record for a registry league, or null when the id is not one of ours. */
export async function readRegistryHistory(leagueId: string): Promise<StoredLeagueHistory | null> {
	const league = registryLeagueFor(leagueId);
	if (!league) return null;
	const dataset = await loadLeagueHistory<RegistryHistoryDataset & { generatedAt?: string }>(league.dataPath);
	if (!dataset?.seasons?.length) return null;
	return recordFromRegistryDataset(leagueId, league, dataset, dataset.generatedAt ?? new Date(0).toISOString());
}
