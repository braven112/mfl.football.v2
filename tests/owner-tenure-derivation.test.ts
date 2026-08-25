/**
 * Owner-tenure derivation — unit tests on inline fixtures.
 *
 * Each case below is a real slot whose shape broke, or would break, a naive
 * segmentation. They are inlined (the `tests/franchise-history.test.ts`
 * convention) so they keep testing the RULE after the league config changes.
 *
 * What no test here can check: whether two adjacent identities were really the
 * same person. Nothing in the data says so. That is what the registry is for,
 * and the registry-override cases at the bottom are how a human says it.
 */
import { describe, it, expect } from 'vitest';
import {
  inferCurrentOwnerSince,
  buildAttributor,
  entriesShareTenure,
  segmentSlotTenures,
  dominantIdentity,
  identityTitle,
  isPunitiveEntry,
  indexRegistryClaims,
  buildOwnerTenures,
  kebab,
} from '../src/utils/owner-tenures.mjs';

// ── Fixtures ───────────────────────────────────────────────────────────────

/** TheLeague 0004 — four distinct owners, no ownerEra, no rebrands. */
const SLOT_0004 = {
  franchiseId: '0004',
  name: 'Dead Cap Walking',
  currentOwnerSince: 2026,
  history: [
    { name: 'Las Vegas Elite', yearStart: 2007, yearEnd: 2017 },
    { name: 'The Art of War', yearStart: 2018, yearEnd: 2018 },
    { name: 'Drunk Indians', yearStart: 2019, yearEnd: 2019 },
    { name: 'Heavy Chevy', yearStart: 2020, yearEnd: 2025 },
  ],
};

/** TheLeague 0003 — ownerEra collapses three aliases into one tenure. */
const SLOT_0003 = {
  franchiseId: '0003',
  name: 'Maverick',
  history: [
    { name: 'Mistakes Were Made', yearStart: 2007, yearEnd: 2009 },
    { name: 'Georgia Punishers', yearStart: 2010, yearEnd: 2011 },
    { name: 'Poker in the Rear', yearStart: 2012, yearEnd: 2013, ownerEra: 1 },
    { name: 'Generals', yearStart: 2014, yearEnd: 2014, ownerEra: 1 },
    { name: 'Poker in the Rear', yearStart: 2015, yearEnd: 2015, ownerEra: 1 },
    { name: 'Maverick', yearStart: 2016, yearEnd: 2024 },
  ],
};

/** AFL 0016 — the punitive bridge. Only 2020 carries the rebrand group. */
const SLOT_0016 = {
  franchiseId: '0016',
  name: 'Swiftie 4 Life',
  history: [
    { name: 'Dicks out for Harambe', yearStart: 2017, yearEnd: 2018 },
    { name: "Be Gentle! It's my first time.", yearStart: 2019, yearEnd: 2019 },
    {
      name: "Be Rough! I'm used to it.",
      yearStart: 2020,
      yearEnd: 2020,
      rebrand: { reason: 'last-place', group: 'be-rough' },
    },
    { name: "Be Gentle. It's my first time.", yearStart: 2021, yearEnd: 2021 },
    { name: 'Silver Bullets', yearStart: 2022, yearEnd: 2022 },
  ],
};

/** AFL 0007 — a punitive entry SIX YEARS after the previous one. Must not bridge. */
const SLOT_0007 = {
  franchiseId: '0007',
  name: 'Avenging Amish',
  history: [
    { name: 'Touchdown My Pants', yearStart: 2010, yearEnd: 2013 },
    { name: 'Team Murderface', yearStart: 2014, yearEnd: 2014 },
    {
      name: "Vit's Brother",
      yearStart: 2021,
      yearEnd: 2021,
      rebrand: { reason: 'last-place', group: 'avenging-amish-repeat' },
    },
  ],
};

const feedNames: Record<string, string> = {
  '0007|2015': 'Avenging Amish',
  '0007|2016': 'Avenging Amish',
  '0007|2017': 'Avenging Amish',
  '0007|2018': 'Avenging Amish',
  '0007|2019': 'Avenging Amish',
  '0007|2020': 'Avenging Amish',
};
const feedIdentityFor = (franchiseId: string, year: number) => {
  const name = feedNames[`${franchiseId}|${year}`];
  return name ? { name, icon: null, banner: null } : null;
};

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const titles = (groups: any[]) => groups.map((g) => identityTitle(g.identities));
const spans = (groups: any[]) =>
  groups.map((g) => `${g.years[0]}-${g.years[g.years.length - 1]}`);

