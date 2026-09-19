/**
 * Guard: per-league PWA identity and push-notification art.
 *
 * Two bugs shipped here in Sept 2026, both AFL-only and both invisible in a
 * diff, so each rule below is pinned mechanically:
 *
 * 1. `public/assets/afl/favicons/site.webmanifest` declared
 *    `start_url` / `scope` of `/afl-fantasy/`. Every league is served at the
 *    ROOT of its own apex domain (the middleware rewrites `/rosters` →
 *    `/afl-fantasy/rosters`, and vercel.json 301s `/afl-fantasy/*` → `/*` on
 *    that host), so that scope excluded every URL the manifest was linked
 *    from. A manifest whose scope does not cover the document is discarded:
 *    no install, no app icon, no app identity on notifications.
 *
 * 2. The service worker sent TheLeague's `icon-192.png` as the notification
 *    BADGE for every league. Android uses only a badge's alpha channel as a
 *    stencil, and that file is PNG color type 2 — no alpha channel at all —
 *    so it rendered as a solid white square rather than a mark.
 *
 * See docs/features/web-push.md.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readPng } from '../scripts/lib/png-raw.mjs';
import { leaguePushIcon, leaguePushBadge } from '../src/utils/push-notify-trade';
import { readSharedPayload } from '../src/utils/share-target';
import { ALL_LEAGUES, isSharedAppHost } from '../src/config/leagues';
import { HOST_TO_SLUG } from '../src/utils/league-host-map';

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

/** navSlugs that ship a PWA manifest + push art. Best-ball is draft-only. */
const PUSH_LEAGUES = ALL_LEAGUES.filter((l) => !l.bestBall).map((l) => l.navSlug);

function findManifests(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findManifests(full, out);
    else if (entry.name.endsWith('.webmanifest') || entry.name === 'manifest.json') out.push(full);
  }
  return out;
}

/**
 * The shared-host app's manifest, which plays by DIFFERENT rules than a
 * league's and must not be swept into the league assertions below.
 *
 * A league is served at the ROOT of its own apex, so its manifest scope is
 * "/" AND its start_url is "/". The shared host reaches the same two values by
 * a different argument and must not be swept into the league assertions that
 * produce them, because the rules that matter here (a league-neutral name, an
 * id that is NOT its start_url, a host gate on every layout that links it) are
 * the inverse of a league's. Pinned in its own describe block at the bottom.
 *
 * Its scope was "/live" until Sep 2026, to stop an installed app claiming the
 * leagues this host serves by path prefix. It is "/" now — see that block.
 */
const SHARED_APP_MANIFEST = path.join(PUBLIC, 'assets', 'mfl-live', 'site.webmanifest');

/** Manifests belonging to a league apex — everything but the shared-host app. */
function leagueManifestsOnly(all: string[]): string[] {
  return all.filter((f) => f !== SHARED_APP_MANIFEST);
}

