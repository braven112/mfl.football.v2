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

  it('states the editorial filter is the feature AND that the feature is drama', () => {
    expect(scannerSrc).toMatch(/THE EDITORIAL FILTER IS THE FEATURE/);
    // The direction shift: drama amplification is the bit, not muted dispassion.
    expect(scannerSrc).toMatch(/THE FEATURE IS DRAMA/);
  });

  it('frames hostile tips as drama amplification, not muted reporting', () => {
    // Schefter plays petty material completely straight, like a real beat
    // reporter on a slow news day. Over-the-top earnest, ridiculous on
    // purpose. This phrasing must be present so the LLM understands the
    // tone target.
    expect(scannerSrc).toMatch(/REAL DRAMA/);
    expect(scannerSrc).toMatch(/playing petty group-chat shit-talk completely straight/i);
    expect(scannerSrc).toMatch(/over-the-top earnest, NOT muted/);
  });

  it('forbids preserving any literal content from a hostile tip', () => {
    expect(scannerSrc).toMatch(/Never preserve any literal content/);
  });

  it('forbids dropping hostile tips at the IRON RULES level', () => {
    // The IRON RULES no longer authorize dropping hostile content. Only
    // genuinely empty/blank tips trip the {"post": null} path. This pins
    // the no-drop policy so a future regression to "silently drop" gets
    // caught here.
    expect(scannerSrc).toMatch(/EVERY non-empty tip ships/);
    expect(scannerSrc).toMatch(/empty \/ blank \/ no-content/);
    expect(scannerSrc).toMatch(/Translate, don't drop/);
  });

  it('describes football flavor as occasional seasoning, never the centerpiece', () => {
    // Football double-entendres are a small ingredient — the user's
    // explicit dial-back. The prompt must call out the sparing use AND
    // the no-content-encoding rule (puns are mood vocabulary, never echo
    // the specific attack).
    expect(scannerSrc).toMatch(/Football flavor — sparingly/);
    expect(scannerSrc).toMatch(/AT MOST one football-flavor phrase per post/);
    expect(scannerSrc).toMatch(/never use a football phrase that winks at the specific attack content/i);
    expect(scannerSrc).toMatch(/drama-coloring, not content-encoding/);
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

  it('explicitly names attributes that must not surface even obliquely', () => {
    // These are the categories we saw in real tips and want NEVER echoed.
    expect(scannerSrc).toMatch(/athletic skill, appearance, profession/);
  });

  it('preserves source-side framing (tipsterDivision / author / codename)', () => {
    // The earlier too-aggressive version told the LLM to default to "tempers
    // running hot" generic. We explicitly want SOURCE framing (division,
    // author, codename) to still come through — only the specific attribute
    // being mocked drops.
    expect(scannerSrc).toMatch(/source-side framing DOES still apply/);
    expect(scannerSrc).toMatch(/tipsterCodename/);
    expect(scannerSrc).toMatch(/tipsterDivision/);
    expect(scannerSrc).toMatch(/intraDivision/);
  });

  it('splits the phrasing kit into feminine-coded (reserved) and neutral (default)', () => {
    // Kit (A) — feminine-coded, RESERVED for tips with a gender reference
    expect(scannerSrc).toMatch(/Feminine-coded kit — RESERVED/);
    expect(scannerSrc).toMatch(/hissy fit/i);
    expect(scannerSrc).toMatch(/cat fight/i);

    // Kit (B) — neutral, DEFAULT for all other crude tips
    expect(scannerSrc).toMatch(/Default neutral kit — use on ALL other/);
    expect(scannerSrc).toMatch(/throwing elbows/i);
    expect(scannerSrc).toMatch(/throwing a tantrum/i);

    // The split must be HARD so the LLM doesn't mix kits.
    expect(scannerSrc).toMatch(/The split between kits \(A\) and \(B\) is HARD/);
    expect(scannerSrc).toMatch(/false positive on kit \(A\)/i);
  });

  it('lists the gender-marker triggers that unlock kit (A)', () => {
    // These markers are how the LLM decides a tip is feminine-coded.
    // "like a girl" / "bitch" / "princess" / etc. are the signal.
    expect(scannerSrc).toMatch(/plays like a girl/i);
    expect(scannerSrc).toMatch(/princess/i);
    expect(scannerSrc).toMatch(/pearl clutcher/i);
  });

  it('adds the A=C barometer close with a behavior-driven ladder', () => {
    expect(scannerSrc).toMatch(/Every accusation is a confession/);
    expect(scannerSrc).toMatch(/tells us something about the shooter/i);
    expect(scannerSrc).toMatch(/projection/i);
    // The barometer metaphor must be explicit so the LLM understands the
    // dial is behavior-driven, not a blanket rule.
    expect(scannerSrc).toMatch(/barometer/i);
    expect(scannerSrc).toMatch(/offTopicCount/);
  });

  it('scales A=C weight with offTopicCount across tier breakpoints', () => {
    // The ladder must call out the 1 / 2 / 3 / 4+ breakpoints so the LLM
    // doesn't flatten them.
    expect(scannerSrc).toMatch(/offTopicCount === 1/);
    expect(scannerSrc).toMatch(/offTopicCount === 2/);
    expect(scannerSrc).toMatch(/offTopicCount === 3/);
    expect(scannerSrc).toMatch(/offTopicCount >= 4/);
  });

  it('documents the rolling window so good behavior can improve the dial', () => {
    // The rolling-window framing is the key design decision — cumulative
    // counting would punish old behavior forever. The LLM and future devs
    // need to know the dial naturally decays.
    expect(scannerSrc).toMatch(/rolling 30-day/i);
    expect(scannerSrc).toMatch(/age out/i);
  });

  it('forbids combining A=C with the Style Book bit', () => {
    expect(scannerSrc).toMatch(/Do NOT combine A=C with the Style Book bit/);
  });

  it('flags mutual-beef damping as a future signal', () => {
    // Leaves the door open for V2 response-detection to damp A=C when the
    // target reciprocates. This comment in the prompt is intentional so
    // future devs (and reviewers) can find the extension point.
    expect(scannerSrc).toMatch(/mutual beef/i);
  });
});

describe('personality.md — hostile-tips expansion', () => {
  const src = read('data/schefter/personality.md');

  it('states the design principle at the top of the section', () => {
    expect(src).toMatch(/The editorial filter IS the product/);
    // Direction shift: meaner input gets MORE DRAMATIC reporting (not softer).
    // Schefter plays petty material straight; the drama amplification is the bit.
    expect(src).toMatch(/The meaner the tip, the more dramatically Schefter reports it/);
  });

  it('forbids dropping hostile tips in the personality bible', () => {
    // Personality.md Iron Rule 2 must mirror the scanner IRON RULE so the
    // lore-loaded prompt and the inline prompt agree.
    expect(src).toMatch(/Every non-empty tip ships/);
    expect(src).toMatch(/Translate, don't drop/);
  });

  it('includes the "Brandon plays baseball like a girl" translation example with hissy-fit framing', () => {
    expect(src).toMatch(/Brandon plays baseball like a girl/);
    // The translation should carry source framing (Southwest / Dead Cap) and
    // use the hissy-fit / elbows language — NOT the old "tempers running hot"
    // generic default we walked back.
    expect(src).toMatch(/hissy fit from an owner in the Southwest/i);
    expect(src).toMatch(/throwing elbows at the commissioner/i);
  });

  it('has a dedicated off-topic section with the hissy-fit frame and kit split', () => {
    expect(src).toMatch(/Off-topic personal insults/);
    // Preferred frame callout
    expect(src).toMatch(/the tipster is the story/i);
    // Kit (A) — feminine-coded, reserved
    expect(src).toMatch(/Kit \(A\)/);
    expect(src).toMatch(/Feminine-coded/);
    expect(src).toMatch(/hissy fit/i);
    expect(src).toMatch(/cat fight/i);
    // Kit (B) — neutral, default
    expect(src).toMatch(/Kit \(B\)/);
    expect(src).toMatch(/Default neutral/);
    expect(src).toMatch(/throwing elbows/i);
    expect(src).toMatch(/throwing a tantrum/i);
    // Warning about false positives
    expect(src).toMatch(/false positive on kit \(A\)/i);
  });

  it('documents the "every accusation is a confession" barometer', () => {
    // Either phrasing — "every accusation is a confession" or
    // "every accusation's a confession" — must appear in the phrasing kit.
    expect(src).toMatch(/every accusation('s| is) a confession/i);
    expect(src).toMatch(/tells us something about the shooter/i);
    // The "barometer" / "dial" metaphor is what communicates the design
    // intent — each owner's behavior tunes their own A=C weight.
    expect(src).toMatch(/barometer/i);
    expect(src).toMatch(/every owner's (recent )?behavior tunes their own barometer/i);
  });

  it('shows the offTopicCount → A=C weight ladder in personality.md', () => {
    expect(src).toMatch(/offTopicCount/);
    // Verify each breakpoint row of the ladder table is present.
    expect(src).toMatch(/light or off/i);
    expect(src).toMatch(/leaning in/i);
    expect(src).toMatch(/pointed/i);
    expect(src).toMatch(/power user/i);
  });

  it('explains that good behavior can improve the barometer via the rolling window', () => {
    // The rolling-window framing is essential — without it, the dial only
    // ever goes up and owners can't recover from old mean tips.
    expect(src).toMatch(/rolling/i);
    // Must call out 30 days so the window is documented
    expect(src).toMatch(/30[- ]day/i);
    // Must say good behavior improves the reading
    expect(src).toMatch(/good behavior/i);
  });

  it('preserves the source-side framing fallback list', () => {
    expect(src).toMatch(/GroupMe author/);
    expect(src).toMatch(/Web tipster's division/);
    expect(src).toMatch(/Intra-division signal/);
  });

  it('frames the bit as drama amplification (not dispassion)', () => {
    // Direction shift: the section was previously titled "Restraint" and
    // closed with "The bit is dispassion." It now reads as drama
    // amplification — Schefter plays petty material completely straight,
    // ridiculous-on-purpose. Pin both the new section header and the
    // PG-but-dramatic framing so this can't silently regress.
    expect(src).toMatch(/Drama amplification \(the bit\)/);
    expect(src).toMatch(/ridiculous-on-purpose/);
    expect(src).toMatch(/breathless beat-reporter earnestness/i);
  });

  it('describes football flavor as sparing seasoning in the personality bible', () => {
    expect(src).toMatch(/Football flavor — sparingly/);
    expect(src).toMatch(/AT MOST one football-flavor phrase per post/);
    expect(src).toMatch(/drama-coloring, not content-encoding/);
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
