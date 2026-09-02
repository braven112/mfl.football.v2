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
    expect(withAfl.name).toBe('Smokane');
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
    expect(smokane.name).toBe('Smokane');
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

  it('defaults to the longest-running eligible era', () => {
    // Compared by ENTRY, not by name: two of Fullybaked's eras are both called
    // "Fullybaked" and differ only by eraLabel, so a name lookup here silently
    // grades the wrong one.
    for (const team of teams) {
      if (getImposedThrowbackEra(team.franchiseId, 'afl')) continue;
      const eligible = getEligibleThrowbackEras(team, 'afl');
      const clean = eligible.filter((e) => !e.rebrand);
      if (clean.length === 0) continue;
      const longest = Math.max(...clean.map(span));
      const worn = pickDefaultThrowbackEra(
        eligible,
        throwbackRules('afl').defaults[team.franchiseId],
      )!;
      expect(
        span(worn),
        `${team.name} defaults to "${worn.name}" (${worn.yearStart}, ${span(worn)}yr) ` +
          `but its longest non-rebrand era runs ${longest}yr`,
      ).toBe(longest);
    }
  });

  it('The Show wears No Frills (17 seasons), not Cock Gobbler (1)', () => {
    // The case that prompted the rule.
    const identity = resolveThrowbackIdentity(findTeam('0023'), undefined, 'afl');
    expect(identity.name).toBe('No Frills');
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
    // Borrowed wholesale — art and palette, not just the name.
    expect(identity.icon).toBe('/assets/afl/history/jesus_killers_icon_icon_circle.png');
    expect(identity.colorPrimary).toBe('#643f29');
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
