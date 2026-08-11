/**
 * "Most Points Allowed" — direction ruling, 2026-08-11.
 *
 * Commissioner ruling: allowing MORE points must BENEFIT the team, in every
 * league and in both contexts. If two teams are tied on every earlier step, the
 * team that gave up more points gets BOTH the better standing AND the better
 * (earlier) draft pick.
 *
 * That is deliberately not a single ordering. Draft order is reverse standings,
 * so one direction cannot produce both outcomes — the step is decoupled, and
 * these tests pin both halves so a future "simplification" can't silently
 * re-couple them.
 *
 * Both rulebooks have always worded the step "Most Points Allowed"
 * (src/data/league-constitution.ts, docs/claude/afl-rules.md). The code used to
 * read it as "fewest points allowed wins", which punished a team that had
 * already been unlucky — in the AFL's draft path it happened to be right for
 * the wrong reason, and everywhere else it was backwards.
 *
 * This step has never actually decided a real division title in 76 TheLeague
 * or 106 AFL division-seasons, so these are synthetic fixtures by necessity.
 */
import { describe, it, expect } from 'vitest';
import {
  rankDivisionStandingsBestFirst,
  calculateAFLDraftOrder,
} from '../src/utils/afl-draft-utils';
import { calculateDraftOrder } from '../src/utils/draft-utils';
import {
  getDivisionStandings,
  getAllPlayStandings,
  getTierAllPlayStandings,
} from '../src/utils/standings';

// Two teams identical on every step of both chains EXCEPT points allowed.
// 0002 allowed more (1900 v 1600) and must therefore win the tiebreak.
const TIED_EXCEPT_PA = [
  {
    id: '0001',
    h2hwlt: '10-8-0',
    divwlt: '3-3-0',
    divpct: '.500',
    confpct: '.500',
    pwr: '40.00',
    pf: '1800.00',
    all_play_pct: '.600',
    vp: '50',
    pa: '1600.00',
  },
  {
    id: '0002',
    h2hwlt: '10-8-0',
    divwlt: '3-3-0',
    divpct: '.500',
    confpct: '.500',
    pwr: '40.00',
    pf: '1800.00',
    all_play_pct: '.600',
    vp: '50',
    pa: '1900.00',
  },
];

describe('most points allowed — standings direction (AFL chain)', () => {
  it('ranks the team that allowed MORE points higher', () => {
    const ranked = rankDivisionStandingsBestFirst(TIED_EXCEPT_PA as never[]);
    expect(ranked.map((t) => t.id)).toEqual(['0002', '0001']);
  });

  it('is the points-allowed step doing the work, not input order', () => {
    // Same fixture reversed — a stable-sort artifact would flip with it.
    const reversed = [...TIED_EXCEPT_PA].reverse();
    const ranked = rankDivisionStandingsBestFirst(reversed as never[]);
    expect(ranked.map((t) => t.id)).toEqual(['0002', '0001']);
  });

  it('still loses to every earlier step in the chain', () => {
    // 0001 allowed fewer points but has more victory points (step 7). The
    // earlier step must win — points allowed only breaks a total deadlock.
    const vpWins = [
      { ...TIED_EXCEPT_PA[0], vp: '60' },
      { ...TIED_EXCEPT_PA[1] },
    ];
    expect(rankDivisionStandingsBestFirst(vpWins as never[]).map((t) => t.id)).toEqual([
      '0001',
      '0002',
    ]);
  });
});