// ── The ownership boundary ─────────────────────────────────────────────────

describe('inferCurrentOwnerSince', () => {
  it('honours an explicit currentOwnerSince above everything else', () => {
    expect(inferCurrentOwnerSince(SLOT_0004)).toBe(2026);
  });

  it('uses the earliest ownerHistory yearStart when one exists', () => {
    const team = {
      franchiseId: '0011',
      name: 'Midwestside Connection',
      ownerHistory: [
        { franchiseId: '0010', yearStart: 2011, yearEnd: 2015 },
        { franchiseId: '0011', yearStart: 2019, yearEnd: 9999 },
      ],
      history: [{ name: 'Amish Rakefighters', yearStart: 2007, yearEnd: 2015 }],
    };
    expect(inferCurrentOwnerSince(team)).toBe(2011);
  });

  it('walks back through consecutive same-name entries', () => {
    const team = {
      franchiseId: '0010',
      name: 'Computer Jocks',
      history: [
        { name: 'Witch City Warlocks', yearStart: 2007, yearEnd: 2010 },
        { name: 'Midwestside Connection', yearStart: 2011, yearEnd: 2015 },
        { name: 'Computer Jocks', yearStart: 2016, yearEnd: 2024 },
      ],
    };
    expect(inferCurrentOwnerSince(team)).toBe(2016);
  });

  /**
   * The `sameEra` clause. `src/utils/afl-awards.ts:198` walks back on NAME
   * only and is missing this — they agree today solely because `ownerEra`
   * exists on one TheLeague slot that afl-awards never reads (trap 3).
   */
  it('walks back through an ownerEra run even when the names differ', () => {
    const team = {
      franchiseId: '0003',
      name: 'Poker in the Rear',
      history: [
        { name: 'Georgia Punishers', yearStart: 2010, yearEnd: 2011 },
        { name: 'Poker in the Rear', yearStart: 2012, yearEnd: 2013, ownerEra: 1 },
        { name: 'Generals', yearStart: 2014, yearEnd: 2014, ownerEra: 1 },
        { name: 'Poker in the Rear', yearStart: 2015, yearEnd: 2015, ownerEra: 1 },
      ],
    };
    // Without the sameEra clause this stops at 2015 and loses three seasons.
    expect(inferCurrentOwnerSince(team)).toBe(2012);
  });

  it('starts the current owner after the last entry when no name matches', () => {
    expect(inferCurrentOwnerSince(SLOT_0007)).toBe(2022);
  });

  it('returns null when there is no history at all — every year is the current owner’s', () => {
    expect(inferCurrentOwnerSince({ franchiseId: '0002', name: 'Drunk Indians' })).toBeNull();
  });
});

describe('attributeSeason', () => {
  const teams = [
    {
      franchiseId: '0010',
      name: 'Computer Jocks',
      history: [
        { name: 'Witch City Warlocks', yearStart: 2007, yearEnd: 2010 },
        { name: 'Midwestside Connection', yearStart: 2011, yearEnd: 2015 },
        { name: 'Computer Jocks', yearStart: 2016, yearEnd: 2024 },
      ],
    },
    {
      franchiseId: '0011',
      name: 'Midwestside Connection',
      ownerHistory: [
        { franchiseId: '0010', yearStart: 2011, yearEnd: 2015 },
        { franchiseId: '0011', yearStart: 2019, yearEnd: 9999 },
      ],
      history: [{ name: 'Amish Rakefighters', yearStart: 2007, yearEnd: 2015 }],
    },
  ];
  const { attributeSeason } = buildAttributor(teams);

  it('drops a former owner’s seasons — the behaviour this whole feature exists for', () => {
    expect(attributeSeason('0010', 2007)).toBeNull();
    expect(attributeSeason('0010', 2010)).toBeNull();
  });

  it('lets a cross-slot ownerHistory claim win', () => {
    expect(attributeSeason('0010', 2011)).toBe('0011');
    expect(attributeSeason('0010', 2015)).toBe('0011');
  });

  it('keeps the current owner’s own seasons', () => {
    expect(attributeSeason('0010', 2016)).toBe('0010');
  });

  it('drops a year the slot’s own ownerHistory does not cover', () => {
    // 0011's owner held 0011 from 2019; 2007-2018 on that slot is somebody else.
    expect(attributeSeason('0011', 2012)).toBeNull();
    expect(attributeSeason('0011', 2019)).toBe('0011');
  });
});

