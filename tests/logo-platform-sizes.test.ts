import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALL_LOGO_OUTPUTS, LOGO_PLATFORMS, SAFE_SQUARE } from '../src/data/logo-platform-sizes';
import { CREST_OUTPUTS, STORED_SIZES } from '../src/utils/brand-asset-specs';
import { bannerLayout, containRect, downscaleSteps, inkFor, inputWarnings, outputFileName } from '../src/utils/logo-resize';
import { buildZip, crc32 } from '../src/utils/zip-store';
import { renderSitemap, sharedHostSitemapEntries } from '../src/utils/sitemap';
import { canonicalUrl } from '../src/utils/structured-data';

/**
 * The free logo resizer (/fantasy-football-logo-resizer, and under both logo
 * maker prompts). The size list is data so a platform is a one-line add; this
 * pins its shape, and the math that turns one logo into every file.
 */
describe('logo platform sizes', () => {
	it.each(ALL_LOGO_OUTPUTS.map((o) => [o.id, o] as const))('%s has a size, a format and a source', (_id, o) => {
		expect(Number.isInteger(o.width) && o.width > 0).toBe(true);
		expect(Number.isInteger(o.height) && o.height > 0).toBe(true);
		expect(['png', 'jpg']).toContain(o.format);
		expect(['square', 'banner']).toContain(o.layout);
		expect(o.label.length).toBeGreaterThan(0);
		expect(o.source.length).toBeGreaterThan(0);
		// A file name a person can read, lowercase, with no extension.
		expect(o.file).toMatch(/^[a-z0-9-]+$/);
		if (o.layout === 'square') expect(o.width).toBe(o.height);
	});

	it('a published size cites a help page or our own spec file', () => {
		for (const o of ALL_LOGO_OUTPUTS.filter((x) => x.published)) {
			expect(o.source, o.id).toMatch(/^(https:\/\/|src\/utils\/brand-asset-specs\.ts$)/);
		}
	});

	it('ids and file names are unique, so the zip never overwrites a file', () => {
		const ids = ALL_LOGO_OUTPUTS.map((o) => o.id);
		const files = ALL_LOGO_OUTPUTS.map((o) => o.file);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(files).size).toBe(files.length);
	});

	it('every platform group has at least one output', () => {
		for (const p of LOGO_PLATFORMS) expect(p.outputs.length, p.id).toBeGreaterThan(0);
	});

	it('the MFL sizes are the ones the site stores', () => {
		const stored = STORED_SIZES.map(([, w, h]) => `${w}x${h}`);
		expect(stored).toContain(`${CREST_OUTPUTS.cardIcon}x${CREST_OUTPUTS.cardIcon}`);
		expect(stored).toContain(`${CREST_OUTPUTS.groupMe}x${CREST_OUTPUTS.groupMe}`);
		expect(stored).toContain(`${CREST_OUTPUTS.banner.width}x${CREST_OUTPUTS.banner.height}`);
		expect(stored).toContain(`${CREST_OUTPUTS.appIcon}x${CREST_OUTPUTS.appIcon}`);
		expect(stored).toContain('180x180');
		const mfl = LOGO_PLATFORMS.find((p) => p.id === 'mfl')!;
		expect(mfl.outputs.find((o) => o.id === 'mfl-icon')?.width).toBe(CREST_OUTPUTS.cardIcon);
		expect(mfl.outputs.find((o) => o.id === 'mfl-banner-2x')).toMatchObject({ width: 1900, height: 316 });
	});

	it('an unpublished size is the safe square or a stated print size', () => {
		for (const o of ALL_LOGO_OUTPUTS.filter((x) => !x.published)) {
			expect([SAFE_SQUARE, 3000], o.id).toContain(o.width);
		}
	});
});

