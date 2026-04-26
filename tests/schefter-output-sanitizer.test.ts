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

describe('pickSchefterTargetMode — 1-in-20 cadence', () => {
  it('returns self-dep for counters 1..19', () => {
    for (let i = 1; i <= 19; i++) {
      expect(pickSchefterTargetMode(i)).toBe('self-dep');
    }
  });

  it('returns attack-back exactly on every multiple of 20', () => {
    expect(pickSchefterTargetMode(20)).toBe('attack-back');
    expect(pickSchefterTargetMode(40)).toBe('attack-back');
    expect(pickSchefterTargetMode(60)).toBe('attack-back');
  });

  it('returns self-dep on counter 0 (defensive)', () => {
    expect(pickSchefterTargetMode(0)).toBe('self-dep');
  });

  it('produces 1 attack-back per 20 across a full cycle', () => {
    let attacks = 0;
    for (let i = 1; i <= 100; i++) {
      if (pickSchefterTargetMode(i) === 'attack-back') attacks++;
    }
    expect(attacks).toBe(5);
  });
});
