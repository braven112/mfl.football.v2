/**
 * Season video — the limits on its public endpoints and on the ESPN save into
 * League History's Redis store. The point these pin: a caller who forges
 * `cf-connecting-ip` (no Cloudflare fronts the site, so anyone can send it)
 * is still counted by the address our platform appends, and the save is
 * bounded per league, per caller, site-wide and by size.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const counts = new Map<string, number>();
vi.mock('../src/utils/rate-limit', () => ({
	checkRateLimit: async (scope: string, id: string, max: number) => {
		const key = `${scope}:${id}`;
		const n = (counts.get(key) ?? 0) + 1;
		counts.set(key, n);
		return { allowed: n <= max, count: n };
	},
}));

const {
	allowEspnSave,
	allowSeasonVideoCall,
	ESPN_SAVES_PER_DAY,
	ESPN_SAVES_PER_LEAGUE_PER_DAY,
	MAX_ESPN_SAVE_CHARS,
	SEASON_VIDEO_LIMITS,
} = await import('../src/utils/season-video/abuse-limits');

const req = (forged: string, hop = '198.51.100.7') =>
	new Request('https://mfl.football/api/x', { headers: { 'cf-connecting-ip': forged, 'x-forwarded-for': `${forged}, ${hop}` } });

beforeEach(() => counts.clear());

describe('season video call limits', () => {
	it('still stops a caller who forges a new address on every request', async () => {
		const { perHop } = SEASON_VIDEO_LIMITS['season-video-espn'];
		let allowed = 0;
		for (let i = 0; i < perHop + 20; i++) if (await allowSeasonVideoCall(req(`10.0.${i >> 8}.${i & 255}`), 'season-video-espn')) allowed++;
		expect(allowed).toBe(perHop);
	});

	it('limits one honest caller at the per-caller number', async () => {
		const { perClient } = SEASON_VIDEO_LIMITS['season-video-sleeper'];
		let allowed = 0;
		for (let i = 0; i < perClient + 5; i++) if (await allowSeasonVideoCall(req('203.0.113.5', '203.0.113.5'), 'season-video-sleeper')) allowed++;
		expect(allowed).toBe(perClient);
	});
});

describe('ESPN save caps', () => {
	it('refuses a paste too big to be one season', async () => {
		expect(await allowEspnSave(req('1.1.1.1'), '123', MAX_ESPN_SAVE_CHARS + 1)).toBe(false);
		expect(await allowEspnSave(req('1.1.1.1'), '123', 200_000)).toBe(true);
	});

	it('keeps a few snapshots per league per day', async () => {
		let saved = 0;
		for (let i = 0; i < ESPN_SAVES_PER_LEAGUE_PER_DAY + 3; i++) if (await allowEspnSave(req('1.1.1.1', `198.51.100.${i}`), '123', 1000)) saved++;
		expect(saved).toBe(ESPN_SAVES_PER_LEAGUE_PER_DAY);
	});

	it('caps what one caller can add across made-up league ids, and what everyone can add in a day', async () => {
		let one = 0;
		for (let i = 0; i < 100; i++) if (await allowEspnSave(req(`10.0.0.${i}`), String(1000 + i), 1000)) one++;
		expect(one).toBeLessThan(100);
		counts.clear();
		let all = 0;
		for (let i = 0; i < ESPN_SAVES_PER_DAY + 50; i++) if (await allowEspnSave(req('1.1.1.1', `198.51.${i >> 8}.${i & 255}`), String(5000 + i), 1000)) all++;
		expect(all).toBe(ESPN_SAVES_PER_DAY);
	});
});

describe('wiring', () => {
	it.each(['season-video-sleeper', 'season-video-espn', 'season-video-logo'])('/api/%s goes through allowSeasonVideoCall', (name) => {
		const src = readFileSync(`src/pages/api/${name}.ts`, 'utf8');
		expect(src).toContain(`allowSeasonVideoCall(request, '${name}')`);
		expect(src).not.toMatch(/getClientIdentity\(request\)\.client/);
	});

	it('every ESPN save passes the caps first', () => {
		const src = readFileSync('src/pages/api/season-video-espn.ts', 'utf8');
		expect(src).toMatch(/allowEspnSave\(request, leagueId, text\.length\)\)\) return;\s*await storeEspnUpload/);
		expect(src.match(/storeEspnUpload\(/g)).toHaveLength(1);
	});
});
