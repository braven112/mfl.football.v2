/**
 * `readLeagueStandings` — MFL's standings, for any league the owner is in.
 *
 * ── THE RULE THIS FILE EXISTS FOR ─────────────────────────────────────────
 * The rows are never re-sorted. MFL returns standings in the league's official
 * order with that league's constitution tiebreaker chain already applied —
 * Power Rank, Victory Points, head-to-head — and we cannot reproduce it.
 * Homebrew tiebreakers miscredited 22 AFL and 10 TheLeague division titles
 * before the rule existed that forbids this.
 * `docs/claude/rules/standings-brackets-draft-order.md`.
 *
 * The rest is the usual MFL posture, which this read cannot opt out of: a 200
 * is not a success, a body that did not parse is a failed read rather than an
 * empty league, and "we could not read it" stays distinct from "there is
 * nothing here" all the way to the UI — `null`, never `[]`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mflFetch = vi.fn();
vi.mock('../src/utils/mfl-fetch', () => ({ mflFetch: (...a: unknown[]) => mflFetch(...a) }));

import {
  decorateStandings,
  readLeagueStandings,
  __resetStandingsCache,
} from '../src/utils/live/standings';
import type { BoardLeague } from '../src/utils/sunday-ticket-selection';

const YEAR = 2026;
const COOKIE = 'mfl-user-cookie';

const outsideLeague: BoardLeague = {
  id: '99999',
  name: 'Some Other League',
  franchiseId: '0003',
  franchiseName: 'Brooklyn Bandits',
  registered: null,
  host: 'https://www49.myfantasyleague.com',
  isSession: false,
};

/** MFL sends every number as a string. */
const franchise = (id: string, over: Record<string, string> = {}) => ({
  id,
  fname: `Team ${id}`,
  h2hw: '3',
  h2hl: '1',
  h2ht: '0',
  pf: '400.50',
  ...over,
});

const ok = (body: unknown) => ({ ok: true, json: async () => body });

const standingsBody = (rows: unknown[]) => ({ leagueStandings: { franchise: rows } });

beforeEach(() => {
  mflFetch.mockReset();
  __resetStandingsCache();
});

describe('MFL’s order is the answer', () => {
  it('keeps the feed’s order exactly, however the columns read', () => {
    // The first row is the leader BECAUSE MFL put it first. Ranking it by wins
    // or points here is precisely the homebrew tiebreaker that miscredited 32
    // division titles across the two leagues.
    const rows = [
      franchise('0007', { h2hw: '1', h2hl: '3', pf: '100.0' }),
      franchise('0002', { h2hw: '4', h2hl: '0', pf: '900.0' }),
      franchise('0005', { h2hw: '2', h2hl: '2', pf: '500.0' }),
    ];
    mflFetch.mockResolvedValue(ok(standingsBody(rows)));

    return readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
    }).then((out) => {
      expect(out!.map((r) => r.franchiseId)).toEqual(['0007', '0002', '0005']);
      // `rank` is the POSITION, not a judgement derived from the columns.
      expect(out!.map((r) => r.rank)).toEqual([1, 2, 3]);
      expect(out![0].wins).toBe(1);
    });
  });

  it('parses MFL’s stringy numbers', async () => {
    mflFetch.mockResolvedValue(
      ok(standingsBody([franchise('0001', { h2hw: '10', h2hl: '2', h2ht: '1', pf: '1,998.36' })])),
    );
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
    });
    expect(out![0]).toMatchObject({ wins: 10, losses: 2, ties: 1, pointsFor: 1998.36 });
  });

  it('reads the record from the COMBINED string when the columns are absent', async () => {
    // MFL ships the record two ways and not every feed ships both —
    // `normalizeWLT` in src/utils/standings.ts exists for the same reason, in
    // the other direction. Reading only the columns is not a missing-data bug:
    // it renders every team as 0-0, which reads as a season nobody has played.
    mflFetch.mockResolvedValue(
      ok(standingsBody([{ id: '0001', fname: 'Team 0001', h2hwlt: '15-3-1', pf: '400.50' }])),
    );
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
    });
    expect(out![0]).toMatchObject({ wins: 15, losses: 3, ties: 1 });
  });

  it('prefers the columns when the feed ships both', async () => {
    mflFetch.mockResolvedValue(
      ok(standingsBody([franchise('0001', { h2hwlt: '99-99-99' })])),
    );
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
    });
    expect(out![0]).toMatchObject({ wins: 3, losses: 1, ties: 0 });
  });

  it('survives a feed carrying neither', async () => {
    mflFetch.mockResolvedValue(ok(standingsBody([{ id: '0001', fname: 'Team', pf: '10.0' }])));
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
    });
    expect(out![0]).toMatchObject({ wins: 0, losses: 0, ties: 0, pointsFor: 10 });
  });

  it('collapses a lone franchise object into a list', async () => {
    // MFL collapses a one-element list to a bare object.
    mflFetch.mockResolvedValue(ok({ leagueStandings: { franchise: franchise('0001') } }));
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
    });
    expect(out).toHaveLength(1);
  });

  it('pads a short franchise id, so it joins the board’s rows', async () => {
    mflFetch.mockResolvedValue(ok(standingsBody([franchise('3')])));
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
    });
    expect(out![0].franchiseId).toBe('0003');
  });
});

