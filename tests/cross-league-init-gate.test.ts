/**
 * A forked per-league page's `astro:page-load` init must name ITS OWN LEAGUE
 * in its bail-out gate.
 *
 * The rule, and why it is not obvious:
 *
 * 1. `init` is registered on `document`. The ClientRouter does NOT replace
 *    `document`, so once an owner has opened the page, that listener fires on
 *    every in-site navigation for the rest of the session. (That registration
 *    is correct — it is the Sept 2026 fix for the page going inert on a return
 *    visit. See docs/claude/rules/lineups.md.)
 * 2. The gate therefore has to ask a node the router REPLACED, not a `window`
 *    global. That was the Sept 2026 hotfix: `window.__LINEUP_DATA__` survived
 *    the swap, so `if (!data) return` was unfalsifiable and the lineup
 *    controller ran — and threw — on every page an owner visited next.
 * 3. But a bare element id is STILL not a gate, because this repo's league
 *    pages are FORKED SIBLINGS: `/theleague/lineup` and `/afl-fantasy/lineup`
 *    render the same ids. And a cross-league navigation is same-origin — so it
 *    is a ClientRouter SWAP, not a fresh document. On the shared host
 *    (mfl.football, where a league with no apex domain lives) the nav header's
 *    own league switcher emits a RELATIVE href: `buildSwitchUrl` in
 *    nav-utils.ts returns the bare equivalent path whenever the league prefix
 *    is not hidden. So the chevron on Set Lineup is exactly that swap, one
 *    click away.
 *
 * What goes wrong with an id-only gate is worse than a double-bind, and it
 * differs per page:
 *
 *   - lineup: both controllers bind the same DOM, and their submit handlers
 *     post to DIFFERENT endpoints (`/api/lineup` vs `/api/afl-fantasy/lineup`),
 *     so a dual-league owner can write a lineup into the wrong league.
 *   - players: both pages guard with the SAME `dataset.init` flag, so the
 *     departing league's listener — registered first, therefore run first —
 *     wires the wrong league's handlers AND sets the flag, which locks the
 *     arriving league's own init out entirely.
 *
 * Naming the league in the selector is what separates them. This guard pins
 * that for every page pair below; add new forked pairs here as they appear.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from './helpers/js-source';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';

interface GuardedPage {
  label: string;
  file: string;
  slug: string;
  /**
   * The gate AS THE INITIALIZER WRITES IT — the whole statement, not just the
   * selector. Matching the selector alone would stay green if a regression put
   * the bare gate back in `init()` and left an unused `querySelector` sitting
   * somewhere else in the file.
   */
  gate: string;
  /**
   * The league-blind form that must NOT appear. Scoped to the initializer's
   * own statement, because these files legitimately reference the same element
   * elsewhere (e.g. players.astro's module-scope `OWN_TABLE`).
   */
  forbidden?: string;
  /** The exact marker attribute, expression included, as the markup writes it. */
  marker: string;
  /**
   * The frontmatter binding proving that marker expression resolves to THIS
   * page's slug. Without it the marker check passes on a page that renders the
   * SIBLING's slug — which would make the gate never match and ship the page
   * inert, the opposite failure but just as dead.
   */
  markerBinding: string;
}

