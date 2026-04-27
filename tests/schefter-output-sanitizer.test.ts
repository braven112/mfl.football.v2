/**
 * Sanitizer + JSON-output-contract tests for the Schefter rumor scanner.
 *
 * Pins the April 2026 incident: when an owner posted a hostile off-topic
 * joke about Schefter, the model rationalized its drop decision into the
 * post body and the scanner posted the reasoning to GroupMe. The fix is
 * two layers:
 *   1. The LLM is instructed to return strict JSON ({"post": "..."} or
 *      {"post": null}) so reasoning has nowhere to land.
 *   2. parseAiResponse extracts the post and runs sanitizeAiPost over it,
 *      which rejects any text containing meta-commentary patterns. A
 *      rejection returns null and the caller falls back to the safe
 *      template body — never to the LLM's freeform text.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeAiPost,
  parseAiResponse,
  pickSchefterTargetMode,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/schefter-rumor-scan.mjs';

describe('sanitizeAiPost', () => {
  it('passes a normal rumor post unchanged', () => {
    const post = "Hearing the Northwest is buzzing about RB help. Phones are warm. Developing.";
    expect(sanitizeAiPost(post)).toBe(post);
  });

  it('passes a self-deprecating Schefter post', () => {
    const post = "For the record: this bot has never been to a resort. I run on a cron and a prayer.";
    expect(sanitizeAiPost(post)).toBe(post);
  });

  it('rejects the April 2026 reasoning post verbatim', () => {
    const bad = `I'm reading this tip, and I need to drop it. This is a hostile personal attack on both Vit and Schefter himself. Per the Iron Rules: if a tip can't be filed, produce NO post. Silently drop it. This one gets dropped.`;
    expect(sanitizeAiPost(bad)).toBeNull();
  });

  it('rejects "Iron Rules" mentions', () => {
    expect(sanitizeAiPost('Per the Iron Rules, dropping this one.')).toBeNull();
  });

  it('rejects "silently drop" / "gets dropped" / "need to drop"', () => {
    expect(sanitizeAiPost('I need to drop this one.')).toBeNull();
    expect(sanitizeAiPost('This one gets dropped.')).toBeNull();
    expect(sanitizeAiPost('Silently drop the tip.')).toBeNull();
  });

  it('rejects "this tip" meta-references (rule 10)', () => {
    expect(sanitizeAiPost('This tip is interesting.')).toBeNull();
  });

  it('rejects "hostile personal attack" framing', () => {
    expect(sanitizeAiPost('A hostile personal attack on Vit and Schefter.')).toBeNull();
  });

  it('rejects "filing decision" / "editorial filter" meta', () => {
    expect(sanitizeAiPost("Here's my filing decision on the matter.")).toBeNull();
    expect(sanitizeAiPost('The editorial filter trimmed this.')).toBeNull();
  });

  it('returns null for empty/whitespace/non-string', () => {
    expect(sanitizeAiPost('')).toBeNull();
    expect(sanitizeAiPost('   ')).toBeNull();
    // @ts-expect-error testing runtime guard
    expect(sanitizeAiPost(null)).toBeNull();
    // @ts-expect-error testing runtime guard
    expect(sanitizeAiPost(undefined)).toBeNull();
  });

  it('trims surrounding whitespace on a valid post', () => {
    expect(sanitizeAiPost('  Hearing chatter in the East.  ')).toBe('Hearing chatter in the East.');
  });
});

describe('parseAiResponse — JSON contract', () => {
  it('extracts post from strict JSON', () => {
    const raw = JSON.stringify({ post: 'Hearing chatter in the Northwest. Developing.' });
    expect(parseAiResponse(raw)).toBe('Hearing chatter in the Northwest. Developing.');
  });

  it('returns null on explicit drop ({"post": null})', () => {
    expect(parseAiResponse('{"post": null}')).toBeNull();
  });

  it('returns null on missing post field', () => {
    expect(parseAiResponse('{"other": "value"}')).toBeNull();
  });

  it('returns null on non-string post', () => {
    expect(parseAiResponse('{"post": 123}')).toBeNull();
  });

  it('extracts JSON wrapped in markdown fences', () => {
    const raw = '```json\n{"post": "Hearing the East division is buzzing."}\n```';
    expect(parseAiResponse(raw)).toBe('Hearing the East division is buzzing.');
  });

  it('extracts JSON when prefixed by explanatory text', () => {
    const raw = 'Here is the JSON:\n{"post": "Late word: a deal is brewing."}';
    expect(parseAiResponse(raw)).toBe('Late word: a deal is brewing.');
  });

  it('returns null when no JSON object can be extracted', () => {
    expect(parseAiResponse('Just a plain string with no JSON.')).toBeNull();
  });

  it('runs the sanitizer — rejects post containing meta-commentary', () => {
    const raw = JSON.stringify({
      post: "Per the Iron Rules: I need to drop this one. This tip violates league business.",
    });
    expect(parseAiResponse(raw)).toBeNull();
  });

  it('returns null on empty string', () => {
    expect(parseAiResponse('')).toBeNull();
  });
});

describe('pickSchefterTargetMode — 7.5% probability', () => {
  it('returns attack-back when rng yields a value below the threshold', () => {
    expect(pickSchefterTargetMode(() => 0)).toBe('attack-back');
    expect(pickSchefterTargetMode(() => 0.05)).toBe('attack-back');
    expect(pickSchefterTargetMode(() => 0.0749)).toBe('attack-back');
  });

  it('returns self-dep when rng yields the threshold or above', () => {
    expect(pickSchefterTargetMode(() => 0.075)).toBe('self-dep');
    expect(pickSchefterTargetMode(() => 0.5)).toBe('self-dep');
    expect(pickSchefterTargetMode(() => 0.99)).toBe('self-dep');
  });

  it('defaults to Math.random when no rng is passed', () => {
    // Just verify it returns one of the two valid modes — exercising the default arg.
    const result = pickSchefterTargetMode();
    expect(['self-dep', 'attack-back']).toContain(result);
  });

  it('produces ~7.5% attack-back across a large sample with a real RNG', () => {
    // 10,000 trials at p=0.075 → expected 750, std-dev ≈ 26.3.
    // ±5σ window (618..882) keeps this test from flaking on any cosmic-ray
    // RNG run while still catching a real regression (e.g. p=0.05 would
    // give ~500 hits and p=0.15 would give ~1500 — both well outside).
    let attacks = 0;
    for (let i = 0; i < 10000; i++) {
      if (pickSchefterTargetMode() === 'attack-back') attacks++;
    }
    expect(attacks).toBeGreaterThanOrEqual(618);
    expect(attacks).toBeLessThanOrEqual(882);
  });
});
