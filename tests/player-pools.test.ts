/**
 * Player pools by MFL `playerLimitUnit` — LEAGUE (one pool), CONFERENCE (the
 * AFL's two) and DIVISION (archies' nine). Pinned against the committed
 * feeds. The archies roster census is the reason this exists: 190 of its 213
 * rostered players sit on more than one roster, never twice in one division,
 * and every check that read "on another roster" as "taken" treated those as
 * unavailable league-wide.
 */
import { describe, expect, it } from 'vitest';
import archiesLeague from '../data/archies/mfl-feeds/2026/league.json';
import archiesRosters from '../data/archies/mfl-feeds/2026/rosters.json';
import archiesPlayers from '../data/archies/mfl-feeds/2026/players.json';
import aflLeague from '../data/afl-fantasy/mfl-feeds/2026/league.json';
import tlLeague from '../data/theleague/mfl-feeds/2026/league.json';
import { buildPoolStructure, buildConferenceStructure } from '../src/utils/afl-conference-rosters.mjs';
import { poolOfFranchise, freeAgencyIsLeagueWide } from '../src/utils/waiver-claim';
import { lockedUnitKey } from '../src/utils/mfl-locked-players';
import {
  poolStructure,
  startingPositions,
  resolvePool,
  heldByPool,
  buildFreeAgents,
  displayName,
} from '../src/utils/package-free-agents';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const archies = poolStructure(archiesLeague)!;
const rosters = (archiesRosters as any).rosters.franchise;

describe('buildPoolStructure', () => {
  it('gives archies one pool per division', () => {
    expect(archies.ids).toHaveLength(9);
    expect(Object.keys(archies.franchiseConferences)).toHaveLength(99);
    for (const id of archies.ids) {
      const members = Object.values(archies.franchiseConferences).filter((p) => p === id);
      expect(members).toHaveLength(11);
      expect(archies.names[id].name).toBe(archies.names[id].name.trim());
    }
  });

  it('is exactly the conference structure for the AFL, and one pool for TheLeague', () => {
    expect(buildPoolStructure(aflLeague)).toEqual(buildConferenceStructure(aflLeague));
    expect(buildPoolStructure(tlLeague)).toBeNull();
  });
});

describe('pool-aware claim helpers', () => {
  const lg = (archiesLeague as any).league;
  it('treats a DIVISION league as pooled and places a franchise in its division', () => {
    expect(freeAgencyIsLeagueWide(lg)).toBe(false);
    const fid = Object.keys(archies.franchiseConferences)[0];
    expect(poolOfFranchise(lg, fid)).toBe(archies.franchiseConferences[fid]);
  });

  it('keeps LEAGUE league-wide and CONFERENCE on conferences', () => {
    expect(freeAgencyIsLeagueWide((tlLeague as any).league)).toBe(true);
    expect(poolOfFranchise((tlLeague as any).league, '0001')).toBeNull();
    const afl = buildConferenceStructure(aflLeague) as unknown as { franchiseConferences: Record<string, string> };
    expect(poolOfFranchise((aflLeague as any).league, '0001')).toBe(afl.franchiseConferences['0001']);
  });

  it('keys a DIVISION lock unit to the division id', () => {
    expect(lockedUnitKey('DIVISION03')).toBe('03');
    expect(lockedUnitKey('CONFERENCE01')).toBe('01');
    expect(lockedUnitKey('LEAGUE')).toBe('');
  });

  it('marks archies as a duplicate-player league', () => {
    expect((LEAGUES as any).archies.duplicatePlayers).toBe(true);
  });
});

describe('division free agents', () => {
  const held = heldByPool(rosters, archies);

  it('never holds a player twice inside one division (the census)', () => {
    for (const f of rosters) {
      const pool = archies.franchiseConferences[f.id];
      const others = rosters.filter((o: any) => o.id !== f.id && archies.franchiseConferences[o.id] === pool);
      const mine = new Set([].concat(f.player ?? []).map((p: any) => p.id));
      for (const o of others) for (const p of [].concat(o.player ?? [])) expect(mine.has((p as any).id)).toBe(false);
    }
    // …while many players are held in several divisions at once.
    const multi = [...new Set(rosters.flatMap((f: any) => [].concat(f.player ?? []).map((p: any) => p.id)))].filter(
      (id) => [...held.values()].filter((s) => s.has(id as string)).length > 1,
    );
    expect(multi.length).toBeGreaterThan(100);
  });

  it("lists only players free in THIS division, at the league's starting positions", () => {
    const positions = startingPositions(archiesLeague);
    expect(positions).toEqual(['QB', 'RB', 'WR', 'TE', 'Def']);
    const pool = archies.ids[0];
    const rows = buildFreeAgents({ players: (archiesPlayers as any).players.player, positions, pool, held });
    const mine = held.get(pool)!;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !mine.has(r.id))).toBe(true);
    expect(rows.every((r) => positions.includes(r.position))).toBe(true);
    // A player rostered in other divisions can still be free here.
    expect(rows.some((r) => r.heldIn > 0)).toBe(true);
  });

  it("opens on the viewer's own division, honours a real request, never invents one", () => {
    const fid = Object.keys(archies.franchiseConferences)[40];
    const own = archies.franchiseConferences[fid];
    expect(resolvePool(archies, null, fid)).toBe(own);
    expect(resolvePool(archies, archies.ids[3], fid)).toBe(archies.ids[3]);
    expect(resolvePool(archies, 'nope', fid)).toBe(own);
    expect(resolvePool(archies, null, null)).toBe(archies.ids[0]);
  });

  it('turns MFL "Last, First" into a display name', () => {
    expect(displayName('Allen, Josh')).toBe('Josh Allen');
    expect(displayName('Bills, Buffalo')).toBe('Buffalo Bills');
    expect(displayName('Plain')).toBe('Plain');
  });
});
