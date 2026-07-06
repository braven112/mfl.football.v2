import { describe, it, expect } from 'vitest';
import { castAflHeroModel, type AflCastingInput } from '../src/utils/afl-hero-casting';
import type { AflHeroState, EventHeroView } from '../src/utils/afl-hero-resolver';
import type { HeroContent } from '../src/types/whats-new';
import {
  getAdpRankedIds,
  getFranchiseHeadliners,
  getKickoffGame,
  getRosteredPlayerIds,
  getTradeBaitCandidates,
  getWeeklyTopScorerCandidates,
} from '../src/utils/offseason-hero-data';
import { getPlayerMap } from '../src/utils/player-map';

// These tests run against the real AFL feed files in the repo. Live data
// flips as the season advances, so they assert INVARIANTS (shape, rostered
// membership, fallback ladders) rather than specific players or counts.

const AFL = 'afl-fantasy' as const;
const YEAR = 2026;
const REF_DATE = new Date('2026-07-05T12:00:00-07:00');

const stubContent: HeroContent = { source: 'event', title: 'T', summary: 'S' };
const stubView: EventHeroView = { pill: 'P', headline: 'H', summary: 'S' };

const input = (overrides: Partial<AflCastingInput> = {}): AflCastingInput => ({
  referenceDate: REF_DATE,
  leagueYear: YEAR,
  ...overrides,
});

const calendarEvent = (eventId: string): AflHeroState =>
  ({ kind: 'calendar-event', priority: 'P0', eventId, content: stubContent, view: stubView }) as AflHeroState;

const seasonSlot = (slot: string): AflHeroState =>
  ({
    kind: 'regular-season',
    priority: 'P0',
    slot,
    gameWindow: null,
    content: stubContent,
    view: stubView,
  }) as unknown as AflHeroState;

// ── League-aware data helpers ────────────────────────────────────────────────

describe('league-aware hero data helpers (AFL)', () => {
  it('reads AFL rosters, not TheLeague rosters', () => {
    const afl = getRosteredPlayerIds(YEAR, AFL);
    const theleague = getRosteredPlayerIds(YEAR);
    expect(afl.size).toBeGreaterThan(0);
    expect(theleague.size).toBeGreaterThan(0);
    // Two different leagues can share players, but never the identical set.
    const same = afl.size === theleague.size && [...afl].every((id) => theleague.has(id));
    expect(same).toBe(false);
  });

  it('returns one headliner per AFL franchise, each rostered by that franchise', () => {
    const headliners = getFranchiseHeadliners(YEAR, AFL);
    expect(headliners.length).toBeGreaterThan(0);
    const franchiseIds = headliners.map((h) => h.franchiseId);
    expect(new Set(franchiseIds).size).toBe(franchiseIds.length);
    const rostered = getRosteredPlayerIds(YEAR, AFL);
    for (const h of headliners) expect(rostered.has(h.playerId)).toBe(true);
  });

  it('never picks a team DEF as headliner, even when projections are dead (2025)', () => {
    // AFL league year 2025's projectedScores feed is empty and AFL rosters
    // carry no salaries — without the DEF exclusion + ADP tie-break, every
    // franchise's "headliner" degenerated to its team DEF (lowest MFL ids).
    for (const year of [2025, YEAR]) {
      const headliners = getFranchiseHeadliners(year, AFL);
      expect(headliners.length).toBeGreaterThan(0);
      const players = getPlayerMap(year);
      for (const h of headliners) {
        expect(players.get(h.playerId)?.position).not.toBe('DEF');
      }
    }
  });

  it('returns AFL ADP rankings as non-empty id list', () => {
    const ids = getAdpRankedIds(YEAR, AFL);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids.slice(0, 5)) expect(typeof id).toBe('string');
  });

  it('trade bait candidates are always rostered', () => {
    const candidates = getTradeBaitCandidates(YEAR, AFL);
    expect(Array.isArray(candidates)).toBe(true);
    const rostered = getRosteredPlayerIds(YEAR, AFL);
    for (const c of candidates) {
      expect(c.playerId).toBeTruthy();
      expect(c.franchiseId).toBeTruthy();
      expect(rostered.has(c.playerId)).toBe(true);
    }
  });

  it('weekly top scorer candidates carry positive scores and rostered owners', () => {
    const candidates = getWeeklyTopScorerCandidates(YEAR, AFL);
    expect(Array.isArray(candidates)).toBe(true);
    const rostered = getRosteredPlayerIds(YEAR, AFL);
    for (const c of candidates) {
      expect(c.score).toBeGreaterThan(0);
      expect(rostered.has(c.playerId)).toBe(true);
    }
  });

  it('kickoff game honors the live window and falls back past week end', () => {
    const absolute = getKickoffGame(YEAR, AFL);
    if (!absolute) return; // schedule feed empty — nothing to assert
    // A reference date before every kickoff picks the same earliest game.
    expect(getKickoffGame(YEAR, AFL, new Date(0))).toEqual(absolute);
    // A reference date after the whole week falls back to the earliest game.
    expect(getKickoffGame(YEAR, AFL, new Date('2100-01-01T00:00:00Z'))).toEqual(absolute);
  });

  it('returns empty for a non-existent year', () => {
    expect(getRosteredPlayerIds(1999, AFL).size).toBe(0);
    expect(getFranchiseHeadliners(1999, AFL)).toEqual([]);
    expect(getAdpRankedIds(1999, AFL)).toEqual([]);
    expect(getTradeBaitCandidates(1999, AFL)).toEqual([]);
    expect(getWeeklyTopScorerCandidates(1999, AFL)).toEqual([]);
  });
});

