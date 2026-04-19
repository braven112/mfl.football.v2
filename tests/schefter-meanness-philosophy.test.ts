/**
 * Tests for the "editorial filter is the feature" philosophy hardening —
 * HARD RULE 12 strengthening, HARD RULE 16 (off-topic personal insults),
 * personality.md expansion, and tip-page copy changes.
 *
 * These are contract / source-level checks. The meaningful behavior is
 * prompted into the LLM, which we don't run in unit tests — what we pin
 * here is that the guardrail language and UX copy are present and can't
 * silently regress.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('HARD RULE 12 — editorial-filter design principle', () => {
  const scannerSrc = read('scripts/schefter-rumor-scan.mjs');

  it('states the editorial filter is the feature', () => {
    expect(scannerSrc).toMatch(/THE EDITORIAL FILTER IS THE FEATURE/);
  });

  it('explicitly tells the LLM that meaner input gets softer output', () => {
    // The design principle: the meaner the tip, the more the filter earns
    // its keep. This phrasing must appear verbatim or near-verbatim so the
    // LLM understands it's its JOB to translate, not to clean up and pass.
    expect(scannerSrc).toMatch(/meaner the input/i);
  });

  it('forbids preserving any literal content from a hostile tip', () => {
    expect(scannerSrc).toMatch(/Never preserve any literal content/);
  });

  it('explicitly names the tip categories that hit this rule', () => {
    // crude jokes / personal jabs / off-topic shots were added so the LLM
    // doesn't treat them as non-hostile just because they're not slurs.
    expect(scannerSrc).toMatch(/crude jokes/);
    expect(scannerSrc).toMatch(/personal jabs/);
    expect(scannerSrc).toMatch(/off-topic shots/);
  });
});

describe('HARD RULE 16 — off-topic personal insults', () => {
  const scannerSrc = read('scripts/schefter-rumor-scan.mjs');

  it('exists as rule 16', () => {
    expect(scannerSrc).toMatch(/16\.\s*Off-topic personal insults/);
  });

  it('lists the fantasy-football markers that distinguish on-topic from off-topic', () => {
    expect(scannerSrc).toMatch(/trades, rosters, lineups, schedules, auctions, standings/);
  });

  it('forbids redirecting personal content into a sports frame', () => {
    expect(scannerSrc).toMatch(/DO NOT attempt to redirect the personal content/);
  });

  it('explicitly names attributes that must not surface even obliquely', () => {
    // These are the categories we saw in real tips and want NEVER echoed.
    expect(scannerSrc).toMatch(/athletic skill, appearance, profession/);
  });

  it('prescribes the "tempers running hot" hedge as the default', () => {
    expect(scannerSrc).toMatch(/tempers running hot/i);
  });
});

describe('personality.md — hostile-tips expansion', () => {
  const src = read('data/schefter/personality.md');

  it('states the design principle at the top of the section', () => {
    expect(src).toMatch(/The editorial filter IS the product/);
    expect(src).toMatch(/The meaner the tip, the softer the output/);
  });

  it('includes the "Brandon plays baseball like a girl" translation example', () => {
    // Real tip observed in TheLeague. This exact row must be in the
    // translation table so the LLM sees a concrete crude-input → generic-
    // output pairing.
    expect(src).toMatch(/Brandon plays baseball like a girl/);
    expect(src).toMatch(/not in a mood to respect the commissioner's office/);
  });

  it('has a dedicated off-topic section named after the canonical example', () => {
    expect(src).toMatch(/Brandon plays baseball like a girl/);
    expect(src).toMatch(/Off-topic personal insults/);
  });

  it('forbids naming the specific attribute being mocked', () => {
    expect(src).toMatch(/Never reference the specific attribute being mocked/);
  });

  it('closes the Restraint section with the dispassion point', () => {
    expect(src).toMatch(/The bit is dispassion/);
  });
});

describe('tip.astro — meanness-welcome UX', () => {
  const src = read('src/pages/theleague/schefter/tip.astro');

  it('invites mean tips in the hero lede', () => {
    expect(src).toMatch(/be as mean as you can think of/);
  });

  it('explains that only innuendo, rumor, and feeling survive', () => {
    // Normalize whitespace so matches span line breaks in the Astro template.
    const collapsed = src.replace(/\s+/g, ' ');
    expect(collapsed).toMatch(/innuendo, rumor, and feeling/);
  });

  it('has a "Be mean" rule as the first entry in the how-it-works list', () => {
    // The rule's label + its positioning BEFORE "Anonymous" matters —
    // the first thing the reader sees below the section header is an
    // invitation to send the crude stuff.
    const howItWorksIdx = src.indexOf('How this works');
    const beMeanIdx = src.indexOf('Be mean');
    const anonymousIdx = src.indexOf('class="tip-rail-rule__label">Anonymous');
    expect(howItWorksIdx).toBeGreaterThan(-1);
    expect(beMeanIdx).toBeGreaterThan(howItWorksIdx);
    expect(anonymousIdx).toBeGreaterThan(beMeanIdx);
  });

  it('includes the "Brandon plays baseball like a girl" example pair', () => {
    expect(src).toMatch(/Brandon plays baseball like a girl/);
    // And the sanitized output alongside it.
    expect(src).toMatch(/not in a mood to respect the commissioner's office/);
  });

  it('includes a crude owner-on-owner example pair', () => {
    expect(src).toMatch(/Crude owner-on-owner shot/);
  });
});
