/**
 * AI model by plan (src/utils/ai-plan.mjs, Brandon 2026-11-09): full custom
 * sites run Sonnet, the League History tier and signed-out demo visitors run
 * Haiku. A league is upgraded by `plan: 'custom'` in the registry and nothing
 * else.
 */
import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { HAIKU_MODEL, SONNET_MODEL } from '../src/utils/claude-models.mjs';
import { AI_PLANS, MODEL_PRICES, addUsage, aiModelForLeague, emptyUsage, leaguePlan, usageCost } from '../src/utils/ai-plan.mjs';

describe('ai-plan', () => {
  it('runs the custom leagues on Sonnet and everything else on Haiku', () => {
    expect(aiModelForLeague('theleague')).toBe(SONNET_MODEL);
    expect(aiModelForLeague('afl-fantasy')).toBe(SONNET_MODEL);
    for (const slug of ['archies', 'sandbox', 'best-ball-1', 'keeper', 'some-mfl-league', '']) {
      expect(aiModelForLeague(slug)).toBe(HAIKU_MODEL);
    }
  });

  it('gives a signed-out demo visitor the History model, even on a custom league', () => {
    expect(aiModelForLeague('theleague', { guest: true })).toBe(HAIKU_MODEL);
  });

  it('reads only plan values it knows', () => {
    for (const entry of Object.values(LEAGUES) as any[]) {
      if (entry.plan !== undefined) expect(['history', 'custom']).toContain(entry.plan);
      expect(AI_PLANS[leaguePlan(entry.slug)]).toBeTruthy();
    }
  });

  it('has a price for every plan model, and prices a tally', () => {
    for (const plan of Object.values(AI_PLANS)) expect(MODEL_PRICES[plan.model]).toBeTruthy();
    const t = addUsage(emptyUsage(HAIKU_MODEL), { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(usageCost(t)).toBeCloseTo(0.6, 6);
    expect(usageCost(emptyUsage('unknown-model'))).toBeNull();
  });
});
