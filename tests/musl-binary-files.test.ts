import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMuslPackageDir, muslBinaryFiles } from '../scripts/lib/musl-binary-files.mjs';

/**
 * The serverless function sits near Vercel's 250 MB limit, and the file
 * tracer copies BOTH libc builds of every native module. The musl copies are
 * dead weight on Vercel's glibc runtime, so the function excludes them. This
 * pins that the exclusion is wired, catches musl dirs, and never a glibc one.
 */
const root = path.resolve(__dirname, '..');

describe('musl binary exclusion', () => {
	it('matches musl store entries and never a glibc one', () => {
		for (const name of [
			'@resvg+resvg-js-linux-x64-musl@2.6.2',
			'@neplex+vectorizer-linux-x64-musl@0.1.0',
			'@img+sharp-libvips-linuxmusl-x64@1.2.3',
			'@img+sharp-linuxmusl-x64@0.34.4',
			'lightningcss-linux-arm64-musl@1.32.0',
		]) expect(isMuslPackageDir(name), name).toBe(true);
		for (const name of [
			'@resvg+resvg-js-linux-x64-gnu@2.6.2',
			'@neplex+vectorizer-linux-x64-gnu@0.1.0',
			'@img+sharp-libvips-linux-x64@1.2.3',
			'@img+sharp-linux-x64@0.34.4',
			'@resvg+resvg-js@2.6.2',
		]) expect(isMuslPackageDir(name), name).toBe(false);
	});

	it('lists only files inside musl store entries', () => {
		const files = muslBinaryFiles({ root });
		for (const f of files) {
			const entry = path.relative(path.join(root, 'node_modules/.pnpm'), f).split(path.sep)[0];
			expect(isMuslPackageDir(entry), f).toBe(true);
		}
	});

	it('is passed to the Vercel adapter', () => {
		expect(readFileSync(path.join(root, 'astro.config.ts'), 'utf8')).toMatch(/excludeFiles:\s*\[[^\]]*muslBinaryFiles\(\)/);
	});
});
