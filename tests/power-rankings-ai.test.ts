import { describe, it, expect } from 'vitest';
// @ts-expect-error — sibling .mjs module, no .d.ts
import {
  validateBlurb,
  applyAIVoice,
  buildFactSheet,
  HEADLINE_MAX,
  LEDE_MAX,
  BLURB_MAX,
// @ts-expect-error — sibling .mjs module, no .d.ts
} from '../scripts/lib/power-rankings-ai.mjs';

const pigskins = {
  franchiseId: '0001',
  name: 'Pacific Pigskins',
  nameMedium: 'Pigskins',
  nameShort: 'Pigskins',
  abbrev: 'SKINS',
  aliases: ['Skins', 'Pigs'],
};
const dangsters = {
  franchiseId: '0002',
  name: 'Da Dangsters',
  nameMedium: 'Da Dangsters',
  nameShort: 'Dangsters',
  abbrev: 'DANG',
};

describe('validateBlurb', () => {
  it('passes a clean blurb that names the franchise', () => {
    const errs = validateBlurb('Pigskins riding a 4-game heater into Week 5.', { franchise: pigskins });
    expect(errs).toEqual([]);
  });

  it('rejects empty/missing text', () => {
    expect(validateBlurb('')).toEqual(['empty']);
    expect(validateBlurb(null as any)).toEqual(['empty']);
    expect(validateBlurb('   ')).toEqual(['empty']);
  });

  it('rejects banned phrases (case-insensitive)', () => {
    const errs = validateBlurb('As an AI, I think the Pigskins look strong.', { franchise: pigskins });
    expect(errs.some(e => e.includes('banned phrase'))).toBe(true);
  });

  it('rejects curly quotes', () => {
    const errs = validateBlurb('Pigskins “rolling” into Week 5.', { franchise: pigskins });
    expect(errs).toContain('curly quote');
  });

  it('rejects markdown fences', () => {
    const errs = validateBlurb('Pigskins ```rolling``` into Week 5.', { franchise: pigskins });
    expect(errs).toContain('markdown fence');
  });

  it('rejects when blurb does not name the target franchise', () => {
    const errs = validateBlurb('Da Dangsters riding a 4-game heater.', { franchise: pigskins });
    expect(errs).toContain('does not name this franchise');
  });

  it('accepts an alias as a franchise mention', () => {
    const errs = validateBlurb('The Pigs are riding a 4-game heater.', { franchise: pigskins });
    expect(errs).toEqual([]);
  });

  it('enforces length cap', () => {
    const long = 'Pigskins ' + 'x'.repeat(BLURB_MAX);
    const errs = validateBlurb(long, { franchise: pigskins });
    expect(errs.some(e => e.startsWith('too long'))).toBe(true);
  });

  it('uses a different cap for headlines', () => {
    const headline = 'Pigskins surge to #1 entering Week 5'.padEnd(HEADLINE_MAX + 5, '!');
    const errs = validateBlurb(headline, { maxLength: HEADLINE_MAX });
    expect(errs.some(e => e.startsWith('too long'))).toBe(true);
  });
});

