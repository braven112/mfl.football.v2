/**
 * Native binaries built for musl Linux, which must NOT be copied into the
 * serverless function.
 *
 * napi-rs packages (`@resvg/resvg-js`, `@neplex/vectorizer`) and sharp pick
 * their binary at runtime with an `isMusl()` check, then `require` either the
 * glibc or the musl build. Vercel's file tracer follows both requires, so the
 * function carried a second copy of every native module. Vercel's runtime is
 * Amazon Linux (glibc), so the musl copy is never loaded.
 *
 * Adding the logo tracer's vectorizer (14 MB per libc) took the function to
 * 250.69 MB against Vercel's 250 MB limit (2026-10-29); dropping the musl
 * copies frees roughly 35 MB.
 *
 * Exact paths, not globs: the adapter compares each traced file against this
 * list verbatim. Derived from what is installed, so a new native dependency is
 * covered with no edit here. `tests/musl-binary-files.test.ts` pins it.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** A pnpm store entry for a musl-only build, e.g. `@resvg+resvg-js-linux-x64-musl@2.6.2`. */
export function isMuslPackageDir(name) {
	return /-linux(?:-x64|-arm64)?-?musl/.test(name) || /linuxmusl/.test(name);
}

function walkFiles(dir, out) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) walkFiles(p, out);
		else out.push(p);
	}
}

/** Every file under a musl-only pnpm store entry, relative to `root`. */
export function muslBinaryFiles(opts = {}) {
	const { root = '' } = opts;
	const store = join(root, 'node_modules', '.pnpm');
	let entries;
	try {
		entries = readdirSync(store);
	} catch {
		return []; // no pnpm store (a non-pnpm checkout): nothing to drop
	}
	const out = [];
	for (const name of entries) {
		if (isMuslPackageDir(name)) walkFiles(join(store, name), out);
	}
	return out;
}
