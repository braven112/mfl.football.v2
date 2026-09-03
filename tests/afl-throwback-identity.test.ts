import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import theleagueConfig from '../src/data/theleague.config.json';
import {
  getEligibleThrowbackEras,
  getImposedThrowbackEra,
  pickDefaultThrowbackEra,
  resolveThrowbackIdentity,
} from '../src/utils/throwback-identity';
import { applyThrowbackOverrides, type ConfigTeam } from '../src/utils/live-scoring-data';
import {
  scopedThrowbackKey,
  strictThrowbackScopeForLeagueSlug,
  isThrowbackWeekForScope,
  throwbackRules,
} from '../src/utils/throwback-scope';
import { makeThrowbackKey } from '../src/utils/throwback-store';
import {
  AFL_THROWBACK_ASSET_CONFLICTS,
  AFL_THROWBACK_REBRAND,
} from '../src/data/afl-fantasy/throwback-config';
import type { TeamConfig } from '../src/utils/team-names';

const teams = (aflConfig as any).teams as TeamConfig[];
const findTeam = (franchiseId: string) => {
  const t = teams.find((t) => t.franchiseId === franchiseId);
  if (!t) throw new Error(`AFL fixture team ${franchiseId} not found`);
  return t;
};

describe('AFL throwback — scope separation', () => {
  it('keeps TheLeague on its legacy unscoped KV key', () => {
    // Byte-identical to what is already stored, or every owner loses the era
    // they picked.
    expect(scopedThrowbackKey('0001', 'theleague')).toBe('throwback:0001');
    expect(makeThrowbackKey('0001')).toBe('throwback:0001');
  });

  it('namespaces the AFL, because both leagues have a franchise 0001', () => {
    expect(scopedThrowbackKey('0001', 'afl')).toBe('throwback:afl:0001');
    expect(makeThrowbackKey('0001', 'afl')).not.toBe(makeThrowbackKey('0001', 'theleague'));
  });

  it('franchise 0001 really is a different team in each league', () => {
    // The premise of the scope. If this ever stops being true the key
    // separation is still correct, but this test should be re-read.
    const afl = findTeam('0001');
    const tl = (theleagueConfig.teams as unknown as TeamConfig[]).find(
      (t) => t.franchiseId === '0001',
    )!;
    expect(afl.name).not.toBe(tl.name);
  });

  it('refuses a scope for a league that does not run Throwback Week', () => {
    // Best Ball has no history[] — a lenient resolve would hand it
    // TheLeague's bucket under a colliding franchise id.
    expect(strictThrowbackScopeForLeagueSlug('best-ball-1')).toBeNull();
    expect(strictThrowbackScopeForLeagueSlug('afl-fantasy')).toBe('afl');
    expect(strictThrowbackScopeForLeagueSlug('theleague')).toBe('theleague');
  });

  it('runs Week 8, and NOT TheLeague\'s Week 4', () => {
    expect(isThrowbackWeekForScope(8, 'afl')).toBe(true);
    expect(isThrowbackWeekForScope(4, 'afl')).toBe(false);
    expect(isThrowbackWeekForScope(4, 'theleague')).toBe(true);
    expect(isThrowbackWeekForScope(8, 'theleague')).toBe(false);
  });

  it('resolves AFL franchises against AFL rules, not TheLeague\'s', () => {
    // The whole reason scope is threaded through. Both leagues define a
    // default for 0001; passing the wrong scope silently returns the other
    // league's year.
    const withAfl = resolveThrowbackIdentity(findTeam('0001'), undefined, 'afl');
    const withDefault = resolveThrowbackIdentity(findTeam('0001'));
    expect(withAfl.name).toBe('Smokane FC');
    // TheLeague's default for 0001 is 2013, which is not an AFL era, so the
    // mis-scoped call falls to earliest-eligible instead of erroring — the
    // exact silent wrongness the scope exists to prevent.
    expect(throwbackRules('theleague').defaults['0001']).not.toBe(
      throwbackRules('afl').defaults['0001'],
    );
    expect(withDefault.isHistorical).toBe(true);
  });
});

