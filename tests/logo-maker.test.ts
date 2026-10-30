import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LOGO_MAKER_EXAMPLES } from '../src/data/logo-maker-examples';
import {
	buildTeamLogoPrompt,
	LOGO_COLORS,
	LOGO_KINDS,
	LOGO_MAX_COLORS,
	LOGO_MIN_CONTRAST,
	LOGO_STYLES,
} from '../src/utils/team-logo-prompt';
import { contrastRatio } from '../src/utils/team-color-contrast';
import { findLogoReference } from '../src/utils/team-logo-references';
import { canonicalUrl } from '../src/utils/structured-data';
import { renderSitemap, sharedHostSitemapEntries } from '../src/utils/sitemap';

/**
 * The free logo maker (/fantasy-football-logo-maker). Its examples claim to
 * be real runs of the tool, so each must be a choice the tool accepts as-is:
 * a known style and kind, colors from the grid that clear the tool's own
 * contrast bar, and a name that names no real player or club. And the page
 * exists to be found, so it must stay in the sitemap and llms.txt.
 */
const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const PATH = '/fantasy-football-logo-maker';

describe('logo maker examples', () => {
	it('each example is a choice the builder takes unchanged', () => {
		const gridHexes = new Set(LOGO_COLORS.map((c) => c.hex));
		for (const ex of LOGO_MAKER_EXAMPLES) {
			expect(LOGO_STYLES.map((s) => s.id), ex.teamName).toContain(ex.style);
			expect(LOGO_KINDS.map((k) => k.id), ex.teamName).toContain(ex.kind);
			expect(ex.colors.length, ex.teamName).toBeLessThanOrEqual(LOGO_MAX_COLORS);
			for (const hex of ex.colors) expect(gridHexes.has(hex), `${ex.teamName} ${hex}`).toBe(true);
			const built = buildTeamLogoPrompt(ex, '');
			expect(built.choice, ex.teamName).toEqual({ teamName: ex.teamName, idea: ex.idea, style: ex.style, colors: ex.colors, kind: ex.kind });
		}
	});

	it('example colors stay distinct at small sizes', () => {
		for (const ex of LOGO_MAKER_EXAMPLES) {
			if (ex.colors.length < 2) continue;
			expect(contrastRatio(ex.colors[0], ex.colors[1]), ex.teamName).toBeGreaterThanOrEqual(LOGO_MIN_CONTRAST);
		}
	});

	it('no example names a real player or club', () => {
		for (const ex of LOGO_MAKER_EXAMPLES) expect(findLogoReference(ex.teamName, ex.idea), ex.teamName).toBeUndefined();
	});

	it('every example image exists and describes itself', () => {
		for (const ex of LOGO_MAKER_EXAMPLES) {
			expect(existsSync(path.join(root, 'public', ex.image)), ex.image).toBe(true);
			expect(ex.alt.length, ex.teamName).toBeGreaterThan(20);
		}
	});
});

describe('logo maker search surface', () => {
	it('has a route that renders the shared builder', () => {
		const page = read(`src/pages${PATH}.astro`);
		expect(page).toContain('TeamLogoBuilder');
		expect(read('src/pages/live/team-logo.astro')).toContain('TeamLogoBuilder');
	});

	it('is in the sitemap and llms.txt', () => {
		expect(renderSitemap(sharedHostSitemapEntries())).toContain(`<loc>${canonicalUrl(PATH)}</loc>`);
		expect(read('public/llms.txt')).toContain(canonicalUrl(PATH));
	});

	it('its social card exists', () => {
		expect(read(`src/pages${PATH}.astro`)).toContain('ogImage="/assets/logo-maker/examples.png"');
		expect(existsSync(path.join(root, 'public/assets/logo-maker/examples.png'))).toBe(true);
	});
});