describe('rank numbers the rows on screen', () => {
  it('leaves NO gap when a malformed row is dropped', async () => {
    // The loop drops rows with a blank or `0000` id — no real franchise has
    // one. Numbering from the feed's index instead of the kept count renders
    // a # column reading 1, 2, 4 with no missing row to explain it.
    mflFetch.mockResolvedValue(
      ok(
        standingsBody([
          franchise('0001'),
          franchise(''),
          franchise('0003'),
          { id: '0000', fname: 'Bye' },
          franchise('0005'),
        ]),
      ),
    );
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
    });
    expect(out!.map((r) => r.franchiseId)).toEqual(['0001', '0003', '0005']);
    expect(out!.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('still numbers in MFL’s order, not one of our own', async () => {
    // Numbering the kept rows is not ranking them: nothing sorts, and nothing
    // reads the columns to decide a position.
    mflFetch.mockResolvedValue(
      ok(
        standingsBody([
          franchise('0007', { h2hw: '0', pf: '1.0' }),
          franchise('0002', { h2hw: '9', pf: '999.0' }),
        ]),
      ),
    );
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
    });
    expect(out!.map((r) => [r.franchiseId, r.rank])).toEqual([
      ['0007', 1],
      ['0002', 2],
    ]);
  });
});

describe('names that arrive after the standings did', () => {
  it('can be applied afterwards, so a concurrent caller is not stuck with fname', async () => {
    // The assembler reads the standings and the franchise names CONCURRENTLY,
    // so it has no names to pass when it calls readLeagueStandings. Without a
    // second pass, an outside league whose rows omit `fname` shows
    // "Franchise 0001" under a Scores tab showing the real name.
    mflFetch.mockResolvedValue(ok(standingsBody([franchise('0001', { fname: '' })])));
    const base = { league: outsideLeague, year: YEAR, mflUserCookie: COOKIE };

    const first = await readLeagueStandings(base);
    expect(first![0].name).not.toBe('Brooklyn Bandits');

    const named = decorateStandings(first!, {
      ...base,
      franchiseNames: { '0001': 'Brooklyn Bandits' },
    });
    expect(named[0].name).toBe('Brooklyn Bandits');
    expect(named[0].initials).toBeTruthy();
  });

  it('is safe to apply twice — a resolved name is what the second pass falls back to', async () => {
    mflFetch.mockResolvedValue(ok(standingsBody([franchise('0001', { fname: 'Tulsa Twisters' })])));
    const base = { league: outsideLeague, year: YEAR, mflUserCookie: COOKIE };
    const once = await readLeagueStandings(base);
    const twice = decorateStandings(once!, { ...base, franchiseNames: {} });
    expect(twice[0].name).toBe('Tulsa Twisters');
    expect(twice.map((r) => r.rank)).toEqual(once!.map((r) => r.rank));
  });

  it('keeps the viewer flag per request across that second pass', async () => {
    mflFetch.mockResolvedValue(ok(standingsBody([franchise('0001'), franchise('0003')])));
    const base = { league: outsideLeague, year: YEAR, mflUserCookie: COOKIE };
    const rows = await readLeagueStandings(base);
    const named = decorateStandings(rows!, { ...base, viewerFranchiseId: '0003' });
    expect(named.filter((r) => r.isViewer).map((r) => r.franchiseId)).toEqual(['0003']);
  });
});

