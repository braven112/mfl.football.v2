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
 * Measured live during the 2026 AFL rehearsal (2026-08-28): the same league
 * and the same unit alternated between one filled pick and zero across polls
 * two seconds apart, on `api.myfantasyleague.com` AND on the league's own
 * `www44`, with runs of four consecutive stale reads. The export is served
 * from backends whose caches disagree, so one poll is a sample of whichever
 * backend answered — not a monotonic view of the draft.
 *
 * The room saw 1.01 land, the board flip back to "on the clock", and forward
 * again, every few seconds. And silently: `collectFreshPicks` already held the
 * pick in its seen-set, so it never re-revealed on the way back.
 *
 * `DraftBroadcast` answers this by keeping the UNION of every filled slot it
 * has seen rather than the latest response. That merge is what these cases
 * pin — as a pure function, because the rule is about the DATA, and a test
 * that had to mount the island to state it would be testing React instead.
 */
describe('a flapping MFL board', () => {
  /** The island's merge, verbatim — see `filledRef` in DraftBroadcast.tsx. */
  function mergeFilled(
    held: Map<number, { overallPickNumber: number; playerId: string }>,
    incoming: { overallPickNumber: number; playerId: string }[]
  ) {
    const merged = incoming.map((p) => (p.playerId ? p : held.get(p.overallPickNumber) ?? p));
    for (const p of merged) if (p.playerId) held.set(p.overallPickNumber, p);
    return merged;
  }

  const slot = (n: number, playerId = '') => ({ overallPickNumber: n, playerId });
  const board = (...filled: Record<number, string>[]) => {
    const map = Object.assign({}, ...filled) as Record<number, string>;
    return [1, 2, 3].map((n) => slot(n, map[n] ?? ''));
  };

  it('does not un-fill a pick when the next poll comes back empty', () => {
    const held = new Map<number, ReturnType<typeof slot>>();
    mergeFilled(held, board({ 1: '17472' }));

    // The exact stale read observed seconds later.
    const after = mergeFilled(held, board());

    expect(after[0].playerId).toBe('17472');
  });

  it('survives a RUN of stale reads, not just one', () => {
    // Four consecutive zeros were measured on api.myfantasyleague.com, so a
    // one-poll tolerance would not have covered it.
    const held = new Map<number, ReturnType<typeof slot>>();
    mergeFilled(held, board({ 1: '17472' }));

    let after = board();
    for (let i = 0; i < 4; i += 1) after = mergeFilled(held, board());

    expect(after[0].playerId).toBe('17472');
  });

  it('takes the fresh half of a response that is stale for another slot', () => {
    // Disagreeing backends make a mixed response possible: this one has lost
    // 1.01 but carries 1.02, which dropping the response whole would discard.
    const held = new Map<number, ReturnType<typeof slot>>();
    mergeFilled(held, board({ 1: '17472' }));

    const after = mergeFilled(held, board({ 2: '99999' }));

    expect(after.map((p) => p.playerId)).toEqual(['17472', '99999', '']);
  });

  it('lets a real re-pick through — the response always wins when it is filled', () => {
    // A commissioner correcting a pick must still reach the board; only an
    // EMPTY slot defers to what we hold.
    const held = new Map<number, ReturnType<typeof slot>>();
    mergeFilled(held, board({ 1: '17472' }));

    const after = mergeFilled(held, board({ 1: '00001' }));

    expect(after[0].playerId).toBe('00001');
  });

  it('never shrinks the filled count across a flapping sequence', () => {
    const held = new Map<number, ReturnType<typeof slot>>();
    const sequence = [
      board({ 1: '17472' }),
      board(),
      board({ 1: '17472' }),
      board(),
      board(),
      board({ 1: '17472', 2: '99999' }),
      board({ 1: '17472' }),
    ];

    let high = 0;
    for (const poll of sequence) {
      const count = mergeFilled(held, poll).filter((p) => p.playerId).length;
      expect(count).toBeGreaterThanOrEqual(high);
      high = count;
    }
    expect(high).toBe(2);
  });
});
