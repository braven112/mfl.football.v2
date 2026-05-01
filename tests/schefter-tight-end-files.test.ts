/**
 * "The Tight End Files" — running-bit meta-awareness for owner-submitted
 * tight-end jokes.
 *
 * Multiple owners across multiple weeks have been submitting variations of
 * the same tight-end joke. Schefter's response is meta-awareness — he files
 * on the SUBMISSION pattern itself rather than retelling the joke. The bit
 * also has a glacially-rare "Schefter unprompted" path (1-in-50) where he
 * makes an original line about the cataloging absurdity itself.
 *
 * These tests pin the running-bit lore so future edits can't quietly drop
 * the trigger conditions, frequency caps, or anti-leak rules. The lore is
 * loaded into the system prompt by `loadLore` (scripts/lib/schefter-lore.mjs),
 * so changes to running-bits.md are read at runtime — no scanner restart
 * required, but the prompt cache (`_cache` closure in loadLore) lives for
 * the lifetime of the Node process.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const RUNNING_BITS = read('data/schefter/running-bits.md');

describe('"The Tight End Files" running-bit lore', () => {
  it('section exists with the expected header', () => {
    expect(RUNNING_BITS).toMatch(/### "The Tight End Files"/);
  });

  it('declares two trigger paths (tipster-suggested + Schefter unprompted)', () => {
    expect(RUNNING_BITS).toMatch(/Tipster-suggested TE joke/);
    expect(RUNNING_BITS).toMatch(/Schefter unprompted/);
  });

  it('caps frequency at 1-in-3 of eligible tipster-suggested posts', () => {
    expect(RUNNING_BITS).toMatch(/Tipster path:\s*1-in-3/);
  });

  it('caps the unprompted path at 1-in-50 (glacially rare)', () => {
    expect(RUNNING_BITS).toMatch(/Unprompted path[\s\S]{0,80}1-in-50/);
  });

  it('lists meta-acknowledgment lines that reference the SUBMISSION pattern, not the joke itself', () => {
    expect(RUNNING_BITS).toMatch(/Another tight end joke landed in the inbox\. Filed\./);
    expect(RUNNING_BITS).toMatch(/three desks/);
    expect(RUNNING_BITS).toMatch(/filing cabinet/);
    expect(RUNNING_BITS).toMatch(/Eighth tight end submission this month/);
  });

  it('lists original (Schefter-unprompted) lines about the cataloging absurdity', () => {
    expect(RUNNING_BITS).toMatch(/Position group with the most inbox traffic/);
    expect(RUNNING_BITS).toMatch(/tight end rumor mill files itself/);
  });

  it('forbids quoting the tipster joke verbatim', () => {
    expect(RUNNING_BITS).toMatch(/NEVER quote the tipster's actual TE joke/);
    expect(RUNNING_BITS).toMatch(/NEVER repeat the specific innuendo/);
  });

  it('mirrors HARD RULE 16 — submission becomes the story when tip has no league business', () => {
    expect(RUNNING_BITS).toMatch(/turn the tip INTO the story/);
  });

  it('forbids stacking with the Style Book bit (thematic overlap)', () => {
    expect(RUNNING_BITS).toMatch(/Do NOT combine with the Style Book bit/);
  });

  it('keeps Schefter PG / columnist-clean (the meta-observation IS the joke, not the innuendo)', () => {
    expect(RUNNING_BITS).toMatch(/Stay PG-clean, columnist-friendly/);
  });

  it('places the bit before "The Wabbit Show" entry (last running bit before catalog sections)', () => {
    const teIdx = RUNNING_BITS.indexOf('### "The Tight End Files"');
    const wabbitIdx = RUNNING_BITS.indexOf('### "The Wabbit Show"');
    expect(teIdx).toBeGreaterThan(-1);
    expect(wabbitIdx).toBeGreaterThan(-1);
    expect(teIdx).toBeLessThan(wabbitIdx);
  });
});

describe('lore loader picks up the new bit', () => {
  // The scanner imports loadLore from scripts/lib/schefter-lore.mjs, which
  // reads running-bits.md and assembles the system-prompt suffix. Verify
  // the loader still references the running-bits file so the new section
  // gets pulled in automatically.
  const loaderSrc = read('scripts/lib/schefter-lore.mjs');

  it('loadLore reads running-bits.md', () => {
    expect(loaderSrc).toMatch(/running-bits\.md/);
  });

  it('appends bits content under the "## RUNNING BITS" header', () => {
    expect(loaderSrc).toMatch(/##\s*RUNNING BITS/);
  });
});