describe('AFL throwback — asset conflicts', () => {
  it('excludes every era whose crest is a live franchise\'s current crest', () => {
    // Rule 1: nobody throws back as a team that is playing that week.
    const currentIcons = new Map(teams.map((t) => [t.icon, t.franchiseId]));
    for (const team of teams) {
      for (const era of getEligibleThrowbackEras(team, 'afl')) {
        const owner = currentIcons.get(era.icon!);
        expect(
          owner === undefined || owner === team.franchiseId,
          `${team.name} may throw back as "${era.name}" (${era.yearStart}), but that crest ` +
            `belongs to franchise ${owner}, which is still in the league`,
        ).toBe(true);
      }
    }
  });

  it('never lets two franchises claim the same historic name', () => {
    // Rule 2. Verified over eligibility, so it holds through the conflict list
    // rather than restating it.
    const claim = new Map<string, string>();
    for (const team of teams) {
      for (const era of getEligibleThrowbackEras(team, 'afl')) {
        const key = era.name.toLowerCase();
        const prior = claim.get(key);
        expect(
          prior === undefined || prior === team.franchiseId,
          `"${era.name}" is eligible for both franchise ${prior} and ${team.franchiseId}`,
        ).toBe(true);
        claim.set(key, team.franchiseId);
      }
    }
  });

  it('every conflict entry names a real era (guards against a stale list)', () => {
    for (const c of AFL_THROWBACK_ASSET_CONFLICTS) {
      const team = findTeam(c.franchiseId);
      expect(
        (team.history ?? []).some((e) => e.yearStart === c.yearStart),
        `conflict ${c.franchiseId}:${c.yearStart} matches no era — the list has drifted`,
      ).toBe(true);
    }
  });
});

