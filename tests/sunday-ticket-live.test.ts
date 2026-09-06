/**
 * Live points on the Sunday Ticket board — the four rules that make the
 * difference between a live board and a confidently wrong one.
 *
 * Each of these is a shape that has bitten this repo on some other surface,
 * and greps cannot hold any of them: they are all a truthiness check or a map
 * lookup that reads fine either way.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyLiveToContribution,
  buildSundayTicketSlate,
  type LeagueContribution,
  type SlateGame,
} from '../src/utils/sunday-ticket-slate';
import { buildMatchupCards, liveStateLabel } from '../src/utils/sunday-ticket-matchups';
import { parseLiveScoringPayload } from '../src/utils/live-scoring-snapshot';

const player = (playerId: string, nflTeam: string, proj: number) => ({
  playerId, name: `Player ${playerId}`, position: 'WR', nflTeam, proj,
});

const contribution = (over: Partial<LeagueContribution> = {}): LeagueContribution => ({
  leagueId: '13522',
  leagueName: 'TheLeague',
  franchiseId: '0001',
  franchiseName: 'Pacific Pigskins',
  lineupResolved: true,
  liveSupported: true,
  players: [player('1', 'KC', 14), player('2', 'BUF', 9)],
  ...over,
});

describe('applyLiveToContribution', () => {
  it('joins live points onto the contribution by MFL player id', () => {
    const merged = applyLiveToContribution(contribution(), {
      players: { '0001': [{ id: '1', live: 21.4, secondsRemaining: 900 }] },
    });
    expect(merged.players[0].live).toBe(21.4);
    expect(merged.players[0].secondsRemaining).toBe(900);
  });

  it('leaves a player the feed does not mention at live: undefined, NOT zero', () => {
    const merged = applyLiveToContribution(contribution(), {
      players: { '0001': [{ id: '1', live: 21.4, secondsRemaining: 900 }] },
    });
    // Absence of a live read renders as the projection. A 0.0 here would tell
    // an owner his starter has been held scoreless when we simply have no read.
    expect(merged.players[1].live).toBeUndefined();
    expect(merged.players[1].proj).toBe(9);
  });

  it('a null snapshot is a NO-OP — the league keeps its projections', () => {
    const before = contribution();
    const after = applyLiveToContribution(before, null);
    expect(after).toBe(before);
    expect(after.players.every((p) => p.live === undefined)).toBe(true);
  });

  it('reads only the franchise it belongs to', () => {
    const merged = applyLiveToContribution(contribution(), {
      players: { '0002': [{ id: '1', live: 99, secondsRemaining: 0 }] },
    });
    expect(merged.players[0].live).toBeUndefined();
  });

  it('NEVER merges bench rows: parse then merge drops the bench entirely', () => {
    // The realistic path — parse an MFL payload, hand the snapshot straight to
    // the merge. `bench` is a sibling key on that snapshot, and the merge must
    // not reach it: a bench player's points in the starters column is the same
    // projection-inflation bug the live board's own split exists to prevent.
    const snapshot = parseLiveScoringPayload({
      liveScoring: { franchise: {
        id: '0001',
        players: { player: [
          { id: '1', status: 'starter', score: '21.4', gameSecondsRemaining: '900' },
          { id: '2', status: 'nonstarter', score: '30.0', gameSecondsRemaining: '900' },
        ] },
      } },
    });
    expect(snapshot.bench['0001'].map((r) => r.id)).toEqual(['2']);

    const merged = applyLiveToContribution(contribution(), snapshot);
    expect(merged.players[0].live).toBe(21.4);
    // Player 2 IS on the contribution and DOES have a live number in the
    // payload — but only on the bench, so it must not be picked up.
    expect(merged.players[1].playerId).toBe('2');
    expect(merged.players[1].live).toBeUndefined();
  });
});

describe('live points never change the ranking', () => {
  // Sun Sep 20 2026, 1:00 PM ET — the early window.
  const EARLY = Math.floor(Date.UTC(2026, 8, 20, 17, 0) / 1000);
  const games: SlateGame[] = [
    { id: 'KC@BUF', kickoff: EARLY, away: 'KC', home: 'BUF' },
    { id: 'DAL@PHI', kickoff: EARLY, away: 'DAL', home: 'PHI' },
  ];

  it('a game with more STARTERS outranks one whose players are outscoring it', () => {
    // Two starters in KC@BUF projected low; one starter in DAL@PHI blowing up.
    const c = contribution({
      players: [
        player('1', 'KC', 4), player('2', 'BUF', 4),
        player('3', 'DAL', 30),
      ],
    });
    const live = applyLiveToContribution(c, {
      players: { '0001': [
        { id: '1', live: 1, secondsRemaining: 900 },
        { id: '2', live: 1, secondsRemaining: 900 },
        { id: '3', live: 60, secondsRemaining: 900 },
      ] },
    });

    const slate = buildSundayTicketSlate({ games, contributions: [live], personalized: true });
    const boxes = slate.windows[0].boxes.filter((b) => b.kind === 'game');
    // Scoring is not comparable across leagues, and live points are no more
    // comparable than projections — so they display, they never sort.
    expect(boxes[0].kind === 'game' && boxes[0].game.id).toBe('KC@BUF');
  });

  it('carries the live subtotal onto the box group without touching projTotal', () => {
    const live = applyLiveToContribution(contribution(), {
      players: { '0001': [
        { id: '1', live: 21.4, secondsRemaining: 900 },
        { id: '2', live: 3.1, secondsRemaining: 0 },
      ] },
    });
    const slate = buildSundayTicketSlate({ games, contributions: [live], personalized: true });
    const box = slate.windows[0].boxes.find((b) => b.kind === 'game' && b.game.id === 'KC@BUF');
    const group = box?.kind === 'game' ? box.byLeague[0] : null;
    expect(group?.liveTotal).toBe(24.5);
    expect(group?.projTotal).toBe(23);
    expect(group?.liveResolved).toBe(true);
  });

  it('a league with no live read reports liveResolved false and liveTotal 0', () => {
    const slate = buildSundayTicketSlate({ games, contributions: [contribution()], personalized: true });
    const box = slate.windows[0].boxes.find((b) => b.kind === 'game' && b.game.id === 'KC@BUF');
    const group = box?.kind === 'game' ? box.byLeague[0] : null;
    expect(group?.liveResolved).toBe(false);
    expect(group?.liveTotal).toBe(0);
  });

  it('an outside league is liveSupported false, so the UI can say "projections only"', () => {
    const outside = contribution({ leagueId: '99999', liveSupported: false });
    const slate = buildSundayTicketSlate({ games, contributions: [outside], personalized: true });
    const box = slate.windows[0].boxes.find((b) => b.kind === 'game' && b.game.id === 'KC@BUF');
    expect(box?.kind === 'game' && box.byLeague[0].liveSupported).toBe(false);
  });
});

describe('buildMatchupCards', () => {
  const brands = {
    '0001': { franchiseId: '0001', name: 'Pacific Pigskins', nameShort: 'PAC', colorPrimary: '#111', colorPrimaryDark: '#111', icon: '/a.png' },
    '0002': { franchiseId: '0002', name: 'Grid Iron Ghosts', nameShort: 'GIG', colorPrimary: '#222', colorPrimaryDark: '#222', icon: '/b.png' },
  };
  const base = {
    leagueId: '13522', leagueSlug: 'theleague', leagueName: 'TheLeague',
    franchiseId: '0001', brands, liveSupported: true,
    weekMatchups: [{ opponentFranchiseId: '0002' }],
  };

  it('names the opponent from the SCHEDULE even with no live read', () => {
    const [card] = buildMatchupCards({ ...base, snapshot: null });
    // The band must not blank on an MFL hiccup — the pairing is known all week.
    expect(card.opponent.name).toBe('Grid Iron Ghosts');
    expect(card.liveResolved).toBe(false);
    expect(card.you.score).toBe(0);
  });

  it('carries both crests and marks which side is yours', () => {
    const [card] = buildMatchupCards({ ...base, snapshot: null });
    expect([card.you.icon, card.opponent.icon]).toEqual(['/a.png', '/b.png']);
    expect(card.you.isYou).toBe(true);
    expect(card.opponent.isYou).toBe(false);
  });

  it('fills both sides from one payload and takes the max clock', () => {
    const snapshot = parseLiveScoringPayload({
      liveScoring: { matchup: { franchise: [
        { id: '0001', score: '118.4', gameSecondsRemaining: '1800', playersYetToPlay: '4' },
        { id: '0002', score: '96.2', gameSecondsRemaining: '0', playersYetToPlay: '0' },
      ] } },
    });
    const [card] = buildMatchupCards({ ...base, snapshot });
    expect(card.you.score).toBe(118.4);
    expect(card.opponent.score).toBe(96.2);
    expect(card.you.yetToPlay).toBe(4);
    expect(card.liveResolved).toBe(true);
    expect(card.secondsRemaining).toBe(1800);
  });

  it('renders one card per game of a doubleheader', () => {
    const cards = buildMatchupCards({
      ...base,
      weekMatchups: [{ opponentFranchiseId: '0002' }, { opponentFranchiseId: '0003' }],
      snapshot: null,
    });
    expect(cards).toHaveLength(2);
    expect(cards[1].opponent.name).toBe('Franchise 0003');
  });

  it('returns nothing without a franchise id', () => {
    expect(buildMatchupCards({ ...base, franchiseId: '', snapshot: null })).toEqual([]);
  });

  it('flags a best-ball league so the card can drop its Set lineup link', () => {
    // The registry is explicit that a `bestBall` league has NO lineups and
    // that "UI that offers any of those must be skipped". src/pages/best-ball-1
    // has no lineup.astro, so the link would 404 — and it is unreachable today
    // only because bb1 happens to ship no schedule feed, which is safety by
    // accident rather than by construction.
    expect(buildMatchupCards({ ...base, snapshot: null })[0].bestBall).toBe(false);
    expect(buildMatchupCards({ ...base, bestBall: true, snapshot: null })[0].bestBall).toBe(true);
  });
});

describe('liveStateLabel', () => {
  it('separates "cannot read live" from "nothing has happened yet"', () => {
    // An outside league and a league whose games have not kicked off look
    // identical in the numbers (both 0) and must not read identically.
    expect(liveStateLabel({ liveSupported: false, liveResolved: false, secondsRemaining: 0 }))
      .toBe('Projections only');
    expect(liveStateLabel({ liveSupported: true, liveResolved: false, secondsRemaining: 0 }))
      .toBe('Not started');
  });

  it('reads the game clock only once a live read has landed', () => {
    expect(liveStateLabel({ liveSupported: true, liveResolved: true, secondsRemaining: 1800 }))
      .toBe('In progress');
    expect(liveStateLabel({ liveSupported: true, liveResolved: true, secondsRemaining: 0 }))
      .toBe('Final');
    // Seconds remaining without a live read is not "in progress" — it is a
    // number we have no basis for, so the ladder must check resolved first.
    expect(liveStateLabel({ liveSupported: true, liveResolved: false, secondsRemaining: 1800 }))
      .toBe('Not started');
  });
});

describe('AFL duplicate players', () => {
  /**
   * With `duplicatePlayers: true` the same NFL player is started by two AFL
   * franchises at once — 85 of 131 starters in a real AFL week. The scoring
   * ticker had to key owners as `playerId -> fid[]` because a
   * `Map<playerId, fid>` dropped 41% of attributions.
   *
   * This merge is immune to that by CONSTRUCTION, and the test exists to keep
   * it that way: it looks up `snapshot.players[myFranchiseId]` FIRST and only
   * then joins by player id, so two franchises starting the same player each
   * read their own row. A future refactor that flattens the snapshot into one
   * player-keyed map before merging would reintroduce the exact bug.
   */
  it('gives each franchise its own row for a player both of them start', () => {
    const snapshot = parseLiveScoringPayload({
      liveScoring: { matchup: { franchise: [
        { id: '0006', score: '115.5', players: { player: [
          { id: '0507', status: 'starter', score: '11.0', gameSecondsRemaining: '0' },
        ] } },
        { id: '0002', score: '119.3', players: { player: [
          // Same NFL player, started by the other conference's franchise too.
          { id: '0507', status: 'starter', score: '11.0', gameSecondsRemaining: '0' },
        ] } },
      ] } },
    });

    const shared = (franchiseId: string) => applyLiveToContribution(
      contribution({ leagueId: '19621', franchiseId, players: [player('0507', 'KC', 8)] }),
      snapshot,
    );

    // Both owners see the player score — neither is dropped by a last-write-wins map.
    expect(shared('0006').players[0].live).toBe(11);
    expect(shared('0002').players[0].live).toBe(11);
    // And a franchise that does NOT start him gets nothing, not someone else's row.
    expect(shared('0099').players[0].live).toBeUndefined();
  });
});

