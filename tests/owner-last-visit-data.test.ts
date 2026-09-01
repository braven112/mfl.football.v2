import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { extractLastVisits, assertNoContactInfo } from '../scripts/sync-owner-last-visit.mjs';
import { ALL_LEAGUES } from '../src/config/leagues';

/**
 * `data/<league>/owner-last-visit.json` is written from a COMMISSIONER-
 * authenticated MFL response, and that response also carries email addresses,
 * phone numbers, street addresses and real names. The writer whitelists
 * `id` + `lastVisit`; this file is the backstop that stops anything else from
 * landing in git history, plus the shape checks the Owner Activity page relies
 * on.
 */

const ROOT = resolve(__dirname, '..');
const MIN_EPOCH_SECONDS = 946_684_800; // 2000-01-01
const MAX_EPOCH_SECONDS = 4_102_444_800; // 2100-01-01

const committedFiles = ALL_LEAGUES.map((league) => ({
	slug: league.slug,
	path: resolve(ROOT, league.dataPath, 'owner-last-visit.json'),
})).filter((f) => existsSync(f.path));

describe('extractLastVisits', () => {
	const wrap = (franchise: unknown) => ({ league: { franchises: { franchise } } });

	it('pulls id -> epoch seconds out of an authenticated response', () => {
		const got = extractLastVisits(
			wrap([
				{ id: '0001', lastVisit: '1787915211', name: 'Pigskins' },
				{ id: '0002', lastVisit: '1787000000', name: 'Bring The Pain' },
			]),
		);
		expect(got).toEqual({ '0001': 1787915211, '0002': 1787000000 });
	});

	// THE BUG THIS PREVENTS: the same response carries owner_name, email, phone,
	// address and zip. A delete-the-bad-keys approach would carry along any new
	// private field MFL adds later; the writer whitelists instead, and this
	// pins that it really does.
	it('carries NOTHING but id and lastVisit — no owner name, email, phone or address', () => {
		const got = extractLastVisits(
			wrap([
				{
					id: '0001',
					lastVisit: '1787915211',
					owner_name: 'A Real Person',
					email: 'someone@example.com',
					phone: '5555555555',
					address: '1 Main St',
					zip: '90210',
					username: 'someuser',
					cell: '5555555555',
				},
			]),
		);
		expect(got).toEqual({ '0001': 1787915211 });
		expect(JSON.stringify(got)).not.toMatch(/@|example|Person|Main St|someuser/i);
	});

	it('normalizes a single franchise returned as an object', () => {
		expect(extractLastVisits(wrap({ id: '0001', lastVisit: '1787915211' }))).toEqual({
			'0001': 1787915211,
		});
	});

	// An ANONYMOUS response has no lastVisit at all and otherwise parses fine.
	// Returning {} here is what lets the writer refuse to blank a good file.
	it('returns an empty map for an anonymous response', () => {
		expect(extractLastVisits(wrap([{ id: '0001', name: 'Pigskins' }]))).toEqual({});
	});

	it('drops values that are not plausible epoch seconds', () => {
		const got = extractLastVisits(
			wrap([
				{ id: '0001', lastVisit: '' },
				{ id: '0002', lastVisit: '0' },
				{ id: '0003', lastVisit: 'yesterday' },
				{ id: '0004', lastVisit: '1' },
				{ id: '0005', lastVisit: '99999999999999' },
			]),
		);
		expect(got).toEqual({});
	});

	it('survives empty and malformed payloads', () => {
		expect(extractLastVisits(null)).toEqual({});
		expect(extractLastVisits({})).toEqual({});
		expect(extractLastVisits(wrap([]))).toEqual({});
	});
});

describe('assertNoContactInfo', () => {
	it('accepts a clean payload', () => {
		expect(() =>
			assertNoContactInfo({ generatedAt: 'x', lastVisit: { '0001': 1787915211 } }),
		).not.toThrow();
	});

	it('throws when a value is not a number', () => {
		expect(() => assertNoContactInfo({ lastVisit: { '0001': 'someone@example.com' } })).toThrow(
			/not a number/i,
		);
	});

	it('throws when contact-shaped text reaches the payload', () => {
		expect(() =>
			assertNoContactInfo({ owner: 'someone@example.com', lastVisit: { '0001': 1787915211 } }),
		).toThrow(/contact/i);
	});

	it('does not trip on the source line, which legitimately names an endpoint', () => {
		expect(() =>
			assertNoContactInfo({
				source: 'MFL export?TYPE=league (commissioner session)',
				generatedAt: new Date().toISOString(),
				lastVisit: { '0001': 1787915211 },
			}),
		).not.toThrow();
	});
});

describe('committed owner-last-visit.json files', () => {
	it('every committed file is well-formed and carries no contact info', () => {
		// Absent until the sync workflow has run for a league — and a league this
		// account is not commissioner of never gets one. Both are fine.
		for (const file of committedFiles) {
			const raw = readFileSync(file.path, 'utf-8');
			expect(raw, `${file.slug}: contact-shaped text in committed file`).not.toMatch(
				/@[a-z0-9-]+\.[a-z]{2,}/i,
			);

			const data = JSON.parse(raw);
			expect(Object.keys(data).sort(), `${file.slug}: unexpected top-level keys`).toEqual(
				['generatedAt', 'lastVisit', 'leagueId', 'source', 'year'].sort(),
			);

			const entries = Object.entries(data.lastVisit as Record<string, unknown>);
			expect(entries.length, `${file.slug}: no franchises`).toBeGreaterThan(0);
			for (const [franchiseId, value] of entries) {
				expect(franchiseId, `${file.slug}: franchise id shape`).toMatch(/^\d{4}$/);
				expect(typeof value, `${file.slug}/${franchiseId}: not a number`).toBe('number');
				expect(value as number).toBeGreaterThan(MIN_EPOCH_SECONDS);
				expect(value as number).toBeLessThan(MAX_EPOCH_SECONDS);
			}
		}
	});

	it('has a file for every league the sync workflow commits', () => {
		// Guards the reverse failure: the workflow's add-paths naming a league
		// whose file never appears means the sync silently stopped covering it.
		// Skipped entirely until the first sync lands anything.
		if (committedFiles.length === 0) return;
		const workflow = readFileSync(
			resolve(ROOT, '.github/workflows/sync-owner-last-visit.yml'),
			'utf-8',
		);
		for (const file of committedFiles) {
			const league = ALL_LEAGUES.find((l) => l.slug === file.slug)!;
			expect(workflow, `${file.slug} is committed but not in the workflow's add-paths`).toContain(
				`${league.dataPath}/owner-last-visit.json`,
			);
		}
	});
});
