/**
 * The television's own league set, and its own silence.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BROADCAST_LEAGUE_COOKIE,
  BROADCAST_SOUND_COOKIE,
  broadcastHref,
  defaultLeagueSelection,
  resolveBroadcastLeagues,
  resolveBroadcastSound,
} from '../src/utils/broadcast-selection';
import { LEAGUE_SELECTION_COOKIE } from '../src/utils/sunday-ticket-selection';
import { ALL_LEAGUES, getLeagueBySlug } from '../src/config/leagues';

const theLeague = getLeagueBySlug('theleague')!;
const afl = getLeagueBySlug('afl-fantasy')!;
const bb1 = ALL_LEAGUES.find((l) => l.bestBall);

const board = (ids: { id: string; registered: any }[]) =>
  ids.map((x) => ({ ...x, name: x.id, franchiseId: '0001', franchiseName: '', host: null, isSession: false })) as any;

const everything = () =>
  board([
    { id: theLeague.id, registered: theLeague },
    { id: afl.id, registered: afl },
    ...(bb1 ? [{ id: bb1.id, registered: bb1 }] : []),
    { id: '99999', registered: null },
  ]);

describe('the picker cookie is the television’s, not Sunday Ticket’s', () => {
  it('uses a different cookie name', () => {
    // A board set up once on a TV must not silently rewrite the league set on
    // the Sunday Ticket page read on a laptop every Sunday morning.
    expect(BROADCAST_LEAGUE_COOKIE).not.toBe(LEAGUE_SELECTION_COOKIE);
  });

  it('never reads or writes Sunday Ticket’s cookie name', () => {
    const src = readFileSync(join(process.cwd(), 'src/utils/broadcast-selection.ts'), 'utf8');
    // The import of the shared pure helpers is fine; the STRING is not.
    expect(src).not.toMatch(/['"]st_leagues['"]/);
  });

  it('has its own sound cookie too', () => {
    expect(BROADCAST_SOUND_COOKIE).not.toBe(BROADCAST_LEAGUE_COOKIE);
  });
});

describe('the default set', () => {
  it('is TheLeague and the AFL — Best Ball and outside leagues start off', () => {
    const defaults = defaultLeagueSelection(everything());
    expect(defaults).toContain(theLeague.id);
    expect(defaults).toContain(afl.id);
    expect(defaults).not.toContain('99999');
    if (bb1) expect(defaults).not.toContain(bb1.id);
  });

  it('is what an owner with no cookie and no param gets', () => {
    const { enabled, explicit } = resolveBroadcastLeagues(null, null, everything());
    expect(enabled).toEqual(defaultLeagueSelection(everything()));
    expect(explicit).toBe(false);
  });

  it('is what a stale or garbage cookie falls back to — never a blank board', () => {
    for (const junk of ['', '   ', 'nope,alsonope', 'all', 'default']) {
      const { enabled } = resolveBroadcastLeagues(null, junk, everything());
      expect(enabled).toEqual(defaultLeagueSelection(everything()));
    }
  });
});

describe('resolveBroadcastLeagues', () => {
  it('lets the URL param beat the cookie, so a link can carry a set', () => {
    const { enabled, explicit } = resolveBroadcastLeagues('99999', theLeague.id, everything());
    expect(enabled).toEqual(['99999']);
    expect(explicit).toBe(true);
  });

  it('honours an explicit opt-in to an outside league', () => {
    const { enabled } = resolveBroadcastLeagues(null, `${theLeague.id},99999`, everything());
    expect(enabled).toEqual([theLeague.id, '99999']);
  });

  it('drops ids for leagues the owner is not in', () => {
    const { enabled } = resolveBroadcastLeagues(`${theLeague.id},55555`, null, everything());
    expect(enabled).toEqual([theLeague.id]);
  });
});

describe('sound is opt-in', () => {
  it('is silent with nothing set', () => {
    expect(resolveBroadcastSound(null, null)).toBe(false);
    expect(resolveBroadcastSound(undefined, undefined)).toBe(false);
  });

  it('turns on only when asked', () => {
    expect(resolveBroadcastSound('1', null)).toBe(true);
    expect(resolveBroadcastSound(null, '1')).toBe(true);
  });

  it('lets the param turn it back OFF over a remembered yes', () => {
    expect(resolveBroadcastSound('0', '1')).toBe(false);
  });
});

describe('broadcastHref', () => {
  it('keeps an explicit week', () => {
    expect(broadcastHref('/broadcast', [theLeague.id], 12)).toBe(
      `/broadcast?week=12&leagues=${theLeague.id}`,
    );
  });

  it('spells the default set as `default` rather than enumerating it', () => {
    expect(broadcastHref('/broadcast', null, null)).toBe('/broadcast?leagues=default');
  });
});
