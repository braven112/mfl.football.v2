/**
 * The two things you do to a draft board BEFORE the room shows up:
 * pre-cache its images, and point it at a live draft that isn't yours yet.
 *
 * Both exist because the broadcast page has exactly one chance a year to be
 * right. `?rehearse=` already replays a finished season through the real ingest
 * path, but it never touches the network, so it cannot catch a wrong league id,
 * a wrong draft unit or a host that 404s — and a warm-up that plans the wrong
 * URLs is a warm-up that leaves the reveal card waiting on the same cold
 * request it always did.
 *
 * What is pinned here is the part a bad night would turn on:
 *  - the warm-up asks for exactly what the reveal card will ask for, in board
 *    order, and never for something the card would not render;
 *  - `?mflLeague=` cannot be talked into naming a host that is not MFL's, which
 *    is the difference between a test hook and an SSRF hole on a public page;
 *  - an override is never silent.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WARM_DEPTH,
  planBroadcastImages,
  resolveWarmDepth,
} from '../src/utils/draft-broadcast-images';
import {
  MFL_EXPORT_HOST,
  resolveBroadcastSource,
  resolveMflHost,
  resolveMflLeagueId,
} from '../src/utils/draft-broadcast-source';
import { hasDraftSlots } from '../src/utils/draft-broadcast-server';
import { isSplashCutoutEligible } from '../src/utils/pick-reveal';
import type { DraftRoomTeam } from '../src/types/draft-room';
import type { BroadcastPlayer } from '../src/types/draft-broadcast';

const ESPN_CUTOUT = 'https://a.espncdn.com/i/headshots/nfl/players/full';

function player(overrides: Partial<BroadcastPlayer> & { id: string }): BroadcastPlayer {
  return {
    name: 'Test Player',
    position: 'WR',
    // No pro team by default: `resolveOrigin` would otherwise add a team mark
    // to every fixture and bury the ordering these cases are about.
    nflTeam: '',
    headshot: `${ESPN_CUTOUT}/${overrides.id}.png`,
    ...overrides,
  } as BroadcastPlayer;
}

function team(franchiseId: string, icon: string): DraftRoomTeam {
  return {
    franchiseId,
    name: `Team ${franchiseId}`,
    nameMedium: `Team ${franchiseId}`,
    nameShort: `T${franchiseId}`,
    abbrev: franchiseId,
    icon,
  } as DraftRoomTeam;
}

describe('planBroadcastImages', () => {
  it('leads with franchise crests — they are on screen before any pick lands', () => {
    const plan = planBroadcastImages({
      players: [player({ id: '1', boardRank: 1 })],
      teams: [team('0001', '/assets/afl/group-me/a.png'), team('0002', '/assets/afl/group-me/b.png')],
    });

    expect(plan.urls.slice(0, 2)).toEqual([
      '/assets/afl/group-me/a.png',
      '/assets/afl/group-me/b.png',
    ]);
    expect(plan.crests).toBe(2);
  });

  it('warms players in BOARD order, not pool order', () => {
    // Pool order is deliberately the reverse of board order: warming in pool
    // order spends the first minutes of room wifi on players nobody takes.
    const plan = planBroadcastImages({
      players: [
        player({ id: '30', boardRank: 30 }),
        player({ id: '2', boardRank: 2 }),
        player({ id: '11', boardRank: 11 }),
      ],
      teams: [],
    });

    expect(plan.urls).toEqual([
      `${ESPN_CUTOUT}/2.png`,
      `${ESPN_CUTOUT}/11.png`,
      `${ESPN_CUTOUT}/30.png`,
    ]);
  });

  it('keeps unranked players — a real pick can be a flier no feed ranks', () => {
    const plan = planBroadcastImages({
      players: [player({ id: 'flier' }), player({ id: '5', boardRank: 5 })],
      teams: [],
    });

    expect(plan.urls).toEqual([`${ESPN_CUTOUT}/5.png`, `${ESPN_CUTOUT}/flier.png`]);
  });

  it('never plans a cutout the reveal card would not paint', () => {
    // The card gates on `isSplashCutoutEligible`: a DEF is a crest, not a face,
    // and an MFL JPG has a baked-in background that ruins the composite. A plan
    // that warmed either would be spending bandwidth on nothing.
    const def = player({ id: 'kc-def', position: 'DEF' });
    const mflPhoto = player({
      id: 'mfl',
      headshot: 'https://www49.myfantasyleague.com/player_photos_big_2014/1234_thumb.jpg',
    });
    expect(isSplashCutoutEligible(def)).toBe(false);
    expect(isSplashCutoutEligible(mflPhoto)).toBe(false);

    const plan = planBroadcastImages({ players: [def, mflPhoto], teams: [] });

    expect(plan.urls).not.toContain(def.headshot);
    expect(plan.urls).not.toContain(mflPhoto.headshot);
    expect(plan.cutouts).toBe(0);
  });

  it('warms the origin mark beside the name, school or pro team', () => {
    const rookie = player({
      id: 'rook',
      boardRank: 1,
      isRookie: true,
      college: 'Ohio State',
      collegeLogo: '/assets/college-logos/194-dark.png',
    });
    const vet = player({ id: 'vet', boardRank: 2, nflTeam: 'KCC' });

    const plan = planBroadcastImages({ players: [rookie, vet], teams: [] });

    // Both marks are the DARK cut the card resolves — the pro half from
    // espncdn (so the warm-up covers it too), the school half from our own
    // assets. See `resolveOrigin`.
    expect(plan.urls).toContain('/assets/college-logos/194-dark.png');
    expect(plan.urls.some((url) => url.includes('/i/teamlogos/nfl/'))).toBe(true);
    expect(plan.logos).toBe(2);
  });

  it('warms EVERY defender in a defense pool, not the two it happens to draw', () => {
    // The reveal card draws two at random from each five-man pool per pick, so
    // warming a slice would leave three of five cold on every DEF selection.
    const plan = planBroadcastImages({
      players: [],
      teams: [],
      defenseFaces: {
        KCC: [
          { name: 'A', espnId: '11' },
          { name: 'B', espnId: '22' },
          { name: 'C', espnId: '33' },
          { name: 'D', espnId: '44' },
          { name: 'E', espnId: '55' },
        ],
      },
    });

    expect(plan.faces).toBe(5);
    expect(plan.urls).toContain(`${ESPN_CUTOUT}/55.png`);
  });

  it('dedupes — two rookies out of the same school share one mark', () => {
    const logo = '/assets/college-logos/194-dark.png';
    const plan = planBroadcastImages({
      players: [
        player({ id: 'a', boardRank: 1, isRookie: true, college: 'Ohio State', collegeLogo: logo }),
        player({ id: 'b', boardRank: 2, isRookie: true, college: 'Ohio State', collegeLogo: logo }),
      ],
      teams: [],
    });

    expect(plan.urls.filter((url) => url === logo)).toHaveLength(1);
    expect(new Set(plan.urls).size).toBe(plan.urls.length);
  });

  it('stops at the requested depth, counted in PLAYERS not URLs', () => {
    const players = Array.from({ length: 50 }, (_, i) =>
      player({ id: String(i + 1), boardRank: i + 1 })
    );
    const plan = planBroadcastImages({ players, teams: [], depth: 10 });

    expect(plan.cutouts).toBe(10);
    expect(plan.urls).toContain(`${ESPN_CUTOUT}/10.png`);
    expect(plan.urls).not.toContain(`${ESPN_CUTOUT}/11.png`);
  });

  it('does not reorder the caller’s player array', () => {
    // The reveal card seats its defender chips by source order, so a planner
    // that sorted in place would move faces out from under their names.
    const players = [player({ id: 'b', boardRank: 9 }), player({ id: 'a', boardRank: 1 })];
    planBroadcastImages({ players, teams: [] });

    expect(players.map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('resolveWarmDepth', () => {
  it('defaults when absent, empty, or unparseable', () => {
    // A typo must not silently disable the warm-up on draft night.
    expect(resolveWarmDepth(null)).toBe(DEFAULT_WARM_DEPTH);
    expect(resolveWarmDepth('')).toBe(DEFAULT_WARM_DEPTH);
    expect(resolveWarmDepth('lots')).toBe(DEFAULT_WARM_DEPTH);
    expect(resolveWarmDepth('-5')).toBe(DEFAULT_WARM_DEPTH);
  });

  it('takes an explicit number, and an explicit off', () => {
    expect(resolveWarmDepth('150')).toBe(150);
    expect(resolveWarmDepth('0')).toBe(0);
    expect(resolveWarmDepth('off')).toBe(0);
    expect(resolveWarmDepth('all')).toBeGreaterThan(10_000);
  });
});

describe('resolveMflHost', () => {
  it('accepts MFL hosts only', () => {
    expect(resolveMflHost('www44.myfantasyleague.com', 'fallback')).toBe(
      'www44.myfantasyleague.com'
    );
    expect(resolveMflHost('API.MyFantasyLeague.com', 'fallback')).toBe('api.myfantasyleague.com');
  });

  it('refuses anything else — this host is fetched server-side', () => {
    // /api/draft/status fetches whatever host it is handed. Every one of these
    // reaching that fetch would be server-side request forgery.
    for (const hostile of [
      'evil.com',
      'myfantasyleague.com.evil.com',
      '169.254.169.254',
      'localhost',
      '',
      null,
      // The suffix check must be on the HOST, not the string: a credential or
      // path segment can carry the real domain while the host is not MFL's.
      'evil.com/www44.myfantasyleague.com',
      'user@evil.com',
    ]) {
      expect(resolveMflHost(hostile, 'fallback')).toBe('fallback');
    }
  });

  it('tolerates a pasted URL rather than a bare host', () => {
    expect(resolveMflHost('https://www44.myfantasyleague.com/', 'fallback')).toBe(
      'www44.myfantasyleague.com'
    );
  });
});

describe('resolveMflLeagueId', () => {
  it('accepts digits and nothing else', () => {
    expect(resolveMflLeagueId('12345')).toBe('12345');
    expect(resolveMflLeagueId(' 12345 ')).toBe('12345');
    expect(resolveMflLeagueId('12345&TYPE=x')).toBeNull();
    expect(resolveMflLeagueId('../../etc')).toBeNull();
    expect(resolveMflLeagueId('')).toBeNull();
    expect(resolveMflLeagueId(null)).toBeNull();
  });
});

describe('resolveBroadcastSource', () => {
  const fallback = {
    leagueId: '19621',
    mflHost: 'www44.myfantasyleague.com',
    unit: 'CONFERENCE00',
  };

  it('returns the league’s own feed when nothing is overridden', () => {
    const source = resolveBroadcastSource(new URLSearchParams(''), fallback);

    expect(source).toEqual({ ...fallback, isOverride: false, label: '' });
  });

  it('ignores mflHost and unit without an mflLeague — the override cannot half-apply', () => {
    const source = resolveBroadcastSource(
      new URLSearchParams('mflHost=www49.myfantasyleague.com&unit=LEAGUE'),
      fallback
    );

    expect(source.isOverride).toBe(false);
    expect(source.mflHost).toBe(fallback.mflHost);
    expect(source.unit).toBe(fallback.unit);
  });

  it('follows another league, defaulting to the host that serves every league', () => {
    // Nobody should have to know which www## a freshly copied league landed on.
    const source = resolveBroadcastSource(new URLSearchParams('mflLeague=99999'), fallback);

    expect(source.isOverride).toBe(true);
    expect(source.leagueId).toBe('99999');
    expect(source.mflHost).toBe(MFL_EXPORT_HOST);
  });

  it('asks for whichever unit the copy has, unless a conference was named', () => {
    // A "draft only" copy can carry one unnamed unit where the real league
    // drafts by conference, and MFL answers a named unit that isn't there with
    // a 404 rather than a board — so the default must not name one.
    expect(resolveBroadcastSource(new URLSearchParams('mflLeague=99999'), fallback).unit).toBeNull();

    expect(
      resolveBroadcastSource(new URLSearchParams('mflLeague=99999&conference=00'), fallback).unit
    ).toBe('CONFERENCE00');

    expect(
      resolveBroadcastSource(new URLSearchParams('mflLeague=99999&unit=CONFERENCE01'), fallback).unit
    ).toBe('CONFERENCE01');

    expect(
      resolveBroadcastSource(new URLSearchParams('mflLeague=99999&conference=00&unit=auto'), fallback)
        .unit
    ).toBeNull();
  });

  it('refuses a non-MFL host even with a valid league id', () => {
    const source = resolveBroadcastSource(
      new URLSearchParams('mflLeague=99999&mflHost=evil.com'),
      fallback
    );

    expect(source.mflHost).toBe(MFL_EXPORT_HOST);
  });

  it('drops an override whose league id is not a league id', () => {
    const source = resolveBroadcastSource(new URLSearchParams('mflLeague=abc'), fallback);

    expect(source.isOverride).toBe(false);
    expect(source.leagueId).toBe(fallback.leagueId);
  });

  it('always labels an override — a test feed must never look like draft night', () => {
    const source = resolveBroadcastSource(new URLSearchParams('mflLeague=99999'), fallback);

    expect(source.label).toContain('99999');
    expect(source.label.toLowerCase()).toContain('test feed');
  });
});

describe('hasDraftSlots', () => {
  /** What MFL returns for a league whose draft has not been set up yet: the
   *  units exist and are named, and there is not a single slot between them.
   *  Observed on the 2026 AFL rehearsal copy (league 65915). */
  const emptyUnits = {
    draftResults: {
      draftUnit: [{ unit: 'CONFERENCE00' }, { unit: 'CONFERENCE01' }],
    },
  };

  const withSlots = {
    draftResults: {
      draftUnit: [
        { unit: 'CONFERENCE00', draftPick: [{ round: '01', pick: '01', franchise: '0006' }] },
        { unit: 'CONFERENCE01' },
      ],
    },
  };

  it('rejects a named unit that carries no slots', () => {
    // A valid response, not a failed fetch — so nothing upstream can catch it,
    // and an override would render a board with no draft order in it.
    expect(hasDraftSlots(emptyUnits, 'CONFERENCE00')).toBe(false);
    expect(hasDraftSlots(emptyUnits, '')).toBe(false);
  });

  it('accepts a unit with a board, per unit', () => {
    expect(hasDraftSlots(withSlots, 'CONFERENCE00')).toBe(true);
    // The other conference of the same copy can still be empty — the AFL's two
    // boards are independent and have drafted on different days.
    expect(hasDraftSlots(withSlots, 'CONFERENCE01')).toBe(false);
  });

  it('takes the first unit when none is named', () => {
    expect(hasDraftSlots(withSlots, '')).toBe(true);
  });

  it('rejects a missing feed, a missing unit, and MFL’s bare-object shape', () => {
    expect(hasDraftSlots(null, 'CONFERENCE00')).toBe(false);
    expect(hasDraftSlots({}, 'CONFERENCE00')).toBe(false);
    expect(hasDraftSlots(withSlots, 'CONFERENCE09')).toBe(false);
    // A single-draft league returns draftUnit as a bare OBJECT, not an array.
    expect(
      hasDraftSlots({ draftResults: { draftUnit: { unit: 'LEAGUE', draftPick: [{ round: '01' }] } } }, '')
    ).toBe(true);
  });
});

