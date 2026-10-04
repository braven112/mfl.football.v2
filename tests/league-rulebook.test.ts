/**
 * Ask Roger for package leagues answers from two sources (the owner's rule,
 * Oct 2026): the league's written rulebook first, its MFL settings where that
 * is silent — and says which it used. These pin the digest that turns MFL's
 * settings into words, the prompt's source order, and the endpoint gate.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { rulesQaKeysFor, RULES_QA_KEYS } from '../src/config/rules-qa-keys.mjs';
import { mflSettingsDigest } from '../src/utils/mfl-settings-digest.mjs';
import { buildRulesQaPrompt, RULES_PAGE_ANCHORS } from '../src/utils/league-rulebook';

const ROOT = path.resolve(__dirname, '..');
const codes = JSON.parse(readFileSync(path.join(ROOT, 'src/data/mfl-scoring-codes.json'), 'utf8'));
const archiesLeague = JSON.parse(readFileSync(path.join(ROOT, 'data/archies/mfl-feeds/2026/league.json'), 'utf8'));

const RULES = {
  rules: {
    positionRules: [
      {
        positions: { $t: 'WR|RB' },
        rule: [
          { event: { $t: 'CC' }, points: { $t: '*.5' }, range: { $t: '0-99' } },
          { event: { $t: 'PY' }, points: { $t: '*.04' }, range: { $t: '-50-999' } },
        ],
      },
      {
        positions: { $t: 'Def' },
        rule: [{ event: { $t: 'UY' }, points: { $t: '.1/2.5' }, range: { $t: '-50-999' } }],
      },
    ],
  },
};

describe('MFL settings digest', () => {
  const digest = mflSettingsDigest(archiesLeague, RULES, codes);

  it("states the league's settings in words", () => {
    expect(digest).toContain('- Teams: 99');
    expect(digest).toContain('- Roster size: 14');
    expect(digest).toMatch(/Waivers: blind bidding \(FAAB\)/);
    expect(digest).toContain('- Blind-bid budget: $100 per season');
    expect(digest).toContain('- Each NFL player can be rostered once per division');
  });

  it('explains scoring codes, per-unit and ratio points', () => {
    expect(digest).toContain('**WR, RB**');
    expect(digest).toContain('- Receptions (CC): 0.5 per [range 0-99]');
    expect(digest).toContain('- Punt Return Yards (UY): 0.1 per 2.5 [range -50-999]');
  });

  it('names what MFL cannot answer, so Roger does not guess it', () => {
    expect(digest).toMatch(/### Not in the MFL settings[\s\S]*playoff format[\s\S]*payouts/);
  });

  it('is empty with no feeds, and never leaks owner contact fields', () => {
    expect(mflSettingsDigest(null, null, codes)).toBe('');
    expect(digest).not.toMatch(/@|mobileAlerts|email/i);
  });

  it('is stable when MFL reorders a position’s rules', () => {
    const shuffled = structuredClone(RULES);
    shuffled.rules.positionRules[0].rule.reverse();
    expect(mflSettingsDigest(archiesLeague, shuffled, codes)).toBe(digest);
  });
});

describe("Roger's prompt for a package league", () => {
  const league = { name: 'Smith Family League', slug: 'smith' };

  it('puts the rulebook first, MFL settings second, and says which it used', () => {
    const prompt = buildRulesQaPrompt(league, { constitution: 'Rule 1: be nice.', mflSettings: '- Roster size: 14' });
    expect(prompt.indexOf('SOURCE 1 — THE LEAGUE RULEBOOK')).toBeLessThan(prompt.indexOf("SOURCE 2 — THE LEAGUE'S MFL SETTINGS"));
    expect(prompt).toContain('Rule 1: be nice.');
    expect(prompt).toContain('- Roster size: 14');
    expect(prompt).toMatch(/disagree, give both and tell the owner to check with the Commissioner/);
    expect(prompt).toContain(`/smith/rules#${RULES_PAGE_ANCHORS.rulebook}`);
    expect(prompt).toContain(`/smith/rules#${RULES_PAGE_ANCHORS.mflSettings}`);
  });

  it('works with no written rulebook, answering from MFL settings alone', () => {
    const prompt = buildRulesQaPrompt(league, { constitution: '', mflSettings: '- Roster size: 14' });
    expect(prompt).toContain('has not provided a written rulebook yet');
    expect(prompt).toContain('- Roster size: 14');
  });
});

describe('Ask Roger keys and endpoint', () => {
  it("keeps TheLeague's and the AFL's stored-answer keys byte-identical", () => {
    expect(rulesQaKeysFor('theleague')).toBe(RULES_QA_KEYS.theleague);
    expect(rulesQaKeysFor('theleague').answers).toBe('rules-qa:all');
    expect(rulesQaKeysFor('afl-fantasy').answers).toBe('afl-rules-qa:all');
    expect(rulesQaKeysFor('smith').answers).toBe('rules-qa:smith:all');
  });

  it('serves only a package league with the box ticked', async () => {
    const { GET } = await import('../src/pages/api/rules-qa/[league]');
    const call = (league: string) =>
      GET({ params: { league }, request: new Request('http://x.invalid/api/rules-qa/' + league) } as never);
    for (const league of ['theleague', 'afl-fantasy', 'best-ball-1', 'nope']) {
      expect((await call(league)).status, league).toBe(404);
    }
    // Archie's is a package league with "Ask Roger" off.
    expect(LEAGUES.archies.features.rulesQa).toBe(false);
    expect((await call('archies')).status).toBe(404);
  });
});
