import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import navConfig from '../src/config/nav-config.json';
import pageDirectory from '../src/data/page-directory.json';
import {
  FRONT_OFFICE_PAGES,
  FRONT_OFFICE_HUB_PATH,
  frontOfficePagesFor,
  routePathOf,
  type FrontOfficeLeagueSlug,
} from '../src/components/shared/front-office-nav/front-office-pages';
import { getVisibleLinks, getLinkLabel } from '../src/utils/nav-utils';

/**
 * The Front Office section: a hub whose PRIMARY content is now the League
 * Planner (TheLeague) / Keeper Planner (AFL), plus a sidebar linking every
 * other cap/contract/trade page (mirrors docs/plans/draft-hub-and-results.md's
 * pattern for the sub-nav strip). Unlike the draft section, TheLeague and the
 * AFL are NOT at parity here and are not meant to be — the AFL runs
 * salaryCap:false / contracts:false, so most of this section is
 * TheLeague-only. That is why this suite pins each league's list explicitly
 * rather than asserting the two are equal.
 *
 * `league-planner` and `keepers` are deliberately NOT registry entries —
 * their content IS the hub now (see front-office-pages.ts's header). Roster/
 * Salary and Keeper Report Card are still deliberately UNMOVED, linked pages
 * — Roster/Salary is the single most-visited page on the site with its own
 * required parity check (scripts/roster-parity-check.mjs); moving it bought
 * nothing but risk.
 */

const navLinks = navConfig.sections.flatMap((s: any) => s.links ?? []);
const directory = pageDirectory as {
  id: string;
  title: string;
  path: string;
  visibility: string;
  tags: string[];
}[];

describe('the Front Office page registry', () => {
  it('keeps every path league-NEUTRAL', () => {
    // A prefixed path here would send half the readers to the other league's
    // site — resolveLeaguePath adds the prefix per reader.
    for (const p of FRONT_OFFICE_PAGES) {
      expect(p.path, p.key).not.toMatch(/^\/(theleague|afl-fantasy|best-ball-1)\b/);
      expect(p.path.startsWith('/'), p.key).toBe(true);
    }
  });

  it('only advertises a page to a league that has the route file', () => {
    const routeFor = (league: string, path: string) => {
      const rel = `src/pages/${league}${routePathOf(path)}`;
      return existsSync(`${rel}.astro`) || existsSync(`${rel}/index.astro`);
    };
    for (const page of FRONT_OFFICE_PAGES) {
      for (const league of page.leagues) {
        expect(routeFor(league, page.path), `${league} has no ${page.path}`).toBe(true);
      }
    }
  });

  it('gives both leagues a hub route', () => {
    expect(existsSync('src/pages/theleague/front-office/index.astro')).toBe(true);
    expect(existsSync('src/pages/afl-fantasy/front-office/index.astro')).toBe(true);
  });

  it('publishes exactly these pages to each league', () => {
    // Explicit rather than compared: the two leagues are NOT at parity and
    // are not meant to be (AFL runs salaryCap:false / contracts:false).
    // Adding a page to one league and forgetting the other still fails here,
    // because the pinned list stops matching — but the failure is a
    // deliberate edit to this test rather than an invented parity rule.
    expect(frontOfficePagesFor('theleague').map((p) => p.key)).toEqual([
      'rosters',
      'contracts',
      'trade-builder',
      'league-comparison',
      'projected-free-agents',
      'dead-money',
      'salary-analytics',
      'salary-history',
      'salary-archive',
    ]);
    expect(frontOfficePagesFor('afl-fantasy').map((p) => p.key)).toEqual([
      'rosters',
      'trade-builder',
      'keeper-analysis',
    ]);
    // The custom-site demo's keeper slot: the AFL-family pages it actually has.
    expect(frontOfficePagesFor('keeper').map((p) => p.key)).toEqual(['rosters', 'trade-builder']);
  });

  it('never re-lists league-planner or keepers — their content IS the hub now', () => {
    const allKeys = FRONT_OFFICE_PAGES.map((p) => p.key);
    expect(allKeys).not.toContain('league-planner');
    expect(allKeys).not.toContain('keepers');
  });

  it('has a page-directory entry for every page it advertises', () => {
    // Without one the page is invisible to site search.
    const paths = new Set(directory.map((p) => p.path));
    const covered = (league: string, path: string) => {
      const bare = routePathOf(path);
      return paths.has(bare) || paths.has(`/${league}${bare}`);
    };
    for (const page of FRONT_OFFICE_PAGES) {
      for (const league of page.leagues) {
        expect(covered(league, page.path), `${league}${page.path} not in page-directory`).toBe(true);
      }
    }
    expect(covered('theleague', FRONT_OFFICE_HUB_PATH)).toBe(true);
    expect(covered('afl-fantasy', FRONT_OFFICE_HUB_PATH)).toBe(true);
  });
});