/**
 * MFL serves a FLAPPING board, and the TV must not.
 *
 * Measured live during the 2026 AFL rehearsal (2026-08-28): polling one league
 * and unit every two seconds returned SEVEN snapshots in rotation — 3, 4, 5, 6,
 * 7, 8 and 25 picks — on `api.myfantasyleague.com` AND on the league's own
 * `www44`, with runs of four consecutive stale reads. The room saw 1.01 land,
 * the board flip back to "on the clock", and forward again, every few seconds.
 *
 * Every snapshot was INTERNALLY COHERENT, though — a clean prefix of the draft,
 * never a board with holes. The responses are not corrupt, just of different
 * AGES. So the board takes the newest and ignores anything older.
 *
 * A UNION of every pick ever seen was tried first and is wrong. It survived the
 * plain flap and then failed the moment the draft was reverted to restart it:
 * the stale backends kept serving the OLD board, so the union could never shed
 * the abandoned picks and the screen jumped to 1.12 of a draft that no longer
 * existed while the room was on 1.02. Recency handles both with one rule, which
 * is why these cases are stated against board AGE and not a merge.
 */
describe('a flapping MFL board', () => {
  /** `boardAge`, verbatim — see DraftBroadcast.tsx. */
  const age = (picks: { playerId: string; timestamp: string }[]) => {
    let newestPick = 0;
    let filled = 0;
    for (const p of picks) {
      if (!p.playerId) continue;
      filled += 1;
      const ts = Number.parseInt(p.timestamp, 10);
      if (Number.isFinite(ts) && ts > newestPick) newestPick = ts;
    }
    return { newestPick, filled };
  };

  /** `isAtLeastAsRecent`, verbatim. */
  const accepts = (
    incoming: { playerId: string; timestamp: string }[],
    onScreen: { playerId: string; timestamp: string }[]
  ) => {
    const a = age(incoming);
    const b = age(onScreen);
    if (a.newestPick !== b.newestPick) return a.newestPick > b.newestPick;
    return a.filled >= b.filled;
  };

  /** A coherent prefix board of `n` picks, the last stamped `ts`. */
  const board = (n: number, ts = 1_000) =>
    Array.from({ length: n }, (_, i) => ({
      playerId: String(1000 + i),
      timestamp: String(ts - (n - 1 - i)),
    }));

  it('ignores a stale snapshot that has fewer picks', () => {
    // The exact read observed seconds after a 25-pick board: back to 3.
    expect(accepts(board(3, 980), board(25, 1_000))).toBe(false);
  });

  it('survives a RUN of stale reads, not just one', () => {
    // Four consecutive stale responses were measured, so a one-poll tolerance
    // would not have covered it. Recency needs no tolerance at all.
    const onScreen = board(25, 1_000);
    for (let i = 0; i < 4; i += 1) expect(accepts(board(3, 980), onScreen)).toBe(false);
  });

  it('takes a snapshot that carries a newer pick', () => {
    expect(accepts(board(26, 1_010), board(25, 1_000))).toBe(true);
  });

  it('accepts an unchanged board so the loop keeps flowing', () => {
    expect(accepts(board(25, 1_000), board(25, 1_000))).toBe(true);
  });

  it('breaks a same-second tie on pick count', () => {
    // MFL stamps in whole seconds, so two picks inside one second are not
    // separable by time alone.
    expect(accepts(board(26, 1_000), board(25, 1_000))).toBe(true);
    expect(accepts(board(24, 1_000), board(25, 1_000))).toBe(false);
  });

  it('prefers a SMALLER board carrying a newer pick — the revert case', () => {
    // The one the union got wrong. After a revert and a re-pick the real board
    // has two picks while stale caches still hold twelve; the re-picked 1.01 is
    // stamped later than anything in the abandoned draft, so the small board
    // wins on its first appearance and 1.12 cannot come back.
    const abandoned = board(12, 1_000);
    const restarted = board(2, 5_000);
    expect(accepts(restarted, abandoned)).toBe(true);
    expect(accepts(abandoned, restarted)).toBe(false);
  });

  it('never lets an empty board displace a live one on recency alone', () => {
    // A revert with no re-pick yet is the one case recency cannot settle, and
    // it is exactly what REVERT_CONFIRM_MS covers — see below.
    expect(accepts([], board(12, 1_000))).toBe(false);
  });
});

