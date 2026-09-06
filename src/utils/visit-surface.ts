/**
 * Visit surface — installed PWA vs ordinary browser tab, plus a coarse platform.
 *
 * The distinction is only knowable in the CLIENT: an installed app and a
 * browser tab send byte-identical requests (same origin, same cookies, same
 * user agent), so nothing server-side can tell them apart. The layout's
 * tracker beacon measures `display-mode: standalone` / `navigator.standalone`
 * at page-load time and reports it; this module is the shared vocabulary for
 * that report — the allowlists the API validates against, the Redis field
 * shape, and the summary math the Owner Activity report renders.
 *
 * WHY THE ALLOWLISTS ARE STRICT. The counters live in Redis HASHES whose
 * fields come from a public, unauthenticated beacon (logged-out visitors are
 * counted too). Anything not in these two lists is rejected rather than
 * stored, which caps the hash at 2 × 4 = 8 possible fields forever. Without
 * that cap, an unauthenticated caller could grow the hash without bound one
 * arbitrary field at a time.
 */

/** Installed-app launch vs a regular browser tab. */
export const VISIT_SURFACES = ['pwa', 'browser'] as const;
export type VisitSurface = (typeof VISIT_SURFACES)[number];

/**
 * Coarse platform bucket. Deliberately four values, not a UA parse: the
 * question this answers is "are the installs on iOS or Android", and every
 * extra bucket is another field in a hash that must stay small.
 */
export const VISIT_PLATFORMS = ['ios', 'android', 'desktop', 'other'] as const;
export type VisitPlatform = (typeof VISIT_PLATFORMS)[number];

export interface VisitContext {
	surface: VisitSurface;
	platform: VisitPlatform;
}

/** Parse a client-supplied surface, returning null for anything unrecognized. */
export function parseVisitSurface(raw: string | null | undefined): VisitSurface | null {
	return (VISIT_SURFACES as readonly string[]).includes(raw ?? '') ? (raw as VisitSurface) : null;
}

/** Parse a client-supplied platform, returning null for anything unrecognized. */
export function parseVisitPlatform(raw: string | null | undefined): VisitPlatform | null {
	return (VISIT_PLATFORMS as readonly string[]).includes(raw ?? '')
		? (raw as VisitPlatform)
		: null;
}

/**
 * Both halves or nothing. A visit with a surface but no platform would land in
 * a field shape the summary math cannot split back apart, so the pair is
 * validated together and the whole visit degrades to page-only tracking.
 */
export function parseVisitContext(
	surface: string | null | undefined,
	platform: string | null | undefined,
): VisitContext | null {
	const s = parseVisitSurface(surface);
	const p = parseVisitPlatform(platform);
	return s && p ? { surface: s, platform: p } : null;
}

/** Redis hash field for a visit, e.g. `pwa:ios`. */
export function surfaceField(ctx: VisitContext): string {
	return `${ctx.surface}:${ctx.platform}`;
}

/**
 * Inverse of `surfaceField`; null for a field that is not a valid pair.
 * The segment count is checked as well as the halves — destructuring alone
 * would accept `pwa:ios:anything` by ignoring the tail.
 */
export function parseSurfaceField(field: string): VisitContext | null {
	const parts = field.split(':');
	if (parts.length !== 2) return null;
	return parseVisitContext(parts[0], parts[1]);
}

export interface SurfacePlatformRow {
	platform: VisitPlatform;
	label: string;
	pwa: number;
	browser: number;
	total: number;
}

export interface SurfaceBreakdown {
	total: number;
	pwa: number;
	browser: number;
	/** PWA share of total visits, 0-100, rounded. 0 when nothing is recorded. */
	pwaShare: number;
	/** Per-platform rows, busiest first, platforms with no visits omitted. */
	platforms: SurfacePlatformRow[];
	/** Whichever surface has more visits, or null when there are none. */
	primary: VisitSurface | null;
}

const PLATFORM_LABELS: Record<VisitPlatform, string> = {
	ios: 'iPhone / iPad',
	android: 'Android',
	desktop: 'Desktop',
	other: 'Other',
};

/** Display label for a platform bucket. */
export function describePlatform(platform: VisitPlatform): string {
	return PLATFORM_LABELS[platform];
}

/** Display label for a surface. */
export function describeSurface(surface: VisitSurface): string {
	return surface === 'pwa' ? 'App' : 'Browser';
}

export const EMPTY_SURFACE_BREAKDOWN: SurfaceBreakdown = {
	total: 0,
	pwa: 0,
	browser: 0,
	pwaShare: 0,
	platforms: [],
	primary: null,
};

/**
 * Fold a raw Redis hash (`{ 'pwa:ios': '12', … }`) into the shape the report
 * renders. Unknown fields and unparseable counts are dropped rather than
 * thrown on — a hash written by an older or newer deploy must never blank the
 * page it feeds.
 */
export function summarizeSurfaces(
	raw: Record<string, string | number> | null | undefined,
): SurfaceBreakdown {
	if (!raw) return EMPTY_SURFACE_BREAKDOWN;

	const byPlatform = new Map<VisitPlatform, { pwa: number; browser: number }>();
	let pwa = 0;
	let browser = 0;

	for (const [field, value] of Object.entries(raw)) {
		const ctx = parseSurfaceField(field);
		if (!ctx) continue;
		const count = Number(value);
		if (!Number.isFinite(count) || count <= 0) continue;

		const row = byPlatform.get(ctx.platform) ?? { pwa: 0, browser: 0 };
		row[ctx.surface] += count;
		byPlatform.set(ctx.platform, row);
		if (ctx.surface === 'pwa') pwa += count;
		else browser += count;
	}

	const total = pwa + browser;
	if (total === 0) return EMPTY_SURFACE_BREAKDOWN;

	const platforms: SurfacePlatformRow[] = [...byPlatform.entries()]
		.map(([platform, row]) => ({
			platform,
			label: describePlatform(platform),
			pwa: row.pwa,
			browser: row.browser,
			total: row.pwa + row.browser,
		}))
		.sort((a, b) => b.total - a.total);

	return {
		total,
		pwa,
		browser,
		pwaShare: Math.round((pwa / total) * 100),
		platforms,
		primary: pwa >= browser ? 'pwa' : 'browser',
	};
}

/**
 * Subtract one breakdown from another — used to derive signed-in traffic from
 * the league-wide total and the logged-out subset, which is cheaper to record
 * than a third counter. Clamped at zero: the two hashes are written by
 * separate requests, so a race can briefly make the subset look larger.
 */
export function subtractSurfaces(
	whole: SurfaceBreakdown,
	part: SurfaceBreakdown,
): { total: number; pwa: number; browser: number; pwaShare: number } {
	const pwa = Math.max(0, whole.pwa - part.pwa);
	const browser = Math.max(0, whole.browser - part.browser);
	const total = pwa + browser;
	return { total, pwa, browser, pwaShare: total === 0 ? 0 : Math.round((pwa / total) * 100) };
}