describe('most points allowed — standings direction (src/utils/standings.ts)', () => {
  // This path has no production callers since both leagues moved to
  // preserveFeedOrder, but it stays consistent with the ruling so anything
  // that picks it back up inherits the right behavior.
  const config = {
    teams: [
      { franchiseId: '0001', name: 'Fewer PA', division: 'Test' },
      { franchiseId: '0002', name: 'More PA', division: 'Test' },
    ],
    divisions: ['Test'],
  };

  it('ranks the team that allowed MORE points higher', () => {
    const divisions = getDivisionStandings(TIED_EXCEPT_PA as never[], config as never);
    expect(divisions[0].teams.map((t) => t.id)).toEqual(['0002', '0001']);
  });

  // The all-play sorters are TheLeague's Wild Card chain (All Play -> Total
  // points -> Power Rank -> Victory Points -> Most Points Allowed) and, unlike
  // divisionTiebreaker, they ARE live: getAllPlayStandings backs the all-play
  // view on the standings page and getTierAllPlayStandings backs the AFL's
  // tier view. They were missed in the first pass at the ruling and kept
  // ranking the lower-PA team higher — caught in review on PR #501.
  it('applies the same direction in the all-play view', () => {
    const ranked = getAllPlayStandings(TIED_EXCEPT_PA as never[], config as never);
    expect(ranked.map((t) => t.id)).toEqual(['0002', '0001']);
  });

  it('applies the same direction in the tiered all-play view', () => {
    const tiers = getTierAllPlayStandings(
      TIED_EXCEPT_PA as never[],
      config as never,
      undefined,
      // Only 'Premier League' / 'D-League' are honored as overrides; anything
      // else falls back to config.tier and lands under 'Unknown'.
      { '0001': 'Premier League', '0002': 'Premier League' }
    );
    const premier = tiers.find((t) => t.tier === 'Premier League');
    expect(premier, 'expected a Premier League tier block').toBeTruthy();
    expect(premier!.teams.map((t) => t.id)).toEqual(['0002', '0001']);
  });
});

describe('most points allowed — draft direction', () => {
  // Draft order is worst-first: pick 1 goes to the team ranked worst. The
  // team that allowed MORE points must get the earlier pick. Both leagues'
  // sortByRecordReverse is module-private, so drive the exported entry points.

  it('gives the team that allowed MORE points the earlier pick (TheLeague)', () => {
    const teamConfigs = new Map([
      ['0001', { franchiseId: '0001', name: 'Fewer PA' }],
      ['0002', { franchiseId: '0002', name: 'More PA' }],
    ]);
    // No champion, no toilet-bowl comp picks — isolate the tiebreaker.
    const order = calculateDraftOrder(
      TIED_EXCEPT_PA as never[],
      teamConfigs as never,
      '',
      []
    );
    expect(order[0].franchiseId).toBe('0002');
    expect(order[1].franchiseId).toBe('0001');
  });

  it('gives the team that allowed MORE points the earlier pick (AFL)', () => {
    const teamConfigs = new Map([
      ['0001', { franchiseId: '0001', name: 'Fewer PA', conference: '00', division: '00' }],
      ['0002', { franchiseId: '0002', name: 'More PA', conference: '00', division: '00' }],
    ]);
    const conferences = calculateAFLDraftOrder(
      TIED_EXCEPT_PA as never[],
      teamConfigs as never,
      new Map(), // no conference champion — nobody forced to the last pick
      new Map() // no NIT bonus — round 1 keeps the base order
    );
    const american = conferences.find((c) => c.conference === 'American League');
    expect(american, 'expected an American League conference block').toBeTruthy();
    // Round 2 follows the BASE reverse-standings order untouched by the NIT
    // bonus, so it reads the tiebreaker most directly.
    const round2 = american!.picks
      .filter((p) => p.round === 2)
      .sort((a, b) => a.pick - b.pick);
    expect(round2[0].franchiseId).toBe('0002');
  });

  it('keeps the two directions decoupled — one team wins both ends', () => {
    // The whole point of the ruling: the SAME team (more points allowed) takes
    // the BEST standing AND the FIRST pick. Draft order is reverse standings,
    // so a single shared ordering mathematically cannot produce both — whoever
    // tops the standings would necessarily pick last. These two agreeing on
    // '0002' is therefore the proof that the step is still decoupled; if they
    // ever DISAGREE, someone has re-merged the directions.
    const standingsBest = rankDivisionStandingsBestFirst(TIED_EXCEPT_PA as never[])[0].id;
    const teamConfigs = new Map([
      ['0001', { franchiseId: '0001', name: 'Fewer PA' }],
      ['0002', { franchiseId: '0002', name: 'More PA' }],
    ]);
    const draftFirst = calculateDraftOrder(
      TIED_EXCEPT_PA as never[],
      teamConfigs as never,
      '',
      []
    )[0].franchiseId;
    expect(standingsBest).toBe('0002');
    expect(draftFirst).toBe('0002');
  });
});