/**
 * A jump of eighteen picks is the board catching up, not the room drafting.
 *
 * MFL's disagreeing caches (see the flap block above) mean a current snapshot
 * can finally answer after a run of stale ones, and the union then gains every
 * pick at once. Queueing all of them is minutes of narrating a round that
 * finished while the idle board — who is ACTUALLY on the clock — never gets
 * the screen.
 *
 * `CATCHUP_BURST` in DraftBroadcast.tsx draws the line. The rule is stated
 * here as the pure predicate it is; the constant it pins is 5.
 */
describe('a catch-up burst', () => {
  const CATCHUP_BURST = 5;
  /** The island's rule, verbatim — see `toReveal` in DraftBroadcast.tsx. */
  const toReveal = <T,>(fresh: T[]) =>
    fresh.length > CATCHUP_BURST ? fresh.slice(-1) : fresh;

  it('reveals every pick of a genuinely fast round', () => {
    // Four selections inside one 5s poll is a real thing in a live room, and
    // dropping any of them is the failure the queue exists to prevent.
    const fresh = [1, 2, 3, 4];
    expect(toReveal(fresh)).toEqual(fresh);
  });

  it('reveals only the NEWEST pick when the board jumps', () => {
    // The 2026 rehearsal: MFL sat on 3 picks, then answered with 25.
    const fresh = Array.from({ length: 22 }, (_, i) => i + 4);
    expect(toReveal(fresh)).toEqual([25]);
  });

  it('shows something rather than nothing — a catch-up is never silent', () => {
    // The older maxBurst behaviour dropped an oversized burst entirely, which
    // on a TV means a pick the room watched happen never appears.
    expect(toReveal([1, 2, 3, 4, 5, 6]).length).toBe(1);
  });

  it('keeps the boundary where the constant says', () => {
    expect(toReveal([1, 2, 3, 4, 5])).toHaveLength(5);
    expect(toReveal([1, 2, 3, 4, 5, 6])).toHaveLength(1);
  });
});