describe('the hub is a real page now, not a links-only landing page', () => {
  // The PO's read on the original all-links hub: "doesn't add any value".
  // This pins the redesign's shape: real primary content (the League
  // Planner / Keeper Planner) + a sidebar to everything else — and pins the
  // PO's explicit rejection of the pill-strip nav above the headline.
  const theLeagueHub = readFileSync('src/pages/theleague/front-office/index.astro', 'utf-8');
  const aflHub = readFileSync('src/pages/afl-fantasy/front-office/index.astro', 'utf-8');
  const hubShell = readFileSync('src/components/shared/front-office-hub/FrontOfficeHubPage.astro', 'utf-8');

  it('renders ONE shared panel as the hub\'s own content, in both leagues', () => {
    // Phase B replaced TheLeaguePlannerPanel + AflKeeperPlannerPanel with a
    // single FrontOfficePanel whose sections are gated on registry features.
    // A second league-specific panel here is the regression to catch.
    expect(theLeagueHub).toMatch(/<FrontOfficePanel\b/);
    expect(aflHub).toMatch(/<FrontOfficePanel\b/);
    expect(existsSync('src/components/shared/front-office-hub/TheLeaguePlannerPanel.astro')).toBe(false);
    expect(existsSync('src/components/shared/front-office-hub/AflKeeperPlannerPanel.astro')).toBe(false);
  });

  it('renders the tool sidebar on both hubs', () => {
    expect(hubShell).toMatch(/<FrontOfficeToolRail\b/);
  });

  it('never renders FrontOfficeNav\'s pill strip on the hub — the PO rejected it explicitly', () => {
    for (const src of [theLeagueHub, aflHub, hubShell]) {
      expect(src).not.toMatch(/<FrontOfficeNav\b/);
    }
  });

  it('gives BOTH leagues a team switcher above the headline', () => {
    // The AFL had none until Phase B, because its Keeper Planner is
    // owner-private. That is still true of the BOARD — the panel renders it
    // for the viewer's own team only — but everything else on the hub is
    // public roster data, so there is a team worth switching to.
    expect(theLeagueHub).toMatch(/<FrontOfficeTeamSwitcher\b/);
    expect(aflHub).toMatch(/<FrontOfficeTeamSwitcher\b/);
    // Above the H1: the switcher slot must appear before the header in the
    // shared shell, not after — this is what "above the headline" means.
    const switcherIdx = hubShell.indexOf('name="switcher"');
    const headerIdx = hubShell.indexOf('<header');
    expect(switcherIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeGreaterThan(-1);
    expect(switcherIdx).toBeLessThan(headerIdx);
  });

  it('writes the team-preference cookie only in the route, never in a component', () => {
    // A component writing Astro.cookies runs after headers are committed
    // and throws — see CLAUDE.md's Sunday Ticket board precedent.
    expect(theLeagueHub).toMatch(/setTheLeaguePreference\(/);
    // The AFL writes through rememberAflTeamChoice, which resolves the
    // conference/tier its cookie carries. Still a ROUTE call — the helper
    // only assembles the arguments.
    expect(aflHub).toMatch(/rememberAflTeamChoice\(Astro\.cookies/);
    for (const componentFile of [
      'src/components/shared/front-office-hub/FrontOfficePanel.astro',
      'src/components/shared/front-office-hub/FrontOfficeTeamSwitcher.astro',
      'src/components/shared/front-office-hub/FrontOfficeHubPage.astro',
    ]) {
      const src = readFileSync(componentFile, 'utf-8');
      expect(src).not.toMatch(/setTheLeaguePreference\(/);
      expect(src).not.toMatch(/setAFLPreference\(/);
      expect(src).not.toMatch(/rememberAflTeamChoice\(/);
      expect(src).not.toMatch(/Astro\.cookies\.set\(/);
    }
  });

  it('leaves the original planner/keeper views in place — Phase 1 duplicates, never cuts', () => {
    // Phase 1 is deliberate duplication — see front-office-planner-data.ts
    // and front-office-keeper-data.ts's header comments. Phase 2 (cutting
    // the planner view out of rosters.astro) is explicitly future work; this
    // pins that each original view's markers are still present so a future
    // edit here can't silently remove them ahead of that phase.
    expect(readFileSync('src/pages/theleague/rosters.astro', 'utf-8')).toMatch(
      /data-view-content="nextyear"/,
    );
    expect(readFileSync('src/components/afl-family/RostersPage.astro', 'utf-8')).toMatch(
      /data-view-content="planner"[\s\S]*?<KeeperPlanner/,
    );
    expect(readFileSync('src/components/afl-family/KeepersPage.astro', 'utf-8')).toMatch(
      /PLANNER_VIEW = 'view=planner'/,
    );
  });
});

describe('rendering mode is preserved on every moved page', () => {
  // astro.config.ts sets output:'server', so a page with NO prerender export
  // is SSR by default. A move must not flip a page's rendering mode — adding
  // `prerender = true` to a page that merely looks static is the regression
  // this pins. Recorded against the pre-move tree.
  const PRERENDER: Record<string, 'absent' | 'false'> = {
    'src/pages/theleague/front-office/contracts.astro': 'absent',
    'src/pages/theleague/front-office/trade-builder.astro': 'false',
    'src/pages/theleague/front-office/projected-free-agents.astro': 'false',
    'src/pages/theleague/front-office/salary-analytics.astro': 'absent',
    'src/pages/theleague/front-office/salary-history.astro': 'absent',
    'src/pages/theleague/front-office/salary-archive.astro': 'absent',
    'src/pages/theleague/front-office/dead-money.astro': 'absent',
    'src/pages/theleague/front-office/league-comparison.astro': 'absent',
    'src/pages/afl-fantasy/front-office/trade-builder.astro': 'false',
  };

  for (const [file, expected] of Object.entries(PRERENDER)) {
    it(`${file} is still ${expected === 'false' ? 'explicit SSR' : 'implicit SSR'}`, () => {
      const src = readFileSync(file, 'utf-8');
      const hasExport = /export const prerender\s*=\s*false/.test(src);
      expect(hasExport, file).toBe(expected === 'false');
      expect(/export const prerender\s*=\s*true/.test(src), `${file} must not be prerendered`).toBe(false);
    });
  }
});

describe('every Front Office page has a way back', () => {
  // The two hub index.astro wrappers are excluded here: they delegate
  // entirely to FrontOfficeHubPage.astro, which always renders the strip
  // (current="hub") — there is nothing else in the wrapper file to match
  // against, the same reason draft/index.astro is not in DRAFT_ROUTES.
  const ROUTES: Record<FrontOfficeLeagueSlug, string[]> = {
    theleague: [
      'src/pages/theleague/front-office/contracts.astro',
      'src/pages/theleague/front-office/trade-builder.astro',
      'src/pages/theleague/front-office/projected-free-agents.astro',
      'src/pages/theleague/front-office/salary-analytics.astro',
      'src/pages/theleague/front-office/salary-history.astro',
      'src/pages/theleague/front-office/salary-archive.astro',
      'src/pages/theleague/front-office/dead-money.astro',
      'src/pages/theleague/front-office/league-comparison.astro',
      'src/pages/theleague/rosters.astro',
    ],
    'afl-fantasy': [
      'src/components/afl-family/TradeBuilderPage.astro',
      'src/components/afl-family/RostersPage.astro',
      'src/components/afl-family/KeepersPage.astro',
      'src/pages/afl-fantasy/keeper-analysis.astro',
    ],
    // The custom-site demo's keeper slot renders the AFL-family page bodies.
    keeper: ['src/components/afl-family/TradeBuilderPage.astro', 'src/components/afl-family/RostersPage.astro'],
  };
  const ALL_ROUTES = [...ROUTES.theleague, ...ROUTES['afl-fantasy']];

  it('renders FrontOfficeNav on every route in the list', () => {
    for (const route of ALL_ROUTES) {
      const src = readFileSync(route, 'utf-8');
      expect(/<FrontOfficeNav\b/.test(src), `${route} has no way back`).toBe(true);
    }
  });

  it('gives every page but the hub a trailing crumb', () => {
    for (const route of ALL_ROUTES) {
      const src = readFileSync(route, 'utf-8');
      const isHub = /current="hub"/.test(src);
      if (isHub) continue;
      // A crumb may be a literal string or a computed expression (rosters.astro
      // picks between "Roster / Salary" and "League Planner" server-side).
      expect(/crumb=(\{|")/.test(src), `${route} renders FrontOfficeNav without a crumb`).toBe(true);
    }
  });

  it('marks each registry key as current on exactly one route, per league', () => {
    for (const league of ['theleague', 'afl-fantasy'] as const) {
      const keys = frontOfficePagesFor(league).map((p) => p.key);
      const sources = ROUTES[league].map((r) => readFileSync(r, 'utf-8'));
      for (const key of keys) {
        // rosters.astro computes `current` dynamically rather than literally,
        // so match either a literal current="key" or the computed variable.
        const matches = sources.filter(
          (src) => new RegExp(`current=(\\{frontOfficeCurrent\\}|"${key}")`).test(src) && src.includes(key)
        );
        expect(matches.length, `key "${key}" (${league}) should be current on exactly one route`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('keeps the breadcrumb trail inside FrontOfficeNav, not duplicated per page', () => {
    for (const route of ALL_ROUTES) {
      const src = readFileSync(route, 'utf-8');
      expect(/<Breadcrumbs\b/.test(src), `${route} renders its own Breadcrumbs`).toBe(false);
    }
    expect(
      readFileSync('src/components/shared/front-office-nav/FrontOfficeNav.astro', 'utf-8')
    ).toMatch(/<Breadcrumbs/);
  });
});

describe('nav', () => {
  const warRoom = (navConfig.sections as any[]).find((s) => s.id === 'offseason-war-room');

  it('has no Front Office section — the hub is a link, not a category', () => {
    // The `front-office` LINK is expected (it opens the War Room, below). What
    // must not come back is the section that wrapped it: a category holding one
    // self-titled link, which is how /rosters fell out of the drawer.
    expect((navConfig.sections as any[]).find((s) => s.id === 'cap-contracts')).toBeUndefined();
    expect(
      (navConfig.sections as any[]).filter((s) => (s.links ?? []).length === 1).map((s) => s.id),
    ).not.toContain('cap-contracts');
  });

  it('drops the old per-page nav links', () => {
    // `rosters` is deliberately NOT in this list — see below. These three
    // moved into the hub's tool rail and have no nav entry of their own.
    for (const id of ['contracts', 'trade-builder', 'projected-free-agents']) {
      expect(navLinks.find((l: any) => l.id === id)).toBeUndefined();
    }
  });

  it('opens Offseason War Room with Front Office, then Rosters', () => {
    // "Front Office" is the name of this page everywhere now — nav, footer and
    // site search — because the rosters planner tabs it used to share the name
    // "League Planner" with are on their way out.
    expect(warRoom.links[0].id).toBe('front-office');
    expect(warRoom.links[0].label).toBe('Front Office');
    expect(warRoom.links[0].path).toBe('/front-office');
    expect(warRoom.links[1].id).toBe('rosters');
    expect(warRoom.links[1].path).toBe('/rosters');
  });

  it('serves both full-format leagues from one untagged entry each', () => {
    // nav-utils reads an untagged link as "every full-format league" and
    // best-ball is opt-in, so one entry covers TheLeague and the AFL while
    // Best Ball keeps its own tagged Rosters and gains no duplicate. Each
    // carries an AFL label because the AFL calls both of these something else.
    for (const link of warRoom.links.slice(0, 2)) {
      expect(link.leagueOnly, `${link.id} should not be league-tagged`).toBeUndefined();
    }
    // Rosters carries an AFL label because the AFL drops the "/Salary" half.
    expect(warRoom.links[1].labelAFL).toBe('Rosters');
    // League Planner deliberately does NOT: an AFL label of "Keeper Planner"
    // would collide with the existing /keepers entry of that name.
    expect(warRoom.links[0].labelAFL).toBeUndefined();
  });

  it('leaves ONE surface named Front Office, and no planner-tab link', () => {
    // The collision this closes: nav said "League Planner" -> /front-office
    // while the footer and site search said "League Planner" ->
    // /rosters?view=planner. Both destinations worked (?view=planner aliases to
    // rosters.astro's `nextyear` view, whose tab is itself labelled "League
    // Planner"), which is what made it a naming problem rather than a dead
    // link. The rosters planner tabs are being retired, so the hub took the
    // name and the directory entry that pointed at the tab is gone.
    expect(navLinks.find((l: any) => l.path === '/rosters?view=planner')).toBeUndefined();

    const directoryEntries = directory.filter(
      (p) => p.path === '/rosters?view=planner' || p.id === 'league-planner',
    );
    expect(directoryEntries).toEqual([]);

    // ...and the old name still FINDS it, so search for "league planner" is not
    // a dead end while the tabs are still shipping.
    const hub = directory.find((p) => p.id === 'front-office');
    expect(hub?.title).toBe('Front Office');
    expect(hub?.tags).toContain('league planner');
  });

  it('never shows one league two links with the same name in a section', () => {
    // Per RENDERED league, not per section: several sections carry a tagged
    // pair on purpose (This Week has a theleague and an afl "Live Scoring",
    // and the same for "Free Agents"), and exactly one of each pair renders.
    // What must never happen is one league seeing the same name twice — which
    // is what a second "League Planner" would have been.
    //
    // Both filter and label come from nav-utils, not from a copy of its rules:
    // a hand-rolled `labelAFL ?? label` would keep passing if the renderer's
    // own resolution ever changed, which is the one thing this guard exists to
    // notice. `franchiseId: '0001'` is an admin in every league, so the set
    // checked is the WIDEST any viewer sees — an owner-only or admin-only link
    // colliding with a public one is still a collision.
    for (const league of ['theleague', 'afl', 'bb1'] as const) {
      for (const section of navConfig.sections as any[]) {
        if (section.leagueOnly && section.leagueOnly !== league) continue;
        const names = getVisibleLinks(section, league, '0001').map((link) =>
          getLinkLabel(link, league),
        );
        expect(
          new Set(names).size,
          `${league} sees a repeated name in ${section.id}: ${names.join(', ')}`,
        ).toBe(names.length);
      }
    }
  });
});

describe('FrontOfficeNav renders breadcrumbs only, no per-page tab strip', () => {
  // The strip (one tab per FRONT_OFFICE_PAGES entry) was redundant with the
  // hub's own Tool Rail and got removed; the breadcrumb trail is the only
  // "way back" chrome these pages carry now.
  const NAV_SRC = readFileSync(
    'src/components/shared/front-office-nav/FrontOfficeNav.astro',
    'utf-8'
  );

  it('has no tab-strip markup left', () => {
    expect(NAV_SRC).not.toMatch(/class="fonav"/);
    expect(NAV_SRC).not.toMatch(/fonav__item/);
    expect(NAV_SRC).not.toMatch(/fonav__list/);
    expect(NAV_SRC).not.toMatch(/frontOfficePagesFor/);
  });

  it('still renders the breadcrumb trail', () => {
    expect(NAV_SRC).toMatch(/<Breadcrumbs/);
  });
});

describe('Contract Tools is retired, not just delisted', () => {
  it('is gone from the registry, page directory, and footer', () => {
    expect(FRONT_OFFICE_PAGES.map((p) => p.key)).not.toContain('contract-tools');
    expect(directory.find((p) => p.id === 'contract-calculator')).toBeUndefined();
  });

  it('has no surviving route file', () => {
    expect(existsSync('src/pages/theleague/front-office/contract-tools.astro')).toBe(false);
  });

  it('redirects both its own URL and its predecessor to the Front Office hub', () => {
    const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf-8'));
    const redirects = vercelConfig.redirects as Array<{ source: string; destination: string }>;
    const byPath = (source: string) => redirects.find((r) => r.source === source)?.destination;
    expect(byPath('/front-office/contract-tools')).toBe('/front-office');
    expect(byPath('/theleague/front-office/contract-tools')).toBe('/theleague/front-office');
    // The even-older /calculator alias must not still chain through the
    // now-deleted page.
    expect(byPath('/calculator')).toBe('/front-office');
    expect(byPath('/theleague/calculator')).toBe('/theleague/front-office');
  });
});
