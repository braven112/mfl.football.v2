/**
 * Guards for the two Ask Roger repair scripts.
 *
 * Both scripts write to production — one posts to the league GroupMe (no
 * unsend), one rewrites stored owner-facing answers in Redis — and the logic
 * that keeps them safe is small, easy to "simplify", and otherwise untested.
 * These cover the two predicates whose regression is expensive in BOTH
 * directions: too strict strands a correction, too loose double-posts to
 * sixteen owners or silently eats a question.
 *
 * The scripts guard `main()` behind an entry-point check, so importing them
 * here runs no side effects.
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { idsOf, FIXES } from '../scripts/fix-rules-qa-answer.mjs';
import { isKnownNonDelivery, CORRECTIONS } from '../scripts/roger-correction.mjs';

describe('idsOf — concurrent-write fingerprint', () => {
  const base = [{ id: 'qa_1' }, { id: 'qa_2' }, { id: 'qa_3' }];

  it('is stable for an unchanged array', () => {
    expect(idsOf(base)).toBe(idsOf([{ id: 'qa_1' }, { id: 'qa_2' }, { id: 'qa_3' }]));
  });

  it('detects an added Q&A (the live POST handler prepends)', () => {
    expect(idsOf([{ id: 'qa_new' }, ...base])).not.toBe(idsOf(base));
  });

  it('detects a deleted Q&A (the DELETE handler filters by id)', () => {
    expect(idsOf(base.filter((x) => x.id !== 'qa_2'))).not.toBe(idsOf(base));
  });

  it('detects a reorder even when the id set is identical', () => {
    expect(idsOf([base[1], base[0], base[2]])).not.toBe(idsOf(base));
  });

  it('returns null for non-arrays so a corrupt re-read compares unequal', () => {
    expect(idsOf(null)).toBeNull();
    expect(idsOf(undefined)).toBeNull();
    expect(idsOf('not an array')).toBeNull();
    expect(idsOf({ id: 'qa_1' })).toBeNull();
    // Critical: a corrupt re-read must NOT compare equal to a real array, or
    // the conflict check would pass and the script would clobber the key.
    expect(idsOf(null)).not.toBe(idsOf(base));
  });

  it('survives entries missing an id without throwing', () => {
    expect(() => idsOf([{ id: 'qa_1' }, {}, null])).not.toThrow();
    expect(idsOf([{ id: 'qa_1' }, {}, null])).not.toBe(idsOf([{ id: 'qa_1' }]));
  });

  it('cannot be spoofed by an id containing the separator', () => {
    // Two different arrays must never collide into the same fingerprint.
    expect(idsOf([{ id: 'a' }, { id: 'b' }])).not.toBe(idsOf([{ id: 'a b' }]));
  });

  it('the script source contains no literal NUL byte', () => {
    // A raw NUL makes git treat the script as binary, so its diffs render as
    // "Bin N -> M bytes" and a rebase conflict cannot be resolved by hand.
    // This regressed once already; the separator must stay an escape.
    const src = readFileSync(
      new URL('../scripts/fix-rules-qa-answer.mjs', import.meta.url),
      'utf8'
    );
    expect(src.includes(String.fromCharCode(0))).toBe(false);
  });
});

describe('isKnownNonDelivery — when a send claim may be released', () => {
  it('releases on a missing bot id (rotated or unset secret)', () => {
    expect(isKnownNonDelivery('no-bot-id')).toBe(true);
  });

  it('releases on any HTTP status, which GroupMe returned and rejected', () => {
    expect(isKnownNonDelivery('http-401')).toBe(true);
    expect(isKnownNonDelivery('http-404')).toBe(true);
    expect(isKnownNonDelivery('http-500')).toBe(true);
  });

  it('KEEPS the claim on a fetch error — the post may have landed', () => {
    // Releasing here risks re-posting an un-unsendable message to the league.
    expect(isKnownNonDelivery('fetch-error')).toBe(false);
  });

  it('keeps the claim for a dry run or an unknown reason', () => {
    expect(isKnownNonDelivery('dry-run')).toBe(false);
    expect(isKnownNonDelivery(undefined)).toBe(false);
    expect(isKnownNonDelivery(null)).toBe(false);
    expect(isKnownNonDelivery('')).toBe(false);
  });
});

describe('correction + fix entries stay well-formed', () => {
  it('every correction closes with a rulebook link', () => {
    for (const [slug, entry] of Object.entries(CORRECTIONS as Record<string, { text: string }>)) {
      const lastLine = entry.text.trimEnd().split('\n').pop() ?? '';
      expect(lastLine, `correction ${slug}`).toMatch(/^https:\/\/\S+\/theleague\/rules(#[a-z0-9-]+)?$/);
    }
  });

  it('every stored-answer fix closes with a rulebook link', () => {
    for (const [slug, entry] of Object.entries(FIXES as Record<string, { answer: string }>)) {
      const lastLine = entry.answer.trimEnd().split('\n').pop() ?? '';
      expect(lastLine, `fix ${slug}`).toMatch(/^\[[^\]]+\]\(\/theleague\/rules(#[a-z0-9-]+)?\)$/);
    }
  });

  it('an already-delivered correction carries sentAt so CI cannot re-send it', () => {
    const taxi = (CORRECTIONS as Record<string, { sentAt?: string }>)['taxi-squad-20-minimum'];
    expect(taxi.sentAt, 'the taxi-squad correction was posted to GroupMe on 2026-08-13').toBeTruthy();
  });

  it('slugs match the workflow allowlist, which rejects anything outside [a-z0-9-]', () => {
    for (const slug of [...Object.keys(CORRECTIONS), ...Object.keys(FIXES)]) {
      expect(slug, `slug ${slug}`).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