// ── Bridging rules ─────────────────────────────────────────────────────────

describe('entriesShareTenure', () => {
  it('bridges on a shared ownerEra', () => {
    expect(entriesShareTenure(SLOT_0003.history[2], SLOT_0003.history[3])).toBe(true);
  });

  it('bridges on the same normalized name', () => {
    expect(
      entriesShareTenure(
        { name: 'The Warlocks', yearStart: 2007, yearEnd: 2008 },
        { name: 'warlocks', yearStart: 2009, yearEnd: 2010 }
      )
    ).toBe(true);
  });

  it('bridges on a shared rebrand group', () => {
    expect(
      entriesShareTenure(
        { name: "Vit's Brother", yearStart: 2021, yearEnd: 2021, rebrand: { reason: 'last-place', group: 'g' } },
        { name: 'Broke Back', yearStart: 2023, yearEnd: 2023, rebrand: { reason: 'last-place', group: 'g' } }
      )
    ).toBe(true);
  });

  it('bridges a punitive rename that is year-adjacent, in both directions', () => {
    const [, gentle, rough, gentleAgain] = SLOT_0016.history;
    expect(entriesShareTenure(gentle, rough)).toBe(true);
    expect(entriesShareTenure(rough, gentleAgain)).toBe(true);
  });

  /** The load-bearing clause. Without adjacency this returns true and eats a tenure. */
  it('does NOT bridge a punitive rename across a multi-year gap', () => {
    const murderface = SLOT_0007.history[1]; // 2014
    const vits = SLOT_0007.history[2]; // 2021, punitive
    expect(entriesShareTenure(murderface, vits)).toBe(false);
  });

  it('does not bridge two unrelated adjacent names', () => {
    expect(entriesShareTenure(SLOT_0004.history[1], SLOT_0004.history[2])).toBe(false);
  });

  it('reads punitive off the rebrand reason, not a flag', () => {
    expect(isPunitiveEntry(SLOT_0016.history[2])).toBe(true);
    expect(isPunitiveEntry(SLOT_0016.history[1])).toBe(false);
    expect(isPunitiveEntry(undefined)).toBe(false);
  });
});

// ── Segmentation ───────────────────────────────────────────────────────────

describe('segmentSlotTenures', () => {
  it('splits TheLeague 0004 into four tenures', () => {
    const groups = segmentSlotTenures({
      team: SLOT_0004,
      years: range(2007, 2025),
      feedIdentityFor: null,
    });
    expect(titles(groups)).toEqual([
      'Las Vegas Elite',
      'The Art of War',
      'Drunk Indians',
      'Heavy Chevy',
    ]);
    expect(spans(groups)).toEqual(['2007-2017', '2018-2018', '2019-2019', '2020-2025']);
  });

  it('collapses 0003’s ownerEra run into ONE tenure spanning 2012-2015', () => {
    const groups = segmentSlotTenures({
      team: SLOT_0003,
      years: range(2007, 2015),
      feedIdentityFor: null,
    });
    expect(spans(groups)).toEqual(['2007-2009', '2010-2011', '2012-2015']);
    expect(titles(groups)[2]).toBe('Poker in the Rear / Generals');
  });

  it('bridges AFL 0016’s Be Gentle! / Be Rough! / Be Gentle. into one tenure', () => {
    const groups = segmentSlotTenures({
      team: SLOT_0016,
      years: range(2019, 2021),
      feedIdentityFor: null,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].years).toEqual([2019, 2020, 2021]);
    expect(titles(groups)[0]).toBe(
      "Be Gentle! It's my first time. / Be Rough! I'm used to it. / Be Gentle. It's my first time."
    );
  });

  it('does NOT let AFL 0007’s punitive 2021 entry swallow the 2014-2020 tenure', () => {
    const groups = segmentSlotTenures({
      team: SLOT_0007,
      years: range(2010, 2021),
      feedIdentityFor,
    });
    expect(spans(groups)).toEqual(['2010-2013', '2014-2020', '2021-2021']);
  });

  it('fills a gap year from the MFL feed and marks it inferred', () => {
    const groups = segmentSlotTenures({
      team: SLOT_0007,
      years: range(2014, 2020),
      feedIdentityFor,
    });
    expect(groups).toHaveLength(1);
    const [murderface, amish] = groups[0].identities;
    expect(murderface.name).toBe('Team Murderface');
    expect(murderface.inferredFromFeed).toBe(false);
    // The only way to name 2015-2020 at all.
    expect(amish.name).toBe('Avenging Amish');
    expect(amish.inferredFromFeed).toBe(true);
    expect(amish.yearStart).toBe(2015);
    expect(amish.yearEnd).toBe(2020);
  });

  it('handles a slot with no history at all — one tenure, all feed-named', () => {
    const groups = segmentSlotTenures({
      team: { franchiseId: '0002', name: 'Drunk Indians', history: [] },
      years: [2003, 2004, 2005],
      feedIdentityFor: () => ({ name: 'Drunk Indians', icon: null, banner: null }),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].identities).toHaveLength(1);
    expect(groups[0].identities[0].inferredFromFeed).toBe(true);
  });

  it('returns nothing for a slot with no years', () => {
    expect(segmentSlotTenures({ team: SLOT_0004, years: [], feedIdentityFor: null })).toEqual([]);
  });

  /**
   * A gap-filled year must never become the bridging reference — otherwise a
   * feed name decides whether the next real entry continues the tenure.
   */
  it('bridges against the last REAL entry, not an intervening gap-filled year', () => {
    const groups = segmentSlotTenures({
      team: SLOT_0007,
      years: range(2014, 2021),
      feedIdentityFor,
    });
    expect(spans(groups)).toEqual(['2014-2020', '2021-2021']);
  });
});

