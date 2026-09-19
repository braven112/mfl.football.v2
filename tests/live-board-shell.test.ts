/**
 * The kit island's SHELL: the head, the panel order, and the one structural
 * rule the drill-in must not break.
 *
 * Rendered through `renderToString`, which is what the page actually does for
 * the first paint, so a props mistake here is a mistake on screen.
 */
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import LiveBoard from '../src/components/shared/live/LiveBoard';
import { buildLiveMatchup, buildLiveTeam } from '../src/utils/live/model';
import type { LiveBoard as Board, LivePanel } from '../src/types/live';
import type { FranchiseIdentity } from '../src/utils/mfl-live-identity';
import type { LivePlayerRow, NflGame, PlayerMeta } from '../src/types/live-scoring';

/** React SSR puts `<!-- -->` between adjacent text nodes; it is not content. */
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

const row = (id: string, live = 0, secondsRemaining = 0): LivePlayerRow => ({
  id,
  live,
  secondsRemaining,
  status: 'starter',
});

const meta = (ids: string[]): Record<string, PlayerMeta> =>
  Object.fromEntries(
    ids.map((id) => [
      id,
      { id, name: id, position: 'RB', nflTeam: 'KC', headshot: '', espnId: null, projected: 0 },
    ]),
  );

const team = (fid: string, live: number, remaining = 0, rows: LivePlayerRow[] = [row(`p${fid}`, live, remaining > 0 ? 900 : 0)]) =>
  buildLiveTeam({
    identity: identity(fid, `Team ${fid}`),
    totals: { live, projectedFinal: live + remaining, remainingPoints: remaining, yetToPlay: remaining > 0 ? 1 : 0 },
    players: rows,
    bench: [],
    meta: meta(rows.map((r) => r.id)),
  });

const pairing = (fidA: string, fidB: string, a: number, b: number, viewer: string | null, index = 0) =>
  buildLiveMatchup({
    index,
    side0: team(fidA, a, 10),
    side1: team(fidB, b, 10),
    side0Colors: { color: '#1c497c' },
    side1Colors: { color: '#c41e3a' },
    surface: 'theleague',
    viewerFranchiseId: viewer,
  });

const panel = (over: Partial<LivePanel> = {}): LivePanel => ({
  leagueId: '13522',
  leagueName: 'TheLeague',
  slug: 'theleague',
  registered: true,
  viewerFranchiseId: '0001',
  status: 'ok',
  matchups: [],
  ...over,
});

const board = (over: Partial<Board> = {}): Board => ({
  ok: true,
  scope: 'league',
  week: 3,
  year: 2026,
  fetchedAt: new Date().toISOString(),
  panels: [panel()],
  games: [],
  moments: [],
  redZone: [],
  playerMeta: {},
  ...over,
});

const render = (props: Partial<Parameters<typeof LiveBoard>[0]> = {}) =>
  text(renderToString(createElement(LiveBoard, { board: board(), ...props })));

const game = (state: NflGame['state']): NflGame => ({
  id: `g-${state}`,
  state,
  shortDetail: state === 'in' ? '8:12 - 3rd' : state === 'post' ? 'Final' : 'Sun 1:00 PM ET',
  period: state === 'pre' ? 0 : 3,
  clock: state === 'in' ? '8:12' : '',
  home: { code: 'KC', score: state === 'pre' ? 0 : 17 },
  away: { code: 'BUF', score: state === 'pre' ? 0 : 14 },
  possession: state === 'in' ? 'KC' : null,
  date: new Date().toISOString(),
});

