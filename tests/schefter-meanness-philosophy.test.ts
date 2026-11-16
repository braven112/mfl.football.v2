/**
 * Tests for the "editorial filter is the feature" philosophy hardening —
 * HARD RULE 12 strengthening, HARD RULE 16 (off-topic personal insults),
 * and tip-page copy changes. (The personality.md pins moved with the
 * file to the private beat-reporter repo, tests/lore.test.mjs.)
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

describe('HARD RULE 16 — off-topic personal insults', () => {
  const scannerSrc = read('scripts/schefter-rumor-scan.mjs');

  it('documents the rolling window so good behavior can improve the dial', () => {
    // The rolling-window framing is the key design decision — cumulative
    // counting would punish old behavior forever. The LLM and future devs
    // need to know the dial naturally decays.
    expect(scannerSrc).toMatch(/rolling 30-day/i);
    expect(scannerSrc).toMatch(/age out/i);
  });
});

describe('tip.astro — meanness-welcome UX', () => {
  // The page body moved into the shared component (per-league thin wrappers).
  const src = read('src/components/schefter/TipPage.astro');

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

  it('includes the "Brandon plays baseball like a girl" example pair with hissy-fit output', () => {
    expect(src).toMatch(/Brandon plays baseball like a girl/);
    // Source-side framing survives (Southwest) + mood (hissy fit) + the
    // optional confession twist. None of the original attack content.
    expect(src).toMatch(/hissy fit from an owner in the Southwest/i);
    expect(src).toMatch(/tells us something about the shooter/i);
  });

  it('includes a crude owner-on-owner example pair', () => {
    expect(src).toMatch(/Crude owner-on-owner shot/);
  });

  it('"Be mean" rule explains the hissy-fit framing and confession angle', () => {
    expect(src).toMatch(/hissy fit/i);
    expect(src).toMatch(/every accusation's a confession/i);
  });
});