describe('segmentSlotTenures artwork', () => {
  /**
   * The sibling of the `buildTenuresFromRows` fold: two adjacent history
   * entries can share a name and differ only in artwork (TheLeague's 0001,
   * 0008 and 0015 all do), so a run assembled from them must not keep the
   * first entry's retired look. A gap-filled year is the exception — its icon
   * is the MFL feed's guess, not a curated choice.
   */
  const slot = (history: any[]) => ({ franchiseId: '0001', name: 'Pacific Pigskins', history });

  it('takes the newest entry of a same-name run', () => {
    const groups = segmentSlotTenures({
      team: slot([
        { name: 'Pacific Pigskins', yearStart: 2007, yearEnd: 2012, icon: '/assets/theleague/history/pigskins_2007.png' },
        { name: 'Pacific Pigskins', yearStart: 2013, yearEnd: 2016, icon: '/assets/theleague/history/pigskins_2013.png' },
      ]),
      years: [2007, 2012, 2013, 2016],
      feedIdentityFor: null,
    });
    expect(groups[0].identities).toHaveLength(1);
    // Cast: `segmentSlotTenures` is untyped .mjs, so an empty-literal fixture
    // narrows `identities` to `never[]`.
    expect((groups[0].identities[0] as any).icon).toBe('/assets/theleague/history/pigskins_2013.png');
  });

  it('does not let a gap-filled feed icon overwrite curated artwork', () => {
    const groups = segmentSlotTenures({
      team: slot([
        { name: 'Pacific Pigskins', yearStart: 2007, yearEnd: 2012, icon: '/assets/theleague/history/pigskins_2007.png' },
      ]),
      years: [2007, 2012, 2013],
      // 2013 has no covering entry, so it gap-fills from the feed.
      feedIdentityFor: () => ({ name: 'Pacific Pigskins', icon: 'https://mfl.example/dead.gif', banner: null }),
    });
    expect((groups[0].identities[0] as any).icon).toBe('/assets/theleague/history/pigskins_2007.png');
  });
});

describe('dominantIdentity', () => {
  it('picks the identity with the most seasons', () => {
    const groups = segmentSlotTenures({
      team: SLOT_0007,
      years: range(2014, 2020),
      feedIdentityFor,
    });
    expect(dominantIdentity(groups[0].identities)?.name).toBe('Avenging Amish');
  });

  it('never titles a tenure with a one-season punitive rename', () => {
    const groups = segmentSlotTenures({
      team: SLOT_0016,
      years: range(2019, 2021),
      feedIdentityFor: null,
    });
    expect(dominantIdentity(groups[0].identities)?.name).not.toBe("Be Rough! I'm used to it.");
  });
});

