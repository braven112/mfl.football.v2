/**
 * The league-wide era pool (Sept 2026): any owner may wear any era in the
 * league, EXCEPT an era worn by an owner who is still here — that one is
 * theirs alone. A departed owner's era is open to everyone, one franchise at
 * a time, first come first served; a team's default is reserved to it until
 * its owner picks something else; picks lock from the throwback week's first
 * kickoff; and a claim is settled atomically under a league-wide lock.
 */
import { describe, it, expect } from 'vitest';
import tlConfig from '../src/data/theleague.config.json';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import {
  eraClaimId,
  eraPickKey,
  getEligibleThrowbackEras,
  getImposedThrowbackEra,
  getPickableThrowbackEras,
  resolveThrowbackAssignments,
  resolveThrowbackIdentity,
  type ThrowbackPick,
} from '../src/utils/throwback-identity';
import { throwbackEraOwner } from '../src/utils/throwback-era-owner';
import { isThrowbackPickLocked, type ThrowbackScope } from '../src/utils/throwback-scope';
import type { FranchiseHistoryEntry, TeamConfig } from '../src/utils/team-names';

const LEAGUES: [ThrowbackScope, TeamConfig[]][] = [
  ['theleague', (tlConfig as any).teams],
  ['afl', (aflConfig as any).teams],
];
const tlTeams = LEAGUES[0][1];
const aflTeams = LEAGUES[1][1];
const team = (teams: TeamConfig[], id: string) => teams.find((t) => t.franchiseId === id)!;

describe('who may pick what', () => {
  it.each(LEAGUES)('%s: an era from a current owner is never offered to anyone else', (scope, teams) => {
    for (const t of teams) {
      for (const era of getPickableThrowbackEras(t, scope, teams)) {
        const slot = era.sourceFranchiseId ?? t.franchiseId;
        const owner = throwbackEraOwner(slot, era.yearStart, scope, teams);
        expect(
          owner === null || owner === t.franchiseId,
          `${scope} ${t.franchiseId} is offered ${slot}:${era.yearStart} ${era.name}, owned by ${owner}`,
        ).toBe(true);
      }
    }
  });

  it("nobody but the Pigskins can wear the Pigskins' old looks", () => {
    for (const t of tlTeams) {
      if (t.franchiseId === '0001') continue;
      const fromPigskins = getPickableThrowbackEras(t, 'theleague', tlTeams).filter(
        (e) => e.sourceFranchiseId === '0001',
      );
      expect(fromPigskins, t.name).toEqual([]);
    }
  });

  it("a departed owner's era is open to another franchise", () => {
    // Heavy Chevy, 2020 — franchise 0004's slot under an owner who has left.
    expect(throwbackEraOwner('0004', 2020, 'theleague', tlTeams)).toBeNull();
    const keys = getPickableThrowbackEras(team(tlTeams, '0001'), 'theleague', tlTeams).map(eraPickKey);
    expect(keys).toContain('0004:2020');
  });

  it('the owners registry reserves an era the attributor alone would have opened', () => {
    // AFL Computer Jocks 2014 sits in slot 0018, but the registry says it was
    // Jomar Marinio's, who runs 0005 today.
    expect(throwbackEraOwner('0018', 2014, 'afl', aflTeams)).toBe('0005');
    for (const t of aflTeams) {
      if (t.franchiseId === '0005') continue;
      expect(getPickableThrowbackEras(t, 'afl', aflTeams).map(eraPickKey)).not.toContain('0018:2014');
    }
  });

  it("a franchise's own list is still what its default is chosen from", () => {
    const t = team(tlTeams, '0001');
    const own = getEligibleThrowbackEras(t, 'theleague', tlTeams).map(eraPickKey);
    expect(own).toEqual(['2007', '2013']);
    expect(getPickableThrowbackEras(t, 'theleague', tlTeams).length).toBeGreaterThan(own.length);
  });
});

