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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_WARM_DEPTH,
  planBroadcastImages,
  resolveWarmDepth,
} from '../src/utils/draft-broadcast-images';
import { applyRehearsal, isRevealWorthy, lastPickAtMs } from '../src/utils/draft-broadcast';
import { collectFreshPicks } from '../src/utils/pick-reveal';
import {
  MFL_EXPORT_HOST,
  toSafeMflUrl,
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
    // An MFL app server that belongs to no league of ours IS reachable: a copy
    // league made to rehearse draft night can be served from any of them, and
    // `static_url` names the one that has its file.
    expect(resolveMflHost('www12.myfantasyleague.com', 'fallback')).toBe(
      'www12.myfantasyleague.com'
    );
    // The list is still finite, so it ends.
    expect(resolveMflHost('www100.myfantasyleague.com', 'fallback')).toBe('fallback');
    expect(resolveMflHost('mail.myfantasyleague.com', 'fallback')).toBe('fallback');
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
  /**
   * `boardAge` from DraftBroadcast.tsx.
   *
   * The stamp half CALLS the real `lastPickAtMs` rather than re-typing its
   * loop. This used to be a hand-copy marked "verbatim", which is a guard that
   * decays silently: the copy keeps passing on its own terms while the source
   * drifts, and it did exactly that the day `boardAge` was refactored onto
   * `lastPickAtMs`. Only the count half is still local, because `boardAge`
   * keeps that inline too.
   */
  const age = (picks: { playerId: string; timestamp: string }[]) => {
    const newest = lastPickAtMs(picks);
    return {
      newestPick: newest === null ? 0 : Math.floor(newest / 1000),
      filled: picks.filter((p) => p.playerId).length,
    };
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
 * The board never moves backwards on its own.
 *
 * There WAS an automatic rollback here: after REVERT_CONFIRM_MS of nothing but
 * older responses, take the newest one wholesale, on the theory that only a
 * real revert could produce a run that long.
 *
 * That theory died on the live NL board (Brandon, 2026-08-28). MFL served NINE
 * distinct snapshots for one conference and the CURRENT one came back about 10%
 * of the time, so the board legitimately rejects most polls and a 45-second run
 * of pure rejections happens constantly during a perfectly normal draft. The
 * rollback fired, dropped the board to the best stale snapshot, and the room
 * watched it go forwards and then back to a pick it had already passed:
 * "after a refresh it went forward and then flipped back to 1.11 where it was
 * stuck before".
 *
 * The threshold now only raises a WARNING. A revert is real but rare and has an
 * obvious operator action — reload, which re-seeds from a freshly sampled
 * server render. Silently reversing a live board to serve that case cost far
 * more than it ever saved.
 */
describe('the board never moves backwards on its own', () => {
  const REVERT_CONFIRM_MS = 45_000;

  /** What a sustained rejection run now does: warn, and nothing else. */
  const warns = (now: number, rejectingSince: number) =>
    now - rejectingSince >= REVERT_CONFIRM_MS;

  it('does not warn during MFL’s ordinary flapping', () => {
    expect(warns(20_000, 0)).toBe(false);
  });

  it('warns once every response has been older for the whole window', () => {
    expect(warns(REVERT_CONFIRM_MS, 0)).toBe(true);
    expect(warns(60_000, 0)).toBe(true);
  });

  it('keeps the threshold clear of the flap on both sides', () => {
    expect(REVERT_CONFIRM_MS).toBeGreaterThan(25_000);
    expect(REVERT_CONFIRM_MS).toBeLessThanOrEqual(60_000);
  });

  it('has no rollback left to fire — the shipped code only sets a flag', () => {
    // Guarding the DECISION, not the wording: an automatic rollback is what put
    // an already-passed pick back on the TV, and it must not come back.
    const src = readFileSync(
      join(__dirname, '..', 'src/components/shared/draft-broadcast/DraftBroadcast.tsx'),
      'utf8'
    );
    const branch = src.slice(
      src.indexOf('if (!isAtLeastAsRecent(age, acceptedRef.current))'),
      src.indexOf('rejectingSinceRef.current = null;\n    setMaybeStale(false);')
    );
    expect(branch).toContain('setMaybeStale(true)');
    // The rollback wrote board state from inside the reject branch. Nothing
    // there may call setPicks or re-seed the reveal set again.
    expect(branch).not.toContain('setPicks');
    expect(branch).not.toContain('seenRef.current =');
    expect(branch).not.toContain('acceptedRef.current =');
  });
});

/**
 * THE REHEARSAL MUST CLEAR THE LIVE AGE GATE — the pairing, not either half.
 *
 * `?rehearse=` replays a season that has already FINISHED, so every pick on
 * that board is stamped months ago, and `isRevealWorthy` (90s, added the same
 * morning for autopick bursts) rejected all of them. The dry run advanced pick
 * by pick with the cadence and the rails all correct and never once showed the
 * card that is the entire point of the night.
 *
 * `applyRehearsal`'s own unit tests cannot catch that coming back, because the
 * fix lives in an ARGUMENT: the replay passes `rehearseUpTo` as the third
 * parameter, and the parameter defaults to Infinity — drop it and every test
 * that calls the function directly still passes while the board goes silent
 * again. So this pins the two ends the unit tests leave open: the island really
 * passes it, and the whole chain really produces a reveal at every step.
 */
describe('a rehearsal reveals every pick it rolls forward', () => {
  const SEASON_OVER_SEC = 1_700_000_000;
  const NOW_MS = 1_800_000_000_000;

  const board = Array.from({ length: 9 }, (_, i) => ({
    round: 1,
    pickInRound: i + 1,
    overallPickNumber: i + 1,
    franchiseId: String(i + 1).padStart(4, '0'),
    playerId: `p${i + 1}`,
    timestamp: String(SEASON_OVER_SEC),
    comments: '',
    isTraded: false,
  }));

  it('produces a reveal at EVERY step of the replay, not just the first', () => {
    // The island's replay loop, verbatim: applyRehearsal → collectFreshPicks →
    // isRevealWorthy. A per-step assertion because the board advancing was
    // never the broken half.
    const startAt = 3;
    const seen = new Set(
      applyRehearsal(board, startAt).filter((p) => p.playerId).map((p) => p.overallPickNumber)
    );

    for (let step = startAt + 1; step <= board.length; step++) {
      const incoming = applyRehearsal(board, step, startAt, NOW_MS);
      const fresh = collectFreshPicks(seen, board.length, incoming, Infinity, NOW_MS);
      for (const p of fresh) seen.add(p.overallPickNumber);

      const revealed = fresh.filter((p) => isRevealWorthy(p, NOW_MS));
      expect(revealed.map((p) => p.overallPickNumber)).toEqual([step]);
    }
  });

  it('is silent on the same board without the fix — this is what regressed', () => {
    // Two-arg call: what the island did before, and what it falls back to if
    // the third argument is ever dropped.
    const incoming = applyRehearsal(board, 4);
    const fresh = collectFreshPicks(new Set([1, 2, 3]), board.length, incoming, Infinity, NOW_MS);

    expect(fresh.map((p) => p.overallPickNumber)).toEqual([4]);
    expect(fresh.filter((p) => isRevealWorthy(p, NOW_MS))).toEqual([]);
  });

  it('the island passes the replay origin — the argument IS the fix', () => {
    const src = readFileSync(
      join(__dirname, '..', 'src/components/shared/draft-broadcast/DraftBroadcast.tsx'),
      'utf8'
    );
    // Guarding the DECISION, not the wording: whatever the replay is spelled
    // like, the call it makes must carry a third argument. A two-argument call
    // here is the regression, and it is silent.
    const call = src.match(/ingest\(applyRehearsal\(([^)]*)\)\)/);
    expect(call).not.toBeNull();
    expect(call![1].split(',')).toHaveLength(3);
    expect(call![1]).toContain('rehearseUpTo');
  });

  it('leaves the picks the operator started from alone', () => {
    // They are history, exactly like the SSR board on draft night. Restamping
    // them would make a reload of ?rehearse=40 storm forty reveals.
    const start = applyRehearsal(board, 4, 2, NOW_MS);
    expect(start[0].timestamp).toBe(String(SEASON_OVER_SEC));
    expect(start[1].timestamp).toBe(String(SEASON_OVER_SEC));
    expect(start[2].timestamp).toBe(String(Math.floor(NOW_MS / 1000)));
  });
});

/**
 * `static_url` comes out of MFL's RESPONSE BODY, not our own parameters.
 *
 * /api/draft/status follows it to read MFL's static draft file, which is the
 * only source fresh enough to keep the board level with the room. But a URL
 * inside a third-party JSON document is not a URL we may fetch on trust:
 * "starts with https://" would let anything in that body name a host this
 * server then requests. CodeQL flagged exactly that (high severity) on the
 * first cut of this change.
 */
describe('toSafeMflUrl', () => {
  it('accepts the real static-file URL MFL advertises', () => {
    expect(toSafeMflUrl('https://www44.myfantasyleague.com/fflnetdynamic2026/21227_CONFERENCE01_draft_results.xml')).not.toBeNull();
  });

  it('refuses a host that is not MFL, however it is dressed up', () => {
    for (const hostile of [
      'https://evil.com/x.xml',
      // The real domain in a path, a credential, or a subdomain suffix — all of
      // which a naive substring check would wave through.
      'https://evil.com/www44.myfantasyleague.com/x.xml',
      'https://user@evil.com/x.xml',
      'https://myfantasyleague.com.evil.com/x.xml',
      // Still a finite list, so it ends — and a non-app-server subdomain of the
      // real domain is refused just like a foreign host.
      'https://www100.myfantasyleague.com/x.xml',
      'https://mail.myfantasyleague.com/x.xml',
      'https://evil.com/?u=myfantasyleague.com',
      // Cloud metadata, the classic SSRF target.
      'https://169.254.169.254/latest/meta-data/',
    ]) {
      expect(toSafeMflUrl(hostile), hostile).toBeNull();
    }
  });

  it('REBUILDS the URL from the allowlist rather than returning the input', () => {
    // The whole point: the origin this server connects to comes from the frozen
    // list, not from the string MFL sent. A port or credential in the original
    // is dropped rather than carried into the fetch.
    expect(toSafeMflUrl('https://WWW44.MyFantasyLeague.com/a/b.xml?x=1')).toBe(
      'https://www44.myfantasyleague.com/a/b.xml?x=1'
    );
    expect(toSafeMflUrl('https://www44.myfantasyleague.com:8443/a.xml')).toBe(
      'https://www44.myfantasyleague.com/a.xml'
    );
    expect(toSafeMflUrl('https://u:p@www44.myfantasyleague.com/a.xml')).toBe(
      'https://www44.myfantasyleague.com/a.xml'
    );
  });

  it('refuses non-https schemes', () => {
    expect(toSafeMflUrl('http://www44.myfantasyleague.com/x.xml')).toBeNull();
    expect(toSafeMflUrl('file:///etc/passwd')).toBeNull();
    expect(toSafeMflUrl('gopher://www44.myfantasyleague.com/')).toBeNull();
  });

  it('refuses anything that is not a parseable URL string', () => {
    expect(toSafeMflUrl('')).toBeNull();
    expect(toSafeMflUrl('www44.myfantasyleague.com/x.xml')).toBeNull();
    expect(toSafeMflUrl(undefined)).toBeNull();
    expect(toSafeMflUrl(null)).toBeNull();
    expect(toSafeMflUrl(42)).toBeNull();
    expect(toSafeMflUrl({ toString: () => 'https://www44.myfantasyleague.com/' })).toBeNull();
  });
});

/**
 * Fixes for the round-one review findings, each pinned by the property that
 * broke rather than by the line that changed.
 */
describe('review round one', () => {
  const SRC = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  describe('the static file is fetched through the REBUILT url', () => {
    it('never passes the caller’s string to fetch', () => {
      // `fetchStaticBoard` computed a safe URL and then fetched the unvalidated
      // one, so the allowlist that closed a CodeQL SSRF alert was a no-op at
      // the exact line that reaches the network. Guarding the decision, not the
      // wording: nothing in that function may fetch anything but `safeUrl`.
      const src = SRC('src/pages/api/draft/status.ts');
      const fn = src.slice(
        src.indexOf('async function fetchStaticBoard'),
        src.indexOf('async function fetchStaticBoard') + 900
      );
      expect(fn).toContain('const safeUrl = toSafeMflUrl(staticUrl)');
      expect(fn).toContain('await fetch(safeUrl');
      expect(fn).not.toContain('await fetch(staticUrl');
    });
  });

  describe('the image-cache trim does not depend on worker lifetime', () => {
    it('is sampled, not counted', () => {
      // A module-level counter reset every time the browser killed the idle
      // worker, so the trim essentially never ran and the cache — exempt from
      // the activate sweep — grew until the origin quota, where cache.put
      // starts throwing and is swallowed.
      const sw = SRC('public/sw.js');
      expect(sw).toContain('Math.random() < 1 / TRIM_EVERY');
      expect(sw).not.toContain('remoteImageWrites');
    });

    it('also trims on activate, which no sampling can miss', () => {
      const sw = SRC('public/sw.js');
      const activate = sw.slice(
        sw.indexOf("addEventListener('activate'"),
        sw.indexOf("addEventListener('fetch'")
      );
      expect(activate).toContain('trimRemoteImages');
    });
  });

  describe('XML attribute values are entity-decoded', () => {
    // `res.json()` decoded these for free on the export path, so nothing
    // downstream expects raw entities. The static file is raw XML, and comments
    // feed parseTradeFromComment and reach a 65-inch screen.
    const decode = (value: string) =>
      value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(lt|gt|quot|apos|amp));/gi, (whole, dec, hex, named) => {
        if (dec) return String.fromCodePoint(Number.parseInt(dec, 10));
        if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
        switch ((named as string).toLowerCase()) {
          case 'lt': return '<';
          case 'gt': return '>';
          case 'quot': return '"';
          case 'apos': return "'";
          case 'amp': return '&';
          default: return whole;
        }
      });

    it('decodes the forms MFL actually emits in a franchise name', () => {
      expect(decode('Da Bear&#39;s &amp; Co.')).toBe("Da Bear's & Co.");
      expect(decode('&quot;The Show&quot;')).toBe('"The Show"');
      expect(decode('a &lt; b &gt; c')).toBe('a < b > c');
      expect(decode('&#x27;quoted&#x27;')).toBe("'quoted'");
    });

    it('leaves ordinary text and unknown entities alone', () => {
      expect(decode('Suh girls, one cup')).toBe('Suh girls, one cup');
      expect(decode('100% &nbsp; sure')).toBe('100% &nbsp; sure');
    });

    it('does not double-decode an encoded ampersand', () => {
      // `&amp;#39;` is a literal "&#39;", not an apostrophe. A two-pass decoder
      // (or decoding &amp; first) turns it into one.
      expect(decode('&amp;#39;')).toBe('&#39;');
    });
  });

  describe('board freshness is a tuple, not one number for two things', () => {
    // Collapsing "stamp if any, else count" makes an unstamped board
    // incomparable: an epoch second dwarfs a pick count, so an unstamped static
    // board could never win and the headline fix would silently never engage.
    const fresh = (newestPick: number, filled: number) => ({ newestPick, filled });
    const atLeastAsFresh = (a: any, b: any) =>
      a.newestPick !== b.newestPick ? a.newestPick > b.newestPick : a.filled >= b.filled;

    it('lets an UNSTAMPED board win on count instead of losing to an epoch', () => {
      expect(atLeastAsFresh(fresh(0, 31), fresh(0, 26))).toBe(true);
    });

    it('does not let an unstamped board beat a stamped one', () => {
      expect(atLeastAsFresh(fresh(0, 99), fresh(1_787_987_132, 31))).toBe(false);
    });

    it('prefers the newer stamp regardless of count — the revert case', () => {
      expect(atLeastAsFresh(fresh(5_000, 2), fresh(1_000, 12))).toBe(true);
    });
  });
});
