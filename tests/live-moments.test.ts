/**
 * The board-neutral moments builder, and the per-matchup selector.
 *
 * Both exist because the broadcast board's `buildBroadcastMoments` is
 * VIEWER-RELATIVE — it emits rows only for the viewer's franchise and their
 * opponents. That is right for MFL Live, which is a board OF your teams, and
 * wrong for a league board where fifteen of sixteen matchups are nobody's and
 * every one of their tickers would come back empty.
 *
 * The rules pinned here are the ones that have each shipped a visible bug.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { buildLiveMoments } from '../src/utils/live/moments';
import { buildLiveMatchup, buildLiveTeam, selectMatchupMoments } from '../src/utils/live/model';
import LvMomentTicker from '../src/components/shared/live/LvMomentTicker';
import type { LiveMoment, LivePanel } from '../src/types/live';
import type { LivePlayerRow, LiveScoringPlay, PlayerMeta } from '../src/types/live-scoring';
import type { FranchiseIdentity } from '../src/utils/mfl-live-identity';

const text = (html: string) => html.replace(/<!-- -->/g, '');

const identity = (franchiseId: string, name: string): FranchiseIdentity => ({
  franchiseId,
  name,
  nameShort: name,
  initials: name.slice(0, 2).toUpperCase(),
  icon: '',
  rung: 'league',
  nflCode: null,
  colors: { color: '#1c497c', colorPrimary: '#1c497c' },
});

const starter = (id: string): LivePlayerRow => ({
  id,
  live: 0,
  secondsRemaining: 0,
  status: 'starter',
});

const meta = (ids: string[]): Record<string, PlayerMeta> =>
  Object.fromEntries(
    ids.map((id) => [
      id,
      { id, name: `Player ${id}`, position: 'RB', nflTeam: 'KC', headshot: '', espnId: null, projected: 0 },
    ]),
  );

const team = (fid: string, playerIds: string[]) =>
  buildLiveTeam({
    identity: identity(fid, `Team ${fid}`),
    totals: { live: 0, projectedFinal: 0, remainingPoints: 0, yetToPlay: 0 },
    players: playerIds.map(starter),
    bench: [],
    meta: meta(playerIds),
  });

const matchup = (fidA: string, aIds: string[], fidB: string, bIds: string[], index = 0) =>
  buildLiveMatchup({
    index,
    side0: team(fidA, aIds),
    side1: team(fidB, bIds),
    side0Colors: { color: '#1c497c' },
    side1Colors: { color: '#c41e3a' },
    surface: 'theleague',
    viewerFranchiseId: null,
  });

const panel = (leagueId: string, leagueName: string, matchups: LivePanel['matchups']): LivePanel => ({
  leagueId,
  leagueName,
  slug: 'theleague',
  registered: true,
  viewerFranchiseId: null,
  status: 'ok',
  matchups,
});

const play = (over: Partial<LiveScoringPlay> = {}): LiveScoringPlay => ({
  playId: 'p1',
  gameId: 'g1',
  sequence: 1,
  period: 3,
  clock: '4:08',
  text: 'Player a 12 Yd Rush (Kick good)',
  typeAbbrev: 'TD',
  typeText: 'Rushing Touchdown',
  nflTeam: 'KC',
  scoreValue: 6,
  playerIds: ['a'],
  ...over,
});

describe('buildLiveMoments credits every franchise on the board', () => {
  it('emits a row for a franchise the viewer has nothing to do with', () => {
    // The whole reason this builder exists. A league board is mostly other
    // people's matchups, and they have tickers too.
    const p = panel('13522', 'TheLeague', [matchup('0003', ['a'], '0004', ['b'])]);
    const out = buildLiveMoments([play()], [p], meta(['a', 'b']));
    expect(out).toHaveLength(1);
    expect(out[0].franchiseId).toBe('0003');
  });

  it('credits BOTH owners when two franchises start the same player', () => {
    // Not defensive padding: the AFL runs 24 franchises as duplicate-player
    // conferences, so one NFL player is routinely started twice. A
    // Map<playerId, fid> keeps only the last one written, which reads as "his
    // touchdown didn't count" rather than as a bug.
    const p = panel('19621', 'AFL', [matchup('0001', ['a'], '0002', ['a'])]);
    const out = buildLiveMoments([play()], [p], meta(['a']));
    expect(out.map((m) => m.franchiseId).sort()).toEqual(['0001', '0002']);
  });

  it('emits ONE row per play per franchise, not per credited player', () => {
    // A touchdown credits several athletes (rusher + kicker). An owner who
    // starts two of them saw the identical line twice — that shipped.
    const p = panel('13522', 'TheLeague', [matchup('0001', ['a', 'k'], '0002', ['b'])]);
    const out = buildLiveMoments([play({ playerIds: ['a', 'k'] })], [p], meta(['a', 'k', 'b']));
    expect(out).toHaveLength(1);
  });

  it('names the LEAGUE in the key, because both leagues have a franchise 0001', () => {
    const out = buildLiveMoments(
      [play()],
      [
        panel('13522', 'TheLeague', [matchup('0001', ['a'], '0002', [])]),
        panel('19621', 'AFL', [matchup('0001', ['a'], '0009', [])]),
      ],
      meta(['a']),
    );
    expect(out).toHaveLength(2);
    expect(new Set(out.map((m) => m.key)).size).toBe(2);
    expect(out.map((m) => m.leagueId).sort()).toEqual(['13522', '19621']);
  });

  it('drops a play nobody on the board started', () => {
    const p = panel('13522', 'TheLeague', [matchup('0001', ['a'], '0002', ['b'])]);
    expect(buildLiveMoments([play({ playerIds: ['z'] })], [p], meta(['a', 'b']))).toEqual([]);
  });

  it('is IDEMPOTENT — running it twice on the same payload gives the same list', () => {
    // Derived, never accumulated. The whole slate arrives on every poll, so
    // there is no seen-set to drift.
    const p = panel('13522', 'TheLeague', [matchup('0001', ['a'], '0002', ['b'])]);
    const once = buildLiveMoments([play()], [p], meta(['a', 'b']));
    const twice = buildLiveMoments([play()], [p], meta(['a', 'b']));
    expect(twice).toEqual(once);
  });

  it('returns the newest play first', () => {
    // The route hands the slate over in chronological order, so reversing is
    // the whole sort — it deliberately does NOT re-sort on `sequence`, which
    // only orders within one game.
    const p = panel('13522', 'TheLeague', [matchup('0001', ['a'], '0002', [])]);
    const out = buildLiveMoments(
      [play({ playId: 'first' }), play({ playId: 'second' })],
      [p],
      meta(['a']),
    );
    expect(out.map((m) => m.playId)).toEqual(['second', 'first']);
  });

  it('formats a real game clock and never fabricates one', () => {
    const p = panel('13522', 'TheLeague', [matchup('0001', ['a'], '0002', [])]);
    expect(buildLiveMoments([play()], [p], meta(['a']))[0].clock).toBe('Q3 4:08');
    const blank = buildLiveMoments(
      [play({ period: 0, clock: '' })],
      [p],
      meta(['a']),
    );
    expect(blank[0].clock).toBe('');
  });
});

describe('selectMatchupMoments merges two franchises into one honest list', () => {
  const p = panel('13522', 'TheLeague', [matchup('0001', ['a'], '0002', ['a'])]);
  const board = buildLiveMoments([play()], [p], meta(['a']));

  it('dedupes by PLAY, because both sides can start the same player', () => {
    // buildLiveMoments keys playId:league:franchise, which is what reaches both
    // owners' boards. Merged into one matchup ticker that is two identical
    // lines with no attribution to tell them apart — it shipped that way for
    // five of 24 AFL matchups.
    expect(board).toHaveLength(2);
    expect(selectMatchupMoments(board, '13522', p.matchups[0])).toHaveLength(1);
  });

  it('will not pull another league’s franchise 0001 into this ticker', () => {
    const other = buildLiveMoments(
      [play({ playId: 'afl-play' })],
      [panel('19621', 'AFL', [matchup('0001', ['a'], '0009', [])])],
      meta(['a']),
    );
    const merged = [...board, ...other];
    const rows = selectMatchupMoments(merged, '13522', p.matchups[0]);
    expect(rows.every((m) => m.leagueId === '13522')).toBe(true);
  });

  it('ignores a franchise that is not in this matchup', () => {
    const wide = panel('13522', 'TheLeague', [
      matchup('0001', ['a'], '0002', [], 0),
      matchup('0003', ['a'], '0004', [], 1),
    ]);
    const all = buildLiveMoments([play()], [wide], meta(['a']));
    expect(all).toHaveLength(2);
    const rows = selectMatchupMoments(all, '13522', wide.matchups[1]);
    expect(rows.map((m) => m.franchiseId)).toEqual(['0003']);
  });

  it('caps the list', () => {
    const wide = panel('13522', 'TheLeague', [matchup('0001', ['a'], '0002', [])]);
    const many = buildLiveMoments(
      Array.from({ length: 20 }, (_, i) => play({ playId: `p${i}` })),
      [wide],
      meta(['a']),
    );
    expect(selectMatchupMoments(many, '13522', wide.matchups[0])).toHaveLength(8);
    expect(selectMatchupMoments(many, '13522', wide.matchups[0], 3)).toHaveLength(3);
  });
});

describe('LvMomentTicker keeps three states apart', () => {
  const row: LiveMoment = {
    key: 'k',
    playId: 'p1',
    leagueId: '13522',
    leagueName: 'TheLeague',
    franchiseId: '0001',
    franchiseName: 'Pigskins',
    playerId: 'a',
    playerName: 'Player a',
    team: 'KC',
    text: 'Player a 12 Yd Rush (Kick good)',
    clock: 'Q3 4:08',
  };
  const ticker = (props: Partial<Parameters<typeof LvMomentTicker>[0]>) =>
    text(renderToString(createElement(LvMomentTicker, { moments: [], ...props })));

  it('renders the plays it has', () => {
    const html = ticker({ moments: [row], status: 'ok' });
    expect(html).toContain('Player a 12 Yd Rush');
    expect(html).toContain('Q3 4:08');
  });

  it('says "we could not read the feed" differently from "nothing yet"', () => {
    // Collapsing these shows an owner an empty ticker during an ESPN outage
    // and lets him believe his starters did nothing.
    const failed = ticker({ status: 'error' });
    const quiet = ticker({ status: 'ok' });
    expect(failed).toContain('lv-moments__note--error');
    expect(failed).toMatch(/couldn.t reach the NFL feed/);
    expect(quiet).not.toContain('lv-moments__note--error');
    expect(quiet).toMatch(/No scoring plays/);
  });

  it('says it is still loading before anything has landed', () => {
    expect(ticker({ status: 'idle' })).toMatch(/Loading scoring plays/);
  });

  it('admits a partial read rather than looking complete', () => {
    expect(ticker({ moments: [row], status: 'ok', partial: true })).toMatch(
      /may be incomplete/,
    );
  });

  it('uses the LOCAL NFL mark, so the dark-mode swap still applies', () => {
    // nfl-logo-dark-css keys its html.dark swap on the src; a CDN URL opts the
    // element out silently, and a snapshot of it would hit the network.
    const html = ticker({ moments: [row], status: 'ok' });
    expect(html).toContain('/assets/nfl-logos/KC.svg');
    expect(html).not.toContain('espncdn');
  });
});