/**
 * Reverting the draft to restart it.
 *
 * Found live (Brandon, 2026-08-28), twice. First the board "switches between
 * old picks and then to the correct pick"; then, after a full reset, it "jumped
 * to the old 1.12 even though we are on 1.02".
 *
 * Recency settles the common case with no window at all: a re-picked slot is
 * stamped later than anything in the abandoned draft, so the restarted board
 * beats the stale one on its first appearance (pinned above). The window below
 * covers only what recency cannot — a revert with NO re-pick yet, where the
 * true board is both emptier and stamped earlier than what is on screen.
 */
describe('reverting the draft', () => {
  const REVERT_CONFIRM_MS = 45_000;

  /** The rollback rule, verbatim — see `rejectingSinceRef` in ingest. */
  const rollsBack = (now: number, rejectingSince: number) =>
    now - rejectingSince >= REVERT_CONFIRM_MS;

  it('holds through the worst flap actually measured', () => {
    // Four consecutive stale polls, ~20s — and in a flap a current snapshot
    // lands in between, which clears the clock entirely rather than pausing it.
    expect(rollsBack(20_000, 0)).toBe(false);
  });

  it('rolls back once nothing but older responses has arrived for the window', () => {
    expect(rollsBack(REVERT_CONFIRM_MS, 0)).toBe(true);
    expect(rollsBack(60_000, 0)).toBe(true);
  });

  it('leaves the window clear of the observed flap on both sides', () => {
    // Below ~25s a normal flap would start rolling the board back mid-draft.
    expect(REVERT_CONFIRM_MS).toBeGreaterThan(25_000);
    // Much past a minute leaves a reset board stale in front of the room.
    expect(REVERT_CONFIRM_MS).toBeLessThanOrEqual(60_000);
  });
});
