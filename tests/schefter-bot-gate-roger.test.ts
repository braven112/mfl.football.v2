/**
 * Tests for the widened detectMention gate + Roger disambiguation.
 *
 * TheLeague chat has two bots — Schefter (beat reporter) and Ask Roger
 * (deadline nag). A bare "the bot" is ambiguous, so the listener now:
 *
 *   - Accepts "the schefter bot" / "claude bot" / "schefty bot" explicitly
 *   - Accepts generic "the bot" / "this bot" / "that bot" ONLY when no
 *     Roger-adjacent phrase also appears in the message
 *   - Rejects "ask roger", "the roger bot", "roger's bot" in all cases
 *
 * Same Roger guard applies to detectAttackOnSchefter so the Style Book
 * doesn't log Roger-directed attacks against an author's file.
 */
import { describe, it, expect } from 'vitest';
import {
  detectMention,
  detectAttackOnSchefter,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/schefter-groupme-listen.mjs';

describe('detectMention — bot/Roger disambiguation', () => {
  it('accepts explicit "the schefter bot" reference', () => {
    const r = detectMention('the schefter bot is a hack');
    expect(r.match).toBe(true);
    // Either variant is acceptable as long as it classifies as a Schefter mention.
    expect(['schefter-bot', 'schefter']).toContain(r.variant);
  });

  it('accepts explicit "the claude bot"', () => {
    const r = detectMention('the claude bot is wrong again');
    expect(r.match).toBe(true);
    expect(['schefter-bot', 'claude']).toContain(r.variant);
  });

  it('accepts generic "the bot" when Roger is not mentioned', () => {
    const r = detectMention('the bot is a fraud, get it together');
    expect(r.match).toBe(true);
    expect(r.variant).toBe('the-bot');
  });

  it('accepts "this bot is wrong" (early-position trigger)', () => {
    const r = detectMention('this bot is wrong about the trade');
    expect(r.match).toBe(true);
  });

  it('rejects generic "the bot" when Roger is also mentioned', () => {
    const r = detectMention('the bot is wrong, ask Roger to double-check');
    expect(r.match).toBe(false);
    expect(r.reason).toMatch(/roger/i);
  });

  it("rejects \"roger's bot\" entirely", () => {
    const r = detectMention("roger's bot broke again");
    expect(r.match).toBe(false);
  });

  it('rejects "ask roger" without Schefter naming', () => {
    const r = detectMention('ask roger when the next deadline is');
    expect(r.match).toBe(false);
  });

  it('still accepts schefter when Roger is named alongside (explicit wins)', () => {
    const r = detectMention('schefter is a hack even though Roger is fine');
    expect(r.match).toBe(true);
    expect(r.variant).toBe('schefter');
  });
});

describe('detectAttackOnSchefter — Roger guard', () => {
  it('logs "the bot is a fraud" as attack when no Roger context', () => {
    expect(detectAttackOnSchefter('the bot is a fraud').attack).toBe(true);
  });

  it('rejects "the bot is wrong, ask Roger to fix it"', () => {
    const r = detectAttackOnSchefter('the bot is wrong, ask Roger to fix it');
    expect(r.attack).toBe(false);
    expect(r.reason).toMatch(/roger/i);
  });

  it("rejects \"roger's bot is lame\"", () => {
    expect(detectAttackOnSchefter("roger's bot is lame").attack).toBe(false);
  });

  it('still logs attack when Schefter is explicitly named alongside Roger', () => {
    const r = detectAttackOnSchefter('schefter is a hack even though Roger is fine');
    expect(r.attack).toBe(true);
    expect(r.keyword).toBe('hack');
  });

  it('rejects "ask roger why the bot is broken" (no explicit Schefter + Roger context)', () => {
    const r = detectAttackOnSchefter('ask roger why the bot is broken');
    expect(r.attack).toBe(false);
  });
});