describe('“we could not read it” is never “there is nothing here”', () => {
  it('answers null — never [] — on a transport failure', async () => {
    mflFetch.mockRejectedValue(new Error('network'));
    expect(
      await readLeagueStandings({ league: outsideLeague, year: YEAR, mflUserCookie: COOKIE }),
    ).toBeNull();
  });

  it('answers null for a 200 that is not a standings payload', async () => {
    // A throttled MFL answers with an HTML page under a 200, and `res.ok`
    // passes it. Read the SHAPE.
    mflFetch.mockResolvedValue(ok({ error: 'Too many requests' }));
    expect(
      await readLeagueStandings({ league: outsideLeague, year: YEAR, mflUserCookie: COOKIE }),
    ).toBeNull();
  });

  it('answers null for a body that did not parse at all', async () => {
    mflFetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('not json');
      },
    });
    expect(
      await readLeagueStandings({ league: outsideLeague, year: YEAR, mflUserCookie: COOKIE }),
    ).toBeNull();
  });

  it('never reaches MFL without the owner’s cookie', async () => {
    expect(
      await readLeagueStandings({ league: outsideLeague, year: YEAR, mflUserCookie: '' }),
    ).toBeNull();
    expect(mflFetch).not.toHaveBeenCalled();
  });
});

describe('the read itself', () => {
  it('reads an OUTSIDE league through its own myleagues host, with the cookie', async () => {
    mflFetch.mockResolvedValue(ok(standingsBody([franchise('0001')])));
    await readLeagueStandings({ league: outsideLeague, year: YEAR, mflUserCookie: COOKIE });

    const [args] = mflFetch.mock.calls[0];
    expect(args.url).toContain('https://www49.myfantasyleague.com/2026/export');
    expect(args.url).toContain('TYPE=leagueStandings');
    expect(args.url).toContain('L=99999');
    // The owner's own credential: an outside league's exports are not ours to
    // read anonymously.
    expect(args.mflUserCookie).toBe(COOKIE);
  });

  it('serves a second call from cache rather than re-reading', async () => {
    mflFetch.mockResolvedValue(ok(standingsBody([franchise('0001')])));
    const input = { league: outsideLeague, year: YEAR, mflUserCookie: COOKIE };
    await readLeagueStandings(input);
    await readLeagueStandings(input);
    // A standing changes when a game goes FINAL — a handful of times a Sunday.
    // Re-reading it every 25s poll charges an export for a number that did not
    // move.
    expect(mflFetch).toHaveBeenCalledTimes(1);
  });
});

describe('the viewer’s own row', () => {
  it('flags it, and only it', async () => {
    mflFetch.mockResolvedValue(
      ok(standingsBody([franchise('0001'), franchise('0003'), franchise('0005')])),
    );
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
      viewerFranchiseId: '0003',
    });
    expect(out!.filter((r) => r.isViewer).map((r) => r.franchiseId)).toEqual(['0003']);
  });

  it('is resolved per REQUEST, never baked into the shared cache', async () => {
    // The cache is shared across requests. A cached `isViewer` would highlight
    // one owner's row for the next reader.
    mflFetch.mockResolvedValue(ok(standingsBody([franchise('0001'), franchise('0003')])));
    const base = { league: outsideLeague, year: YEAR, mflUserCookie: COOKIE };

    const first = await readLeagueStandings({ ...base, viewerFranchiseId: '0003' });
    const second = await readLeagueStandings({ ...base, viewerFranchiseId: '0001' });

    expect(first!.find((r) => r.isViewer)!.franchiseId).toBe('0003');
    expect(second!.find((r) => r.isViewer)!.franchiseId).toBe('0001');
    expect(mflFetch).toHaveBeenCalledTimes(1);
  });

  it('flags nobody when the viewer is in no row', async () => {
    mflFetch.mockResolvedValue(ok(standingsBody([franchise('0001')])));
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
      viewerFranchiseId: null,
    });
    expect(out!.some((r) => r.isViewer)).toBe(false);
  });
});

describe('names', () => {
  it('prefers the names the cross-league read already resolved', async () => {
    mflFetch.mockResolvedValue(ok(standingsBody([franchise('0001')])));
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
      franchiseNames: { '0001': 'Brooklyn Bandits' },
    });
    expect(out![0].name).toBe('Brooklyn Bandits');
  });

  it('falls back to the feed’s own fname', async () => {
    mflFetch.mockResolvedValue(ok(standingsBody([franchise('0001', { fname: 'Tulsa Twisters' })])));
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
    });
    expect(out![0].name).toBe('Tulsa Twisters');
  });

  it('does not let a BLANK resolved name beat the feed’s', async () => {
    // An empty string would override a good name with nothing at all.
    mflFetch.mockResolvedValue(ok(standingsBody([franchise('0001', { fname: 'Tulsa Twisters' })])));
    const out = await readLeagueStandings({
      league: outsideLeague,
      year: YEAR,
      mflUserCookie: COOKIE,
      franchiseNames: { '0001': '   ' },
    });
    expect(out![0].name).toBe('Tulsa Twisters');
  });
});
