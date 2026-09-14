/**
 * Guard: MFL Live's league selection.
 *
 * Its default is the OPPOSITE of every other board's — everything on, because
 * "all of your teams" has to be true on first load — and that inversion is
 * what makes the shared toggle helper dangerous here. `toggleLeagueSelection`
 * returns `null` for an empty result, `null` means "use the default", and the
 * default here is EVERY league. So switching off your last one would switch
 * them all back on: the exact opposite of the tap.
 */

import { describe, it, expect } from 'vitest';
import {
  MFL_LIVE_LEAGUE_COOKIE,
  defaultMflLiveSelection,
  rememberMflLiveChoice,
  resolveMflLiveLeagues,
  toggleMflLiveLeague,
} from '../src/utils/mfl-live-selection';
import { LEAGUE_SELECTION_COOKIE } from '../src/utils/sunday-ticket-selection';
import { BROADCAST_LEAGUE_COOKIE } from '../src/utils/broadcast-selection';

const league = (id: string, registered: unknown = null) =>
  ({ id, name: `League ${id}`, franchiseId: '0001', franchiseName: 'Mine', registered, host: null, isSession: false }) as any;

const three = [league('a'), league('b'), league('c')];

describe('the default is everything', () => {
  it('every league the owner is in', () => {
    expect(defaultMflLiveSelection(three)).toEqual(['a', 'b', 'c']);
  });

  it('includes a draft-only league rather than hiding it', () => {
    // Best Ball has no weekly matchup, but it renders `no-matchup`, which is
    // information. Hiding a league the owner is genuinely in would make the
    // board's own promise false.
    const withBestBall = [...three, league('bb', { slug: 'best-ball-1', bestBall: true })];
    expect(defaultMflLiveSelection(withBestBall)).toContain('bb');
  });

  it('is NOT the other boards’ default', () => {
    // Sunday Ticket and /broadcast default to home leagues only. If this ever
    // starts filtering by `registered`, the promise breaks silently.
    const mixed = [league('home', { slug: 'theleague' }), league('outside')];
    expect(defaultMflLiveSelection(mixed)).toEqual(['home', 'outside']);
  });
});

describe('the cookie is this board’s own', () => {
  it('is not Sunday Ticket’s and not the broadcast board’s', () => {
    // Three screens, three answers. A television set up once must not rewrite
    // the phone in your pocket.
    expect(MFL_LIVE_LEAGUE_COOKIE).not.toBe(LEAGUE_SELECTION_COOKIE);
    expect(MFL_LIVE_LEAGUE_COOKIE).not.toBe(BROADCAST_LEAGUE_COOKIE);
  });
});

describe('resolveMflLiveLeagues', () => {
  it('param wins, so a link can carry a set', () => {
    const { enabled, explicit } = resolveMflLiveLeagues('a,c', 'b', three);
    expect(enabled).toEqual(['a', 'c']);
    expect(explicit).toBe(true);
  });

  it('falls back to the cookie', () => {
    expect(resolveMflLiveLeagues(null, 'b', three).enabled).toEqual(['b']);
  });

  it('a garbage or stale cookie can never blank the board', () => {
    for (const junk of ['', '   ', 'not-a-league', 'default']) {
      expect(resolveMflLiveLeagues(null, junk, three).enabled).toEqual(['a', 'b', 'c']);
    }
  });

  it('a param can never widen what the session may see', () => {
    // Only ids already present in this owner's own list survive.
    expect(resolveMflLiveLeagues('a,someone-elses', null, three).enabled).toEqual(['a']);
  });
});

describe('toggleMflLiveLeague', () => {
  it('switching one off keeps the rest', () => {
    const { selection, refused } = toggleMflLiveLeague(['a', 'b', 'c'], ['a', 'b', 'c'], 'b');
    expect(refused).toBe(false);
    expect(selection).toEqual(['a', 'c']);
  });

  it('switching the last one back on collapses to the default', () => {
    // `null` = "default" = everything, so the cookie stops pinning today's
    // list and a league joined next month appears by itself.
    const { selection } = toggleMflLiveLeague(['a', 'b'], ['a', 'b', 'c'], 'c');
    expect(selection).toBeNull();
  });

  it('REFUSES to switch off the last league on', () => {
    // The whole reason this wrapper exists. The shared helper would return
    // null here, which means "default", which means every league back ON.
    const { selection, refused } = toggleMflLiveLeague(['b'], ['a', 'b', 'c'], 'b');
    expect(refused).toBe(true);
    expect(selection).toEqual(['b']);
  });

  it('and the refusal is not just a null check — it never yields the default', () => {
    const { selection } = toggleMflLiveLeague(['b'], ['a', 'b', 'c'], 'b');
    // If this were null, resolveMflLiveLeagues would answer with all three.
    expect(resolveMflLiveLeagues(selection ? selection.join(',') : null, null, three).enabled).toEqual(['b']);
  });

  it('orders by the league list, not by when each was switched on', () => {
    // Four leagues so the result is a real subset rather than the default.
    const { selection } = toggleMflLiveLeague(['c', 'a'], ['a', 'b', 'c', 'd'], 'b');
    expect(selection).toEqual(['a', 'b', 'c']);
  });
});

describe('rememberMflLiveChoice — route-only cookie write', () => {
  const jar = () => {
    const calls: Array<{ name: string; value: string }> = [];
    return { calls, set: (name: string, value: string) => calls.push({ name, value }) };
  };

  it('writes the param under this board’s cookie', () => {
    const c = jar();
    rememberMflLiveChoice(new URL('https://mfl.football/live?leagues=a,b'), c as never);
    expect(c.calls).toEqual([{ name: MFL_LIVE_LEAGUE_COOKIE, value: 'a,b' }]);
  });

  it('writes nothing when the URL carries no choice', () => {
    // A plain visit must not overwrite a choice made earlier.
    const c = jar();
    rememberMflLiveChoice(new URL('https://mfl.football/live'), c as never);
    expect(c.calls).toEqual([]);
  });

  it('an empty value is stored as "default" rather than as nothing', () => {
    const c = jar();
    rememberMflLiveChoice(new URL('https://mfl.football/live?leagues='), c as never);
    expect(c.calls[0].value).toBe('default');
  });
});

describe('the cookie write stays in the route', () => {
  it('no component calls Astro.cookies.set for this board', async () => {
    // `Astro.cookies.set()` from an imported component runs after the response
    // headers are committed, throws ResponseSentError and blanks the page —
    // Sunday Ticket shipped that on its first click. Only the two routes may
    // write, and they do it through rememberMflLiveChoice.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(astro|ts|tsx)$/.test(e.name)) {
          const src = fs.readFileSync(path.join(root, rel), 'utf8');
          if (src.includes('MFL_LIVE_LEAGUE_COOKIE') && src.includes('cookies.set(')) offenders.push(rel);
        }
      }
    };
    walk('src/components');
    expect(offenders, 'a component writes this board’s cookie — it will blank the page').toEqual([]);
  });
});
