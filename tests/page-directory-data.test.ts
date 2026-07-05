import { describe, it, expect } from 'vitest';
import entries from '../src/data/page-directory.json';
import { loadSpriteIconIds, SPRITE_REL_PATH } from './helpers/sprite-icons';

/**
 * Page Directory Data Validation
 *
 * Ensures page-directory.json entries follow required conventions
 * and have complete metadata for the searchable directory page.
 */

const VALID_CATEGORIES = ['popular', 'my-team', 'reports', 'tools', 'info'];
const VALID_VISIBILITY = ['all', 'admin'];

type DirectoryEntry = {
	id: string;
	title: string;
	description: string;
	path: string;
	icon: string;
	category: string;
	tags: string[];
	visibility: string;
	popularity: number;
};

const typedEntries = entries as DirectoryEntry[];

describe('page-directory.json data integrity', () => {
	it('has entries (sanity check)', () => {
		expect(typedEntries.length).toBeGreaterThan(0);
	});

	it('all entries have unique IDs', () => {
		const ids = typedEntries.map((e) => e.id);
		const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
		expect(duplicates, `Duplicate IDs: ${duplicates.join(', ')}`).toEqual([]);
	});

	for (const entry of typedEntries) {
		describe(`[${entry.category}] ${entry.id}`, () => {
			it('has all required fields', () => {
				expect(entry.id, 'missing id').toBeTruthy();
				expect(entry.title, 'missing title').toBeTruthy();
				expect(entry.description, 'missing description').toBeTruthy();
				expect(entry.path, 'missing path').toBeTruthy();
				expect(entry.icon, 'missing icon').toBeTruthy();
				expect(entry.category, 'missing category').toBeTruthy();
				expect(entry.tags, 'missing tags').toBeDefined();
				expect(entry.visibility, 'missing visibility').toBeTruthy();
				expect(entry.popularity, 'missing popularity').toBeDefined();
			});

			it('path starts with /', () => {
				expect(entry.path).toMatch(/^\//);
			});

			it('category is valid', () => {
				expect(
					VALID_CATEGORIES,
					`Invalid category "${entry.category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`,
				).toContain(entry.category);
			});

			it('visibility is valid', () => {
				expect(
					VALID_VISIBILITY,
					`Invalid visibility "${entry.visibility}". Must be one of: ${VALID_VISIBILITY.join(', ')}`,
				).toContain(entry.visibility);
			});

			it('tags is a non-empty array of strings', () => {
				expect(Array.isArray(entry.tags)).toBe(true);
				expect(entry.tags.length).toBeGreaterThan(0);
				for (const tag of entry.tags) {
					expect(typeof tag).toBe('string');
					expect(tag.length).toBeGreaterThan(0);
				}
			});

			it('has at least 10 tags for searchability', () => {
				expect(
					entry.tags.length,
					`Entry "${entry.id}" has only ${entry.tags.length} tags. Add more synonyms for better search coverage.`,
				).toBeGreaterThanOrEqual(10);
			});

			it('popularity is an integer between 0 and 100', () => {
				expect(Number.isInteger(entry.popularity)).toBe(true);
				expect(entry.popularity).toBeGreaterThanOrEqual(0);
				expect(entry.popularity).toBeLessThanOrEqual(100);
			});
		});
	}
});

// ---------------------------------------------------------------------------
// Sprite icon validation
// ---------------------------------------------------------------------------
//
// The directory page and homepage quick links render
// `<use href="${sprite}#icon-${page.icon}">`, so the stored value must be the
// bare glyph name — a prefixed or unknown value silently renders a blank icon.

describe('page-directory.json sprite icons', () => {
	const spriteIds = loadSpriteIconIds();

	it(`parsed glyph ids from ${SPRITE_REL_PATH} (sanity check)`, () => {
		expect(spriteIds.size).toBeGreaterThan(0);
	});

	it('no icon value carries the "icon-" prefix (consumers add it)', () => {
		const doublePrefixed = typedEntries
			.filter((e) => e.icon?.startsWith('icon-'))
			.map((e) => `${e.id} -> "${e.icon}"`);
		expect(
			doublePrefixed,
			`Icon values must be bare glyph names ("eye", not "icon-eye"). Display code prepends ` +
				`"icon-", so a prefixed value resolves to a nonexistent #icon-icon-* glyph and ` +
				`renders an empty icon.`,
		).toEqual([]);
	});

	it(`every icon refers to a real glyph in ${SPRITE_REL_PATH}`, () => {
		const unknown = typedEntries
			.filter((e) => e.icon && !spriteIds.has(e.icon))
			.map((e) => `${e.id} -> "${e.icon}"`);
		expect(
			unknown,
			`Icons not found in the sprite. Use an existing glyph id (without the "icon-" ` +
				`prefix) or add the glyph to ${SPRITE_REL_PATH}.`,
		).toEqual([]);
	});
});
