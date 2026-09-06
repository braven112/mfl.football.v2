/**
 * Guards the PWA-vs-browser visit split.
 *
 * Three rules, each a bug this file exists to stop:
 *
 * 1. THE ALLOWLISTS ARE THE CARDINALITY CAP. The surface counters are Redis
 *    hashes whose fields come from a PUBLIC, unauthenticated beacon (logged-out
 *    visits are counted too). If an unrecognized surface or platform were
 *    stored rather than rejected, any caller could grow those hashes without
 *    bound, one arbitrary field at a time.
 *
 * 2. HALF A CONTEXT IS NO CONTEXT. A surface with no platform produces a field
 *    the summary math cannot split back apart, so the pair must validate
 *    together and the visit must degrade to page-only tracking.
 *
 * 3. A HASH FROM ANOTHER DEPLOY MUST NOT BLANK THE PAGE. Unknown fields and
 *    junk counts are dropped, never thrown on — the report renders whatever it
 *    can understand.
 */

import { describe, it, expect } from 'vitest';
import {
	VISIT_SURFACES,
	VISIT_PLATFORMS,
	parseVisitSurface,
	parseVisitPlatform,
	parseVisitContext,
	surfaceField,
	parseSurfaceField,
	summarizeSurfaces,
	subtractSurfaces,
	describeSurface,
	describePlatform,
	EMPTY_SURFACE_BREAKDOWN,
} from '../src/utils/visit-surface';

describe('surface + platform allowlists', () => {
	it('accepts exactly the two surfaces and four platforms', () => {
		expect([...VISIT_SURFACES]).toEqual(['pwa', 'browser']);
		expect([...VISIT_PLATFORMS]).toEqual(['ios', 'android', 'desktop', 'other']);
	});

	it('rejects anything outside them', () => {
		for (const junk of ['', 'PWA', 'standalone', 'twa', '__proto__', 'pwa:ios', null, undefined]) {
			expect(parseVisitSurface(junk as string)).toBeNull();
		}
		for (const junk of ['', 'iOS', 'ipados', 'windows', 'linux', null, undefined]) {
			expect(parseVisitPlatform(junk as string)).toBeNull();
		}
	});

	it('requires BOTH halves — a surface without a platform is not a visit', () => {
		expect(parseVisitContext('pwa', 'ios')).toEqual({ surface: 'pwa', platform: 'ios' });
		expect(parseVisitContext('pwa', null)).toBeNull();
		expect(parseVisitContext(null, 'ios')).toBeNull();
		expect(parseVisitContext('pwa', 'windows')).toBeNull();
	});
});

describe('field encoding', () => {
	it('round-trips every legal pair, and only those', () => {
		for (const surface of VISIT_SURFACES) {
			for (const platform of VISIT_PLATFORMS) {
				const field = surfaceField({ surface, platform });
				expect(field).toBe(`${surface}:${platform}`);
				expect(parseSurfaceField(field)).toEqual({ surface, platform });
			}
		}
		// 2 surfaces × 4 platforms — the whole space a hash can ever hold.
		expect(VISIT_SURFACES.length * VISIT_PLATFORMS.length).toBe(8);
	});

	it('refuses fields that are not a legal pair', () => {
		for (const junk of ['pwa', 'pwa:', ':ios', 'pwa:ios:extra', 'twa:ios', 'pwa:windows']) {
			expect(parseSurfaceField(junk)).toBeNull();
		}
	});
});

describe('summarizeSurfaces', () => {
	it('is empty for no data', () => {
		expect(summarizeSurfaces(null)).toEqual(EMPTY_SURFACE_BREAKDOWN);
		expect(summarizeSurfaces({})).toEqual(EMPTY_SURFACE_BREAKDOWN);
		expect(summarizeSurfaces({ 'pwa:ios': 0 })).toEqual(EMPTY_SURFACE_BREAKDOWN);
	});

	it('totals both surfaces and reports the app share', () => {
		const s = summarizeSurfaces({ 'pwa:ios': '30', 'browser:ios': '10', 'browser:desktop': '10' });
		expect(s.pwa).toBe(30);
		expect(s.browser).toBe(20);
		expect(s.total).toBe(50);
		expect(s.pwaShare).toBe(60);
		expect(s.primary).toBe('pwa');
	});

	it('groups platforms busiest-first and omits ones with no visits', () => {
		const s = summarizeSurfaces({ 'pwa:ios': 5, 'browser:desktop': 20, 'pwa:android': 8 });
		expect(s.platforms.map((p) => p.platform)).toEqual(['desktop', 'android', 'ios']);
		expect(s.platforms.find((p) => p.platform === 'desktop')).toMatchObject({
			pwa: 0,
			browser: 20,
			total: 20,
		});
	});

	it('drops fields and counts it cannot understand instead of throwing', () => {
		const s = summarizeSurfaces({
			'pwa:ios': '4',
			'twa:ios': '999',
			garbage: '999',
			'browser:ios': 'not-a-number',
			'browser:desktop': '-5',
		});
		expect(s.total).toBe(4);
		expect(s.pwa).toBe(4);
		expect(s.browser).toBe(0);
	});
});

describe('subtractSurfaces', () => {
	it('derives signed-in traffic from the whole and the anonymous subset', () => {
		const all = summarizeSurfaces({ 'pwa:ios': 80, 'browser:desktop': 120 });
		const anon = summarizeSurfaces({ 'browser:desktop': 100 });
		expect(subtractSurfaces(all, anon)).toEqual({
			total: 100,
			pwa: 80,
			browser: 20,
			pwaShare: 80,
		});
	});

	it('clamps at zero — the two hashes are written by separate requests', () => {
		const all = summarizeSurfaces({ 'pwa:ios': 1 });
		const anon = summarizeSurfaces({ 'pwa:ios': 5, 'browser:ios': 5 });
		expect(subtractSurfaces(all, anon)).toEqual({ total: 0, pwa: 0, browser: 0, pwaShare: 0 });
	});
});

describe('labels', () => {
	it('names every surface and platform', () => {
		expect(describeSurface('pwa')).toBe('App');
		expect(describeSurface('browser')).toBe('Browser');
		for (const platform of VISIT_PLATFORMS) {
			expect(describePlatform(platform)).toBeTruthy();
		}
	});
});