describe('applyAIVoice', () => {
  const teams = new Map<string, any>([
    ['0001', pigskins],
    ['0002', dangsters],
  ]);

  const issue = {
    year: 2025,
    week: 14,
    headline: 'Pigskins hold #1',
    lede: 'Templated lede.',
    rankings: [
      { rank: 1, franchiseId: '0001', blurb: 'TEMPLATED Pigskins blurb.', metrics: {}, previousRank: 1, trend: 'flat' },
      { rank: 2, franchiseId: '0002', blurb: 'TEMPLATED Dangsters blurb.', metrics: {}, previousRank: 2, trend: 'flat' },
    ],
    awards: {
      statOfWeek: { franchiseId: '0001', title: 'Stat of the Week', blurb: 'Pigskins dropped 150.', metric: { score: 150 } },
      benchBlunder: null,
    },
  } as any;

  it('applies all valid AI blurbs and reports counts', () => {
    const aiOutput = {
      headline: 'Pigskins keep their grip on #1',
      lede: 'Pigskins are not relinquishing the throne.',
      blurbs: {
        '0001': 'Pigskins riding a 4-game heater. Boom.',
        '0002': 'Da Dangsters need a spark, sources tell me.',
      },
      awardBlurbs: {
        statOfWeek: 'Pigskins crushed the league with a 150 burst.',
      },
    };
    const { issue: out, report } = applyAIVoice(issue, aiOutput, teams);
    expect(out.headline).toBe('Pigskins keep their grip on #1');
    expect(out.lede).toBe('Pigskins are not relinquishing the throne.');
    expect(out.rankings[0].blurb).toBe('Pigskins riding a 4-game heater. Boom.');
    expect(out.rankings[1].blurb).toBe('Da Dangsters need a spark, sources tell me.');
    expect(out.awards.statOfWeek.blurb).toBe('Pigskins crushed the league with a 150 burst.');
    expect(report.headline).toBe('ai');
    expect(report.lede).toBe('ai');
    expect(report.blurbs.applied).toBe(2);
    expect(report.blurbs.fallback).toBe(0);
    expect(report.awardBlurbs.applied).toBe(1);
  });

  it('falls back per-blurb when validation fails', () => {
    const aiOutput = {
      headline: 'Pigskins hold #1',
      lede: 'Templated lede.',
      blurbs: {
        '0001': 'Random Team Name riding a heater.', // no franchise mention
        '0002': 'As an AI, I see strength here.',     // banned phrase
      },
      awardBlurbs: {},
    };
    const { issue: out, report } = applyAIVoice(issue, aiOutput, teams);
    expect(out.rankings[0].blurb).toBe('TEMPLATED Pigskins blurb.');
    expect(out.rankings[1].blurb).toBe('TEMPLATED Dangsters blurb.');
    expect(report.blurbs.applied).toBe(0);
    expect(report.blurbs.fallback).toBe(2);
    expect(report.blurbs.fails).toHaveLength(2);
  });

  it('does not crash when AI returns nothing', () => {
    const { issue: out, report } = applyAIVoice(issue, {}, teams);
    expect(out.headline).toBe('Pigskins hold #1');
    expect(out.rankings[0].blurb).toBe('TEMPLATED Pigskins blurb.');
    expect(report.blurbs.applied).toBe(0);
  });

  it('skips null awards in the input issue', () => {
    const aiOutput = {
      awardBlurbs: {
        benchBlunder: 'Should be ignored — issue has null benchBlunder.',
      },
    };
    const { issue: out } = applyAIVoice(issue, aiOutput, teams);
    expect(out.awards.benchBlunder).toBeNull();
  });
});

describe('buildFactSheet', () => {
  const teams = new Map<string, any>([
    ['0001', pigskins],
    ['0002', dangsters],
  ]);
  const issue = {
    year: 2025,
    week: 14,
    rankings: [
      {
        rank: 1, franchiseId: '0001', previousRank: 5, trend: 'up',
        metrics: { rolling3Ppg: 132.5, seasonPpg: 118.0 },
        factsForBlurb: { last3Record: { wins: 3, losses: 0, ties: 0 }, streak: { type: 'W', length: 4 } },
      },
      {
        rank: 2, franchiseId: '0002', previousRank: 1, trend: 'down',
        metrics: { rolling3Ppg: 110.0, seasonPpg: 117.2 },
        factsForBlurb: { last3Record: { wins: 1, losses: 2, ties: 0 }, streak: { type: 'L', length: 1 } },
      },
    ],
    awards: {
      statOfWeek: { franchiseId: '0001', title: 'Stat of the Week', blurb: 'Pigskins dropped 150.', metric: { score: 150 } },
    },
  } as any;

  it('includes rankings with trend, record, ppg, and streak', () => {
    const sheet = buildFactSheet({ issue, teams });
    expect(sheet).toContain('#1 | Pigskins');
    expect(sheet).toContain('up 4 (was #5)');
    expect(sheet).toContain('3-0 L3');
    expect(sheet).toContain('132.5 PPG L3');
    expect(sheet).toContain('W4');
    expect(sheet).toContain('#2 | Da Dangsters');
    expect(sheet).toContain('down 1 (was #1)');
  });

  it('includes the allowed franchise tokens block', () => {
    const sheet = buildFactSheet({ issue, teams });
    expect(sheet).toContain('ALLOWED FRANCHISE NAME TOKENS');
    expect(sheet).toContain('Pacific Pigskins');
    expect(sheet).toContain('Pigskins, Pigskins, SKINS, Skins, Pigs');
  });

  it('renders awards with their raw blurbs and metrics', () => {
    const sheet = buildFactSheet({ issue, teams });
    expect(sheet).toContain('statOfWeek: Stat of the Week — Pigskins');
    expect(sheet).toContain('raw: Pigskins dropped 150.');
    expect(sheet).toContain('"score":150');
  });
});