describe('kebab', () => {
  it('produces URL-safe segments', () => {
    expect(kebab('Witch City Warlocks')).toBe('witch-city-warlocks');
    expect(kebab("Be Gentle! It's my first time.")).toBe('be-gentle-it-s-my-first-time');
    expect(kebab('Guns & Roses')).toBe('guns-and-roses');
  });

  it('never returns an empty segment', () => {
    expect(kebab('')).toBe('owner');
    expect(kebab('!!!')).toBe('owner');
  });
});

// ── Registry overlay ───────────────────────────────────────────────────────

describe('indexRegistryClaims', () => {
  const registry = {
    version: 1,
    people: [
      {
        id: 'own-0006',
        slug: 'witch-city-warlocks-2007',
        claims: [{ league: 'theleague', franchiseId: '0010', yearStart: 2007, yearEnd: 2010 }],
      },
    ],
  };

  it('indexes each claimed season', () => {
    const index = indexRegistryClaims(registry, 'theleague');
    expect(index.get('0010|2007')?.map((h: any) => h.person.id)).toEqual(['own-0006']);
    expect(index.get('0010|2010')?.map((h: any) => h.person.id)).toEqual(['own-0006']);
    expect(index.get('0010|2011')).toBeUndefined();
  });

  it('ignores claims belonging to another league', () => {
    expect(indexRegistryClaims(registry, 'afl-fantasy').size).toBe(0);
  });

  it('allows two people on one season when BOTH claims say shared', () => {
    const coOwned = {
      version: 1,
      people: [
        {
          id: 'own-0100',
          slug: 'a',
          claims: [
            { league: 'theleague', franchiseId: '0014', yearStart: 2018, yearEnd: 9999, shared: true },
          ],
        },
        {
          id: 'own-0101',
          slug: 'b',
          claims: [
            { league: 'theleague', franchiseId: '0014', yearStart: 2018, yearEnd: 9999, shared: true },
          ],
        },
      ],
    };
    const index = indexRegistryClaims(coOwned, 'theleague');
    expect(index.get('0014|2018')?.map((h: any) => h.person.id).sort()).toEqual([
      'own-0100',
      'own-0101',
    ]);
  });

  it('still throws when only ONE side of a shared season declares it', () => {
    const halfDeclared = {
      version: 1,
      people: [
        {
          id: 'own-0100',
          slug: 'a',
          claims: [
            { league: 'theleague', franchiseId: '0014', yearStart: 2018, yearEnd: 2018, shared: true },
          ],
        },
        {
          id: 'own-0101',
          slug: 'b',
          // No `shared` — indistinguishable from a typo that hands away a
          // whole tenure, so it must not be accepted silently.
          claims: [{ league: 'theleague', franchiseId: '0014', yearStart: 2018, yearEnd: 2018 }],
        },
      ],
    };
    expect(() => indexRegistryClaims(halfDeclared, 'theleague')).toThrow(/not marked shared/);
  });

  it('throws on a doubly-claimed season rather than silently last-wins', () => {
    const conflicting = {
      version: 1,
      people: [
        ...registry.people,
        {
          id: 'own-0007',
          slug: 'someone-else-2008',
          claims: [{ league: 'theleague', franchiseId: '0010', yearStart: 2008, yearEnd: 2008 }],
        },
      ],
    };
    expect(() => indexRegistryClaims(conflicting, 'theleague')).toThrow(/more than one person/);
  });
});

// ── End-to-end overrides ───────────────────────────────────────────────────

