/**
 * Former-name callbacks — Schefter nodding to the name a franchise just
 * retired ("Dead Cap Walking, the former Heavy Chevy…").
 *
 * Two things are being locked in here, and they pull in opposite directions:
 *
 *  1. The bit must FIRE — occasionally in the offseason, more often in
 *     preseason and weeks 1–3, for every kind of rename (voluntary or the
 *     AFL's last-place punishments alike).
 *  2. The bit must EXPIRE — hard stop at week 4, and one season only. A
 *     callback to a name nobody remembers isn't a callback, it's confusion.
 *
 * Plus the containment rule that keeps it from becoming a privacy hole: the
 * payload only ever rides on a scope that is already allowed to name the
 * franchise.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore — sibling .mjs module, no .d.ts
import {
  resolveCallbackPhase,
  pickFormerName,
  buildFormerNameCallback,
  CALLBACK_ODDS,
} from '../scripts/lib/schefter-former-name.mjs';
// @ts-ignore — sibling .mjs module, no .d.ts
import { anonymizeTips } from '../scripts/schefter-rumor-scan.mjs';

const at = (d: string) => new Date(`${d}T18:00:00Z`);
/** Labor Day 2026 is Sept 7, so weeks 1–3 run Sept 7 → Sept 27. */
const PRESEASON_2026 = at('2026-08-15');
const OFFSEASON_2026 = at('2026-03-10');
const WEEK_2_2026 = at('2026-09-16');
const WEEK_4_2026 = at('2026-09-28');