describe('the head carries the title, the week and the freshness', () => {
  it('names the board and offers its week', () => {
    const html = render();
    expect(html).toContain('Live Scoring');
    expect(html).toContain('lv-weeksel');
    // The selected week is the BOARD's, not a default — a picker that always
    // says "Week 1" is worse than none.
    expect(html).toMatch(/value="3"|selected/);
  });

  it('takes a caller’s own title', () => {
    expect(render({ title: 'Your teams' })).toContain('Your teams');
  });

  it('hides the picker only when asked', () => {
    expect(render({ hideWeekPicker: true })).not.toContain('lv-weeksel');
  });

  it('shows NO pill when nothing is being polled', () => {
    // No `pollUrl` and no extra feeds: there is no freshness to report, and a
    // pill stuck on "Connecting…" is the lie in the other direction from the
    // static "Live" badge this replaced.
    expect(render()).not.toContain('lv-status');
  });

  it('shows the pill once a poller exists', () => {
    expect(render({ pollUrl: '/api/live-board' })).toContain('lv-status');
  });

  it('badges a bundled sample and suppresses the pill', () => {
    // The replay is the thing that must be labelled: an offseason board
    // showing a real past week is indistinguishable from a live one.
    const html = render({ pollUrl: '/api/live-board', demoLabel: 'Sample data' });
    expect(html).toContain('Sample data');
    expect(html).toContain('lv-sample');
    expect(html).not.toContain('lv-status');
  });

  it('counts LIVE NFL games, not franchises with time left', () => {
    // A franchise still holding seconds is true all week and says nothing
    // about right now, so the clause is claimed from the slate.
    const html = render({
      pollUrl: '/api/live-board',
      board: board({ games: [game('in'), game('pre')] }),
    });
    expect(html).toContain('1 game live');
  });
});

describe('a panel leads with the viewer’s matchup, then the closest game', () => {
  const three = [
    pairing('0003', '0004', 100, 40, null, 0),
    pairing('0001', '0002', 90, 88, '0001', 1),
    pairing('0005', '0006', 70, 69, null, 2),
  ];

  it('puts the viewer’s pairing in the lead row and the others below', () => {
    const html = render({ board: board({ panels: [panel({ matchups: three })] }) });
    const lead = html.indexOf('lv-cards--lead');
    expect(lead).toBeGreaterThan(-1);
    // The lead grid comes first in the document, and the viewer's own team is
    // inside it rather than in the tail.
    const tail = html.indexOf('class="lv-cards"', lead);
    expect(tail).toBeGreaterThan(lead);
    expect(html.slice(lead, tail)).toContain('Team 0001');
  });

  it('badges only a real matchup of the viewer’s', () => {
    const mine = render({ board: board({ panels: [panel({ matchups: three })] }) });
    expect(mine).toContain('YOUR MATCHUP');

    // With none of theirs the closest game is promoted into the lead row — and
    // must NOT claim to be anybody's.
    const nobody = render({
      board: board({
        panels: [panel({ matchups: [pairing('0003', '0004', 100, 40, null), pairing('0005', '0006', 70, 69, null)] })],
      }),
    });
    expect(nobody).toContain('lv-cards--lead');
    expect(nobody).not.toContain('YOUR MATCHUP');
  });

  it('renders every matchup exactly once across the two rows', () => {
    const html = render({ board: board({ panels: [panel({ matchups: three })] }) });
    for (const fid of ['0001', '0002', '0003', '0004', '0005', '0006']) {
      expect(html.match(new RegExp(`Team ${fid}<`, 'g')) ?? []).toHaveLength(1);
    }
  });

  it('orders each panel on its own, so a cross-league board leads every league', () => {
    const html = render({
      board: board({
        scope: 'cross-league',
        panels: [
          panel({ matchups: [pairing('0001', '0002', 90, 88, '0001')] }),
          panel({ leagueId: '19621', leagueName: 'AFL', slug: 'afl-fantasy', matchups: [pairing('0007', '0008', 50, 49, '0007')] }),
        ],
      }),
    });
    expect(html.match(/lv-cards--lead/g) ?? []).toHaveLength(2);
    // A multi-league board names each league; a single-league one does not.
    expect(html).toContain('lv-panel__name');
    expect(render()).not.toContain('lv-panel__name');
  });

  it('gives a failed league its place in the list, saying why', () => {
    const html = render({
      board: board({ panels: [panel({ status: 'unavailable', matchups: [] })] }),
    });
    expect(html).toContain('lv-empty--unavailable');
    expect(html).not.toContain('lv-cards');
  });
});