describe('one era, one franchise', () => {
  it.each(LEAGUES)('%s: with no picks, no two franchises wear the same era', (scope, teams) => {
    const { eras } = resolveThrowbackAssignments(teams, {}, scope);
    const worn = teams
      .filter((t) => eras.get(t.franchiseId))
      .map((t) => eraClaimId(t, eras.get(t.franchiseId)!));
    expect(new Set(worn).size).toBe(worn.length);
  });

  it.each(LEAGUES)('%s: the whole league claiming one open era leaves it on exactly one team', (scope, teams) => {
    // Pick an open era some franchise's picker offers from another slot.
    const era = getPickableThrowbackEras(teams[0], scope, teams).find(
      (e) => e.sourceFranchiseId && throwbackEraOwner(e.sourceFranchiseId, e.yearStart, scope, teams) === null,
    )!;
    expect(era).toBeDefined();
    const id = `${era.sourceFranchiseId}:${era.yearStart}`;
    const picks: Record<string, ThrowbackPick> = {};
    teams.forEach((t, i) => {
      picks[t.franchiseId] =
        t.franchiseId === era.sourceFranchiseId
          ? { yearStart: era.yearStart, claimedAt: 1000 + i }
          : { yearStart: era.yearStart, sourceFranchiseId: era.sourceFranchiseId, claimedAt: 1000 + i };
    });
    const { eras, claims } = resolveThrowbackAssignments(teams, picks, scope);
    const wearers = teams.filter((t) => {
      const e = eras.get(t.franchiseId);
      return e && eraClaimId(t, e) === id;
    });
    expect(wearers).toHaveLength(1);
    expect(claims.get(id)).toBe(wearers[0].franchiseId);
  });

  it('the earlier claim wins and the later one is outbid onto its default', () => {
    const pick = { yearStart: 2020, sourceFranchiseId: '0004' };
    const picks = {
      '0001': { ...pick, claimedAt: 2000 },
      '0002': { ...pick, claimedAt: 1000 },
    };
    const { eras, outbid } = resolveThrowbackAssignments(tlTeams, picks, 'theleague');
    expect(eras.get('0002')?.name).toBe('Heavy Chevy');
    expect(eras.get('0001')?.name).not.toBe('Heavy Chevy');
    expect(outbid.has('0001')).toBe(true);
    expect(outbid.has('0002')).toBe(false);
  });

  it('a pick saved before claiming existed (no timestamp) ranks first', () => {
    const picks = {
      '0001': { yearStart: 2020, sourceFranchiseId: '0004', claimedAt: 5 },
      '0002': { yearStart: 2020, sourceFranchiseId: '0004' },
    };
    const { claims } = resolveThrowbackAssignments(tlTeams, picks, 'theleague');
    expect(claims.get('0004:2020')).toBe('0002');
  });

  // A team whose default is a departed owner's era — the only kind anyone
  // else can pick. Drunk Indians 2019, franchise 0004's slot.
  const victimOf = (scope: ThrowbackScope, teams: TeamConfig[]) => {
    const { eras } = resolveThrowbackAssignments(teams, {}, scope);
    const victim = teams.find((t) => {
      const e = eras.get(t.franchiseId);
      if (!e) return false;
      const slot = e.sourceFranchiseId ?? t.franchiseId;
      return throwbackEraOwner(slot, e.yearStart, scope, teams) === null &&
        teams.some((o) => o !== t && getPickableThrowbackEras(o, scope, teams).some((p) => eraClaimId(o, p) === eraClaimId(t, e)));
    })!;
    return { victim, era: eras.get(victim.franchiseId)! };
  };
  const claimOf = (claimer: TeamConfig, victim: TeamConfig, era: FranchiseHistoryEntry, at: number): ThrowbackPick =>
    claimer.franchiseId === (era.sourceFranchiseId ?? victim.franchiseId)
      ? { yearStart: era.yearStart, claimedAt: at }
      : { yearStart: era.yearStart, sourceFranchiseId: era.sourceFranchiseId ?? victim.franchiseId, claimedAt: at };

  it.each(LEAGUES)("%s: a team that has picked nothing keeps its default, whoever else claims it", (scope, teams) => {
    const { victim, era } = victimOf(scope, teams);
    expect(victim, `${scope}: no team has a claimable default`).toBeDefined();
    const picks: Record<string, ThrowbackPick> = {};
    teams.forEach((t, i) => {
      if (t !== victim) picks[t.franchiseId] = claimOf(t, victim, era, 1 + i);
    });
    const { eras, claims, outbid, reservedDefaults } = resolveThrowbackAssignments(teams, picks, scope);
    const id = eraClaimId(victim, era);
    expect(eras.get(victim.franchiseId)?.name).toBe(era.name);
    expect(claims.get(id)).toBe(victim.franchiseId);
    expect(reservedDefaults.has(id)).toBe(true);
    for (const t of teams) {
      if (t === victim || getImposedThrowbackEra(t.franchiseId, scope)) continue;
      const worn = eras.get(t.franchiseId);
      expect(worn && eraClaimId(t, worn), `${t.franchiseId} wears ${victim.franchiseId}'s default`).not.toBe(id);
    }
    expect(outbid.size).toBeGreaterThan(0);
  });

  it('a team whose owner picked its default outright still holds it', () => {
    const { victim, era } = victimOf('theleague', tlTeams);
    const thief = tlTeams.find((t) => t !== victim)!;
    const picks = {
      [victim.franchiseId]: { yearStart: era.yearStart, claimedAt: 50 },
      [thief.franchiseId]: claimOf(thief, victim, era, 1),
    };
    const { eras, outbid } = resolveThrowbackAssignments(tlTeams, picks, 'theleague');
    expect(eras.get(victim.franchiseId)?.name).toBe(era.name);
    expect(outbid.has(thief.franchiseId)).toBe(true);
  });

  it('picking another era releases the default to the pool', () => {
    const { victim, era } = victimOf('theleague', tlTeams);
    const other = getPickableThrowbackEras(victim, 'theleague', tlTeams).find(
      (e) => eraClaimId(victim, e) !== eraClaimId(victim, era),
    )!;
    const thief = tlTeams.find((t) => t !== victim)!;
    const picks = {
      [victim.franchiseId]: { yearStart: other.yearStart, sourceFranchiseId: other.sourceFranchiseId, claimedAt: 5 },
      [thief.franchiseId]: claimOf(thief, victim, era, 9),
    };
    const { eras, claims, reservedDefaults } = resolveThrowbackAssignments(tlTeams, picks, 'theleague');
    const id = eraClaimId(victim, era);
    expect(eras.get(thief.franchiseId)?.name).toBe(era.name);
    expect(claims.get(id)).toBe(thief.franchiseId);
    expect(reservedDefaults.has(id)).toBe(false);
  });

  it('a released default that someone claimed is not handed back when its owner is outbid elsewhere', () => {
    const { victim, era } = victimOf('theleague', tlTeams);
    const [thief, rival] = tlTeams.filter((t) => t !== victim);
    // Poker in the Rear 2012 (slot 0003, a departed owner's era and nobody's
    // default), which the rival claimed first.
    const pool = { yearStart: 2012, sourceFranchiseId: '0003' };
    const picks = {
      [victim.franchiseId]: { ...pool, claimedAt: 20 },
      [rival.franchiseId]: { ...pool, claimedAt: 10 },
      [thief.franchiseId]: claimOf(thief, victim, era, 30),
    };
    const { eras, outbid } = resolveThrowbackAssignments(tlTeams, picks, 'theleague');
    expect(outbid.has(victim.franchiseId)).toBe(true);
    expect(eras.get(thief.franchiseId)?.name).toBe(era.name);
    const after = eras.get(victim.franchiseId);
    expect(after && eraClaimId(victim, after)).not.toBe(eraClaimId(victim, era));
  });

  it('resolveThrowbackIdentity follows the league-wide answer when given every pick', () => {
    const pick = { yearStart: 2020, sourceFranchiseId: '0004' };
    const picks = { '0001': { ...pick, claimedAt: 2 }, '0002': { ...pick, claimedAt: 1 } };
    const loser = resolveThrowbackIdentity(team(tlTeams, '0001'), picks['0001'], 'theleague', tlTeams, picks);
    expect(loser.name).not.toBe('Heavy Chevy');
    const winner = resolveThrowbackIdentity(team(tlTeams, '0002'), picks['0002'], 'theleague', tlTeams, picks);
    expect(winner.name).toBe('Heavy Chevy');
  });
});