describe('resize math', () => {
	it('contain-fit centers a square in a square with no offset', () => {
		expect(containRect(1024, 1024, 100, 100)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
	});

	it('contain-fit letterboxes a wide image and never stretches it', () => {
		const r = containRect(2000, 1000, 512, 512);
		expect(r).toEqual({ x: 0, y: 128, w: 512, h: 256 });
		expect(r.w / r.h).toBe(2);
	});

	it('contain-fit pillarboxes a tall image', () => {
		expect(containRect(600, 1200, 400, 400)).toEqual({ x: 100, y: 0, w: 200, h: 400 });
	});

	it('contain-fit respects an inset', () => {
		expect(containRect(1024, 1024, 950, 158, 16)).toEqual({ x: 412, y: 16, w: 126, h: 126 });
	});

	it('steps down by halves and lands exactly on the target', () => {
		expect(downscaleSteps(1024, 1024, 16, 16)).toEqual([[512, 512], [256, 256], [128, 128], [64, 64], [32, 32], [16, 16]]);
		expect(downscaleSteps(1024, 1024, 100, 100)).toEqual([[512, 512], [256, 256], [128, 128], [100, 100]]);
		expect(downscaleSteps(1024, 1024, 512, 512)).toEqual([[512, 512]]);
	});

	it('draws once when scaling up or by less than half', () => {
		expect(downscaleSteps(1024, 1024, 3000, 3000)).toEqual([[3000, 3000]]);
		expect(downscaleSteps(1024, 1024, 800, 800)).toEqual([[800, 800]]);
	});

	it('a banner with no name centers the logo', () => {
		const b = bannerLayout(1024, 1024, 950, 158, false);
		expect(b.text).toBeNull();
		expect(b.logo.x + b.logo.w / 2).toBe(475);
		expect(b.logo.h).toBeLessThan(158);
	});

	it('a banner with a name puts the logo left and the name beside it, inside the band', () => {
		const b = bannerLayout(1024, 1024, 1900, 316, true);
		expect(b.logo.x).toBeLessThan(100);
		expect(b.text).not.toBeNull();
		expect(b.text!.x).toBeGreaterThan(b.logo.x + b.logo.w);
		expect(b.text!.x + b.text!.maxWidth).toBeLessThanOrEqual(1900);
	});

	it('warns on small or non-square input, and not on a 1024 square', () => {
		expect(inputWarnings(1024, 1024)).toEqual([]);
		expect(inputWarnings(256, 256)).toHaveLength(1);
		expect(inputWarnings(1536, 1024)).toHaveLength(1);
		expect(inputWarnings(300, 200)).toHaveLength(2);
	});

	it('picks readable ink for a banner color', () => {
		expect(inkFor('#ffffff')).toBe('#000000');
		expect(inkFor('#0b1f3a')).toBe('#ffffff');
		expect(inkFor('#f3e9d2')).toBe('#000000');
	});

	it('names files with the right extension', () => {
		expect(outputFileName('mfl-icon-100', 'png')).toBe('mfl-icon-100.png');
		expect(outputFileName('x-profile-400', 'jpg')).toBe('x-profile-400.jpg');
	});
});

describe('zip writer', () => {
	it('computes the standard CRC-32', () => {
		expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
	});

	it('writes a zip that unzip can list and test', () => {
		const files = [
			{ name: 'favicon-16.png', data: new Uint8Array([1, 2, 3]) },
			{ name: 'sleeper-avatar-512.png', data: new TextEncoder().encode('hello logo') },
		];
		const dir = mkdtempSync(join(tmpdir(), 'zip-'));
		const path = join(dir, 'logos.zip');
		writeFileSync(path, buildZip(files));
		let listing: string;
		try {
			listing = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
		} catch (e) {
			// No unzip on this machine: fall back to python's zipfile.
			listing = execFileSync('python3', ['-c', `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print("\\n".join(z.namelist())); print("No errors")`, path], { encoding: 'utf8' });
		}
		expect(listing).toContain('favicon-16.png');
		expect(listing).toContain('sleeper-avatar-512.png');
		expect(listing).toMatch(/No errors/);
	});
});

describe('resizer page', () => {
	const PATH = '/fantasy-football-logo-resizer';
	const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

	it('is in the sitemap and llms.txt', () => {
		expect(renderSitemap(sharedHostSitemapEntries())).toContain(`<loc>${canonicalUrl(PATH)}</loc>`);
		expect(read('public/llms.txt')).toContain(canonicalUrl(PATH));
	});

	it('never sends the logo anywhere: no fetch, no API route, no beacon', () => {
		// The page promises "your logo never leaves your device".
		for (const file of ['src/components/shared/LogoResizer.astro', 'src/utils/logo-resize.ts', 'src/utils/zip-store.ts']) {
			const src = read(file);
			expect(src, file).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|\/api\//);
		}
	});
});
