import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOddsMap } from '../src/utils/coach-data';
import { resolveChannel } from '../src/utils/broadcast-channels';

/**
 * The `.net-badge` primitive — the TV network a real NFL game is carried on.
 *
 * Every rule here is a way the badge silently stops working rather than
 * breaking loudly, which is why they are mechanical:
 *
 *  - a surface that resolves a channel WITHOUT `resolveChannel` names a US
 *    network to a viewer in Perth,
 *  - the lineup slot is rendered TWICE (once by Astro, once by the page's own
 *    client script on every player swap), so a badge added to one copy alone
 *    vanishes the moment the owner touches their lineup,
 *  - and a surface that emits the class without loading the stylesheet renders
 *    an unstyled, full-size PNG in the middle of a row.
 */

const root = (p: string) => resolve(__dirname, '..', p);
const read = (p: string) => readFileSync(root(p), 'utf8');

/** Every file that draws a `.net-badge`, and where its stylesheet comes from. */
const BADGE_SURFACES = [
  'src/components/shared/NetworkBadge.astro',
  'src/components/shared/NflGamesStrip.tsx',
  'src/pages/theleague/lineup.astro',
  'src/pages/afl-fantasy/lineup.astro',
] as const;

/**
 * Every file that mounts the rail, DISCOVERED rather than listed. The hardcoded
 * trio below is still asserted (they must all exist), but the directive and
 * server-slate rules run over whatever the repo actually contains — a fourth
 * page copied from the component's own example is precisely how the
 * never-hydrating mount came back.
 */
function stripMountFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(root(dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(astro|tsx)$/.test(e.name) && read(rel).includes('<NflGamesStrip')) out.push(rel);
    }
  };
  walk('src/pages');
  return out.sort();
}

/** Routes that mount the React island and therefore must hand it a country. */
const STRIP_ROUTES = [
  'src/pages/theleague/live-scoring.astro',
  'src/pages/afl-fantasy/live-scoring.astro',
  'src/pages/best-ball-1/live-scoring.astro',
] as const;

const LINEUP_PAGES = [
  'src/pages/theleague/lineup.astro',
  'src/pages/afl-fantasy/lineup.astro',
] as const;