describe('AFL throwback — every franchise can actually throw back', () => {
  it('all 24 franchises resolve to a HISTORICAL identity', () => {
    // Drunk Indians (0002) and Fullybaked (0010) had empty history[] until
    // their art was recovered from MFL's fflnetdynamic hosting. A franchise
    // with no eligible era silently wears its current identity — the failure
    // mode that looks like "nothing happened" rather than like a bug.
    expect(teams).toHaveLength(24);
    for (const team of teams) {
      const identity = resolveThrowbackIdentity(team, undefined, 'afl');
      expect(identity.isHistorical, `${team.name} has no eligible throwback era`).toBe(true);
    }
  });

  it('the two recovered franchises wear art that differs from today', () => {
    for (const franchiseId of ['0002', '0010']) {
      const team = findTeam(franchiseId);
      const identity = resolveThrowbackIdentity(team, undefined, 'afl');
      expect(
        identity.icon !== team.icon || identity.banner !== team.banner,
        `${team.name} throws back to art identical to its current look`,
      ).toBe(true);
    }
  });

  it('every resolved crest and banner is a committed file', () => {
    // A 404 crest on the one week a year anyone looks is worse than the bug
    // this feature fixes. Era art paths are hand-maintained.
    for (const team of teams) {
      for (const era of getEligibleThrowbackEras(team, 'afl')) {
        for (const asset of [era.icon, era.banner]) {
          expect(typeof asset).toBe('string');
          expect(
            existsSync(join(process.cwd(), 'public', asset!)),
            `${team.name} "${era.name}" (${era.yearStart}) points at missing ${asset}`,
          ).toBe(true);
        }
      }
    }
  });

  it('every eligible era carries a palette, so the board never tints modern', () => {
    // Without era colors the scoreboard shows legacy names and crests over
    // TODAY's colors — the difference between a throwback and a nameplate swap.
    for (const team of teams) {
      for (const era of getEligibleThrowbackEras(team, 'afl')) {
        expect(
          era.colorPrimary,
          `${team.name} "${era.name}" (${era.yearStart}) has no colorPrimary`,
        ).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe('AFL throwback — live-scoring overlay', () => {
  it('swaps identity and palette, and clears the current dark variants', () => {
    const overridden = applyThrowbackOverrides(
      teams as unknown as ConfigTeam[],
      true,
      {},
      'afl',
    );
    const smokane = overridden.find((t) => t.franchiseId === '0001')!;
    expect(smokane.name).toBe('Smokane FC');
    expect(smokane.colorPrimary).toMatch(/^#[0-9a-f]{6}$/i);
    // The *Dark variants belong to the CURRENT brand; leaving them makes dark
    // mode paint today's colors over a legacy identity.
    expect(smokane.colorPrimaryDark).toBeUndefined();
    expect(smokane.colorSecondaryDark).toBeUndefined();
  });

  it('is a no-op when the week is not a throwback week', () => {
    const untouched = applyThrowbackOverrides(teams as unknown as ConfigTeam[], false, {}, 'afl');
    expect(untouched.find((t) => t.franchiseId === '0001')!.name).toBe('Smokane FC');
  });

  it('honors an owner override, and ignores an era that is not theirs', () => {
    const swiftie = findTeam('0016');
    const alt = getEligibleThrowbackEras(swiftie, 'afl').find(
      (e) => e.yearStart !== throwbackRules('afl').defaults['0016'],
    )!;
    expect(resolveThrowbackIdentity(swiftie, alt.yearStart, 'afl').name).toBe(alt.name);
    // 1999 is nobody's era — falls back down the default chain rather than
    // rendering an undefined identity.
    expect(resolveThrowbackIdentity(swiftie, 1999, 'afl').isHistorical).toBe(true);
  });
});

describe('throwback defaults — never a punitive last-place rebrand', () => {
  const span = (e: { yearStart: number; yearEnd?: number }) =>
    (e.yearEnd ?? e.yearStart) - e.yearStart + 1;

  it('no franchise is DEFAULTED into a shame name', () => {
    // The rule this pins is a league policy, not a heuristic: an owner may
    // choose to wear the name the league stuck them with for finishing last,
    // but the site never chooses it for them. The seeding heuristic that
    // preceded it picked four of these outright, because a last-place rename
    // is by construction both recent and visually distinct.
    //
    // The Throwback Rebrand is the ONE deliberate exception, and it is not a
    // hole in the rule — the rule is about what the site chooses FOR an owner,
    // and that assignment is a sentence being served, not a default. It is
    // covered separately below.
    for (const team of teams) {
      if (getImposedThrowbackEra(team.franchiseId, 'afl')) continue;
      const identity = resolveThrowbackIdentity(team, undefined, 'afl');
      expect(
        identity.rebrand,
        `${team.name} is defaulted into its last-place rebrand "${identity.name}"`,
      ).toBeUndefined();
    }
  });

  it('defaults to the longest-running era, unless the commissioner said otherwise', () => {
    // Compared by ENTRY, not by name: two of Fullybaked's eras are both called
    // "Fullybaked" and differ only by eraLabel, so a name lookup here silently
    // grades the wrong one.
    //
    // The seeded map is allowed to WIN over tenure — that is what it is for,
    // and The Show is deliberately seeded to the three-season "clean wordmark"
    // No Frills over the fourteen-season "bananas" one. What must never happen
    // is a franchise drifting to a short era by accident, so a default that is
    // not the longest has to be the seed, spelled out in the config.
    for (const team of teams) {
      if (getImposedThrowbackEra(team.franchiseId, 'afl')) continue;
      const eligible = getEligibleThrowbackEras(team, 'afl');
      const clean = eligible.filter((e) => !e.rebrand);
      if (clean.length === 0) continue;
      const seed = throwbackRules('afl').defaults[team.franchiseId];
      const longest = Math.max(...clean.map(span));
      const worn = pickDefaultThrowbackEra(eligible, seed)!;
      const deliberate = worn.yearStart === seed;
      expect(
        deliberate || span(worn) === longest,
        `${team.name} defaults to "${worn.name}" (${worn.yearStart}, ${span(worn)}yr), ` +
          `which is neither its seeded era (${seed}) nor its longest (${longest}yr)`,
      ).toBe(true);
    }
  });

  it('The Show wears the No Frills the commissioner picked, not Cock Gobbler', () => {
    // Cock Gobbler is the one-season shame name that prompted the no-rebrand
    // rule; the seed then chose BETWEEN the two No Frills eras.
    const identity = resolveThrowbackIdentity(findTeam('0023'), undefined, 'afl');
    expect(identity.name).toBe('No Frills');
    const seeded = (findTeam('0023').history ?? []).find(
      (e) => e.yearStart === throwbackRules('afl').defaults['0023'],
    )!;
    expect(identity.icon).toBe(seeded.icon);
    expect(seeded.eraLabel).toBe('The clean wordmark');
  });

  it('an owner may still CHOOSE a rebrand era', () => {
    const show = findTeam('0023');
    const shame = getEligibleThrowbackEras(show, 'afl').find((e) => e.rebrand)!;
    expect(shame.name).toBe('Cock Gobbler');
    expect(resolveThrowbackIdentity(show, shame.yearStart, 'afl').name).toBe('Cock Gobbler');
  });

  it('a seeded default that is a rebrand is overruled, not honored', () => {
    // Rule 1 must not be defeatable by a stale entry in the seed map.
    const eligible = [
      { name: 'Shame', yearStart: 2020, yearEnd: 2020, rebrand: { reason: 'last-place', group: 'g' } },
      { name: 'Real', yearStart: 2010, yearEnd: 2012 },
    ] as any;
    expect(pickDefaultThrowbackEra(eligible, 2020)!.name).toBe('Real');
  });

  it('falls back to a rebrand only when every era is one', () => {
    const allShame = [
      { name: 'Shame A', yearStart: 2020, yearEnd: 2020, rebrand: { reason: 'last-place', group: 'g' } },
      { name: 'Shame B', yearStart: 2015, yearEnd: 2018, rebrand: { reason: 'last-place', group: 'g' } },
    ] as any;
    // Dropping out of Throwback Week entirely would be worse than the shame name.
    expect(pickDefaultThrowbackEra(allShame)!.name).toBe('Shame B');
  });

  it('breaks a tenure tie on the earlier era, deterministically', () => {
    const tied = [
      { name: 'Later', yearStart: 2015, yearEnd: 2017 },
      { name: 'Earlier', yearStart: 2005, yearEnd: 2007 },
    ] as any;
    expect(pickDefaultThrowbackEra(tied)!.name).toBe('Earlier');
  });
});

describe('the Throwback Rebrand', () => {
  const assignment = AFL_THROWBACK_REBRAND!;

  it('targets the franchise that is actually serving a last-place rename', () => {
    // The drift guard. If the rebrand moves to another team and nobody updates
    // the assignment, this fails rather than dressing the wrong franchise in
    // somebody else's shame name for a season.
    const wearing = teams.filter((t) => (t as any).currentRebrand);
    expect(
      wearing.map((t) => t.franchiseId),
      'exactly one AFL franchise should carry currentRebrand',
    ).toEqual([assignment.franchiseId]);
  });

  it('dresses A Bruin Pegs Me as Jesus Killers, overriding its own history', () => {
    const identity = resolveThrowbackIdentity(findTeam('0014'), undefined, 'afl');
    expect(identity.name).toBe('Jesus Killers');
    expect(identity.isHistorical).toBe(true);
    // Borrowed wholesale — art and palette, not just the name. Both are read
    // from Jewpacabra's own era rather than restated here: the palettes are
    // derived from the art (scripts/derive-era-palettes.mjs), so a literal
    // would pin a hex that re-deriving is meant to be free to change, and it
    // would still pass if the borrow quietly stopped carrying the palette.
    const source = (findTeam('0018').history ?? []).find((e) => e.yearStart === 2019)!;
    expect(identity.icon).toBe(source.icon);
    expect(identity.banner).toBe(source.banner);
    expect(identity.colorPrimary).toBe(source.colorPrimary);
    expect(identity.colorSecondary).toBe(source.colorSecondary);
    expect(source.colorPrimary).toBeTruthy();
  });

  it('ignores an owner override — a rebrand is imposed, not chosen', () => {
    const bruin = findTeam('0014');
    // Thundering Herd is its 19-season era and would otherwise be the default.
    const own = (bruin.history ?? []).find((e) => e.name === 'Thundering Herd')!;
    const identity = resolveThrowbackIdentity(bruin, own.yearStart, 'afl');
    expect(identity.name).toBe('Jesus Killers');
  });

  it('takes the era off the SOURCE franchise while it is on loan', () => {
    // Two teams in one identity on a single scoreboard is exactly what the
    // asset conflicts exist to stop.
    const jewpacabra = findTeam('0018');
    const eligible = getEligibleThrowbackEras(jewpacabra, 'afl');
    expect(eligible.map((e) => e.name)).not.toContain('Jesus Killers');
    expect(eligible.length, 'Jewpacabra keeps its other eras').toBeGreaterThan(0);
  });

  it('leaves every other franchise alone', () => {
    for (const team of teams) {
      const imposed = getImposedThrowbackEra(team.franchiseId, 'afl');
      if (team.franchiseId === assignment.franchiseId) expect(imposed).not.toBeNull();
      else expect(imposed, `${team.name} should not be imposed on`).toBeNull();
    }
  });

  it('does not leak into TheLeague', () => {
    expect(getImposedThrowbackEra('0014', 'theleague')).toBeNull();
    expect(throwbackRules('theleague').rebrand).toBeNull();
  });

  it('still puts exactly one Jesus Killers on the board', () => {
    const worn = teams.map((t) => resolveThrowbackIdentity(t, undefined, 'afl').name);
    expect(worn.filter((n) => n === 'Jesus Killers')).toHaveLength(1);
    // And no other duplicate identity either.
    expect(new Set(worn).size).toBe(worn.length);
  });
});

describe('the two leagues never cross', () => {
  const tlTeams = (theleagueConfig as any).teams as TeamConfig[];

  it('no AFL era points at TheLeague art', () => {
    // Several owners run a franchise in BOTH leagues — five pairs share a
    // byte-identical current crest — which makes borrowing the other league's
    // history look reasonable and is exactly why this guard exists. The two
    // archives stay separate: an AFL throwback is something the franchise wore
    // in the AFL.
    for (const team of teams) {
      for (const era of team.history ?? []) {
        for (const asset of [era.icon, era.banner]) {
          expect(
            String(asset).includes('/theleague/'),
            `${team.name} "${era.name}" points at TheLeague art: ${asset}`,
          ).toBe(false);
        }
      }
    }
  });

  it('no TheLeague era points at AFL art', () => {
    for (const team of tlTeams) {
      for (const era of team.history ?? []) {
        for (const asset of [era.icon, era.banner]) {
          expect(
            String(asset).includes('/afl/'),
            `${team.name} "${era.name}" points at AFL art: ${asset}`,
          ).toBe(false);
        }
      }
    }
  });

  it('neither config carries a cross-league identity array', () => {
    // The shape a reintroduction would take. `history[]` is the only source of
    // throwback eras, and it means "what this franchise wore in THIS league".
    for (const team of [...teams, ...tlTeams]) {
      expect((team as any).borrowedIdentities, `${team.name} has borrowedIdentities`).toBeUndefined();
      for (const era of team.history ?? []) {
        expect((era as any).borrowed, `${team.name} "${era.name}" is flagged borrowed`).toBeUndefined();
      }
    }
  });

  it('a franchise resolves only to eras from its own league config', () => {
    for (const team of teams) {
      const own = new Set((team.history ?? []).map((e) => `${e.yearStart}:${e.name}`));
      for (const era of getEligibleThrowbackEras(team, 'afl')) {
        expect(own.has(`${era.yearStart}:${era.name}`)).toBe(true);
      }
    }
  });
});

describe('era keys stay unique', () => {
  it('history[] spans never overlap', () => {
    // history[] answers "what was this franchise called in THIS league in
    // year N" and `getTeamIdentityForYear` reads it for award naming,
    // standings and owner pages — two entries covering the same year make
    // that answer arbitrary. Recovering finer-grained art produced exactly
    // this: the original Smokane and Gamecocks entries spanned a whole early
    // period that the newly recovered runs then subdivided.
    for (const team of teams) {
      const h = [...(team.history ?? [])].sort((a, b) => a.yearStart - b.yearStart);
      for (let i = 1; i < h.length; i++) {
        const prevEnd = h[i - 1].yearEnd ?? h[i - 1].yearStart;
        expect(
          h[i].yearStart,
          `${team.name}: "${h[i - 1].name}" (${h[i - 1].yearStart}-${prevEnd}) overlaps ` +
            `"${h[i].name}" (${h[i].yearStart}-${h[i].yearEnd})`,
        ).toBeGreaterThan(prevEnd);
      }
    }
  });

  it('no franchise has two eras with the same yearStart', () => {
    // `yearStart` IS the era's identity: the seeded default map, the stored
    // owner preference, the picker's radio value and the API's validation all
    // key on it. A duplicate means an owner picks one era and silently gets
    // the other. Two of these appeared the moment borrowed eras arrived
    // carrying the OTHER league's timeline.
    for (const team of teams) {
      const seen = new Map<number, string>();
      for (const era of team.history ?? []) {
        expect(
          seen.has(era.yearStart),
          `${team.name} has two eras at ${era.yearStart}: "${seen.get(era.yearStart)}" and "${era.name}"`,
        ).toBe(false);
        seen.set(era.yearStart, era.name);
      }
    }
  });
});

/**
 * Eras that ARE invisible and cannot be fixed yet, `<league> <franchiseId> <yearStart>`.
 *
 * This list may only SHRINK. Each entry is an era whose distinct art no
 * longer exists anywhere we can reach, so pointing it at the live files is
 * the only option available — not a mistake left in place.
 */
const KNOWN_INVISIBLE_ERAS = new Set([
  // All four are the same story, and it is TheLeague's version of the AFL bug
  // this guard was written for: the franchise's LAST pre-2025 look lived on
  // `theleague.us/images/team_banners/*.png` — named in every one of those
  // years' league.json — and that host now answers every image request with a
  // 124 KB HTML 404. There is no rehost of it (unlike afl-fantasy.com, which
  // mfl.football mirrors), so these entries point at the 2025 rebrand files
  // and the eras do not appear in TheLeague's picker.
  //
  // Recover the art — an owner's copy, an archive — and the line comes out.
  'theleague 0003 2016', // Maverick
  'theleague 0010 2016', // Computer Jocks
  'theleague 0013 2014', // Gridiron Geeks
  'theleague 0014 2018', // Cowboy Up
]);

describe('no era is invisible', () => {
  it('no history entry duplicates its own franchise\'s live identity', () => {
    // `getEligibleThrowbackEras` drops an entry whose name, icon AND banner
    // all equal the franchise's current ones — correctly, since throwing back
    // to today is not a throwback. But that makes a data error SILENT: the
    // era is simply absent from the picker with nothing to indicate why.
    //
    // Jewpacabra's 2015-2018 entry was exactly that. It named the live team
    // and pointed at `/assets/afl/icons/jewpacabra.png` and
    // `/assets/afl/banners/jewpacabra.png` — the 2025 rebrand's own files —
    // so the franchise carried seven history rows and could only pick five.
    // The real 2015-2024 banner was in the MFL feed the whole time.
    //
    // A deliberate exclusion has a home: AFL_THROWBACK_ASSET_CONFLICTS. This
    // one never does.
    const found: string[] = [];
    for (const [label, config] of [['afl', aflConfig], ['theleague', theleagueConfig]] as const) {
      for (const team of (config as any).teams as TeamConfig[]) {
        for (const era of team.history ?? []) {
          const same =
            era.name === team.name && era.icon === team.icon && era.banner === team.banner;
          const key = `${label} ${team.franchiseId} ${era.yearStart}`;
          if (same && !KNOWN_INVISIBLE_ERAS.has(key)) {
            found.push(`${key} — "${era.name}" is byte-for-byte the live identity`);
          }
        }
      }
    }
    expect(found, `invisible eras:\n${found.join('\n')}`).toEqual([]);
  });

  it('every known-invisible era is still actually invisible', () => {
    // The same ratchet idiom as the typecheck and page-fork baselines: an
    // entry that no longer describes reality is slack, and slack is how a
    // pinned list stops being a check.
    for (const key of KNOWN_INVISIBLE_ERAS) {
      const [label, franchiseId, yearStart] = key.split(' ');
      const config = label === 'afl' ? aflConfig : theleagueConfig;
      const team = ((config as any).teams as TeamConfig[]).find(
        (t) => t.franchiseId === franchiseId,
      );
      expect(team, `${key} names a franchise that does not exist`).toBeTruthy();
      const era = (team!.history ?? []).find((e) => e.yearStart === Number(yearStart));
      expect(era, `${key} names an era that does not exist`).toBeTruthy();
      expect(
        era!.name === team!.name && era!.icon === team!.icon && era!.banner === team!.banner,
        `${key} has real art now — delete it from KNOWN_INVISIBLE_ERAS`,
      ).toBe(true);
    }
  });

  it('every AFL franchise offers at least one era', () => {
    for (const team of teams) {
      expect(
        getEligibleThrowbackEras(team, 'afl').length,
        `${team.name} has nothing to wear on Throwback Week`,
      ).toBeGreaterThan(0);
    }
  });
});
