/**
 * Guards the visit beacon against Astro's origin check.
 *
 * THE BUG: the layout sent `navigator.sendBeacon('/api/track-visit?…')` with
 * no body, so the request had no Content-Type. Astro's built-in origin check
 * (security.checkOrigin, on by default) forbids any non-GET request with NO
 * content-type unless `Origin` equals the URL's origin exactly — so every
 * browser that omits or nulls Origin got a 403 before the endpoint ran, and
 * that owner's visits were never recorded. In Sep 2026 about one beacon in
 * five was rejected in production, and five AFL owners who used the site
 * (one had just debugged a lineup submit with the commissioner) read as
 * "never visited" on /activity.
 *
 * The rest of the site never hit this because every other POST sends JSON,
 * which the check exempts. So the rule is: a beacon carries a JSON-typed body.
 *
 * Two halves:
 * 1. SCAN — every `navigator.sendBeacon(` call under src/ passes a body typed
 *    `application/json`. (`text/plain`, the default for a string body, is
 *    form-like and is checked, so a bare string body is NOT a fix.)
 * 2. BEHAVIOUR — Astro's real check, imported from the installed package, still
 *    forbids the body-less shape and still allows the JSON one. If an Astro
 *    upgrade changes either answer, this fails and the scan's premise must be
 *    re-derived rather than trusted.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
// Not in astro's package exports, so it is imported by file path. If an
// upgrade moves it, find the new home of `isForbiddenCrossOriginRequest`.
import { isForbiddenCrossOriginRequest } from '../node_modules/astro/dist/core/app/origin-check.js';

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(REPO_ROOT, 'src');

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walk(full));
		else if (/\.(astro|ts|tsx|js|mjs)$/.test(entry)) out.push(full);
	}
	return out;
}

/** The full argument text of each `navigator.sendBeacon(...)` call, paren-balanced. */
function beaconCalls(source: string): string[] {
	const calls: string[] = [];
	const needle = 'navigator.sendBeacon(';
	let from = 0;
	for (;;) {
		const start = source.indexOf(needle, from);
		if (start === -1) return calls;
		let depth = 1;
		let i = start + needle.length;
		for (; i < source.length && depth > 0; i++) {
			if (source[i] === '(') depth++;
			else if (source[i] === ')') depth--;
		}
		calls.push(source.slice(start + needle.length, i - 1));
		from = i;
	}
}

describe('visit beacon — every sendBeacon call carries a JSON-typed body', () => {
	const calls = walk(SRC).flatMap((file) =>
		beaconCalls(readFileSync(file, 'utf8')).map((args) => ({
			file: path.relative(REPO_ROOT, file),
			args,
		})),
	);

	it('finds the track-visit beacon (the scan is not vacuous)', () => {
		expect(calls.some((c) => c.file === 'src/layouts/TheLeagueLayout.astro' && c.args.includes('/api/track-visit'))).toBe(true);
	});

	it('no beacon is sent body-less or with a form-like type', () => {
		const offenders = calls
			.filter((c) => !/type:\s*['"]application\/json['"]/.test(c.args))
			.map((c) => `${c.file}: navigator.sendBeacon(${c.args.replace(/\s+/g, ' ').trim()})`);
		expect(
			offenders,
			`Astro 403s a POST with no content-type (or a form-like one) unless Origin matches exactly, silently dropping it. Pass new Blob([json], { type: 'application/json' }):\n  ${offenders.join('\n  ')}`,
		).toEqual([]);
	});
});

describe("visit beacon — Astro's origin check still draws the line the scan assumes", () => {
	const url = new URL('https://www.afl-fantasy.com/api/track-visit?page=/lineup');
	const post = (headers: Record<string, string>) =>
		new Request(url, { method: 'POST', headers });

	it('forbids a body-less POST whose Origin is missing or null (the old beacon)', () => {
		expect(isForbiddenCrossOriginRequest(post({}), url, false)).toBe(true);
		expect(isForbiddenCrossOriginRequest(post({ origin: 'null' }), url, false)).toBe(true);
	});

	it('forbids a text/plain POST in the same case (a string body is not a fix)', () => {
		expect(isForbiddenCrossOriginRequest(post({ 'content-type': 'text/plain;charset=UTF-8' }), url, false)).toBe(true);
	});

	it('allows a JSON-typed POST whatever Origin says (the beacon as sent now)', () => {
		expect(isForbiddenCrossOriginRequest(post({ 'content-type': 'application/json' }), url, false)).toBe(false);
		expect(isForbiddenCrossOriginRequest(post({ 'content-type': 'application/json', origin: 'null' }), url, false)).toBe(false);
	});
});