describe('picks lock at kickoff', () => {
  // TheLeague's throwback week is week 4; 2026 week 4 kicks off
  // 2026-10-01 17:15 PT and week 5 on 2026-10-08.
  it('is open before the first kickoff', () => {
    expect(isThrowbackPickLocked('theleague', new Date('2026-10-01T17:14:00-07:00'))).toBe(false);
  });
  it('locks at the first kickoff', () => {
    expect(isThrowbackPickLocked('theleague', new Date('2026-10-01T17:15:00-07:00'))).toBe(true);
    expect(isThrowbackPickLocked('theleague', new Date('2026-10-05T20:00:00-07:00'))).toBe(true);
  });
  it('reopens once the week is over', () => {
    expect(isThrowbackPickLocked('theleague', new Date('2026-10-07T12:00:00-07:00'))).toBe(false);
  });
  it("is per league — TheLeague's week does not lock the AFL", () => {
    expect(isThrowbackPickLocked('afl', new Date('2026-10-03T12:00:00-07:00'))).toBe(false);
  });
});

describe('the picker view', () => {
  it("lists an owner's era from another slot with their own eras, not the open pool", async () => {
    const { buildThrowbackPickerView } = await import('../src/utils/throwback-settings-view');
    const view = await buildThrowbackPickerView(
      { franchiseId: '0005', leagueId: 'x' } as any,
      aflTeams,
      'afl',
    );
    const pooled = view!.poolEras.map(eraPickKey);
    for (const key of pooled) {
      const [slot, year] = key.split(':');
      expect(throwbackEraOwner(slot, Number(year), 'afl', aflTeams), key).toBeNull();
    }
  });

  it("labels another team's reserved default as its default, not a claim", async () => {
    // No Redis in tests: nobody has picked, so every default is reserved.
    const { buildThrowbackPickerView } = await import('../src/utils/throwback-settings-view');
    const view = await buildThrowbackPickerView(
      { franchiseId: '0001', leagueId: 'x' } as any,
      tlTeams,
      'theleague',
    );
    expect(view!.claimedBy['0004:2019']).toBe(`${team(tlTeams, '0004').name}'s default`);
    expect(Object.values(view!.claimedBy).some((c) => c.startsWith('Claimed by'))).toBe(false);
  });

  it("the commissioner panel does not count a reserved default as a pick", async () => {
    const { buildThrowbackSettingsView } = await import('../src/utils/throwback-settings-view');
    const view = await buildThrowbackSettingsView(
      { franchiseId: '0001', leagueId: 'x', role: 'admin' } as any,
      tlTeams,
      'theleague',
    );
    expect(view!.commishRows.length).toBe(tlTeams.length);
    // No Redis in tests, so nobody has picked.
    expect(view!.commishRows.filter((r) => r.hasPick).map((r) => r.franchiseId)).toEqual([]);
    const maverick = view!.commishRows.find((r) => r.franchiseId === '0003')!;
    expect(maverick.eras.find((e) => e.isDefault)?.yearStart).toBe(2016);
  });
});

