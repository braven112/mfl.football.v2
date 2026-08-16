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
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
      nameOwners: new Map(),
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
      nameOwners: new Map(),
      now: PRESEASON_2026,
      rng: always,
    });
    expect(out).toMatchObject({ former: 'Cock Gobbler', punitive: true });
  });

  it('goes silent from week 4 on, no matter how the dice land', () => {
    const out = buildFormerNameCallback(DEAD_CAP, {
      currentName: 'Dead Cap',
      nameOwners: new Map(),
      now: WEEK_4_2026,
      rng: always,
    });
    expect(out).toBeNull();
  });

  it('covers ONE season only — the 2025 rename is dead to us in 2027', () => {
    const out = buildFormerNameCallback(DEAD_CAP, {
      currentName: 'Dead Cap',
      nameOwners: new Map(),
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
      nameOwners: new Map(),
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
        nameOwners: new Map(),
        now,
        rng: always,
      })).toBeNull();
    }
  });

  it('respects the dice — a roll above the phase odds produces nothing', () => {
    const opts = { currentName: 'Dead Cap', nameOwners: new Map(), now: OFFSEASON_2026 };
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

  it('ignores a former name ANOTHER franchise currently wears', () => {
    // "Midwestside Connection" is 0010's old name and 0011's current one —
    // a callback there points at a live team that isn't the subject.
    const jocks = {
      franchiseId: '0010',
      name: 'Computer Jocks',
      history: [{ name: 'Midwestside Connection', yearStart: 2011, yearEnd: 2025 }],
    };
    const owners = new Map([['midwestside connection', new Set(['0011'])]]);
    expect(pickFormerName(jocks, owners, { ...LAST, franchiseId: '0010' })).toBeNull();
    expect(pickFormerName(jocks, new Map(), { ...LAST, franchiseId: '0010' })).not.toBeNull();
  });

  it('does NOT let a franchise\'s OWN leftover alias suppress its own rename', () => {
    // The regression: AFL 0014 renamed Thundering Herd -> A Bruin Pegs Me and
    // kept "Thundering Herd" in its own `aliases` so people can still search
    // by it — which is the documented convention. A flat set of taken names
    // can't tell that apart from another team owning the name, so 0014's
    // callback vanished: the league's current punitive rename, silently
    // ineligible while two quieter renames worked.
    const bruin = {
      franchiseId: '0014',
      name: 'A Bruin Pegs Me',
      nameShort: 'Pegs Me',
      aliases: ['Pegs Me', 'Bruin', 'Thundering Herd', 'Herd'],
      history: [{ name: 'Thundering Herd', yearStart: 2007, yearEnd: 2025 }],
    };
    const owners = new Map([['thundering herd', new Set(['0014'])], ['herd', new Set(['0014'])]]);
    expect(pickFormerName(bruin, owners, { ...LAST, franchiseId: '0014' })?.name)
      .toBe('Thundering Herd');
  });

  it('still blocks when the name is shared with another team', () => {
    const bruin = {
      franchiseId: '0014',
      name: 'A Bruin Pegs Me',
      aliases: ['Thundering Herd'],
      history: [{ name: 'Thundering Herd', yearStart: 2007, yearEnd: 2025 }],
    };
    const owners = new Map([['thundering herd', new Set(['0014', '0009'])]]);
    expect(pickFormerName(bruin, owners, { ...LAST, franchiseId: '0014' })).toBeNull();
  });

  it('normalizes case in the Set/array fallback shape', () => {
    // The fallback lower-cases the name it is testing but used to compare it
    // against raw Set values, so a Set of display-cased names silently matched
    // nothing — quietly re-enabling callbacks to names a live franchise owns.
    const jocks = {
      franchiseId: '0010',
      name: 'Computer Jocks',
      history: [{ name: 'Midwestside Connection', yearEnd: 2025 }],
    };
    const opts = { lastSeason: 2025, franchiseId: '0010' };
    expect(pickFormerName(jocks, new Set(['Midwestside Connection']), opts)).toBeNull();
    expect(pickFormerName(jocks, new Set(['midwestside connection']), opts)).toBeNull();
    expect(pickFormerName(jocks, ['Midwestside Connection'], opts)).toBeNull();
    expect(pickFormerName(jocks, new Set(), opts)).not.toBeNull();
  });

  it('refuses a non-integer lastSeason rather than coercing', () => {
    expect(pickFormerName(DEAD_CAP, new Map(), { lastSeason: '2025' as never })).toBeNull();
    expect(pickFormerName(DEAD_CAP, new Map(), { lastSeason: NaN })).toBeNull();
    expect(pickFormerName(DEAD_CAP, new Map(), { lastSeason: 2025.5 })).toBeNull();
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

describe('real configs — every last-season rename is actually reachable', () => {
  // The 0014 bug was invisible in unit tests because it only appeared with a
  // real config's leftover aliases. This walks both live configs and asserts
  // that every franchise whose history closes at last season can produce a
  // callback — so a franchise going silently ineligible fails here rather
  // than just quietly never firing.

  for (const [label, configPath] of [
    ['theleague', 'src/data/theleague.config.json'],
    ['afl-fantasy', 'data/afl-fantasy/afl.config.json'],
  ] as const) {
    it(`${label}: no last-season rename is suppressed by its own aliases`, () => {
      const raw = JSON.parse(readFileSync(path.join(process.cwd(), configPath), 'utf8'));
      const owners = new Map<string, Set<string>>();
      const claim = (v: unknown, fid: string) => {
        if (typeof v !== 'string' || v.trim().length < 2) return;
        const k = v.trim().toLowerCase();
        if (!owners.has(k)) owners.set(k, new Set());
        owners.get(k)!.add(fid);
      };
      for (const t of raw.teams ?? []) {
        for (const f of ['name', 'nameMedium', 'nameShort', 'abbrev']) claim(t[f], t.franchiseId);
        for (const a of t.aliases ?? []) claim(a, t.franchiseId);
      }

      const currentForms = (t: any) => new Set(
        ['name', 'nameMedium', 'nameShort', 'abbrev']
          .map((f) => t[f])
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim().toLowerCase()),
      );

      const suppressed: string[] = [];
      for (const t of raw.teams ?? []) {
        // A genuine rename: history closes at 2025 under a name the team no
        // longer uses. (Re-skin rows repeating the current name don't count.)
        const own = currentForms(t);
        const renamed = (t.history ?? []).some(
          (h: any) => h?.yearEnd === 2025
            && typeof h.name === 'string'
            && !own.has(h.name.trim().toLowerCase()),
        );
        if (!renamed) continue;
        const got = pickFormerName(t, owners, { lastSeason: 2025, franchiseId: t.franchiseId });
        if (!got) suppressed.push(`${t.franchiseId} ${t.name}`);
      }
      expect(suppressed).toEqual([]);
    });
  }
});

describe('the prompt rule requires the pairing', () => {
  const src = readFileSync(
    path.join(process.cwd(), 'scripts/schefter-rumor-scan.mjs'),
    'utf8',
  );

  it('states rule 30 and forbids the bare former name', () => {
    expect(src).toMatch(/30\. FORMER-NAME CALLBACK/);
    expect(src).toMatch(/MUST appear alongside it/);
    expect(src).toMatch(/FORBIDDEN: "Dockside Dynamos are fielding calls\."/);
  });

  it('uses INVENTED names in its examples, never real franchises', () => {
    // The prompt is a leak path the payload redaction cannot reach: it is
    // built once and sent on EVERY call, including anonymous-scope posts. The
    // first draft of rule 30 hardcoded "Dead Cap Walking / Heavy Chevy" and
    // "The Show / Cock Gobbler" — real teams, paired with their real former
    // names, one of them a punishment. That handed the model the exact
    // association the whole feature is gated on, for teams that may be out of
    // window, on posts not allowed to name anyone.
    //
    // Rule 30 was not the only offender, which is why this scans the WHOLE
    // HARD RULES block rather than one rule: 4b's explicit-pick examples ran
    // on "[Geeks]" (0013's own alias) a dozen times over, and 15/16 addressed
    // a GroupMe author as "Dead Cap" (0004's nameShort). Same category, same
    // always-sent prompt — a real team named in every call Schefter makes.
    // Any new rule that reaches for a concrete team name fails here too.
    const hardRules = src.slice(
      src.indexOf('HARD RULES (self-enforce, never violate):'),
      src.indexOf('Voice: "League sources tell me'),
    );
    // Both anchors must still resolve — a renamed heading that silently
    // shrinks the scanned region to nothing would leave this test green while
    // guarding nothing at all.
    expect(hardRules).toContain('4b. If a web tip\'s scope is "franchise-explicit-pick"');
    expect(hardRules).toContain('30. FORMER-NAME CALLBACK');

    // Harvest every form a franchise answers to, not just its display name —
    // an alias or a retired name identifies a team just as well (same reason
    // redactFranchiseNamesInText harvests history[] and aliases[]). The >= 4
    // floor keeps abbreviations like "GG" from matching prose; at the time of
    // writing this pulls ~300 forms across the two leagues and produces zero
    // false positives, so a hit here is a real name, not a coincidence.
    const realNames = new Set<string>();
    const claim = (v: unknown) => {
      if (typeof v === 'string' && v.trim().length >= 4) realNames.add(v.trim());
    };
    for (const cfgPath of ['src/data/theleague.config.json', 'data/afl-fantasy/afl.config.json']) {
      const cfg = JSON.parse(readFileSync(path.join(process.cwd(), cfgPath), 'utf8'));
      for (const t of cfg.teams ?? []) {
        for (const f of ['name', 'nameMedium', 'nameShort', 'abbrev'] as const) claim(t[f]);
        for (const a of t.aliases ?? []) claim(a);
        for (const h of t.history ?? []) {
          for (const f of ['name', 'nameMedium', 'nameShort', 'abbrev'] as const) claim(h?.[f]);
        }
      }
    }
    expect(realNames.size).toBeGreaterThan(100);

    const hardcoded = [...realNames].filter((n) => hardRules.includes(n));
    expect(hardcoded).toEqual([]);
  });
});