/**
 * The two review findings that are SILENTLY wrong rather than visibly broken —
 * the board still renders, it just stops telling the truth. Both are pinned
 * here because neither shows up in a screenshot.
 */
describe('live-layer rendering contracts', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('gates the league heading on liveSupported, not liveResolved', () => {
    // The heading is the ONLY home of the per-league live subtotal, and the
    // island can only patch a span the server rendered. `multiLeague` is
    // `enabledIds.length > 1`, so gating on `liveResolved` meant a
    // single-league owner who opened the board before kickoff never got the
    // element — and therefore never got a running total, no matter how long
    // they watched.
    const box = read('../src/components/shared/sunday-ticket/SundayTicketBox.astro');
    expect(box).toContain('(multiLeague || group.liveSupported)');
    expect(box).not.toContain('(multiLeague || group.liveResolved)');
  });

  it('never lets the game-day hint pin the poll cadence to POLL_LIVE', () => {
    // `live` comes from Astro frontmatter and is fixed for the life of the
    // page. ORing it into liveNow made POLL_STALE unreachable on a Sunday, so
    // the board kept polling every 60s per league long after the last game
    // went final. Once a poll has landed, the DATA decides.
    const hook = read('../src/hooks/useLiveScoringFeed.ts');
    expect(hook).not.toMatch(/const liveNow = live \|\|/);
    expect(hook).toMatch(/state\.fetchedAt === 0\s*\?\s*live/);
  });

  it('shows the error state even when the FIRST poll is the one that failed', () => {
    // A failed first poll leaves fetchedAt at 0, so checking "Connecting…"
    // first swallowed the one state the freshness pill exists to surface.
    const island = read('../src/components/shared/sunday-ticket/SundayTicketLive.tsx');
    // Assert the branch order exactly. An earlier version of this guard sliced
    // from the first `el.textContent =` in the file — which is inside the
    // `setText` helper, not the pill — so it spanned almost the whole module
    // and passed with the bug reintroduced. Anchor on the assignment itself.
    expect(island).toContain('el.textContent = erroring');
    expect(island).not.toMatch(/el\.textContent = newest === 0/);
  });

  it('derives card state from BOTH franchises, per card, like the server does', () => {
    // The server takes Math.max across the pair, so a card whose owner is done
    // but whose opponent is still playing is "In progress". The island read
    // only the owner's clock and applied one label to every card in the
    // league — so it flipped such a card to "Final" (a divergence from the
    // very server render `liveStateLabel` is shared to keep it aligned with),
    // and a doubleheader's two cards, which have DIFFERENT opponents under one
    // league id, could never hold different states.
    const island = read('../src/components/shared/sunday-ticket/SundayTicketLive.tsx');
    expect(island).toMatch(/data-st-live-state\^=/);          // prefix match, per card
    expect(island).not.toMatch(/data-st-live-state="\$\{CSS\.escape\(leagueId\)\}"/);
    expect(island).toMatch(/Math\.max\(\.\.\.sides\.map/);
    // And the hook the server writes must carry both ids for that to be possible.
    const cards = read('../src/components/shared/sunday-ticket/SundayTicketMatchups.astro');
    expect(cards).toContain('${card.leagueId}:${card.you.franchiseId}:${card.opponent.franchiseId}');
  });

  it('never 500s the live route on a non-JSON upstream body', () => {
    // MFL answers a throttled request with an HTML page under a 200 often
    // enough to matter; an unguarded .json() escapes to the outer handler and
    // turns a degradable condition into a hard failure.
    const route = read('../src/pages/api/live-scoring.ts');
    expect(route).toContain('.json().catch(() => null)');
  });

  it('leaves a server-rendered value alone when the feed omits that franchise', () => {
    // playersYetToPlay is populated conditionally, so a franchise can vanish
    // between polls. Absent is "no answer", not "zero left to play".
    const island = read('../src/components/shared/sunday-ticket/SundayTicketLive.tsx');
    expect(island).toContain('if (ytp === undefined) return;');
  });
});
