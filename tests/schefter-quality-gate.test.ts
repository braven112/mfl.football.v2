import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import { parseScorerResponse, getThreshold, checkGroupMeQuality, scoreSchefterPost } from '../scripts/lib/schefter-quality-gate.mjs';

describe('parseScorerResponse', () => {
  it('extracts JSON from a clean response', () => {
    const r = parseScorerResponse('{"score": 8, "reason": "ships"}');
    expect(r).toEqual({ score: 8, reason: 'ships' });
  });

  it('extracts JSON when surrounded by prose', () => {
    const r = parseScorerResponse('Sure! {"score": 4, "reason": "flat"} done.');
    expect(r.score).toBe(4);
    expect(r.reason).toBe('flat');
  });

  it('throws when no JSON object present', () => {
    expect(() => parseScorerResponse('no json here')).toThrow(/no JSON/);
  });

  it('throws on out-of-range scores', () => {
    expect(() => parseScorerResponse('{"score": 11}')).toThrow(/invalid score/);
    expect(() => parseScorerResponse('{"score": 0}')).toThrow(/invalid score/);
    expect(() => parseScorerResponse('{"score": "high"}')).toThrow(/invalid score/);
  });

  it('truncates very long reasons', () => {
    const long = 'x'.repeat(500);
    const r = parseScorerResponse(`{"score": 7, "reason": "${long}"}`);
    expect(r.reason.length).toBe(240);
  });
});

describe('getThreshold', () => {
  it('defaults to 6 when env var is unset', () => {
    expect(getThreshold({})).toBe(6);
  });

  it('reads SCHEFTER_QUALITY_THRESHOLD when valid', () => {
    expect(getThreshold({ SCHEFTER_QUALITY_THRESHOLD: '8' })).toBe(8);
  });

  it('falls back to 6 for out-of-range or non-numeric values', () => {
    expect(getThreshold({ SCHEFTER_QUALITY_THRESHOLD: '0' })).toBe(6);
    expect(getThreshold({ SCHEFTER_QUALITY_THRESHOLD: '11' })).toBe(6);
    expect(getThreshold({ SCHEFTER_QUALITY_THRESHOLD: 'high' })).toBe(6);
  });
});

describe('checkGroupMeQuality', () => {
  const post = { headline: 'Test', body: 'Body', tier: 'breaking' };

  it('allows the send when no API key is provided', async () => {
    const result = await checkGroupMeQuality(post, { apiKey: '', log: () => {}, warn: () => {} });
    expect(result.allow).toBe(true);
    expect(result.reason).toBe('no-api-key');
  });

  it('allows when score >= threshold', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: '{"score": 8, "reason": "good"}' }] }),
    });
    const result = await scoreSchefterPost(post, { apiKey: 'k', fetchFn });
    expect(result.score).toBe(8);
  });

  it('defaults to allow=true on scorer error (network/rate-limit)', async () => {
    // checkGroupMeQuality wraps scoreSchefterPost; force the inner call to
    // throw via an apiKey but a fetch that 529s.
    const original = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 529,
      text: async () => 'overloaded',
    }) as typeof fetch;
    try {
      const result = await checkGroupMeQuality(post, { apiKey: 'k', log: () => {}, warn: () => {} });
      expect(result.allow).toBe(true);
      expect(result.error).toMatch(/529/);
    } finally {
      global.fetch = original;
    }
  });

  it('suppresses when score < threshold', async () => {
    const original = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: '{"score": 3, "reason": "flat"}' }] }),
    }) as typeof fetch;
    try {
      const result = await checkGroupMeQuality(post, { apiKey: 'k', threshold: 6, log: () => {}, warn: () => {} });
      expect(result.allow).toBe(false);
      expect(result.score).toBe(3);
    } finally {
      global.fetch = original;
    }
  });
});