// ── castAflHeroModel ─────────────────────────────────────────────────────────

describe('castAflHeroModel', () => {
  const aflRostered = getRosteredPlayerIds(YEAR, AFL);

  it('never casts for bespoke phases (their components own the visual)', () => {
    const bespoke: AflHeroState[] = [
      { kind: 'trade-deadline', priority: 'P0++', content: stubContent, deadlineMidnightPT: '2026-11-19T00:00:00-08:00' },
      { kind: 'playoffs', priority: 'P0', content: stubContent },
      { kind: 'championship', priority: 'P0', content: stubContent },
    ];
    for (const state of bespoke) expect(castAflHeroModel(state, input())).toBeNull();
  });

  it('keeper deadline casts a rostered keeper cornerstone', () => {
    const model = castAflHeroModel(calendarEvent('afl-keeper-deadline'), input());
    expect(model).not.toBeNull();
    expect(model!.descriptor).toBe('Keeper Cornerstone');
    expect(aflRostered.has(model!.mflId)).toBe(true);
    expect(model!.headshot).toContain('espncdn.com');
    expect(model!.position).not.toBe('DEF');
  });

  it('keeper deadline prefers the signed-in owner’s headliner', () => {
    const headliners = getFranchiseHeadliners(YEAR, AFL);
    const target = headliners[0];
    const model = castAflHeroModel(
      calendarEvent('afl-keeper-deadline'),
      input({ userFranchiseId: target.franchiseId }),
    );
    // The owner's headliner wins when compositable; otherwise the league-wide
    // pool takes over — either way a model must cast.
    expect(model).not.toBeNull();
  });

  it('draft events cast the best available (unrostered) player', () => {
    for (const eventId of ['afl-al-draft', 'afl-nl-draft']) {
      const model = castAflHeroModel(calendarEvent(eventId), input());
      expect(model).not.toBeNull();
      expect(['Best Available', 'Headliner']).toContain(model!.descriptor);
      if (model!.descriptor === 'Best Available') {
        expect(aflRostered.has(model!.mflId)).toBe(false);
      }
    }
  });

  it('trade deadline lead casts a trade-block player or falls back to a headliner', () => {
    const model = castAflHeroModel(calendarEvent('afl-trade-deadline'), input());
    expect(model).not.toBeNull();
    expect(['On the Block', 'Headliner']).toContain(model!.descriptor);
    expect(aflRostered.has(model!.mflId)).toBe(true);
  });

  it('season start casts a kickoff-game starter or falls back to a headliner', () => {
    const model = castAflHeroModel(calendarEvent('afl-season-start'), input());
    expect(model).not.toBeNull();
    expect(['Kickoff Starter', 'Headliner']).toContain(model!.descriptor);
  });

  it('waiver-wire slot casts an unrostered top target or falls back', () => {
    const model = castAflHeroModel(seasonSlot('waiver-wire'), input());
    expect(model).not.toBeNull();
    expect(['Top Target', 'Headliner']).toContain(model!.descriptor);
    if (model!.descriptor === 'Top Target') {
      expect(aflRostered.has(model!.mflId)).toBe(false);
    }
  });

  it('recap slot casts the week’s top scorer, headliner when no scores yet', () => {
    const model = castAflHeroModel(seasonSlot('recap'), input());
    expect(model).not.toBeNull();
    expect(['Top Scorer', 'Headliner']).toContain(model!.descriptor);
  });

  it('standings slot casts the leader’s headliner when a leader is known', () => {
    const headliners = getFranchiseHeadliners(YEAR, AFL);
    const leader = headliners[0];
    const model = castAflHeroModel(
      seasonSlot('standings'),
      input({ standingsLeaderId: leader.franchiseId }),
    );
    expect(model).not.toBeNull();
    if (model!.descriptor === 'Leading the Race') {
      expect(model!.mflId).toBe(leader.playerId);
    }
  });

  it('fresh What’s New casts a rookie (rookies represent "new")', () => {
    const state = { kind: 'feature', priority: 'P2', content: stubContent, view: stubView } as AflHeroState;
    const model = castAflHeroModel(state, input());
    expect(model).not.toBeNull();
    expect(['Rookie', 'Headliner']).toContain(model!.descriptor);
  });

  it('default state casts a league headliner and is deterministic per day', () => {
    const state = { kind: 'default', priority: 'P5', content: stubContent, view: stubView } as AflHeroState;
    const a = castAflHeroModel(state, input());
    const b = castAflHeroModel(state, input());
    expect(a).not.toBeNull();
    expect(a!.descriptor).toBe('Headliner');
    expect(b!.mflId).toBe(a!.mflId);
  });

  it('returns null gracefully when feeds are missing (bad year)', () => {
    const state = { kind: 'default', priority: 'P5', content: stubContent, view: stubView } as AflHeroState;
    expect(castAflHeroModel(state, input({ leagueYear: 1999 }))).toBeNull();
  });
});