describe('network badge — one resolver', () => {
  // `resolveChannel` is the only thing that knows a Thursday game is Prime
  // Video in Seattle, DAZN in London and Kayo in Perth. A surface that reaches
  // past it into the mappings file, or builds its own `/assets/tv-logos/` path,
  // is a second copy of that mapping that will drift.
  it('no surface builds a tv-logo path by hand', () => {
    const offenders: string[] = [];
    for (const file of BADGE_SURFACES) {
      if (/['"`]\/assets\/tv-logos\//.test(read(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('no surface imports broadcast-mappings.json directly', () => {
    const offenders: string[] = [];
    for (const file of BADGE_SURFACES) {
      if (/broadcast-mappings\.json/.test(read(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('network badge — the stylesheet reaches every surface', () => {
  // `.net-badge` lives in one shared stylesheet. NetworkBadge imports it for
  // the Astro surfaces; the React island cannot, so its routes import it.
  it('NetworkBadge imports it, so every Astro consumer is covered', () => {
    expect(read('src/components/shared/NetworkBadge.astro')).toMatch(/styles\/network-badge\.css/);
  });

  it('every route mounting NflGamesStrip imports it', () => {
    for (const route of STRIP_ROUTES) {
      const src = read(route);
      expect(src, route).toMatch(/NflGamesStrip/);
      expect(src, route).toMatch(/styles\/network-badge\.css/);
    }
  });

  it('both lineup pages import it — they emit the class inline, not via NetworkBadge', () => {
    for (const page of LINEUP_PAGES) {
      const src = read(page);
      expect(src, page).toMatch(/net-badge/);
      expect(src, page).toMatch(/styles\/network-badge\.css/);
    }
  });

  it('Storybook loads it too — a component frontmatter import never reaches the canvas', () => {
    expect(read('.storybook/preview.ts')).toMatch(/styles\/network-badge\.css/);
  });
});

describe('network badge — country comes from the ROUTE', () => {
  // Resolving a viewer preference WRITES cookies, and `Astro.cookies.set()`
  // after the headers are committed throws and blanks the page. Reading is
  // side-effect free, which is why these routes call `readViewerClock`.
  it('every route feeding a badge reads the preference rather than resolving it', () => {
    for (const route of [...STRIP_ROUTES, ...LINEUP_PAGES]) {
      const src = read(route);
      expect(src, route).toMatch(/readViewerClock\(/);
      expect(src, route).not.toMatch(/resolveViewerPreferences\(/);
    }
  });

  it('every route mounting NflGamesStrip passes country to it', () => {
    for (const route of STRIP_ROUTES) {
      expect(read(route), route).toMatch(/country=\{viewerCountry\}/);
    }
  });

  it('NflGamesStrip takes country as a prop and never reads a cookie itself', () => {
    const src = read('src/components/shared/NflGamesStrip.tsx');
    expect(src).toMatch(/country\?: CountryCode/);
    expect(src).not.toMatch(/document\.cookie/);
  });
});

describe('NFL games rail — it must survive its own empty server render', () => {
  /**
   * The rail was invisible in production for its whole life and nobody noticed,
   * because the ONE path anyone checked (`?demo=1`) is the path that hides it.
   *
   * `NflGamesStrip` returns null when it has no games. Astro's `client:visible`
   * hydration observes the island's CHILDREN — an island that server-rendered
   * nothing has none, so the observer never fires, the island never hydrates,
   * the client poll never runs, and the rail never appears. Not "until
   * kickoff": never. Two independent things stop it, and both are pinned here.
   */
  it('every known route still mounts the rail', () => {
    // Discovery must not silently find nothing, which would pass every check below.
    expect(stripMountFiles()).toEqual(expect.arrayContaining([...STRIP_ROUTES]));
  });

  it('every file mounting the rail hands it a server-rendered slate', () => {
    const missing = stripMountFiles().filter((f) => {
      const src = read(f);
      return !/fetchInitialNflGames\(/.test(src) || !/initialGames=\{nflGames\}/.test(src);
    });
    expect(missing, 'these mount the rail with no server slate').toEqual([]);
  });

  it('no file mounts the rail with client:visible', () => {
    const offenders = stripMountFiles().filter((f) => {
      const mount = read(f).slice(read(f).indexOf('<NflGamesStrip'));
      return /client:visible/.test(mount.slice(0, 400));
    });
    // `visible` is the one directive that cannot recover from an empty island.
    expect(offenders, 'client:visible cannot hydrate an island with no children').toEqual([]);
  });

  it("the component's own example does not recommend client:visible", () => {
    // The example is what a fourth page gets copied from.
    const doc = read('src/components/shared/NflGamesStrip.tsx').split('*/')[0];
    expect(doc).not.toMatch(/client:visible week/);
    expect(doc).toMatch(/client:idle/);
  });

  it('the server slate and the client poll parse through the SAME source', () => {
    // Two copies of the parse rules is how the SSR rail and the polled rail
    // would come to disagree about a team code or a network.
    const route = read('src/pages/api/nfl-scoreboard.ts');
    expect(route).toMatch(/from '\.\.\/\.\.\/utils\/nfl-scoreboard-source'/);
    expect(route, 'the API route re-implements the parse').not.toMatch(/parseGameSituation|canonicalNflCode/);
  });

  it('an ESPN outage yields undefined, never an empty array', () => {
    // `[]` would be indistinguishable from a real empty week and would render
    // an empty rail; undefined lets the island fall back to its own poll.
    const src = read('src/utils/nfl-scoreboard-source.ts');
    expect(src).toMatch(/board\.ok && board\.games\.length > 0 \? board\.games : undefined/);
  });
});

describe('network badge — the lineup slot renders twice and both must draw it', () => {
  // The page rebuilds a slot's innerHTML on every player swap. A badge present
  // only in the .astro branch disappears the first time the owner changes
  // anything — which is exactly when they are looking at the row.
  it.each(LINEUP_PAGES)('%s draws the badge in the Astro branch AND the client script', (page) => {
    const src = read(page);
    // The Astro branch: a JSX-ish attribute with an expression value.
    expect(src).toMatch(/class="net-badge net-badge--mark lineup-slot__net" title=\{game\.channel\.title\}/);
    // The client branch: the same markup inside a template literal.
    expect(src).toMatch(/class="net-badge net-badge--mark lineup-slot__net" title="\$\{esc\(ch\.title\)\}"/);
  });

  it.each(LINEUP_PAGES)('%s interpolates the client badge INTO the slot markup, not just defines it', (page) => {
    const src = read(page);
    expect(src, page).toMatch(/const netHtml =/);
    // Defining the badge is not drawing it. The drift this pins is real: the
    // builder survives while the template that consumed it is edited, and the
    // badge then disappears on the first player swap with nothing failing.
    const oppRow = src.match(/<div class="lineup-slot__opp" aria-label="\$\{esc\(matchupLabel\)\}">[\s\S]*?<\/div>/);
    expect(oppRow?.[0], `${page}: client-script opponent row not found`).toBeTruthy();
    expect(oppRow![0], `${page}: netHtml is built but never rendered`).toContain('${netHtml}');
  });

  it.each(LINEUP_PAGES)('%s announces the channel in the slot BUTTON label, both render paths', (page) => {
    const src = read(page);
    // The starter slot's button carries an explicit aria-label, which REPLACES
    // its subtree for assistive tech — so the badge's own alt text is
    // unreachable from inside it and the channel has to be in the label or it
    // is not announced at all. The bench row has no such wrapper and is fine.
    expect(src, `${page}: Astro branch label omits the channel`)
      .toMatch(/game\?\.channel \? ` On \$\{game\.channel\.name\}\.` : ''/);
    expect(src, `${page}: client branch label omits the channel`)
      .toMatch(/ch \? ` On \$\{esc\(ch\.name\)\}\.` : ''/);
  });

  it.each(LINEUP_PAGES)('%s declares `ch` before the label that reads it', (page) => {
    const src = read(page);
    // `const` is not hoisted to a usable value: reading `ch` above its
    // declaration is a TDZ ReferenceError that throws on EVERY slot re-render,
    // which is exactly what happened when the label started using it.
    const decl = src.indexOf('const ch = game?.channel');
    const use = src.indexOf('btn.ariaLabel');
    expect(decl, `${page}: no ch declaration`).toBeGreaterThan(-1);
    expect(use, `${page}: no ariaLabel assignment`).toBeGreaterThan(-1);
    expect(decl, `${page}: ch is declared after the label reads it`).toBeLessThan(use);
  });

  it.each(LINEUP_PAGES)('%s resolves the channel server-side, never in the client script', (page) => {
    const src = read(page);
    expect(src).toMatch(/function channelFor\(/);
    // The client script re-emits strings off the payload; if it ever called the
    // resolver itself the country mapping would be shipped to the browser and
    // could disagree with the server render.
    const clientScript = src.slice(src.indexOf('<script>'));
    expect(clientScript).not.toMatch(/resolveChannel\(/);
  });

  it.each(LINEUP_PAGES)('%s escapes the channel strings it interpolates', (page) => {
    const src = read(page);
    for (const field of ['ch.title', 'ch.logo', 'ch.name']) {
      expect(src, `${page} — ${field}`).toContain(`esc(${field})`);
    }
  });
});

describe('network badge — the mark must not collapse before it loads', () => {
  // `loading="lazy"` plus `width: auto` gives an unloaded image NO intrinsic
  // size, so the mark renders 0px wide — invisible, then popping the row wider
  // when it arrives. Measured on the games rail: 0x15 before load, 44x15 after,
  // which is why the rail looked badge-less on a page nobody had scrolled.
  it.each(BADGE_SURFACES)('%s does not lazy-load the mark', (file) => {
    const src = read(file);
    const lazyMarks = src
      .split('\n')
      .filter((l) => l.includes('net-badge__logo') && l.includes('loading="lazy"'));
    expect(lazyMarks, `${file}: ${lazyMarks.length} lazy mark(s)`).toEqual([]);
  });
});

describe('network badge — the mark is never the only affordance', () => {
  /**
   * The text arm, in each dialect a surface writes it: an Astro/JSX expression
   * (`>{channel.name}`) or the lineup client script's escaped template literal.
   * Matching the RENDERED NAME rather than a class name is the point — a class
   * can survive while the branch that draws the name is deleted.
   */
  const TEXT_ARM = /(?:>\{channel\.name\}|>\{game\.channel\.name\}|>\$\{esc\(ch\.name\)\})/;

  // A channel with no artwork on disk still has to say who is carrying the
  // game, so the text arm is a real branch and not an <img> error fallback.
  it.each(BADGE_SURFACES)('%s draws the channel NAME when there is no mark', (file) => {
    const src = read(file);
    expect(src, `${file} has no mark branch at all`).toMatch(/net-badge--mark/);
    expect(src, `${file} draws only the mark — a channel with no logo on disk would render nothing`)
      .toMatch(TEXT_ARM);
  });

  it.each(BADGE_SURFACES)('%s gives the mark the channel name as alt text', (file) => {
    const src = read(file);
    if (!src.includes('net-badge__logo')) return;
    // alt="" would leave a screen reader with no channel at all — the mark IS
    // the only statement of the network on that branch.
    expect(src, file).not.toMatch(/net-badge__logo[\s\S]{0,160}?alt=""/);
    expect(src, file).toMatch(/net-badge__logo[\s\S]{0,200}?alt=(?:\{|")\$?\{?(?:channel|ch|game\.channel)/);
  });
});

describe('network badge — the lineup pages actually receive a network', () => {
  // The lineup pages read their schedule from coach-data's odds map, not from
  // /api/nfl-scoreboard. Carrying `broadcast` through THAT builder is the whole
  // reason the opponent line can name a channel; without it `channelFor` is
  // handed '' on every game and the badge is silently absent everywhere.
  const competition = (broadcasts: unknown) => ({
    id: '401772510',
    broadcasts,
    competitors: [
      { homeAway: 'home', score: '24', team: { abbreviation: 'PHI' } },
      { homeAway: 'away', score: '20', team: { abbreviation: 'DAL' } },
    ],
    status: { type: { shortDetail: 'Final' } },
  });
  const scoreboard = (broadcasts: unknown) => ({
    events: [{ id: '401772510', date: '2026-09-13T17:00Z', competitions: [competition(broadcasts)] }],
  });

  it('buildOddsMap carries the network onto BOTH teams of a game', () => {
    const map = buildOddsMap(scoreboard([{ names: ['CBS'] }]));
    expect(map.PHI.broadcast).toBe('CBS');
    expect(map.DAL.broadcast).toBe('CBS');
  });

  it("a game ESPN has not assigned yields '' rather than undefined", () => {
    // '' is what `resolveChannel` reads as "no network", returning null and
    // rendering no badge. `undefined` would work by accident today and break
    // the moment anything string-handles the field.
    const map = buildOddsMap(scoreboard(undefined));
    expect(map.PHI.broadcast).toBe('');
    expect(resolveChannel(map.PHI.broadcast, 'US')).toBeNull();
  });

  it('that network resolves to a mark at home and a local carrier abroad', () => {
    const network = buildOddsMap(scoreboard([{ names: ['CBS'] }])).PHI.broadcast;
    const us = resolveChannel(network, 'US');
    expect(us?.name).toBe('CBS');
    expect(us?.logo).toMatch(/^\/assets\/tv-logos\/.+\.png$/);
    // The point of resolving per country: a Perth owner is not told to watch CBS.
    expect(resolveChannel(network, 'AU')?.name).not.toBe('CBS');
  });
});
