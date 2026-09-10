/**
 * Feature adoption — how much of the league has the app installed, and how
 * many of them can actually be reached by a notification.
 *
 * Both answers already exist in storage; nothing here writes or tracks
 * anything new. They live in one module because they answer the same
 * question from two sides ("did this feature land?") and because the Owner
 * Activity page is a forked sibling pair — one bundled read keeps the
 * addition to a line on each route instead of a block that can drift, the
 * same reason `getSurfaceSection` exists.
 *
 * WHY COUNTS AND NOT NAMES. A per-owner column is available for install (the
 * page already names owners) but notification PREFERENCES are not the same
 * kind of fact: "who turned off trade alerts" is a private setting, and a
 * table of it invites exactly the conversation nobody wants. The adoption
 * numbers are aggregates for that reason — how many owners, not which.
 */

import { getRedis } from './redis-client';
import { installStateKey, parseInstallState, type InstallSource } from './app-install-state';
import { preferencesKey, sanitize } from './push-preferences';
import { subscriptionsKey } from './push-subscriptions';
import {
	isCategoryEnabled,
	visibleCategoriesForLeague,
	type NotificationLeague,
} from '../config/notification-categories';

/** How an install was learned about, in the order the report lists them. */
const INSTALL_SOURCE_LABELS: Record<InstallSource, string> = {
	standalone: 'Opened the app',
	appinstalled: 'Installed here',
	declared: 'Told us they had it',
};

export interface InstallAdoption {
	/** Owners with an install record. */
	installed: number;
	/** Owners in the league — the denominator, so the UI needs no second prop. */
	total: number;
	/** `installed / total`, 0-100. */
	share: number;
	sources: { source: InstallSource; label: string; count: number }[];
}

export interface PushCategoryAdoption {
	id: string;
	label: string;
	/** Reachable owners who have this category ON (explicitly or by default). */
	on: number;
}

export interface PushAdoption {
	/** Owners with at least one live subscription — the reachable ones. */
	reachable: number;
	total: number;
	share: number;
	/** Browsers/devices registered across the league. */
	devices: number;
	categories: PushCategoryAdoption[];
}

export interface AdoptionSection {
	install: InstallAdoption;
	push: PushAdoption;
}

/** A stored preferences record, or nothing when it cannot be read. */
function parseStoredPreferences(raw: unknown): unknown {
	if (typeof raw !== 'string') return raw;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function share(part: number, whole: number): number {
	return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export function emptyAdoption(total = 0): AdoptionSection {
	return {
		install: { installed: 0, total, share: 0, sources: [] },
		push: { reachable: 0, total, share: 0, devices: 0, categories: [] },
	};
}

/**
 * Install + notification adoption for a whole league.
 *
 * Cost is `2 + N` Upstash commands (two MGETs and one HLEN per franchise).
 * The subscription hashes are read with HLEN rather than HGETALL on purpose:
 * the only thing wanted is how many devices, and the values are full push
 * endpoints — pulling 24 franchises' worth of them across the wire to call
 * `.length` on the result would be the expensive way to learn a number Redis
 * already knows.
 */
export async function getAdoptionSection(
	leagueId: string,
	franchiseIds: readonly string[],
	league: NotificationLeague,
): Promise<AdoptionSection> {
	const total = franchiseIds.length;
	const redis = await getRedis();
	if (!redis || total === 0) return emptyAdoption(total);

	try {
		const [installRaw, prefsRaw, deviceCounts] = await Promise.all([
			redis.mget<unknown>(...franchiseIds.map((id) => installStateKey(leagueId, id))),
			redis.mget<unknown>(...franchiseIds.map((id) => preferencesKey(leagueId, id))),
			Promise.all(franchiseIds.map((id) => redis.hlen(subscriptionsKey(leagueId, id)))),
		]);

		const sourceCounts = new Map<InstallSource, number>();
		let installed = 0;
		for (const raw of installRaw ?? []) {
			const state = parseInstallState(raw);
			if (!state) continue;
			installed += 1;
			sourceCounts.set(state.source, (sourceCounts.get(state.source) ?? 0) + 1);
		}

		const categories = visibleCategoriesForLeague(league);
		const categoryCounts = new Map<string, number>();
		let reachable = 0;
		let devices = 0;

		franchiseIds.forEach((_id, i) => {
			const deviceCount = Number(deviceCounts[i]) || 0;
			devices += deviceCount;
			// A franchise with no subscription cannot be reached, so counting its
			// preferences would inflate every category with owners who will never
			// see the alert.
			if (deviceCount === 0) return;
			reachable += 1;
			// Parsed per row, not per section: a single unparseable preferences
			// value would otherwise throw to the catch below and hide the whole
			// section — install numbers included, which were already correct.
			// `readPreferences` and `parseInstallState` both guard the same way.
			const stored = sanitize(parseStoredPreferences(prefsRaw?.[i]));
			for (const category of categories) {
				if (isCategoryEnabled(category.id, stored, league)) {
					categoryCounts.set(category.id, (categoryCounts.get(category.id) ?? 0) + 1);
				}
			}
		});

		return {
			install: {
				installed,
				total,
				share: share(installed, total),
				sources: (Object.keys(INSTALL_SOURCE_LABELS) as InstallSource[])
					.map((source) => ({
						source,
						label: INSTALL_SOURCE_LABELS[source],
						count: sourceCounts.get(source) ?? 0,
					}))
					.filter((row) => row.count > 0),
			},
			push: {
				reachable,
				total,
				share: share(reachable, total),
				devices,
				categories: categories
					.map((category) => ({
						id: category.id,
						label: category.label,
						on: categoryCounts.get(category.id) ?? 0,
					}))
					.sort((a, b) => b.on - a.on || a.label.localeCompare(b.label)),
			},
		};
	} catch (err) {
		console.error('[site-adoption] read failed:', err);
		return emptyAdoption(total);
	}
}

/**
 * Deterministic stand-in for the `?mock` preview path, so the section can be
 * designed before a single owner has installed anything.
 */
export function mockAdoptionSection(
	franchiseIds: readonly string[],
	league: NotificationLeague,
): AdoptionSection {
	const total = franchiseIds.length;
	const installed = Math.max(1, Math.round(total * 0.55));
	const reachable = Math.max(1, Math.round(total * 0.45));
	const categories = visibleCategoriesForLeague(league);
	return {
		install: {
			installed,
			total,
			share: share(installed, total),
			sources: (
				[
					{ source: 'standalone', count: Math.round(installed * 0.6) },
					{ source: 'appinstalled', count: Math.round(installed * 0.3) },
					{
						source: 'declared',
						count: installed - Math.round(installed * 0.6) - Math.round(installed * 0.3),
					},
				] as { source: InstallSource; count: number }[]
			)
				.filter((row) => row.count > 0)
				.map((row) => ({ ...row, label: INSTALL_SOURCE_LABELS[row.source] })),
		},
		push: {
			reachable,
			total,
			share: share(reachable, total),
			devices: Math.round(reachable * 1.6),
			categories: categories
				.map((category, i) => ({
					id: category.id,
					label: category.label,
					on: category.defaultOn ? reachable - (i % 3) : Math.max(0, Math.round(reachable / 3) - (i % 2)),
				}))
				.sort((a, b) => b.on - a.on || a.label.localeCompare(b.label)),
		},
	};
}