/** Real shapes: a voluntary rename and a punitive one, both retired in 2025. */
const DEAD_CAP = {
  name: 'Dead Cap Walking',
  nameShort: 'Dead Cap',
  history: [
    { name: 'Las Vegas Elite', yearStart: 2007, yearEnd: 2017 },
    { name: 'Heavy Chevy', yearStart: 2020, yearEnd: 2025 },
  ],
};
const THE_SHOW = {
  name: 'The Show',
  nameShort: 'The Show',
  history: [
    { name: 'No Frills', yearStart: 2005, yearEnd: 2021 },
    { name: 'Cock Gobbler', yearStart: 2025, yearEnd: 2025, rebrand: { reason: 'last-place' } },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('callback window — phases', () => {
  it('walks offseason → preseason → early-season → closed across 2026', () => {
    expect(resolveCallbackPhase(OFFSEASON_2026).phase).toBe('offseason');
    expect(resolveCallbackPhase(PRESEASON_2026).phase).toBe('preseason');
    expect(resolveCallbackPhase(at('2026-09-07')).phase).toBe('early-season');
    expect(resolveCallbackPhase(WEEK_2_2026).phase).toBe('early-season');
    expect(resolveCallbackPhase(at('2026-09-27')).phase).toBe('early-season');
  });

  it('closes the window at week 4 and never reopens that season', () => {
    expect(resolveCallbackPhase(WEEK_4_2026).phase).toBe('closed');
    expect(resolveCallbackPhase(at('2026-11-15')).phase).toBe('closed');
    expect(resolveCallbackPhase(at('2026-12-31')).phase).toBe('closed');
  });

  it('fires more often in preseason and early season than in the offseason', () => {
    expect(CALLBACK_ODDS.preseason).toBeGreaterThan(CALLBACK_ODDS.offseason);
    expect(CALLBACK_ODDS['early-season']).toBeGreaterThan(CALLBACK_ODDS.offseason);
    expect(CALLBACK_ODDS.offseason).toBeGreaterThan(0);
    expect(CALLBACK_ODDS.closed).toBe(0);
  });
});

describe('callback eligibility — one season, any kind of rename', () => {
  const always = () => 0;

  it('fires for a VOLUNTARY rename (Heavy Chevy → Dead Cap Walking)', () => {
    const out = buildFormerNameCallback(DEAD_CAP, {
      currentName: 'Dead Cap',
      takenNames: new Set(),
      now: PRESEASON_2026,
      rng: always,
    });
    expect(out).toMatchObject({
      current: 'Dead Cap',
      former: 'Heavy Chevy',
      lastSeason: 2025,
      punitive: false,
      phase: 'preseason',
    });
  });

  it('fires for a PUNITIVE rename and flags it as such', () => {
    const out = buildFormerNameCallback(THE_SHOW, {
      currentName: 'The Show',
      takenNames: new Set(),
      now: PRESEASON_2026,
      rng: always,
    });
    expect(out).toMatchObject({ former: 'Cock Gobbler', punitive: true });
  });

  it('goes silent from week 4 on, no matter how the dice land', () => {
    const out = buildFormerNameCallback(DEAD_CAP, {
      currentName: 'Dead Cap',
      takenNames: new Set(),
      now: WEEK_4_2026,
      rng: always,
    });
    expect(out).toBeNull();
  });

  it('covers ONE season only — the 2025 rename is dead to us in 2027', () => {
    const out = buildFormerNameCallback(DEAD_CAP, {
      currentName: 'Dead Cap',
      takenNames: new Set(),
      now: at('2027-08-15'),
      rng: always,
    });
    expect(out).toBeNull();
  });

  it('never reaches past last season, even when that is the only rename', () => {
    // Las Vegas Elite (retired 2017) is a real former name of a real
    // franchise and is still never a callback — the bit is about a rename
    // the league just lived through, not franchise trivia.
    const ancientOnly = { name: 'Dead Cap Walking', history: [DEAD_CAP.history[0]] };
    const out = buildFormerNameCallback(ancientOnly, {
      currentName: 'Dead Cap',
      takenNames: new Set(),
      now: PRESEASON_2026,
      rng: always,
    });
    expect(out).toBeNull();
  });

  it('never reaches back one season too far (a 2024 rename, in 2026)', async () => {
    const twoAgo = { name: 'Dead Cap Walking', history: [{ name: 'Heavy Chevy', yearEnd: 2024 }] };
    for (const now of [OFFSEASON_2026, PRESEASON_2026, WEEK_2_2026]) {
      expect(buildFormerNameCallback(twoAgo, {
        currentName: 'Dead Cap',
        takenNames: new Set(),
        now,
        rng: always,
      })).toBeNull();
    }
  });

  it('respects the dice — a roll above the phase odds produces nothing', () => {
    const opts = { currentName: 'Dead Cap', takenNames: new Set(), now: OFFSEASON_2026 };
    expect(buildFormerNameCallback(DEAD_CAP, { ...opts, rng: () => 0.99 })).toBeNull();
    expect(buildFormerNameCallback(DEAD_CAP, { ...opts, rng: () => 0 })).not.toBeNull();
  });
});

describe('pickFormerName — last season only', () => {
  const LAST = { lastSeason: 2025 };

  it('returns the name worn last season', () => {
    expect(pickFormerName(DEAD_CAP, new Set(), LAST)?.name).toBe('Heavy Chevy');
  });

  it('refuses any name from an earlier season, even with none newer', () => {
    // Las Vegas Elite (retired 2017) is this franchise's most recent rename
    // once Heavy Chevy is out of range — and it is still not a callback.
    // "Most recent" is the wrong question; "last season" is the rule.
    const elite = { name: 'Dead Cap Walking', history: [DEAD_CAP.history[0]] };
    expect(pickFormerName(elite, new Set(), LAST)).toBeNull();
    expect(pickFormerName(DEAD_CAP, new Set(), { lastSeason: 2026 })).toBeNull();
    expect(pickFormerName(DEAD_CAP, new Set(), { lastSeason: 2018 })).toBeNull();
  });

  it('refuses to guess when no season is supplied', () => {
    expect(pickFormerName(DEAD_CAP, new Set())).toBeNull();
    expect(pickFormerName(DEAD_CAP, new Set(), { lastSeason: undefined })).toBeNull();
  });

  it('ignores re-skin rows that repeat the current name', () => {
    // Most franchises carry icon/banner history under their CURRENT name.
    // "The Pigskins, formerly the Pigskins" is the failure this prevents.
    const pigskins = {
      name: 'Pacific Pigskins',
      nameShort: 'Pigskins',
      history: [
        { name: 'Pacific Pigskins', yearStart: 2007, yearEnd: 2012 },
        { name: 'Pacific Pigskins', yearStart: 2013, yearEnd: 2025 },
      ],
    };
    expect(pickFormerName(pigskins, new Set(), LAST)).toBeNull();
  });

  it('ignores a former name another franchise currently wears', () => {
    // "Midwestside Connection" is 0010's old name and 0011's current one —
    // a callback there points at a live team that isn't the subject.
    const jocks = {
      name: 'Computer Jocks',
      history: [{ name: 'Midwestside Connection', yearStart: 2011, yearEnd: 2025 }],
    };
    expect(pickFormerName(jocks, new Set(['midwestside connection']), LAST)).toBeNull();
    expect(pickFormerName(jocks, new Set(), LAST)).not.toBeNull();
  });
});

describe('callback containment — naming-allowed scopes only', () => {
  const teams = new Map<string, any>([
    ['0004', { ...DEAD_CAP, division: 'Northwest', aliases: [] }],
    ['0002', { name: 'Nashville Geeks', nameShort: 'Geeks', division: 'Northwest', aliases: [], history: [] }],
  ]);

  const webTip = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    source: 'web',
    topic: 'roster',
    text: 'Something is up',
    submittedAt: PRESEASON_2026.getTime(),
    ...extra,
  });

  it('attaches the callback on a naming-allowed scope', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const out = await anonymizeTips(
      [webTip('t1', { franchiseHint: '0004' }), webTip('t2', { franchiseHint: '0004' })],
      teams,
      [],
      PRESEASON_2026,
    );
    expect(out[0].scope.kind).toBe('franchise-multi-source');
    expect(out[0].formerName).toMatchObject({ former: 'Heavy Chevy', current: 'Dead Cap' });
  });

  it('withholds it on scopes that must stay anonymous', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // Single web tip, no hashedOwnerId → division fuzz. Naming is off, so the
    // callback must be off too: an old name identifies a franchise just as
    // well as the current one.
    const out = await anonymizeTips(
      [webTip('t1', { franchiseHint: '0004' })],
      teams,
      [],
      PRESEASON_2026,
    );
    expect(out[0].scope.kind).toBe('division');
    expect(out[0].formerName).toBeUndefined();
  });

  it('withholds it when the dice miss, even on a naming-allowed scope', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const out = await anonymizeTips(
      [webTip('t1', { franchiseHint: '0004' }), webTip('t2', { franchiseHint: '0004' })],
      teams,
      [],
      PRESEASON_2026,
    );
    expect(out[0].scope.kind).toBe('franchise-multi-source');
    expect(out[0].formerName).toBeUndefined();
  });

  it('withholds it for a franchise that never renamed', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const out = await anonymizeTips(
      [webTip('t1', { franchiseHint: '0002' }), webTip('t2', { franchiseHint: '0002' })],
      teams,
      [],
      PRESEASON_2026,
    );
    expect(out[0].scope.kind).toBe('franchise-multi-source');
    expect(out[0].formerName).toBeUndefined();
  });

  it('withholds it after the window closes', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const out = await anonymizeTips(
      [
        webTip('t1', { franchiseHint: '0004', submittedAt: WEEK_4_2026.getTime() }),
        webTip('t2', { franchiseHint: '0004', submittedAt: WEEK_4_2026.getTime() }),
      ],
      teams,
      [],
      WEEK_4_2026,
    );
    expect(out[0].scope.kind).toBe('franchise-multi-source');
    expect(out[0].formerName).toBeUndefined();
  });
});

describe('the prompt rule requires the pairing', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
    'utf8',
  );

  it('states rule 30 and forbids the bare former name', () => {
    expect(src).toMatch(/30\. FORMER-NAME CALLBACK/);
    expect(src).toMatch(/MUST appear alongside it/);
    expect(src).toMatch(/FORBIDDEN: "Heavy Chevy are fielding calls\."/);
  });
});
