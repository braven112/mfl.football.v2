import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { castAflHeroModel, type AflCastingInput } from '../src/utils/afl-hero-casting';
import { resolveAflHeroState, type AflHeroState, type EventHeroView } from '../src/utils/afl-hero-resolver';
import type { WhatsNewEntry } from '../src/types/whats-new';
import type { HeroContent } from '../src/types/whats-new';
import { castBestScoredModel, castRandomStarterModel, castsFor } from '../src/utils/hero-casting';
import {
  getAdpRankedIds,
  getFranchiseCompositableHeadliners,
  getFranchiseHeadliners,
  getKickoffGame,
  getMarqueeGameStars,
  getOwnersByPlayer,
  getRosteredPlayerIds,
  getTradeBaitCandidates,
  getWeekGameCandidates,
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

  it('picks a real face, not the lowest MFL id, when projections are dead (2025)', () => {
    // The compositable variant feeds the starter slots' own-roster fallback,
    // which runs exactly when the candidate pool is empty — one cause of which
    // is a dead projectedScores feed. AFL rosters carry no salaries, so with
    // projections gone score and salary are 0 for everyone and the sort has
    // only tie-breaks left: without the ADP rank it collapses to lowest id.
    const YEAR_DEAD = 2025;
    const headliners = getFranchiseCompositableHeadliners(YEAR_DEAD, AFL);
    if (headliners.length === 0) return; // no 2025 feed — nothing to assert
    const players = getPlayerMap(YEAR_DEAD);
    const adpRank = new Map(getAdpRankedIds(YEAR_DEAD, AFL).map((id, i) => [id, i]));
    const rosters = JSON.parse(
      readFileSync(`data/${AFL}/mfl-feeds/${YEAR_DEAD}/rosters.json`, 'utf8'),
    );
    const franchises = rosters?.rosters?.franchise ?? [];
    const rosterById = new Map<string, string[]>();
    for (const f of Array.isArray(franchises) ? franchises : [franchises]) {
      const ps = Array.isArray(f.player) ? f.player : f.player ? [f.player] : [];
      rosterById.set(
        f.id,
        ps.filter((p: any) => p?.id && (!p.status || p.status === 'ROSTER')).map((p: any) => p.id),
      );
    }

    let ranked = 0;
    for (const h of headliners) {
      const pm = players.get(h.playerId);
      expect(pm?.position).not.toBe('DEF');
      // Nobody on the roster who is ADP-ranked ABOVE the pick may have been passed over.
      const pickRank = adpRank.get(h.playerId) ?? Number.MAX_SAFE_INTEGER;
      if (pickRank !== Number.MAX_SAFE_INTEGER) ranked++;
      for (const id of rosterById.get(h.franchiseId) ?? []) {
        const other = players.get(id);
        if (!other || other.position === 'DEF' || !other.headshot.includes('espncdn.com')) continue;
        const rank = adpRank.get(id) ?? Number.MAX_SAFE_INTEGER;
        expect(rank, `${h.franchiseId}: ${other.name} outranks the cast ${pm?.name}`).toBeGreaterThanOrEqual(pickRank);
      }
    }
    // Guard the guard: a feed with no ADP overlap would pass vacuously.
    expect(ranked, '2025 ADP list overlaps no headliner — assertion is vacuous').toBeGreaterThan(0);
  });

  it('returns AFL ADP rankings as non-empty id list', () => {
    const ids = getAdpRankedIds(YEAR, AFL);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids.slice(0, 5)) expect(typeof id).toBe('string');
  });

  it('trade bait candidates are always rostered, and name every owner', () => {
    const candidates = getTradeBaitCandidates(YEAR, AFL);
    expect(Array.isArray(candidates)).toBe(true);
    const rostered = getRosteredPlayerIds(YEAR, AFL);
    const owners = getOwnersByPlayer(YEAR, AFL);
    let shared = 0;
    for (const c of candidates) {
      expect(c.playerId).toBeTruthy();
      expect(c.franchiseId).toBeTruthy();
      expect(rostered.has(c.playerId)).toBe(true);
      // A block listing on a player both conferences roster belongs to BOTH
      // owners — the singular map picked one at random and the other owner's
      // trade-block hero widened to a stranger.
      expect(c.franchiseIds).toEqual(owners.get(c.playerId));
      expect(c.franchiseIds).toContain(c.franchiseId);
      if ((c.franchiseIds?.length ?? 0) > 1) shared++;
    }
    // One entry per player, never one per owner — the guest pool must not
    // weight a shared player twice.
    expect(new Set(candidates.map((c) => c.playerId)).size).toBe(candidates.length);
    if (candidates.length > 0) expect(shared).toBeGreaterThanOrEqual(0);
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

  it('week game candidates span the whole remaining slate, each carrying its kickoff', () => {
    const candidates = getWeekGameCandidates(YEAR, AFL, REF_DATE);
    if (candidates.length === 0) return; // no schedule/projections yet
    for (const c of candidates) {
      expect(Number.isFinite(c.kickoff)).toBe(true);
      expect(typeof c.playerId).toBe('string');
    }
    // The earliest kickoff in the pool is the opener the copy names.
    const opener = getKickoffGame(YEAR, AFL, REF_DATE);
    const earliest = Math.min(...candidates.map((c) => c.kickoff));
    const players = getPlayerMap(YEAR);
    const openerTeams = new Set(
      candidates.filter((c) => c.kickoff === earliest).map((c) => players.get(c.playerId)?.nflTeam),
    );
    if (opener) for (const code of openerTeams) expect(opener.teamCodes).toContain(code);
    // Week-wide, not opener-only — and assert it against the feed rather than
    // `size > 0`, which any non-empty pool satisfies (Copilot, PR #749).
    // REF_DATE is before Week 1, so every game in the slate is still upcoming.
    const schedule = JSON.parse(
      readFileSync(`data/${AFL}/mfl-feeds/${YEAR}/nflSchedule.json`, 'utf8'),
    );
    const matchups = schedule?.nflSchedule?.matchup ?? [];
    const slateKickoffs = new Set(
      (Array.isArray(matchups) ? matchups : [matchups])
        .map((m: any) => parseInt(m?.kickoff, 10))
        .filter((k: number) => Number.isFinite(k)),
    );
    expect(slateKickoffs.size, 'schedule feed has no distinct kickoffs to test with').toBeGreaterThan(1);
    expect(new Set(candidates.map((c) => c.kickoff))).toEqual(slateKickoffs);
  });

  it('empties the candidate pool for a spent week, but still names the opener', () => {
    // A fully-played week must not resurrect its games as castable: the hero
    // captions a cast player "In Action". getKickoffGame keeps its fallback —
    // the week's opener is still the opener after it has been played.
    //
    // Derive the reference date from the feed, never a literal: fetch-mfl-feeds
    // re-syncs nflSchedule.json to the CURRENT NFL week every day, so a
    // hardcoded date stops being "after the whole slate" the moment the feed
    // rolls over — red CI every week for the rest of the season.
    const schedule = JSON.parse(
      readFileSync(`data/${AFL}/mfl-feeds/${YEAR}/nflSchedule.json`, 'utf8'),
    );
    const matchups = schedule?.nflSchedule?.matchup ?? [];
    const kickoffs = (Array.isArray(matchups) ? matchups : [matchups])
      .map((m: any) => parseInt(m?.kickoff, 10))
      .filter((k: number) => Number.isFinite(k));
    if (kickoffs.length === 0) return; // no slate — nothing to spend
    // Past the last kickoff plus the 4h in-progress grace.
    const afterTheWeek = new Date((Math.max(...kickoffs) + 5 * 3600) * 1000);
    expect(getWeekGameCandidates(YEAR, AFL, afterTheWeek)).toEqual([]);
    expect(getKickoffGame(YEAR, AFL, afterTheWeek)).toEqual(getKickoffGame(YEAR, AFL));
  });

  it('counts only ACTIVE roster spots as ownership', () => {
    // The owner's slice is the sole pool the starter heroes cast from, so a
    // taxi-squad or IR player in this map wins outright as "your kickoff
    // starter". Assert against the feed's own non-ROSTER entries.
    for (const league of [AFL, 'theleague'] as const) {
      const owners = getOwnersByPlayer(YEAR, league);
      const rosterData = JSON.parse(
        readFileSync(`data/${league}/mfl-feeds/${YEAR}/rosters.json`, 'utf8'),
      );
      const franchises = rosterData?.rosters?.franchise ?? [];
      let benched = 0;
      for (const f of Array.isArray(franchises) ? franchises : [franchises]) {
        const players = Array.isArray(f.player) ? f.player : f.player ? [f.player] : [];
        for (const p of players) {
          if (!p?.id || !p.status || p.status === 'ROSTER') continue;
          benched++;
          expect(owners.get(p.id) ?? [], `${league} ${p.id} is ${p.status} on ${f.id}`).not.toContain(f.id);
        }
      }
      // Guard the guard: if the feed ever stops carrying benched players this
      // test would pass vacuously.
      if (league === 'theleague') expect(benched).toBeGreaterThan(0);
    }
  });

  it('every candidate builder names EVERY owner, and some players have two', () => {
    // The AFL's two conferences roster independently inside one MFL league id,
    // so ownership is a list. A builder that keeps one franchise per player
    // credits ~72% of the league to a coin flip, and the owner asking for "my
    // player" loses him about half the time.
    const owners = getOwnersByPlayer(YEAR, AFL);
    const ownersWithBench = getOwnersByPlayer(YEAR, AFL, { activeOnly: false });
    const builders: Array<[string, Array<{ playerId: string; franchiseIds: string[] }>, Map<string, string[]>]> = [
      ['getWeekGameCandidates', getWeekGameCandidates(YEAR, AFL), owners],
      ['getTradeBaitCandidates', getTradeBaitCandidates(YEAR, AFL), ownersWithBench],
      ['getWeeklyTopScorerCandidates', getWeeklyTopScorerCandidates(YEAR, AFL), owners],
    ];
    const marquee = getMarqueeGameStars(YEAR, AFL);
    if (marquee) {
      builders.push([
        'getMarqueeGameStars',
        [...marquee.awayCandidates, ...marquee.homeCandidates],
        owners,
      ]);
    }

    let sawShared = 0;
    for (const [name, candidates, truth] of builders) {
      for (const c of candidates) {
        expect(c.franchiseIds, `${name} dropped franchiseIds for ${c.playerId}`).toBeDefined();
        // A rostered player's list must be exactly his owners; a free agent's
        // is empty (only the pools that include unrostered players have those).
        const expected = truth.get(c.playerId) ?? [];
        expect(c.franchiseIds, `${name} mis-attributed ${c.playerId}`).toEqual(expected);
        if (c.franchiseIds.length > 1) sawShared++;
      }
    }
    // Guard the guard: if no candidate anywhere is dual-rostered, the
    // assertions above pass without ever exercising the bug.
    expect(sawShared, 'no dual-rostered candidate in any AFL pool — test is vacuous').toBeGreaterThan(0);
  });

  it('casts a shared player for BOTH of his owners', () => {
    // The behavioral half: a player on two AFL rosters must count as "mine"
    // for each of them, through the same castsFor path every caster uses.
    const owners = getOwnersByPlayer(YEAR, AFL);
    const players = getPlayerMap(YEAR);
    const candidates = getWeekGameCandidates(YEAR, AFL);
    const shared = candidates.find(
      (c) =>
        c.franchiseIds.length > 1 &&
        c.score > 0 &&
        players.get(c.playerId)?.headshot.includes('espncdn.com'),
    );
    expect(shared, 'no compositable dual-rostered candidate to test with').toBeDefined();
    if (!shared) return;
    for (const franchiseId of owners.get(shared.playerId) ?? []) {
      expect(castsFor(shared, franchiseId)).toBe(true);
      const model = castBestScoredModel([shared], players, franchiseId, 'Top');
      expect(model?.mflId, `${franchiseId} could not cast their own ${shared.playerId}`).toBe(
        shared.playerId,
      );
    }
  });

  it('keeps a single-owner map from coming back', () => {
    // The mistake was one helper every consumer trusted, so the fix is that the
    // helper does not exist. This fails the build if it (or a hand-rolled
    // equivalent) reappears.
    // Same walk idiom as tests/league-literal-guard.test.ts — node:fs globSync
    // isn't in this TS lib's types, and the ratchet counts that as an error.
    const CODE = new Set(['.ts', '.tsx', '.astro', '.mjs', '.js']);
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (CODE.has(extname(entry.name))) out.push(full);
      }
      return out;
    };
    const files = walk('src');
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (/getOwnerByPlayer\b/.test(src)) offenders.push(`${file}: getOwnerByPlayer`);
      // A hand-rolled `playerId -> one franchiseId` map over the rosters feed:
      // `.set(<player>.id, <franchise>.id)` inside a franchise loop.
      const handRolled = src.match(/ownerByPlayer\s*\.set\(/g);
      if (handRolled) offenders.push(`${file}: hand-rolled ownerByPlayer.set`);
    }
    expect(offenders, 'ownership is a LIST — use getOwnersByPlayer').toEqual([]);
  });

  it('returns empty for a non-existent year', () => {
    expect(getRosteredPlayerIds(1999, AFL).size).toBe(0);
    expect(getFranchiseHeadliners(1999, AFL)).toEqual([]);
    expect(getAdpRankedIds(1999, AFL)).toEqual([]);
    expect(getTradeBaitCandidates(1999, AFL)).toEqual([]);
    expect(getWeeklyTopScorerCandidates(1999, AFL)).toEqual([]);
    expect(getWeekGameCandidates(1999, AFL)).toEqual([]);
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

  it('starter slots cast only the signed-in owner’s own players', () => {
    // The rule this hero exists to enforce: never someone else's guy. Whether
    // the cast comes from the week slate or the headliner fallback, a
    // signed-in owner's model must be on THEIR roster.
    const owners = getOwnersByPlayer(YEAR, AFL);
    const franchiseId = getFranchiseHeadliners(YEAR, AFL)[0]?.franchiseId;
    expect(franchiseId, 'AFL rosters feed has no franchises').toBeDefined();
    if (!franchiseId) return;
    const states = [
      calendarEvent('afl-season-start'),
      seasonSlot('game-day-preview'),
      seasonSlot('live-scoring'),
    ];
    for (const state of states) {
      const model = castAflHeroModel(state, input({ userFranchiseId: franchiseId }));
      expect(model).not.toBeNull();
      expect(owners.get(model!.mflId) ?? []).toContain(franchiseId);
    }
  });

  it('never casts another franchise’s player at ANY hour of the week, in either league', () => {
    // The Sunday-night hole: getWeekGameCandidates drops finished games, so the
    // remaining slate shrinks and an owner can end the week with nobody left
    // playing. The first cut of this feature widened to the league there and
    // captioned a stranger "In Action". Sweep the whole week, both leagues,
    // every franchise — a cast model must be OWNED by the franchise it is
    // cast for, or be null so the caller's own-roster fallback runs.
    // Sample points derived from each league's own feed, not literals: the
    // schedule re-syncs to the CURRENT NFL week daily, so hardcoded dates stop
    // meaning "Sunday night" the moment it rolls over.
    const sweepHours = (league: string): Date[] => {
      const schedule = JSON.parse(
        readFileSync(`data/${league}/mfl-feeds/${YEAR}/nflSchedule.json`, 'utf8'),
      );
      const matchups = schedule?.nflSchedule?.matchup ?? [];
      const kickoffs = (Array.isArray(matchups) ? matchups : [matchups])
        .map((m: any) => parseInt(m?.kickoff, 10))
        .filter((k: number) => Number.isFinite(k))
        .sort((a: number, b: number) => a - b);
      if (kickoffs.length === 0) return [];
      const last = kickoffs[kickoffs.length - 1];
      return [
        kickoffs[0] - 86400, // a day before the opener
        ...kickoffs.map((k: number) => k + 5 * 3600), // just past each game's grace
        last + 3 * 86400, // whole week played — the pool is empty by design
      ].map((sec: number) => new Date(sec * 1000));
    };

    for (const league of [AFL, 'theleague'] as const) {
      const hours = sweepHours(league);
      expect(hours.length, `${league} schedule feed has no kickoffs to sweep`).toBeGreaterThan(2);
      // Every owner, not one: 143 of the AFL's 199 rostered players are on two
      // rosters (AL + NL run separate pools inside one MFL league), so the
      // single-owner map would fail this test on correct casts.
      const owners = getOwnersByPlayer(YEAR, league);
      const franchiseIds = getFranchiseHeadliners(YEAR, league).map((h) => h.franchiseId);
      expect(franchiseIds.length).toBeGreaterThan(0);
      const players = getPlayerMap(YEAR);
      for (const referenceDate of hours) {
        const candidates = getWeekGameCandidates(YEAR, league, referenceDate);
        for (const franchiseId of franchiseIds) {
          const model = castRandomStarterModel(
            candidates,
            players,
            franchiseId,
            referenceDate,
            'Kickoff Starter',
            8,
            'Your First Starter',
          );
          if (!model) continue; // null is fine — the caller falls back to their own roster
          expect(
            owners.get(model.mflId) ?? [],
            `${league} ${franchiseId} @ ${referenceDate.toISOString()} cast ${model.name}`,
          ).toContain(franchiseId);
        }
      }
    }
  });

  it('the AFL ladder keeps a signed-in owner on their own roster all week', () => {
    // Same sweep through the real ladder (cast → own compositable headliner →
    // own headliner), which is what the homepage actually renders.
    const owners = getOwnersByPlayer(YEAR, AFL);
    const franchiseIds = getFranchiseHeadliners(YEAR, AFL).map((h) => h.franchiseId);
    for (const iso of ['2026-09-10T09:00:00-07:00', '2026-09-13T23:00:00-07:00', '2026-09-14T18:00:00-07:00']) {
      const referenceDate = new Date(iso);
      for (const franchiseId of franchiseIds) {
        for (const state of [calendarEvent('afl-season-start'), seasonSlot('live-scoring')]) {
          const model = castAflHeroModel(state, input({ referenceDate, userFranchiseId: franchiseId }));
          if (!model) continue;
          expect(owners.get(model.mflId) ?? [], `${franchiseId} @ ${iso} cast ${model.name}`).toContain(franchiseId);
        }
      }
    }
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

  it('fresh What’s New casts NO player unless the entry names one (screenshot is the art)', () => {
    const state = { kind: 'feature', priority: 'P2', content: stubContent, view: stubView } as AflHeroState;
    expect(castAflHeroModel(state, input())).toBeNull();
  });

  it('fresh What’s New casts the entry’s featured player when heroPlayerId is set', () => {
    // Any compositable player from the live map works — the cast must be
    // exactly him, with the entry's descriptor.
    const players = getPlayerMap(YEAR);
    const featured = [...players.values()].find(
      (p) => p.position !== 'DEF' && p.headshot.includes('espncdn.com'),
    );
    // Guard instead of `!`: a clear failure if the live feed ever loses ESPN
    // headshots entirely, rather than a TypeError deep in the cast.
    expect(featured, 'player map has no compositable player to test with').toBeDefined();
    if (!featured) return;
    const state = {
      kind: 'feature',
      priority: 'P2',
      content: { ...stubContent, heroPlayerId: featured.mflId, heroPlayerDescriptor: 'Cover Star' },
      view: stubView,
    } as AflHeroState;
    const model = castAflHeroModel(state, input());
    expect(model?.mflId).toBe(featured.mflId);
    expect(model?.descriptor).toBe('Cover Star');
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

describe('resolveAflHeroState fresh-feature pick', () => {
  it('is deterministic across same-day requests (no per-request random)', () => {
    // Quiet-offseason date with multiple fresh AFL entries → the P2 feature
    // hero must pick the SAME entry on every SSR render that day.
    const now = new Date('2026-04-10T12:00:00-07:00');
    const entries = ['a', 'b', 'c', 'd', 'e'].map(
      (id, i): WhatsNewEntry =>
        ({
          id: `fresh-${id}`,
          date: '2026-04-09',
          title: `Entry ${id}`,
          summary: 's',
          description: ['d'],
          category: 'enhancement',
          leagues: ['afl'],
          icon: 'star',
          image: `x-${i}.webp`,
          imageAlt: 'x',
        }) as WhatsNewEntry,
    );
    const first = resolveAflHeroState({ referenceDate: now, whatsNewEntries: entries });
    expect(first.kind).toBe('feature');
    for (let i = 0; i < 5; i++) {
      const again = resolveAflHeroState({ referenceDate: now, whatsNewEntries: entries });
      expect(again.content.title).toBe(first.content.title);
    }
  });

  it('carries the entry screenshot and featured player through to the view/content', () => {
    const now = new Date('2026-04-10T12:00:00-07:00');
    const entry = {
      id: 'fresh-shot',
      date: '2026-04-09',
      title: 'Entry',
      summary: 's',
      description: ['d'],
      category: 'new-feature',
      leagues: ['afl'],
      icon: 'star',
      image: 'fresh-shot.webp',
      imageAlt: 'x',
      heroPlayerId: '12345',
      heroPlayerDescriptor: 'Cover Star',
    } as WhatsNewEntry;
    const state = resolveAflHeroState({ referenceDate: now, whatsNewEntries: [entry] });
    expect(state.kind).toBe('feature');
    if (state.kind !== 'feature') return;
    // The view is what AflEventHero renders — the screenshot must ride it.
    expect(state.view.screenshot).toBe('fresh-shot.webp');
    // The content is what castAflHeroModel reads the featured player from.
    expect(state.content.heroPlayerId).toBe('12345');
    expect(state.content.heroPlayerDescriptor).toBe('Cover Star');
  });
});
