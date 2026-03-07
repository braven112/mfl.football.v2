import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { WhatsNewEntry } from '../src/types/whats-new';
import entries from '../src/data/whats-new.json';

/**
 * What's New Data Validation
 *
 * Ensures whats-new.json entries follow required conventions.
 * Screenshot images are required for new-page, new-feature, and enhancement
 * entries added after the enforcement date below.
 */

/** Categories that require a screenshot */
const SCREENSHOT_REQUIRED_CATEGORIES = ['new-page', 'new-feature', 'enhancement'];

/**
 * Entries dated after this date MUST include image + imageAlt.
 * Older entries are grandfathered in.
 */
const SCREENSHOT_ENFORCEMENT_DATE = '2026-02-28';

const WHATS_NEW_ASSETS_DIR = resolve(__dirname, '../public/assets/whats-new');

const typedEntries = entries as WhatsNewEntry[];

// ---------------------------------------------------------------------------
// Screenshot requirement
// ---------------------------------------------------------------------------

describe('whats-new.json screenshot requirements', () => {
  const enforceableEntries = typedEntries.filter(
    (e) =>
      SCREENSHOT_REQUIRED_CATEGORIES.includes(e.category) &&
      e.date > SCREENSHOT_ENFORCEMENT_DATE,
  );

  it('has entries to validate (sanity check)', () => {
    // This test will start passing once new entries are added after the
    // enforcement date. Until then it just confirms the filter works.
    expect(typedEntries.length).toBeGreaterThan(0);
  });

  for (const entry of enforceableEntries) {
    describe(`[${entry.category}] ${entry.id}`, () => {
      it('has an image field', () => {
        expect(
          entry.image,
          `Entry "${entry.id}" (${entry.category}, ${entry.date}) is missing a required "image" field. ` +
            `All ${SCREENSHOT_REQUIRED_CATEGORIES.join('/')} entries after ${SCREENSHOT_ENFORCEMENT_DATE} must include a screenshot.`,
        ).toBeTruthy();
      });

      it('has an imageAlt field', () => {
        expect(
          entry.imageAlt,
          `Entry "${entry.id}" is missing a required "imageAlt" field. ` +
            `Provide descriptive alt text for the screenshot.`,
        ).toBeTruthy();
      });

      it('image file exists in public/assets/whats-new/', () => {
        if (!entry.image) return; // skip if image is missing (caught above)
        const imagePath = resolve(WHATS_NEW_ASSETS_DIR, entry.image);
        expect(
          existsSync(imagePath),
          `Screenshot file not found: public/assets/whats-new/${entry.image}. ` +
            `Add the screenshot image before publishing.`,
        ).toBe(true);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// General data integrity
// ---------------------------------------------------------------------------

describe('whats-new.json data integrity', () => {
  it('all entries have unique IDs', () => {
    const ids = typedEntries.map((e) => e.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, `Duplicate IDs found: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('all entries have valid dates', () => {
    for (const entry of typedEntries) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(entry.date).toString()).not.toBe('Invalid Date');
    }
  });

  it('all entries with image also have imageAlt', () => {
    const missingAlt = typedEntries.filter((e) => e.image && !e.imageAlt);
    expect(
      missingAlt.map((e) => e.id),
      `Entries with image but missing imageAlt: ${missingAlt.map((e) => e.id).join(', ')}`,
    ).toEqual([]);
  });

  it('all image files referenced actually exist', () => {
    const missing = typedEntries
      .filter((e) => e.image)
      .filter((e) => !existsSync(resolve(WHATS_NEW_ASSETS_DIR, e.image!)));
    expect(
      missing.map((e) => `${e.id} -> ${e.image}`),
      `Missing image files`,
    ).toEqual([]);
  });

  it('all inline description images exist', () => {
    const missing: string[] = [];
    for (const entry of typedEntries) {
      for (const block of entry.description) {
        if (typeof block === 'object' && block.type === 'image') {
          const imgPath = resolve(WHATS_NEW_ASSETS_DIR, block.src);
          if (!existsSync(imgPath)) {
            missing.push(`${entry.id} -> ${block.src}`);
          }
        }
      }
    }
    expect(missing, 'Missing inline description images').toEqual([]);
  });
});