describe('the shell outlives the screen switch', () => {
  // Structural, not a screenshot: the rail and the banner must be rendered
  // OUTSIDE the `selected ? detail : board` branch. Red zone is a persistent
  // STATE, and a live drive that vanishes because somebody opened a matchup is
  // the mistake the broadcast board made one level up, where the banner sat on
  // the stage layer and the next reveal preempted it.
  const src = readFileSync(
    resolve(__dirname, '../src/components/shared/live/LiveBoard.tsx'),
    'utf8',
  );

  it('renders the rail and the red-zone banner BEFORE the branch', () => {
    const rail = src.indexOf('{rail}');
    const banner = src.indexOf('<LvRedZoneBanner');
    const branch = src.indexOf('{open ? (');
    expect(rail).toBeGreaterThan(-1);
    expect(banner).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(-1);
    expect(rail).toBeLessThan(branch);
    expect(banner).toBeLessThan(branch);
  });

  it('renders the banner exactly once, so neither arm owns a copy', () => {
    expect(src.match(/<LvRedZoneBanner/g) ?? []).toHaveLength(1);
  });

  it('keeps the head above the branch too, so the week picker never disappears', () => {
    expect(src.indexOf('<div className="lv-head">')).toBeLessThan(src.indexOf('{open ? ('));
  });

  /**
   * THE DRILL-IN STORES AN IDENTITY AND RESOLVES IT EVERY POLL.
   *
   * This shipped broken and was caught in review. `LiveMatchup` carries its
   * own scores, projections, yet-to-play counts and player rows, and each poll
   * REPLACES the board with fresh objects — so a `selected` that holds the
   * clicked matchup freezes the open screen at the moment it was opened, while
   * the rail, the freshness pill and the ticker beside it keep updating. Live
   * scoring's whole job, stopped, on the one screen an owner sits on.
   *
   * The island this replaced stored `{ home, away }` — franchise ids — and
   * passed the live `teams`/`players`/`bench` maps alongside, so its detail
   * stayed current. Moving the data inside the matchup (the right call) made
   * that pattern unsafe, and it was carried over unchanged.
   *
   * Scanned rather than driven: the bug only appears across two polls, which
   * `renderToString` cannot stage, and the three facts below are exactly what
   * makes it impossible.
   */
  describe('the open matchup is an identity, resolved against the latest board', () => {
    const decl = /const \[selected, setSelected\] = useState<([^>]*)>/.exec(src)?.[1] ?? '';

    it('finds the selection state', () => {
      expect(decl, 'the `selected` useState declaration moved or was renamed').not.toBe('');
    });

    it('never stores the matchup or panel OBJECT', () => {
      // The whole bug in one assertion: a selection typed to hold a
      // `LiveMatchup` is a selection that cannot follow a poll.
      expect(decl).not.toMatch(/LiveMatchup|LivePanel/);
    });

    it('stores the pairing key, which survives MFL reordering the feed', () => {
      // `index` is a position in the feed's own order and MFL returns arrays
      // nondeterministically, so it can point at a DIFFERENT matchup after a
      // poll — a worse failure than a frozen one.
      expect(src).toMatch(/setSelected\(\{[^}]*pairing:\s*pairingKey\(/);
      expect(decl).not.toMatch(/index/);
    });

    it('re-finds it in the CURRENT board before rendering', () => {
      expect(src).toMatch(/board\.panels\.find\(/);
      expect(src).toMatch(/\.matchups\.find\(\(m\) => pairingKey\(m\)/);
    });

    it('renders the detail from the resolved matchup, never from the stored selection', () => {
      expect(src).toMatch(/matchup=\{open\.matchup\}/);
      expect(src).not.toMatch(/matchup=\{selected\./);
    });
  });
});