describe('PWA manifests', () => {
  const manifests = findManifests(PUBLIC);
  const leagueManifests = leagueManifestsOnly(manifests);

  it('finds every manifest we ship', () => {
    expect(manifests.length).toBeGreaterThanOrEqual(2);
  });

  it('still finds the shared-host app manifest where this file expects it', () => {
    // If it moves, leagueManifestsOnly() silently stops excluding it and the
    // league rules below start failing on a manifest they do not govern —
    // which reads as "MFL Live is broken" rather than "this path is stale".
    expect(fs.existsSync(SHARED_APP_MANIFEST), SHARED_APP_MANIFEST).toBe(true);
  });

  it.each(leagueManifests)('%s is served at the apex root, not under a league prefix', (file) => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    // The whole bug in one assertion. A `/afl-fantasy/` scope on a domain
    // that 301s `/afl-fantasy/*` → `/*` makes the manifest inapplicable to
    // every page that links it.
    expect(m.scope, `${path.basename(file)} scope`).toBe('/');
    expect(m.start_url, `${path.basename(file)} start_url`).toBe('/');
  });

  it('gives every manifest a DISTINCT app id', () => {
    // `scope` and `start_url` must be "/" (above), but the AFL manifest is
    // also served on theleague.us: vercel.json's /afl-fantasy/* -> /* redirect
    // is host-gated to afl-fantasy.com, league-host-map keeps /afl-fantasy/ in
    // SKIP_REWRITE_PREFIXES so cross-league deep links resolve, and the layout
    // picks the manifest by LEAGUE, not by host. So an AFL page really does
    // render at theleague.us/afl-fantasy/... with the AFL manifest attached.
    //
    // A manifest's app id defaults to its start_url, so "/" for both would
    // make the two manifests the SAME app on that origin — letting the AFL's
    // name and icons overwrite an owner's installed TheLeague app. `id` is
    // resolved against the origin and does NOT have to sit inside `scope`,
    // which is what makes a distinct id the surgical fix.
    const ids = manifests.map((file) => {
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      return m.id ?? m.start_url;
    });
    expect(new Set(ids).size, `duplicate app id among ${ids.join(', ')}`).toBe(ids.length);
  });

  it.each(manifests)('%s points at icons that exist and are >=192px', (file) => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Array.isArray(m.icons) && m.icons.length > 0).toBe(true);
    for (const icon of m.icons) {
      const abs = path.join(PUBLIC, icon.src.replace(/^\//, ''));
      expect(fs.existsSync(abs), `${icon.src} referenced by ${path.basename(file)}`).toBe(true);
      const png = readPng(abs);
      expect(png.width).toBe(png.height);
      expect(png.width).toBeGreaterThanOrEqual(192);
    }
  });

  it.each(manifests)('%s ships a maskable icon so Android has a real adaptive icon', (file) => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const maskable = m.icons.filter((i: { purpose?: string }) => i.purpose?.split(/\s+/).includes('maskable'));
    expect(maskable.length).toBeGreaterThan(0);
    for (const icon of maskable) {
      // Adaptive icons are cropped to an OEM shape — a transparent corner
      // becomes a visible notch, so a maskable icon must be full-bleed.
      const png = readPng(path.join(PUBLIC, icon.src.replace(/^\//, '')));
      const corners = [
        [0, 0],
        [png.width - 1, 0],
        [0, png.height - 1],
        [png.width - 1, png.height - 1],
      ];
      for (const [x, y] of corners) {
        expect(png.data[(y * png.width + x) * 4 + 3], `${icon.src} corner ${x},${y} alpha`).toBe(255);
      }
    }
  });
});

describe('manifest host gating', () => {
  const layout = fs.readFileSync(path.join(ROOT, 'src/layouts/TheLeagueLayout.astro'), 'utf8');

  it("never serves one league's manifest on another league's apex", () => {
    // /theleague/* and /afl-fantasy/* are deliberately kept in
    // SKIP_REWRITE_PREFIXES so cross-league deep links resolve from either
    // host, and the layout picks its head block by LEAGUE. So an AFL page
    // really does render on theleague.us — and an ungated manifest link there
    // puts a scope:"/" start_url:"/" AFL manifest on TheLeague's origin.
    expect(layout).toMatch(/const onForeignLeagueHost =/);
    // Plain substring match on whitespace-normalized source, not a RegExp built
    // from a variable — interpolating a path into a pattern means escaping it,
    // and a half-done escape is its own (CodeQL-flagged) bug.
    const normalized = layout.replace(/\s+/g, ' ');
    for (const href of ['/assets/afl/favicons/site.webmanifest', '/manifest.json']) {
      expect(normalized, `${href} must be gated on !onForeignLeagueHost`).toContain(
        `{!onForeignLeagueHost && ( <link rel="manifest" href="${href}"`,
      );
    }
  });

  it('treats the shared multi-league origin as foreign to every league', () => {
    // mfl.football serves every league by path prefix and is in no league's
    // `domains`, so a bare HOST_TO_SLUG lookup misses it and both manifests
    // would land on that one origin.
    //
    // Pinned through the registry predicate rather than the literal
    // expression that used to be here (`new URL(SHARED_APP_ORIGIN).hostname`):
    // an exact compare against the production origin recognised mfl.football
    // and silently missed staging.mfl.football, which then served a per-league
    // identity on the one host whose job is to reproduce production. Assert
    // the BEHAVIOUR — every shared host is foreign — so the next
    // implementation change cannot quietly narrow it again.
    expect(layout).toMatch(/onSharedMultiLeagueHost/);
    expect(layout).toMatch(/isSharedAppHost\(Astro\.url\.hostname\)/);
    for (const host of ['mfl.football', 'v2.mfl.football', 'staging.mfl.football']) {
      expect(isSharedAppHost(host), `${host} must be foreign to every league`).toBe(true);
      expect(HOST_TO_SLUG[host], `${host} must not map to a league slug`).toBeUndefined();
    }
  });

  it('suppresses only on a known foreign apex, so localhost and previews keep theirs', () => {
    // "unless on our own apex" would strip the manifest from every non-apex
    // host — localhost and Vercel previews included — and make the PWA
    // untestable anywhere but production.
    expect(layout).toMatch(/hostLeagueSlug !== null && hostLeagueSlug !== ownLeagueSlug/);
  });

  it('keeps every manifest id distinct, which is the only guard prerendered routes get', () => {
    // The six `prerender = true` routes evaluate the host gate at BUILD time
    // (hostname localhost), so they still ship their manifest on a foreign
    // apex. Distinct ids are what stop that from being destructive there.
    const ids = findManifests(PUBLIC).map((file) => {
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      return m.id ?? m.start_url;
    });
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('push notification art', () => {
  it.each(PUSH_LEAGUES)('%s has an icon and a badge that both exist', (navSlug) => {
    for (const rel of [leaguePushIcon(navSlug), leaguePushBadge(navSlug)]) {
      expect(rel.startsWith('/'), `${rel} must be site-relative`).toBe(true);
      expect(fs.existsSync(path.join(PUBLIC, rel.replace(/^\//, ''))), rel).toBe(true);
    }
  });

  it.each(PUSH_LEAGUES)('%s badge is a translucent stencil, not an opaque block', (navSlug) => {
    const png = readPng(path.join(PUBLIC, leaguePushBadge(navSlug).replace(/^\//, '')));
    let transparent = 0;
    let opaqueNonWhite = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] < 16) transparent++;
      else if (png.data[i] < 240 || png.data[i + 1] < 240 || png.data[i + 2] < 240) opaqueNonWhite++;
    }
    const total = png.width * png.height;
    // Android tints the alpha channel and ignores RGB. An image with no
    // meaningful transparency is a filled square on the device.
    expect(transparent / total, 'transparent fraction').toBeGreaterThan(0.25);
    // ...and the visible part must be white so any platform that DOES honor
    // RGB renders the same silhouette rather than a muddy thumbnail.
    expect(opaqueNonWhite, 'non-white pixels in a stencil').toBe(0);
  });

  it('never reuses a league icon as its badge', () => {
    for (const navSlug of PUSH_LEAGUES) {
      expect(leaguePushBadge(navSlug)).not.toBe(leaguePushIcon(navSlug));
    }
  });

  it('gives each league its own art', () => {
    const icons = new Set(PUSH_LEAGUES.map(leaguePushIcon));
    const badges = new Set(PUSH_LEAGUES.map(leaguePushBadge));
    expect(icons.size).toBe(PUSH_LEAGUES.length);
    expect(badges.size).toBe(PUSH_LEAGUES.length);
  });

  it('the committed art matches what the generator produces', () => {
    // Cheap insurance that a hand-edit of a derived PNG cannot drift from its
    // source favicon: the generator is deterministic.
    expect(() =>
      execFileSync('node', ['scripts/generate-notification-icons.mjs', '--check'], {
        cwd: ROOT,
        encoding: 'utf8',
      }),
    ).not.toThrow();
  });
});

describe('service worker badge contract', () => {
  const sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');

  it('honors a per-payload badge', () => {
    expect(sw).toMatch(/badge:\s*typeof data\.badge === 'string'/);
  });

  it('never falls back to an opaque favicon for the badge', () => {
    const fallback = sw.match(/const DEFAULT_NOTIFICATION_BADGE = '([^']+)'/);
    expect(fallback, 'DEFAULT_NOTIFICATION_BADGE must exist').not.toBeNull();
    const png = readPng(path.join(PUBLIC, fallback![1].replace(/^\//, '')));
    let transparent = 0;
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 3] < 16) transparent++;
    expect(transparent / (png.width * png.height)).toBeGreaterThan(0.25);
  });
});

describe('manifest shortcuts and share target', () => {
  // League manifests only. The shared-host app is a board, not a league site:
  // it has no /lineup or /tip to shortcut to, and no tip page to share into.
  const manifests = leagueManifestsOnly(findManifests(PUBLIC));

  /**
   * Which league's pages a manifest's apex-relative URLs resolve against.
   *
   * Every league is served at the root of its own apex, so a manifest URL of
   * `/lineup` means `src/pages/<that league>/lineup` — NOT a shared route. A
   * shortcut copied between manifests therefore has to exist in both leagues
   * or it dead-ends for one of them, and it dead-ends from the OS launcher,
   * where nobody is watching.
   */
  //
  // Keyed on the path relative to public/, NOT the basename: `site.webmanifest`
  // is a conventional filename and more than one manifest in this repo already
  // uses it, so a basename key silently resolves one manifest's shortcuts
  // against another league's pages.
  const LEAGUE_DIR: Record<string, string> = {
    'manifest.json': 'theleague',
    'assets/afl/favicons/site.webmanifest': 'afl-fantasy',
  };

  const leagueDirFor = (file: string) =>
    LEAGUE_DIR[path.relative(PUBLIC, file).split(path.sep).join('/')];

  function routeExists(leagueDir: string, url: string): boolean {
    const rel = url.replace(/^\//, '').split('?')[0];
    const base = path.join(ROOT, 'src/pages', leagueDir, rel);
    return (
      fs.existsSync(`${base}.astro`) ||
      fs.existsSync(base) ||
      fs.existsSync(path.join(base, 'index.astro'))
    );
  }

  it.each(manifests)('%s declares shortcuts', (file) => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Array.isArray(m.shortcuts), 'shortcuts').toBe(true);
    expect(m.shortcuts.length).toBeGreaterThan(0);
    // Android surfaces at most four on a long-press; more are simply dropped,
    // silently, so a fifth is a shortcut nobody will ever see.
    expect(m.shortcuts.length).toBeLessThanOrEqual(4);
  });

  it.each(manifests)('%s shortcuts point at real routes in that league', (file) => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const leagueDir = leagueDirFor(file);
    expect(leagueDir, `no league mapped for ${path.basename(file)}`).toBeTruthy();
    for (const shortcut of m.shortcuts) {
      expect(shortcut.name, 'every shortcut needs a name').toBeTruthy();
      // Must be in scope ("/"), or the platform discards the shortcut.
      expect(shortcut.url.startsWith('/'), `${shortcut.url} must be site-relative`).toBe(true);
      expect(
        routeExists(leagueDir, shortcut.url),
        `${shortcut.url} has no page under src/pages/${leagueDir}`,
      ).toBe(true);
    }
  });

  it.each(manifests)('%s share target lands on a real page, in scope', (file) => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const leagueDir = leagueDirFor(file);
    expect(m.share_target?.action, 'share_target.action').toBeTruthy();
    expect(m.share_target.action.startsWith('/')).toBe(true);
    // GET, because the tip form prefills from the query string. A POST target
    // would need a route that accepts multipart form data and would land the
    // owner on a page with no way back to their draft.
    expect(m.share_target.method ?? 'GET').toBe('GET');
    expect(routeExists(leagueDir, m.share_target.action)).toBe(true);
  });

  it.each(manifests)('%s share params are the ones the tip page reads', (file) => {
    // The param names are a contract between the manifest and
    // readSharedPayload. Renaming one side silently drops every share on the
    // floor — the page still renders, just empty.
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { title, text, url } = m.share_target.params;
    const params = new URLSearchParams();
    params.set(title, 'T');
    params.set(text, 'B');
    params.set(url, 'U');
    expect(readSharedPayload(params)).toEqual({ title: 'T', text: 'B', url: 'U' });
  });
});

/**
 * Guard: the shared-host app's PWA identity.
 *
 * MFL Live installs from mfl.football, a host that belongs to no league and
 * serves all of them by path prefix. Every rule here is the INVERSE of the
 * league rules above, and each one is a way the two could be confused.
 */
describe('shared-host app manifest (MFL Live)', () => {
  const manifest = JSON.parse(fs.readFileSync(SHARED_APP_MANIFEST, 'utf8'));

  it('claims the whole shared origin, and starts at its front door', () => {
    // Sep 2026: this REPLACED the inverse assertion (`scope` must not be '/').
    //
    // The old rule existed because a '/' scope makes the installed app the app
    // for every league this host serves by path prefix. What changed is the
    // product decision, not the mechanics: v2.mfl.football itself is now the
    // installable app, so its scope has to be the origin and its start_url has
    // to be the splash. /theleague/* and /afl-fantasy/* are not served on the
    // shared host (they 404 there), so the only league actually pulled into
    // scope is Best Ball #1 — which has no apex of its own and has only ever
    // lived on this host.
    //
    // Both values are pinned, because widening scope WITHOUT moving start_url
    // is the silent half-change: the app would claim the origin but still open
    // on the board, and the splash would never be the front door it now is.
    expect(manifest.scope, 'scope').toBe('/');
    expect(manifest.start_url, 'start_url').toBe('/');
  });

  it('starts inside its own scope', () => {
    // A start_url outside scope makes the manifest inapplicable — the same
    // class of bug as the AFL's /afl-fantasy/ scope, arrived at from the
    // other direction. Trivially true while both are '/', and the assertion
    // that keeps it true if either one moves again.
    expect(String(manifest.start_url).startsWith(manifest.scope)).toBe(true);
  });

  it('keeps the app id it shipped with, so installs update in place', () => {
    // An app id is an identity key. It is resolved against the origin and is
    // NOT required to sit inside `scope`, which is the whole reason this one
    // could stay '/live' when start_url moved to '/'. Changing it would make
    // every phone that already installed MFL Live treat the widened app as a
    // DIFFERENT app: the old install would stay behind, pinned to the old
    // scope, and the owner would end up with two.
    //
    // It also has to differ from '/' so it can never merge with a league app
    // on an origin that serves one — the 'DISTINCT app id' test above pins
    // that across the whole set.
    expect(manifest.id, 'id').toBe('/live');
    expect(manifest.id, 'id must not collapse into start_url').not.toBe(manifest.start_url);
  });

  it('offers live scoring as a shortcut, since start_url is no longer the board', () => {
    // Moving start_url to the splash cost the board its position as the thing
    // the app opens on. A manifest shortcut (long-press the installed icon) is
    // half of what replaces it; the visible band on the splash is the other
    // half, pinned below.
    const urls = (manifest.shortcuts ?? []).map((s: { url?: string }) => s.url);
    expect(urls, 'shortcuts').toContain('/live');
  });

  it('is linked on the shared host only, from EVERY layout that links it', () => {
    // Mirror of "never serves one league's manifest on another league's apex".
    // If /live/ is ever added to SKIP_REWRITE_PREFIXES so the app answers on
    // theleague.us too, this gate is what stops MFL Live's manifest from
    // landing on a league's origin and competing with that league's own app.
    //
    // Two layouts link it now: MflAppLayout (the board) and SplashLayout (the
    // start_url). A gate on one and not the other is the bug this iterates —
    // the manifest is only as host-scoped as its LEAKIEST link site.
    for (const rel of ['src/layouts/MflAppLayout.astro', 'src/layouts/SplashLayout.astro']) {
      const normalized = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\s+/g, ' ');
      expect(normalized, `${rel} resolves the gate`).toContain(
        'const onSharedHost = isSharedAppHost(Astro.url.hostname)',
      );
      expect(normalized, `${rel} applies the gate`).toContain('{onSharedHost && (');
      // And it must be THIS manifest behind that gate, not a league's.
      expect(normalized, `${rel} links the shared-host manifest`).toContain(
        'href="/assets/mfl-live/site.webmanifest"',
      );
    }
    expect(isSharedAppHost('mfl.football'), 'registry still knows the shared host').toBe(true);
  });

  it('does not hand the splash the board\u2019s fixed-dark chrome', () => {
    // The splash is the start_url, so it inherited MFL Live's PWA head block —
    // including two metas that are only correct on a surface that stays dark.
    // The splash flips (#eeeeee light, near-black dark), so:
    //
    //  - ThemeScript rewrites theme-color to #121212 in dark and back to
    //    `data-theme-color-light` in light. A DARK value in that attribute is
    //    therefore not a theme color at all, it is a permanently dark bar over
    //    a light page, and the swap it was written for never happens.
    //  - `black-translucent` draws WHITE status-bar glyphs and assumes the
    //    `viewport-fit=cover` + safe-area insets MflAppLayout sets. On this
    //    layout it is white-on-#eeeeee with no inset.
    const splash = fs.readFileSync(path.join(ROOT, 'src/layouts/SplashLayout.astro'), 'utf8');
    const light = splash.match(/data-theme-color-light="([^"]+)"/)?.[1];
    expect(light, 'the splash declares a light theme-color').toBeTruthy();
    expect(light!.toLowerCase(), 'the LIGHT theme color must not be the board\u2019s dark ground')
      .not.toBe('#14161a');
    // Read the META, not the file: the layout's comment explains why
    // `black-translucent` is wrong here, and a whole-file scan matches the
    // explanation as if it were the bug.
    const statusBar = splash.match(
      /<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="([^"]+)"/,
    )?.[1];
    expect(statusBar, 'the splash declares a status bar style').toBeTruthy();
    expect(statusBar, 'a light-flipping page takes the `default` status bar style')
      .toBe('default');
  });

  it('is reachable from the splash it now opens on', () => {
    // start_url is the splash, so the splash is where an owner lands — both on
    // first visit and every time they launch the installed app. Without a link
    // out to the board, widening the scope would have BURIED the surface it
    // was widened to carry.
    const splash = fs.readFileSync(path.join(ROOT, 'src/pages/index.astro'), 'utf8');
    expect(splash, 'splash links /live').toMatch(/href="\/live"/);
  });

  it('names no league', () => {
    // The whole point of the surface. A league name in the installed app's
    // title is the fastest way for this to stop being league-neutral.
    const text = `${manifest.name} ${manifest.short_name} ${manifest.description}`.toLowerCase();
    for (const league of ALL_LEAGUES) {
      expect(text, `${league.name} named in the shared app manifest`).not.toContain(
        league.name.toLowerCase(),
      );
    }
  });
});