describe('buildOwnerTenures registry overrides', () => {
  const league = { slug: 'theleague', navSlug: 'theleague', name: 'The League' };
  const teams = [SLOT_0004];
  // 2018 and 2019 are separate owners by inference (Art of War / Drunk Indians).
  const ledgerRows = range(2018, 2019).map((year) => ({
    year,
    franchiseId: '0004',
    attributedTo: null,
    name: year === 2018 ? 'The Art of War' : 'Drunk Indians',
    nameMedium: null,
    icon: null,
    banner: null,
    sourceFranchiseId: null,
    wins: 9,
    losses: 9,
    ties: 0,
    pointsFor: 1500,
    regSeasonRank: 8,
    divisionId: '01',
    divisionName: 'West',
    wonDivision: false,
    playoffResult: 'missed',
    seasonNotStarted: false,
  }));

  const build = (registry: any) =>
    buildOwnerTenures({ league, teams, ledgerRows, registry, generatedAt: 'fixed' });

  it('infers two owners with no registry', () => {
    const out = build(null);
    expect(out.owners).toHaveLength(2);
    expect(out.owners.every((o: any) => o.source === 'inferred')).toBe(true);
  });

  it('MERGE: one person claiming both years becomes one owner', () => {
    const out = build({
      version: 1,
      people: [
        {
          id: 'own-0001',
          slug: 'the-serial-rebrander',
          displayName: null,
          claims: [{ league: 'theleague', franchiseId: '0004', yearStart: 2018, yearEnd: 2019 }],
        },
      ],
    });
    expect(out.owners).toHaveLength(1);
    expect(out.owners[0].slug).toBe('the-serial-rebrander');
    expect(out.owners[0].source).toBe('registry');
    expect(out.owners[0].totals.seasons).toBe(2);
  });

  it('SPLIT: two people claiming sub-ranges stay separate, with frozen slugs', () => {
    const out = build({
      version: 1,
      people: [
        {
          id: 'own-0001',
          slug: 'art-of-war-guy',
          claims: [{ league: 'theleague', franchiseId: '0004', yearStart: 2018, yearEnd: 2018 }],
        },
        {
          id: 'own-0002',
          slug: 'drunk-indians-guy',
          claims: [{ league: 'theleague', franchiseId: '0004', yearStart: 2019, yearEnd: 2019 }],
        },
      ],
    });
    expect(out.owners.map((o: any) => o.slug).sort()).toEqual([
      'art-of-war-guy',
      'drunk-indians-guy',
    ]);
  });

  it('NAME: a displayName replaces the identity-joined title, changing nothing else', () => {
    const out = build({
      version: 1,
      people: [
        {
          id: 'own-0001',
          slug: 'the-serial-rebrander',
          displayName: 'Dave',
          claims: [{ league: 'theleague', franchiseId: '0004', yearStart: 2018, yearEnd: 2019 }],
        },
      ],
    });
    expect(out.owners[0].title).toBe('Dave');
    expect(out.owners[0].displayName).toBe('Dave');
    expect(out.owners[0].totals.seasons).toBe(2);
  });

  it('PARTIAL: an uncovered year still flows in by inference', () => {
    const out = build({
      version: 1,
      people: [
        {
          id: 'own-0001',
          slug: 'art-of-war-guy',
          claims: [{ league: 'theleague', franchiseId: '0004', yearStart: 2018, yearEnd: 2018 }],
        },
      ],
    });
    expect(out.owners).toHaveLength(2);
    expect(out.owners.map((o: any) => o.source).sort()).toEqual(['inferred', 'registry']);
  });

  it('CROSS-LEAGUE: a claim in another league surfaces on the owner', () => {
    const out = build({
      version: 1,
      people: [
        {
          id: 'own-0001',
          slug: 'the-serial-rebrander',
          claims: [
            { league: 'theleague', franchiseId: '0004', yearStart: 2018, yearEnd: 2019 },
            { league: 'afl-fantasy', franchiseId: '0009', yearStart: 2015, yearEnd: 9999 },
          ],
        },
      ],
    });
    expect(out.owners[0].crossLeague).toEqual([
      { league: 'afl-fantasy', franchiseId: '0009', yearStart: 2015, yearEnd: 9999 },
    ]);
  });

  it('conserves every season regardless of how the registry carves it up', () => {
    for (const registry of [
      null,
      {
        version: 1,
        people: [
          {
            id: 'own-0001',
            slug: 'a',
            claims: [{ league: 'theleague', franchiseId: '0004', yearStart: 2018, yearEnd: 2019 }],
          },
        ],
      },
      {
        version: 1,
        people: [
          {
            id: 'own-0001',
            slug: 'a',
            claims: [{ league: 'theleague', franchiseId: '0004', yearStart: 2018, yearEnd: 2018 }],
          },
        ],
      },
    ]) {
      const out = build(registry);
      const seasons = out.owners.flatMap((o: any) =>
        o.tenures.flatMap((t: any) => t.seasons.map((s: any) => `${t.franchiseId}|${s.year}`))
      );
      expect(seasons.sort()).toEqual(['0004|2018', '0004|2019']);
    }
  });
});

