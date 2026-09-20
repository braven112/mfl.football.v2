/**
 * Scan guards for MFL Live's league boards.
 *
 * These read the SOURCE rather than run it, because what they pin is the shape
 * of the code and not the value it returns — and both rules are ones a future
 * edit could drop while every behavioural test stays green.
 *
 * 1. **The league id in the URL is a CHECK, never an input.** Both entry
 *    points — the page and the poll — must look the id up in the owner's own
 *    `discoverBoardLeagues` list and refuse a miss. The assembly is about to
 *    send the owner's `MFL_USER_ID` to a host named in a `myleagues` payload;
 *    taking the id on trust would let a URL decide which league gets read with
 *    someone's credential. It is the same posture `/api/live-leagues` states
 *    for its own selection: a league parameter may only ever narrow what the
 *    session can already see.
 *
 * 2. **An island prop must survive JSON.** Astro serializes the props of a
 *    hydrated island across the server/client boundary, so a FUNCTION prop
 *    does not arrive — it throws on render. `panelHrefBase` is a string for
 *    that reason, and a callback version of it would look correct in review.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const PAGE = 'src/pages/live/league/[id].astro';
const POLL = 'src/pages/api/league-board.ts';

describe('the league id is checked against the owner’s own leagues', () => {
  for (const file of [PAGE, POLL]) {
    it(`${file} resolves it through discoverBoardLeagues`, () => {
      const src = read(file);
      expect(src).toContain('discoverBoardLeagues');
      // The list is SEARCHED for the id — never indexed by it, and never used
      // merely as a presence check while the raw param is passed on.
      expect(src).toMatch(/\.find\(\s*\(l\w*\)\s*=>\s*l\w*\.id === /);
    });

    it(`${file} refuses a league the account is not in`, () => {
      const src = read(file);
      // A miss must end the request. Rendering an empty board instead would
      // confirm which league ids are real.
      expect(src).toMatch(/404/);
    });

    it(`${file} passes the FOUND league on, not the raw param`, () => {
      const src = read(file);
      // `assembleMflLeagueBoard` takes a BoardLeague precisely so the id
      // cannot arrive unchecked; a call site handing it `leagueId` directly
      // would mean the lookup above had been made decorative.
      expect(src).toMatch(/assembleMflLeagueBoard\(\{[^}]*league[,:]/s);
      expect(src).not.toMatch(/assembleMflLeagueBoard\(\{[^}]*leagueId:/s);
    });
  }
});

describe('island props cross the boundary as JSON', () => {
  it('no .astro page hands LiveBoard a function prop', () => {
    // A function prop throws on render rather than degrading, so this is a
    // build-breaker that only shows on the page that does it.
    const pages = ['src/pages/live/index.astro', PAGE];
    for (const page of pages) {
      const src = read(page);
      expect(src).not.toMatch(/panelHref=\{\(/);
      expect(src).not.toMatch(/=\{\([\w\s,]*\)\s*=>/);
    }
  });

  it('the base path is a string prop the kit appends the league id to', () => {
    const kit = read('src/components/shared/live/LiveBoard.tsx');
    expect(kit).toMatch(/panelHrefBase\?: string;/);
    expect(kit).toContain('encodeURIComponent(panel.leagueId)');
  });

  it('the league boards do NOT pass it — the link would point at themselves', () => {
    const page = read('src/components/shared/live/LiveBoardPage.astro');
    expect(page).not.toContain('panelHrefBase');
  });
});

describe('the board is assembled in process, never through our own API', () => {
  it('the page does not fetch /api/league-board to render itself', () => {
    // A request blocked at the edge never reaches the route: on 2026-09-09
    // the live-scoring page printed "Scores will appear here when games begin"
    // over a live slate, invisible in the logs, for exactly this reason.
    const src = read(PAGE);
    expect(src).toContain('assembleMflLeagueBoard');
    expect(src).not.toMatch(/(await\s+)?fetch\(\s*['"`][^'"`]*\/api\//);
  });
});
