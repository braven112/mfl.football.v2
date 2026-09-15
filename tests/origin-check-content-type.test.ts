/**
 * Guards browser requests against Astro's origin check.
 *
 * THE BUG: the layout sent `navigator.sendBeacon('/api/track-visit?…')` with
 * no body, so the request had no Content-Type. Astro's built-in origin check
 * (security.checkOrigin, on by default) forbids any non-GET request with NO
 * content-type — or a form-like one — unless `Origin` equals the URL's origin
 * exactly. Every browser that omits or nulls Origin got a 403 before the
 * endpoint ran. In Sep 2026 about one visit beacon in five was rejected in
 * production, and five AFL owners who used the site read as "never visited"
 * on /activity. Fourteen more body-less `fetch` POST/DELETE calls (logout, tip
 * retraction, keeper reset, Board deletes, trade-draft delete, contract
 * reconcile, …) had the same exposure and were fixed alongside it.
 *
 * The rule: a same-origin non-GET request from the browser carries
 * `Content-Type: application/json`. JSON is the only exempt shape —
 * `text/plain` (a string body's default) and form bodies are checked too.
 *
 * Two halves:
 * 1. SCAN — every `navigator.sendBeacon(` and every non-GET `fetch(` under
 *    src/ names `application/json`, minus a short, reasoned allowlist.
 * 2. BEHAVIOUR — Astro's real check, imported from the installed package, still
 *    forbids the body-less and text/plain shapes and still allows JSON. If an
 *    Astro upgrade changes either answer, this fails and the scan's premise
 *    must be re-derived rather than trusted.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, walkFiles } from './helpers/scan-guard';
// Not in astro's package exports, so it is imported by file path. If an
// upgrade moves it, find the new home of `isForbiddenCrossOriginRequest`.
import { isForbiddenCrossOriginRequest } from '../node_modules/astro/dist/core/app/origin-check.js';

/**
 * Calls that legitimately do not send JSON. Keyed by file; `count` pins how
 * many such calls the file may hold, so a NEW offender in an allowlisted file
 * still fails.
 */
const ALLOWLIST: { file: string; count: number; reason: string }[] = [
	{
		file: 'src/utils/mfl-login.ts',
		count: 2,
		reason: 'server-to-MFL requests; Astro only checks requests it RECEIVES',
	},
	{
		file: 'src/components/theleague/suggestions/ImageUploader.tsx',
		count: 1,
		reason:
			'multipart image upload cannot be JSON; still exposed to the check in browsers that drop Origin — moving it off FormData is a separate change',
	},
];

/** The argument text of each `<needle>...)` call, paren-balanced. Not syntax-aware: a paren inside a string literal would miscount. */
function calls(source: string, needle: string): { args: string; line: number }[] {
	const out: { args: string; line: number }[] = [];
	let from = 0;
	for (;;) {
		const start = source.indexOf(needle, from);
		if (start === -1) return out;
		let depth = 1;
		let i = start + needle.length;
		for (; i < source.length && depth > 0; i++) {
			if (source[i] === '(') depth++;
			else if (source[i] === ')') depth--;
		}
		out.push({
			args: source.slice(start + needle.length, i - 1),
			line: source.slice(0, start).split('\n').length,
		});
		from = i;
	}
}

const JSON_TYPE = /application\/json/;
const NON_GET = /method:\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i;

// API routes are the RECEIVERS, and their fetches go to other hosts.
const files = walkFiles({ roots: ['src'], extensions: ['.astro', '.ts', '.tsx', '.js', '.mjs'] }).filter(
	(f) => !f.startsWith('src/pages/api/'),
);
const sources = files.map((file) => ({ file, src: readFileSync(path.join(REPO_ROOT, file), 'utf8') }));

const beacons = sources.flatMap(({ file, src }) =>
	calls(src, 'navigator.sendBeacon(').map((c) => ({ file, ...c })),
);
const writes = sources.flatMap(({ file, src }) =>
	calls(src, 'fetch(')
		.filter((c) => NON_GET.test(c.args))
		.map((c) => ({ file, ...c })),
);

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 160);

describe('origin check — browser requests carry a JSON content type', () => {
	it('finds the visit beacon (the scan is not vacuous)', () => {
		expect(beacons.some((c) => c.file === 'src/layouts/TheLeagueLayout.astro' && c.args.includes('/api/track-visit'))).toBe(true);
	});

	it('every sendBeacon call sends a JSON-typed body', () => {
		const offenders = beacons
			.filter((c) => !JSON_TYPE.test(c.args))
			.map((c) => `${c.file}:${c.line}  navigator.sendBeacon(${oneLine(c.args)})`);
		expect(
			offenders,
			`Astro 403s a POST with no content type (or a form-like one) unless Origin matches exactly. Pass new Blob([json], { type: 'application/json' }):\n  ${offenders.join('\n  ')}`,
		).toEqual([]);
	});

	it('every non-GET fetch sends Content-Type: application/json, or is allowlisted with a reason', () => {
		const offenders: string[] = [];
		for (const file of new Set(writes.map((w) => w.file))) {
			const bad = writes.filter((w) => w.file === file && !JSON_TYPE.test(w.args));
			const allowed = ALLOWLIST.find((a) => a.file === file)?.count ?? 0;
			if (bad.length > allowed) {
				offenders.push(...bad.map((w) => `${w.file}:${w.line}  fetch(${oneLine(w.args)})`));
			}
		}
		expect(
			offenders,
			`Astro 403s a non-GET request with no content type (or a form-like one) unless Origin matches exactly, and some browsers omit it. Add headers: { 'Content-Type': 'application/json' }:\n  ${offenders.join('\n  ')}`,
		).toEqual([]);
	});

	it('the allowlist has no stale entries', () => {
		const stale = ALLOWLIST.filter(
			(a) => writes.filter((w) => w.file === a.file && !JSON_TYPE.test(w.args)).length < a.count,
		).map((a) => `${a.file} (allows ${a.count}) — "${a.reason}"`);
		expect(stale, `retighten these allowlist counts:\n  ${stale.join('\n  ')}`).toEqual([]);
	});
});

describe("origin check — Astro's check still draws the line the scan assumes", () => {
	const url = new URL('https://www.afl-fantasy.com/api/track-visit?page=/lineup');
	const post = (headers: Record<string, string>) => new Request(url, { method: 'POST', headers });

	it('forbids a body-less POST whose Origin is missing or null (the old beacon)', () => {
		expect(isForbiddenCrossOriginRequest(post({}), url, false)).toBe(true);
		expect(isForbiddenCrossOriginRequest(post({ origin: 'null' }), url, false)).toBe(true);
	});

	it('forbids a text/plain POST in the same case (a string body is not a fix)', () => {
		expect(isForbiddenCrossOriginRequest(post({ 'content-type': 'text/plain;charset=UTF-8' }), url, false)).toBe(true);
	});

	it('allows a JSON-typed POST whatever Origin says (the shape every call sends now)', () => {
		expect(isForbiddenCrossOriginRequest(post({ 'content-type': 'application/json' }), url, false)).toBe(false);
		expect(isForbiddenCrossOriginRequest(post({ 'content-type': 'application/json', origin: 'null' }), url, false)).toBe(false);
	});
});
