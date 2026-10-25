/**
 * Seasonal themes (src/config/seasonal-themes.mjs): the window maths, and
 * that everything a season swaps in actually exists for every league that
 * opts in. A missing mark would render the league's normal crest in the
 * middle of an all-black-and-white page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_LEAGUES, type LeagueDefinition } from '../src/config/leagues';
import { SEASONAL_THEMES, SURFACE_SEASONAL_THEMES, activeSeasonalTheme, resolveSeasonPreview } from '../src/config/seasonal-themes.mjs';
import { getLeagueTeams } from '../src/utils/league-config';
import { buildAllTeamIconDarkCss } from '../src/utils/team-icon-dark-styles';
import { buildSeasonalMarkCss, seasonalLogoFile, seasonalMarkIds, seasonalSwapPath } from '../src/utils/seasonal-mark-css';
import { stampBadgeYear } from '../src/utils/afl-badge';

const ROOT = path.resolve(__dirname, '..');
const at = (iso: string) => activeSeasonalTheme(['halloween'], new Date(iso))?.id ?? null;
const atXmas = (iso: string) => activeSeasonalTheme(['halloween', 'christmas'], new Date(iso))?.id ?? null;

describe('Halloween window', () => {
  it('opens the Tuesday that starts the first of its two NFL weeks (Oct 20 in 2026)', () => {
    expect(at('2026-10-20T06:59:00Z')).toBeNull(); // Oct 19, 11:59pm PDT
    expect(at('2026-10-20T07:00:00Z')).toBe('halloween');
  });

  it('runs through the Monday night game of Halloween week (Nov 2 in 2026)', () => {
    expect(at('2026-11-03T07:59:00Z')).toBe('halloween'); // Nov 2, 11:59pm PST
    expect(at('2026-11-03T08:00:00Z')).toBeNull();
  });

  it('is always two NFL weeks, Halloween week last when it falls Thursday to Monday', () => {
    const w = (y: number) => SEASONAL_THEMES.halloween.window(y);
    expect(w(2027)).toEqual({ start: { y: 2027, m: 10, d: 19 }, end: { y: 2027, m: 11, d: 1 } }); // Sunday
    expect(w(2030)).toEqual({ start: { y: 2030, m: 10, d: 22 }, end: { y: 2030, m: 11, d: 4 } }); // Thursday
    expect(w(2033)).toEqual({ start: { y: 2033, m: 10, d: 18 }, end: { y: 2033, m: 10, d: 31 } }); // Monday
  });

  it('a Tuesday or Wednesday Halloween takes the two weeks just played, through Halloween itself', () => {
    const w = (y: number) => SEASONAL_THEMES.halloween.window(y);
    expect(w(2028)).toEqual({ start: { y: 2028, m: 10, d: 17 }, end: { y: 2028, m: 10, d: 31 } }); // Tuesday
    expect(w(2029)).toEqual({ start: { y: 2029, m: 10, d: 16 }, end: { y: 2029, m: 10, d: 31 } }); // Wednesday
  });

  it('a preview opens the season early, only for a league that wears it', () => {
    const oct18 = new Date('2026-10-18T19:00:00Z');
    expect(activeSeasonalTheme(['halloween'], oct18)).toBeNull();
    expect(activeSeasonalTheme(['halloween'], oct18, 'halloween')?.id).toBe('halloween');
    expect(activeSeasonalTheme(undefined, oct18, 'halloween')).toBeNull();
    expect(activeSeasonalTheme(['halloween'], oct18, 'nope')).toBeNull();
  });

  it('?seasonPreview= sets, keeps and clears the session preview', () => {
    expect(resolveSeasonPreview('Halloween', undefined)).toEqual({ kind: 'set', id: 'halloween' });
    expect(resolveSeasonPreview(null, 'halloween')).toEqual({ kind: 'keep', id: 'halloween' });
    expect(resolveSeasonPreview(null, 'bogus')).toEqual({ kind: 'keep', id: null });
    expect(resolveSeasonPreview('off', 'halloween')).toEqual({ kind: 'clear' });
  });

  it('is off for a league that does not opt in', () => {
    expect(activeSeasonalTheme(undefined, new Date('2026-10-25T12:00:00Z'))).toBeNull();
  });
});

describe('Christmas window', () => {
  it('opens the Tuesday of the NFL week holding Christmas (Dec 22 in 2026, Week 16)', () => {
    expect(atXmas('2026-12-22T07:59:00Z')).toBeNull(); // Dec 21, 11:59pm PST
    expect(atXmas('2026-12-22T08:00:00Z')).toBe('christmas');
  });

  it('runs through that week\'s Monday night game (Dec 28 in 2026)', () => {
    expect(atXmas('2026-12-29T07:59:00Z')).toBe('christmas'); // Dec 28, 11:59pm PST
    expect(atXmas('2026-12-29T08:00:00Z')).toBeNull();
  });

  it('always holds Christmas Day, whatever weekday it falls on', () => {
    const w = (y: number) => SEASONAL_THEMES.christmas.window(y);
    expect(w(2027)).toEqual({ start: { y: 2027, m: 12, d: 21 }, end: { y: 2027, m: 12, d: 27 } }); // Saturday
    expect(w(2028)).toEqual({ start: { y: 2028, m: 12, d: 19 }, end: { y: 2028, m: 12, d: 25 } }); // Monday: last day
    expect(w(2029)).toEqual({ start: { y: 2029, m: 12, d: 25 }, end: { y: 2029, m: 12, d: 31 } }); // Tuesday: first day
  });

  it('never overlaps Halloween', () => {
    expect(atXmas('2026-10-25T12:00:00Z')).toBe('halloween');
    expect(atXmas('2026-12-01T12:00:00Z')).toBeNull();
  });
});

describe('opted-in leagues', () => {
  const optedIn: LeagueDefinition[] = ALL_LEAGUES.filter((l: LeagueDefinition) => l.seasonalThemes?.length);

  it('TheLeague wears Halloween, with all 16 marks drawn', () => {
    expect(optedIn.map((l) => l.slug)).toContain('theleague');
    expect(seasonalMarkIds('theleague', 'halloween').size).toBe(16);
  });

  it('both leagues wear Christmas, with every team knit (16 and 24)', () => {
    expect(seasonalMarkIds('theleague', 'christmas').size).toBe(16);
    expect(seasonalMarkIds('afl', 'christmas').size).toBe(24);
  });

  it('the AFL wears Halloween, with all 24 marks drawn', () => {
    expect(optedIn.map((l) => l.slug)).toContain('afl-fantasy');
    expect(seasonalMarkIds('afl', 'halloween').size).toBe(24);
  });

  it('a franchise with no drawn mark keeps its crest (no rule is emitted for it)', () => {
    const css = buildSeasonalMarkCss('theleague', ['halloween'], [{ franchiseId: '0099', icon: '/x/undrawn.png' }]);
    expect(css).not.toContain('undrawn');
    expect(css).not.toContain('0099');
  });

  for (const league of optedIn) {
    for (const id of league.seasonalThemes!) {
      const season = SEASONAL_THEMES[id];
      it(`${league.slug}: "${id}" names a known season and palette`, () => {
        expect(season).toBeTruthy();
        expect(fs.existsSync(path.join(ROOT, 'src/themes', `${season.theme}.json`))).toBe(true);
      });
      if (!season?.marks) continue;
      it(`${league.slug}: its ${id} league logo is drawn and swapped in for both registry cuts`, () => {
        // `"_logo": null` is a set's explicit "the league keeps its own logo"
        // (Christmas: the sweaters are the season, the logo stays); a set
        // that simply forgot it still fails here.
        const set = JSON.parse(
          fs.readFileSync(path.join(ROOT, 'src/data/seasonal-marks', `${league.navSlug}-${id}.json`), 'utf8'),
        ) as { _logo?: string | null };
        if (set._logo === null) {
          expect(buildSeasonalMarkCss(league.navSlug, [id], [], league.logo)).not.toContain(`[data-season="${id}"] img[src="${league.logo.light}"]`);
          return;
        }
        const file = seasonalLogoFile(league.navSlug, id);
        expect(file, `no _logo in ${league.navSlug}-${id}.json`).toBeTruthy();
        expect(fs.existsSync(path.join(ROOT, 'public/assets', league.navSlug, season.marks!, file!))).toBe(true);
        const css = buildSeasonalMarkCss(league.navSlug, [id], [], league.logo);
        for (const src of [league.logo.light, league.logo.dark]) {
          expect(css).toContain(`html[data-league="${league.navSlug}"][data-season="${id}"] img[src="${src}"]`);
        }
        expect(css).toContain(`url("/assets/${league.navSlug}/${season.marks}/${file}")`);
      });
      it(`${league.slug}: every ${id} sprite icon swap names a real icon and a drawn file`, () => {
        const set = JSON.parse(
          fs.readFileSync(path.join(ROOT, 'src/data/seasonal-marks', `${league.navSlug}-${id}.json`), 'utf8'),
        ) as { _icons?: Record<string, string> };
        const sprite = fs.readFileSync(path.join(ROOT, 'public/assets/icons/sprite.svg'), 'utf8');
        const css = buildSeasonalMarkCss(league.navSlug, [id], []);
        for (const [icon, file] of Object.entries(set._icons ?? {})) {
          expect(sprite, `no icon-${icon} in the sprite`).toContain(`id="icon-${icon}"`);
          expect(fs.existsSync(path.join(ROOT, 'public/assets', league.navSlug, season.marks!, file)), `${file} not drawn`).toBe(true);
          const scope = `html[data-league="${league.navSlug}"][data-season="${id}"]`;
          expect(css).toContain(`${scope} svg:has(> use[href$="#icon-${icon}"]) { --seasonal-icon: url("/assets/${league.navSlug}/${season.marks}/${file}"); background-color: currentColor;`);
          expect(css).toContain(`${scope} use[href$="#icon-${icon}"] { visibility: hidden; }`);
        }
      });
      it(`${league.slug}: every ${id} side-nav icon is tinted from a real asset and drawn file`, () => {
        const set = JSON.parse(
          fs.readFileSync(path.join(ROOT, 'src/data/seasonal-marks', `${league.navSlug}-${id}.json`), 'utf8'),
        ) as { _menuIcons?: Record<string, string> };
        const css = buildSeasonalMarkCss(league.navSlug, [id], []);
        for (const [from, file] of Object.entries(set._menuIcons ?? {})) {
          expect(fs.existsSync(path.join(ROOT, 'public', from)), `${from} does not exist`).toBe(true);
          expect(fs.existsSync(path.join(ROOT, 'public/assets', league.navSlug, season.marks!, file)), `${file} not drawn`).toBe(true);
          expect(css).toContain(
            `html[data-league="${league.navSlug}"][data-season="${id}"] .nav-links__icon img[src="${from}"] { content: normal; object-position: -9999px 0; --seasonal-icon: url("/assets/${league.navSlug}/${season.marks}/${file}")`,
          );
        }
      });
      it(`${league.slug}: every ${id} art swap replaces a real asset with a drawn file`, () => {
        const set = JSON.parse(
          fs.readFileSync(path.join(ROOT, 'src/data/seasonal-marks', `${league.navSlug}-${id}.json`), 'utf8'),
        ) as { _swaps?: Record<string, string> };
        const css = buildSeasonalMarkCss(league.navSlug, [id], []);
        for (const [from, file] of Object.entries(set._swaps ?? {})) {
          expect(fs.existsSync(path.join(ROOT, 'public', from)), `${from} does not exist`).toBe(true);
          const drawn = seasonalSwapPath(league.navSlug, id, from);
          expect(drawn, `${from} → ${file} was rejected`).toBe(`/assets/${league.navSlug}/${season.marks}/${file}`);
          expect(fs.existsSync(path.join(ROOT, 'public', drawn!)), `${drawn} not drawn`).toBe(true);
          expect(css).toContain(`html[data-league="${league.navSlug}"][data-season="${id}"] img[src="${from}"]:not([data-brand-book] img):not([data-earned-mark]) { content: url("${drawn}")`);
        }
      });
      it(`${league.slug}: the Brand Book keeps its standard marks while ${id} is open`, () => {
        // The Brand Book always shows the standard marks, with each seasonal
        // set drawn beside them (owner, Oct 2026): every swapped <img> rule
        // exempts its content.
        const teams = getLeagueTeams(league.navSlug);
        const css = buildSeasonalMarkCss(league.navSlug, [id], teams, league.logo);
        const selectors = css.split('\n').flatMap((line) => line.split(/,\s*/)).filter((s) => /\] img\[(src|data-seasonal-franchise)=/.test(s) && !s.includes(':has('));
        expect(selectors.length).toBeGreaterThan(0);
        for (const sel of selectors) {
          expect(sel, sel).toContain(':not([data-brand-book] img)');
          // A League History banner keeps the logo it was won under.
          expect(sel, sel).toContain(':not([data-earned-mark])');
        }
      });
      it(`${league.slug}: every listed ${id} mark is a real franchise with a built file`, () => {
        const franchises = new Set(getLeagueTeams(league.navSlug).map((t) => t.franchiseId));
        for (const fid of seasonalMarkIds(league.navSlug, id)) {
          expect(franchises.has(fid), `${fid} is not a ${league.slug} franchise`).toBe(true);
          expect(fs.existsSync(path.join(ROOT, 'public/assets', league.navSlug, season.marks!, `${fid}.png`)), `${fid}.png not built`).toBe(true);
        }
      });
    }
  }

  it('every mark swap is scoped to its league and season', () => {
    const blocks = buildAllTeamIconDarkCss()
      .split('}')
      .filter((b) => b.includes('halloween-marks'));
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      for (const selector of block.split('{')[0]!.split(',')) {
        // an <img> by its src or by the club id it names, a sprite icon's <svg> by its <use>, or a nav icon slot's <img>
        expect(selector).toMatch(
          /html\[data-league="\w+"\]\[data-season="halloween"\] (img\[src=|img\[data-seasonal-franchise=|svg:has\(> use\[href\$=|(\.nav-links__link--active )?\.nav-links__icon img\[src=)/,
        );
      }
    }
  });
});

describe('inlined AFL badge art follows the season', () => {
  it('swaps a redrawn division badge in while Halloween is open, and only then', async () => {
    const { aflBadgeSvgs } = await import('../src/utils/afl-badge-art');
    const normal = aflBadgeSvgs(null);
    const halloween = aflBadgeSvgs('halloween');
    expect(Object.keys(halloween).sort()).toEqual(Object.keys(normal).sort());
    expect(normal['al-north.svg']).not.toContain('<mask');
    expect(halloween['al-north.svg']).toContain('<mask id="hm-awards-al-north"');
    // the year stays stampable on the drawn badge
    expect(stampBadgeYear(halloween['al-north.svg']!, 2019)).toContain('★  2019  ★');
    // the championship badges are redrawn too, and keep a stampable year
    for (const f of ['afl-championship.svg', 'afl-cup.svg', 'premier-league.svg', 'dleague-champion.svg', 'al-champion.svg', 'nl-champion.svg']) {
      expect(halloween[f], f).toContain(`<mask id="hm-awards-${f.replace('.svg', '')}"`);
      expect(stampBadgeYear(halloween[f]!, 2019), f).toContain('2019');
    }
    // a badge the season does not redraw keeps its art
    expect(halloween['nit.svg']).toBe(normal['nit.svg']);
  });
});

describe('MFL Live wears the season for everyone', () => {
  const layout = fs.readFileSync(path.join(ROOT, 'src/layouts/MflAppLayout.astro'), 'utf8');
  const palette = fs.readFileSync(path.join(ROOT, 'src/styles/league-themes.generated.css'), 'utf8');
  const helper = fs.readFileSync(path.join(ROOT, 'src/utils/mfl-live-season.ts'), 'utf8');
  const livePage = fs.readFileSync(path.join(ROOT, 'src/pages/live/index.astro'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src/styles/seasonal-themes.css'), 'utf8');

  it('wears Halloween, stamped and locked by its own layout', () => {
    expect(SURFACE_SEASONAL_THEMES.mfl).toContain('halloween');
    expect(layout).toContain('mflLiveSeason(Astro.url, Astro.locals.seasonPreview)');
    expect(helper).toMatch(/activeSeasonalTheme\(\s*SURFACE_SEASONAL_THEMES\.mfl/);
    expect(layout).toContain('data-season={season?.id}');
    expect(layout).toContain('data-theme-lock={modeLock}');
  });

  it('gets the Halloween palette in both modes', () => {
    expect(palette).toContain('html[data-league="mfl"][data-season="halloween"]');
    expect(palette).toContain('html.dark[data-league="mfl"][data-season="halloween"]');
  });

  it("a league that wears the season shows its drawn marks there; one that does not keeps its logos", () => {
    const icon = '/assets/theleague/icons/0001.png';
    const wearing = buildSeasonalMarkCss('theleague', ['halloween'], [{ franchiseId: '0001', icon }]);
    expect(wearing).toContain(`html[data-league="mfl"][data-season="halloween"] img[src="${icon}"]`);
    expect(buildSeasonalMarkCss('theleague', [], [{ franchiseId: '0001', icon }])).toBe('');
  });

  it("only franchise marks and the league logo reach MFL Live, never a league's art swaps or sprite icons", () => {
    const blocks = buildAllTeamIconDarkCss()
      .split('}')
      .filter((b) => b.includes('halloween-marks') && b.includes('data-league="mfl"'));
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).toMatch(/halloween-marks\/(\d{4}\.png|logo\.svg)/);
    }
  });

  it('the /live board header gets the haunted scene and its cards, from the same resolution', () => {
    expect(livePage).toContain('mflLiveSeason(Astro.url, Astro.locals.seasonPreview)');
    expect(livePage).toMatch(/<LiveBoard[\s\S]*season=\{season\}/);
    expect(livePage).toContain('class="mfl-live-board"');
    expect(css).toContain("html[data-season='halloween'] .mfl-live-board .lv-head");
  });

  it('the signed-out landing hero gets the haunted scene too', () => {
    expect(css).toContain("html[data-season='halloween'] .mll-hero__top");
  });
});