describe('buildOwnerTenures cross-slot tenures', () => {
  it('gives an owner who moved slots one tenure per slot', () => {
    const league = { slug: 'theleague', navSlug: 'theleague', name: 'The League' };
    const row = (franchiseId: string, year: number, name: string) => ({
      year,
      franchiseId,
      attributedTo: '0011',
      name,
      nameMedium: null,
      icon: null,
      banner: null,
      sourceFranchiseId: franchiseId === '0011' ? null : franchiseId,
      wins: 10,
      losses: 8,
      ties: 0,
      pointsFor: 1600,
      regSeasonRank: 5,
      divisionId: '01',
      divisionName: 'Central',
      wonDivision: false,
      playoffResult: 'playoffs',
      seasonNotStarted: false,
    });
    const out = buildOwnerTenures({
      league,
      teams: [{ franchiseId: '0011', name: 'Midwestside Connection' }],
      ledgerRows: [
        row('0010', 2011, 'Midwestside Connection'),
        row('0010', 2012, 'Midwestside Connection'),
        row('0011', 2019, 'Midwestside Connection'),
      ],
      generatedAt: 'fixed',
    });
    expect(out.owners).toHaveLength(1);
    expect(out.owners[0].tenures.map((t: any) => t.franchiseId)).toEqual(['0010', '0011']);
    expect(out.owners[0].totals.seasons).toBe(3);
    // Current owner of 0011, NOT of the slot they left.
    expect(out.owners[0].currentFranchiseId).toBe('0011');
  });
});

describe('buildOwnerTenures identity artwork', () => {
  /**
   * A team can restyle without renaming — Da Dangsters wore the 2017 circle
   * icon through 2024 and a new one from 2025, under one unbroken name. Both
   * years fold into a single identity run, and taking the run's FIRST row
   * pinned every current owner's card on /owners to artwork the team had
   * already retired. The newest year in the run is what the identity looks
   * like today.
   */
  const league = { slug: 'theleague', navSlug: 'theleague', name: 'The League' };
  const row = (year: number, name: string, icon: string, banner: string) => ({
    year,
    franchiseId: '0002',
    attributedTo: '0002',
    name,
    nameMedium: null,
    icon,
    banner,
    sourceFranchiseId: null,
    wins: 9,
    losses: 9,
    ties: 0,
    pointsFor: 1500,
    regSeasonRank: 7,
    divisionId: '01',
    divisionName: 'Central',
    wonDivision: false,
    playoffResult: 'missed',
    seasonNotStarted: false,
  });
  // `buildOwnerTenures` is a .mjs with no type declarations, so TS infers its
  // optional params from their DEFAULT VALUES — `resolveIcon = null` types as
  // `null`, and passing a real resolver is an error. Cast the options bag
  // rather than let these count against the type-error baseline.
  const build = (ledgerRows: any[]) =>
    buildOwnerTenures({
      league,
      teams: [{ franchiseId: '0002', name: 'Da Dangsters' }],
      ledgerRows,
      resolveIcon: ({ icon }: any) => icon,
      generatedAt: 'fixed',
    } as any);

  it('takes the newest year of a name run, not the oldest', () => {
    const out = build([
      row(2015, 'Da Dangsters', '/assets/theleague/history/old.png', '/assets/theleague/history/old_banner.png'),
      row(2025, 'Da Dangsters', '/assets/theleague/icons/new.png', '/assets/theleague/banners/new.png'),
    ]);
    const identity = out.owners[0].tenures[0].identities[0];
    expect(identity.years).toEqual([2015, 2025]);
    expect(identity.icon).toBe('/assets/theleague/icons/new.png');
    expect(identity.banner).toBe('/assets/theleague/banners/new.png');
    // …and it reaches the owner card, which is where the bug was visible.
    expect(out.owners[0].icon).toBe('/assets/theleague/icons/new.png');
  });

  it('keeps the run\'s own artwork when a newer year carries none', () => {
    const out = build([
      row(2015, 'Da Dangsters', '/assets/theleague/history/old.png', '/assets/theleague/history/old_banner.png'),
      { ...row(2025, 'Da Dangsters', '', ''), icon: null, banner: null },
    ]);
    const identity = out.owners[0].tenures[0].identities[0];
    expect(identity.icon).toBe('/assets/theleague/history/old.png');
    expect(identity.banner).toBe('/assets/theleague/history/old_banner.png');
  });

  it('does not leak artwork across a rename', () => {
    const out = build([
      row(2014, 'Degenerates', '/assets/theleague/history/degenerates.png', '/assets/theleague/history/degenerates_banner.png'),
      row(2015, 'Da Dangsters', '/assets/theleague/history/old.png', '/assets/theleague/history/old_banner.png'),
      row(2025, 'Da Dangsters', '/assets/theleague/icons/new.png', '/assets/theleague/banners/new.png'),
    ]);
    const identities = out.owners[0].tenures[0].identities;
    expect(identities.map((i: any) => i.icon)).toEqual([
      '/assets/theleague/history/degenerates.png',
      '/assets/theleague/icons/new.png',
    ]);
  });
});