const PAIRS: Record<string, GuardedPage[]> = {
  'Set Lineup': [
    {
      label: 'TheLeague',
      file: 'src/pages/theleague/lineup.astro',
      slug: 'theleague',
      gate: `if (!document.querySelector('.lineup-page[data-league="theleague"]')) return;`,
      marker: '<div class="lineup-page" data-league={PAGE_LEAGUE_SLUG}>',
      markerBinding: `const PAGE_LEAGUE_SLUG = getLeagueBySlug('theleague')!.slug;`,
    },
    {
      // The AFL's lineup is the AFL-FAMILY page component, shared with the
      // custom-site demo's keeper slot: one controller for both, so its gate
      // names the family marker and it reads its league off the page it found
      // (the route binds `league` to getLeagueBySlug('afl-fantasy')). It still
      // must never match TheLeague's page, which is what this pair pins.
      label: 'the AFL',
      file: 'src/components/afl-family/LineupPage.astro',
      slug: 'afl-fantasy',
      gate: `const pageRoot = document.querySelector<HTMLElement>('.lineup-page[data-controller="afl-family"]');`,
      marker: '<div class="lineup-page" data-league={PAGE_LEAGUE_SLUG} data-controller="afl-family">',
      markerBinding: `const PAGE_LEAGUE_SLUG = league.slug;`,
    },
  ],
  Players: [
    {
      label: 'TheLeague',
      file: 'src/pages/theleague/players.astro',
      slug: 'theleague',
      gate: `const table = document.querySelector('#players-table[data-league="theleague"]');`,
      forbidden: `const table = document.getElementById('players-table');`,
      marker: '<table class="players-table" id="players-table" data-league={theLeagueDef.slug}>',
      markerBinding: `const theLeagueDef = getLeagueBySlug('theleague');`,
    },
    {
      // The AFL-family players page, shared with the demo's keeper slot — see
      // the lineup entry above for why its gate names the family marker.
      label: 'the AFL',
      file: 'src/components/afl-family/PlayersPage.astro',
      slug: 'afl-fantasy',
      gate: `const table = document.querySelector('#players-table[data-controller="afl-family"]');`,
      forbidden: `const table = document.getElementById('players-table');`,
      marker: '<table class="players-table" id="players-table" data-league={aflLeague.slug} data-controller="afl-family">',
      markerBinding: `const { league: aflLeague, freeAgentsData, leagueFeedModules, calendarModules, logoSrc } = Astro.props;`,
    },
  ],
  Rosters: [
    {
      label: 'TheLeague',
      file: 'src/pages/theleague/rosters.astro',
      slug: 'theleague',
      gate: `if (!document.querySelector('.roster-page[data-league="theleague"]')) return;`,
      // This direction was already safe by accident — the old gate asked for
      // `#roster-config`, which only this page renders. Accident, because the
      // id says nothing about a league; the sibling was one rename away from
      // colliding with it.
      marker: '<section class="roster-page" data-league={PAGE_LEAGUE_SLUG}>',
      markerBinding: `const PAGE_LEAGUE_SLUG = getLeagueBySlug('theleague')!.slug;`,
    },
    {
      // The AFL-family rosters page, shared with the demo's keeper slot — see
      // the lineup entry above for why its gate names the family marker.
      label: 'the AFL',
      file: 'src/components/afl-family/RostersPage.astro',
      slug: 'afl-fantasy',
      gate: `const pageRoot = document.querySelector<HTMLElement>('.roster-page[data-controller="afl-family"]');`,
      // The direction that was really broken: this controller ran on
      // TheLeague's rosters page after an AFL -> TheLeague swap and bound a
      // second player-modal trigger onto it, reading the wrong league's data.
      forbidden: `const pageRoot = document.querySelector<HTMLElement>('.roster-page');`,
      marker: '<section class="roster-page" data-league={PAGE_LEAGUE_SLUG} data-controller="afl-family" data-initial-view={initialView}>',
      markerBinding: `const PAGE_LEAGUE_SLUG = aflLeague.slug;`,
    },
  ],
};


const REGISTRY_SLUGS = new Set(ALL_LEAGUES.map((l: { slug: string }) => l.slug));

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
}

describe.each(Object.entries(PAIRS))('%s — cross-league init gate', (_pair, pages) => {
  it.each(pages.map((p) => [p.label, p] as const))(
    "%s's init gate names its own league",
    (_label, page) => {
      // Comment-stripped, so a gate that was commented out cannot satisfy this.
      const code = stripComments(read(page.file));

      expect(REGISTRY_SLUGS.has(page.slug), `${page.slug} is not a registry slug`).toBe(true);

      // The page must actually be in the hazard class this rule is about: an
      // init registered on `document`, which the swap does not replace.
      expect(code, `${page.file}: expected an astro:page-load init`)
        .toMatch(/document\.addEventListener\('astro:page-load'/);

      expect(code, `${page.file}: the init gate must name its own league`)
        .toContain(page.gate);

      // The league-blind form must be gone from the initializer, or a
      // regression could satisfy the check above with an unused selector
      // parked elsewhere in the file while `init()` kept the old gate.
      if (page.forbidden) {
        expect(code, `${page.file}: the initializer must not keep the league-blind gate`)
          .not.toContain(page.forbidden);
      }

      // And never a sibling's — that is the bug this guard exists for.
      for (const other of REGISTRY_SLUGS) {
        if (other === page.slug) continue;
        expect(code, `${page.file}: must not gate on ${other}'s marker`)
          .not.toContain(`data-league="${other}"`);
      }

      // The marker has to be RENDERED, or the gate never matches and the page
      // ships inert. The expression is matched exactly, not just its `{`
      // prefix, so the sibling's expression cannot be swapped in unnoticed.
      const markup = read(page.file);
      expect(markup, `${page.file}: the gated element must carry its league marker`)
        .toContain(page.marker);

      // …and that expression has to resolve to THIS page's slug, from the
      // registry. This is the half the marker check alone cannot see.
      expect(markup, `${page.file}: the marker must be bound to its own registry entry`)
        .toContain(page.markerBinding);
    },
  );
});

describe('the cross-league gate rule', () => {
  it('covers both sides of every pair it lists', () => {
    // A pair guarded on one side only is the drift this repo keeps shipping:
    // the fix lands in one league and the sibling keeps the bug.
    for (const [pair, pages] of Object.entries(PAIRS)) {
      const slugs = pages.map((p) => p.slug);
      expect(new Set(slugs).size, `${pair}: duplicate league in the pair`).toBe(slugs.length);
      expect(slugs.length, `${pair}: a pair needs at least two sides`).toBeGreaterThan(1);
    }
  });
});