describe('buildOwnerTenures owner card face', () => {
  /**
   * The card icon answers "what does this owner's team look like TODAY", which
   * `dominantIdentity` does not: it picks the identity a tenure is NAMED for,
   * by season count. The AFL's 0012 spent ten years as "Pubes" and the last
   * eight as "Suh girls, one cup", so its card wore a logo retired in 2018.
   */
  const league = { slug: 'afl-fantasy', navSlug: 'afl', name: 'AFL' };
  const row = (year: number, name: string, icon: string) => ({
    year,
    franchiseId: '0012',
    attributedTo: '0012',
    name,
    nameMedium: null,
    icon,
    banner: null,
    sourceFranchiseId: null,
    wins: 8,
    losses: 8,
    ties: 0,
    pointsFor: 1400,
    regSeasonRank: 8,
    divisionId: '01',
    divisionName: 'East',
    wonDivision: false,
    playoffResult: 'missed',
    seasonNotStarted: false,
  });
  const build = (ledgerRows: any[], teams: any[]) =>
    buildOwnerTenures({
      league,
      teams,
      ledgerRows,
      resolveIcon: ({ icon }: any) => icon,
      generatedAt: 'fixed',
    } as any);

  const TEAM = [{ franchiseId: '0012', name: 'Suh girls, one cup', currentOwnerSince: 2009 }];

  it('shows a current owner their newest identity, not their longest-worn one', () => {
    const out = build(
      [
        row(2009, 'Pubes', '/assets/afl/history/pubes.png'),
        row(2010, 'Pubes', '/assets/afl/history/pubes.png'),
        row(2011, 'Pubes', '/assets/afl/history/pubes.png'),
        row(2019, 'Suh girls, one cup', '/assets/afl/icons/suh.png'),
      ],
      TEAM
    );
    // The tenure is still NAMED for the longest-worn identity…
    expect(out.owners[0].dominantName).toBe('Pubes');
    // …but the face is the team as it stands today.
    expect(out.owners[0].icon).toBe('/assets/afl/icons/suh.png');
  });

  it('never puts a punitive rebrand on the card', () => {
    const out = build(
      [
        row(2024, 'Thundering Herd', '/assets/afl/history/herd.png'),
        row(2025, 'Thundering Herd', '/assets/afl/history/herd.png'),
        row(2026, 'A Bruin Pegs Me', '/assets/afl/icons/bruin.png'),
      ],
      [
        {
          franchiseId: '0012',
          name: 'A Bruin Pegs Me',
          currentOwnerSince: 2024,
          currentRebrand: { reason: 'last-place' },
          history: [{ name: 'Thundering Herd', yearStart: 2024, yearEnd: 2025 }],
        },
      ]
    );
    // The newest identity is a punishment, not an identity — skip to the one
    // beneath it rather than crowning the rename.
    expect(out.owners[0].icon).toBe('/assets/afl/history/herd.png');
  });

  it('leaves a former owner on their dominant identity', () => {
    const out = build(
      [
        { ...row(2009, 'Pubes', '/assets/afl/history/pubes.png'), attributedTo: null },
        { ...row(2010, 'Pubes', '/assets/afl/history/pubes.png'), attributedTo: null },
        { ...row(2011, 'Pubes', '/assets/afl/history/pubes.png'), attributedTo: null },
        { ...row(2012, 'Late Name', '/assets/afl/history/late.png'), attributedTo: null },
      ],
      [
        {
          franchiseId: '0012',
          name: 'Someone Else',
          currentOwnerSince: 2020,
          // The orphan path segments from the CONFIG's history entries, not
          // from the ledger rows, so the era art has to live here.
          history: [
            { name: 'Pubes', yearStart: 2009, yearEnd: 2011, icon: '/assets/afl/history/pubes.png' },
            { name: 'Late Name', yearStart: 2012, yearEnd: 2012, icon: '/assets/afl/history/late.png' },
          ],
        },
      ]
    );
    const former = out.owners.find((o: any) => !o.isCurrent);
    expect(former?.icon).toBe('/assets/afl/history/pubes.png');
  });
});
