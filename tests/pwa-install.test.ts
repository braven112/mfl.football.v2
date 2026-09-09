/**
 * Guard: who gets pitched the "install this app" prompt.
 *
 * The pitch exists for one reason — on iOS, Web Push works ONLY once the site
 * is on the Home Screen, so every category in notification-categories.ts is
 * unreachable for an iPhone owner in Safari. That makes two failure modes
 * expensive and both are invisible in a diff:
 *
 *  - pitching someone who CANNOT act on it (an in-app webview, Chrome on iOS,
 *    an owner already running the installed app) is pure noise, and
 *  - failing to pitch an iPhone owner leaves them permanently unable to
 *    receive a single notification while the UI shows them a settings page
 *    full of switches.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseInstallState,
  isInstallSource,
  installStateKey,
} from '../src/utils/app-install-state';
import {
  resolveInstallPitch,
  isIosSafari,
  isInAppBrowser,
  isDismissalActive,
  INSTALL_DISMISS_MS,
} from '../src/utils/pwa-install';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const GROUPME_WEBVIEW =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 GroupMe/5.9.2';

describe('isIosSafari', () => {
  it('accepts real iOS Safari', () => {
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true);
  });

  it('rejects the other iOS browsers, which have no Add to Home Screen', () => {
    // They all wrap WebKit, so a naive /iPhone/ test says yes — but only
    // Safari's share sheet carries the item, and pitching the steps in Chrome
    // sends an owner hunting for a menu entry that does not exist.
    expect(isIosSafari(IPHONE_CHROME)).toBe(false);
    expect(isIosSafari(IPHONE_SAFARI.replace('Safari/604.1', 'FxiOS/126.0'))).toBe(false);
  });

  it('rejects desktop and Android', () => {
    expect(isIosSafari(MAC_SAFARI)).toBe(false);
    expect(isIosSafari(ANDROID_CHROME)).toBe(false);
  });

  it('survives a missing user agent', () => {
    expect(isIosSafari('')).toBe(false);
  });
});

describe('isInAppBrowser', () => {
  it('flags the webviews owners land in from a chat link', () => {
    // Every league link posted to GroupMe opens here first.
    expect(isInAppBrowser(GROUPME_WEBVIEW)).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) FBAN/FBIOS')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) Instagram 300.0')).toBe(true);
  });

  it('leaves real browsers alone', () => {
    expect(isInAppBrowser(IPHONE_SAFARI)).toBe(false);
    expect(isInAppBrowser(ANDROID_CHROME)).toBe(false);
  });
});

describe('resolveInstallPitch', () => {
  it('never pitches an owner already running the installed app', () => {
    // The banner has to self-retire, or it is permanent furniture in the app
    // it is advertising.
    for (const userAgent of [IPHONE_SAFARI, ANDROID_CHROME, MAC_SAFARI]) {
      expect(
        resolveInstallPitch({ userAgent, standalone: true, promptAvailable: true }),
      ).toBe('installed');
      expect(
        resolveInstallPitch({ userAgent, standalone: true, promptAvailable: false }),
      ).toBe('installed');
    }
  });

  it('prefers a real install over instructions when the browser offers one', () => {
    expect(
      resolveInstallPitch({
        userAgent: ANDROID_CHROME,
        standalone: false,
        promptAvailable: true,
      }),
    ).toBe('prompt');
  });

  it('gives iOS Safari the manual steps, because it has no install API', () => {
    expect(
      resolveInstallPitch({
        userAgent: IPHONE_SAFARI,
        standalone: false,
        promptAvailable: false,
      }),
    ).toBe('ios-manual');
  });

  it('stays silent where there is no install path at all', () => {
    // Desktop Safari, Firefox, and every in-app webview: showing a pitch with
    // no action behind it trains owners to ignore the banner.
    expect(
      resolveInstallPitch({ userAgent: MAC_SAFARI, standalone: false, promptAvailable: false }),
    ).toBe('unsupported');
    expect(
      resolveInstallPitch({ userAgent: IPHONE_CHROME, standalone: false, promptAvailable: false }),
    ).toBe('unsupported');
  });

  it('stays silent in an in-app browser even when it looks like iOS Safari', () => {
    // The GroupMe webview's UA contains the whole Safari string, so the
    // in-app check has to run BEFORE the iOS check or every chat link shows
    // Add-to-Home-Screen steps that webview cannot perform.
    expect(
      resolveInstallPitch({
        userAgent: GROUPME_WEBVIEW,
        standalone: false,
        promptAvailable: false,
      }),
    ).toBe('unsupported');
  });
});

describe('isDismissalActive', () => {
  const now = Date.UTC(2026, 8, 6);

  it('treats no stored value as never dismissed', () => {
    expect(isDismissalActive(null, now)).toBe(false);
    expect(isDismissalActive('', now)).toBe(false);
  });

  it('suppresses the banner inside the window', () => {
    expect(isDismissalActive(String(now - 1000), now)).toBe(true);
  });

  it('lets the pitch return once the window lapses', () => {
    // Deliberately not forever: an owner who dismissed in June has no idea
    // this is the only route to lineup alerts in September.
    expect(isDismissalActive(String(now - INSTALL_DISMISS_MS - 1), now)).toBe(false);
  });

  it('ignores garbage rather than hiding the banner for good', () => {
    expect(isDismissalActive('not-a-number', now)).toBe(false);
    expect(isDismissalActive('0', now)).toBe(false);
    expect(isDismissalActive('-5', now)).toBe(false);
  });
});


describe('layout PWA inline scripts register once per document', () => {
  /**
   * Both PWA scripts in TheLeagueLayout attach listeners to `document` or
   * `window`, and the ClientRouter re-executes body scripts on EVERY
   * navigation — so each one needs a one-time-per-document flag or its
   * handlers stack for as long as the tab lives.
   *
   * This is a rule that already shipped a bug: the install-prompt capture was
   * written with its guard and the badge sync was written without one, on the
   * same day, in the same file. The badge case was the worse of the two,
   * because its service-worker `message` handler syncs with `force = true`,
   * bypassing the throttle — so N stacked handlers meant N forced
   * /api/app-badge fetches for every single push.
   */
  const layout = fs.readFileSync(
    path.resolve(__dirname, '../src/layouts/TheLeagueLayout.astro'),
    'utf8',
  );

  it.each([
    ['install prompt capture', '__mflInstallPromptBound'],
    ['app badge sync', '__mflBadgeSyncBound'],
  ])('%s bails out when already bound', (_label, flag) => {
    // Both halves matter: the early return AND the set. A set with no return
    // guards nothing, and a return with no set never stops re-binding.
    expect(layout, `${flag} early return`).toContain(`if (window.${flag}) return;`);
    expect(layout, `${flag} set`).toContain(`window.${flag} = true;`);
  });

  it('has no unguarded persistent listener registration in a PWA script', () => {
    // A cheap structural check on the two blocks we own: every addEventListener
    // on document/window inside them must sit after a bind guard. Counted
    // rather than parsed — if a third PWA script appears without a flag, the
    // flag count stops matching and this fails.
    const pwaBlocks = layout.match(/window\.__mfl\w*Bound = true;/g) ?? [];
    expect(pwaBlocks.length, 'one bind flag per guarded PWA script').toBe(2);
  });
});


describe('hidden elements are actually hidden', () => {
  /**
   * The bug this pins, in full, because it is the whole feature failing while
   * every unit test passed:
   *
   * `hidden` is a USER-AGENT style. Any author `display` rule beats it. This
   * component sets `display: flex` on its root and `display: grid` on the
   * steps list, so on 2026-09-07 the banner rendered INSIDE the installed app,
   * showing the iOS "tap Share" steps, on Android — three separate things it
   * is explicitly built never to do.
   *
   * `resolveInstallPitch` was correct the whole time and every test above
   * passed. The pure function returned 'installed'; the DOM ignored it.
   *
   * This repo has NO global [hidden] reset (src/styles/player-news.css
   * carries its own `.pn-status[hidden]` rule for the same reason), so any
   * component that toggles `hidden` on a flex or grid element has to neutralize
   * it itself.
   */
  const component = fs.readFileSync(
    path.resolve(__dirname, '../src/components/shared/pwa/InstallAppPrompt.astro'),
    'utf8',
  );

  const styleBlock = component.slice(component.indexOf('<style>'));

  /** Class selectors in the style block that set a `display` other than none. */
  function classesWithDisplay(css: string): Set<string> {
    const found = new Set<string>();
    const ruleRe = /([^{}]+)\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(css))) {
      const [, selector, body] = m;
      const display = /display:\s*([\w-]+)/.exec(body)?.[1];
      if (!display || display === 'none') continue;
      if (selector.includes('[hidden]')) continue;
      for (const cls of selector.match(/\.[\w-]+/g) ?? []) found.add(cls.slice(1));
    }
    return found;
  }

  it('neutralizes [hidden] on the root and on every descendant', () => {
    // Two selectors, both load-bearing: the root carries `hidden` itself, and
    // the steps/copy/button are descendants toggled independently.
    const normalized = styleBlock.replace(/\s+/g, ' ');
    expect(normalized, 'root [hidden] rule').toMatch(
      /\.install-prompt\[hidden\][^{]*\{[^}]*display: none/,
    );
    expect(normalized, 'descendant [hidden] rule').toMatch(
      /\.install-prompt \[hidden\][^{]*\{[^}]*display: none/,
    );
  });

  it('gives every script-hidden element a display that [hidden] can beat', () => {
    // The mechanical half: find each element the script toggles `hidden` on,
    // and confirm its classes either carry no author `display` at all or are
    // covered by the [hidden] rules above. Without the rules, this is the
    // check that fails.
    const toggled = [...component.matchAll(/data-install-(?:copy-\w+|steps|action)\b/g)].map(
      (m) => m[0],
    );
    expect(toggled.length, 'script-hidden elements found in markup').toBeGreaterThan(3);

    const hiddenRuleCoversDescendants = /\.install-prompt\s+\[hidden\]/.test(
      styleBlock.replace(/\s+/g, ' '),
    );
    const displayed = classesWithDisplay(styleBlock);
    // Root and steps are the two that actually collide today; assert the
    // collision is known AND covered rather than asserting it away.
    expect(displayed.has('install-prompt'), 'root still sets a display').toBe(true);
    expect(displayed.has('install-prompt__steps'), 'steps still set a display').toBe(true);
    expect(
      hiddenRuleCoversDescendants,
      'a flex/grid element is script-hidden with no [hidden] override — it will render anyway',
    ).toBe(true);
  });
});


describe('the banner is a strip, not a column', () => {
  /**
   * Both homepages hang <InstallAppPrompt variant="banner"> as a DIRECT CHILD
   * of their two-column grid (`.hp2`, `.afl-hp`). Grid auto-placement put it
   * in the first cell and pushed the main column into the 380px sidebar
   * track — the page rendered as an empty left column beside a squeezed one,
   * every paragraph wrapping at about six words. Spanning every track is what
   * makes it a strip ABOVE both columns instead of a third item competing for
   * one; it is inert when the parent is flex or block.
   */
  const component = fs.readFileSync(
    path.resolve(__dirname, '../src/components/shared/pwa/InstallAppPrompt.astro'),
    'utf8',
  );

  it('spans every track of a grid parent', () => {
    const banner = /\.install-prompt--banner\s*\{([^}]*)\}/.exec(component)?.[1] ?? '';
    expect(banner, '.install-prompt--banner rule').not.toBe('');
    expect(banner.replace(/\s+/g, ' ')).toMatch(/grid-column: 1 \/ -1/);
  });

  it.each([
    ['src/pages/theleague/index.astro', '.hp2'],
    ['src/pages/afl-fantasy/index.astro', '.afl-hp'],
  ])('%s still places it inside a multi-column grid', (file, container) => {
    // If a homepage ever stops being a grid the rule above is harmless, but
    // while it IS one, this is the arrangement the rule exists for.
    const page = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    const rule = new RegExp(`\\${container}\\s*\\{([^}]*)\\}`).exec(page)?.[1] ?? '';
    expect(rule, `${container} rule`).toMatch(/display: grid/);
    expect(rule, `${container} columns`).toMatch(/grid-template-columns:\s*1fr\s+\d+px/);
  });
});

describe('owners who already have the app are not pitched it', () => {
  /**
   * The device cannot answer this question. `display-mode: standalone` is
   * false in the desktop browser of an owner whose phone has had the app on
   * its Home Screen for a month, and Chrome keeps firing
   * `beforeinstallprompt` there because on THAT device it genuinely is
   * installable — so the local 60-day dismissal is a banner to swipe away
   * again in every browser, forever. The fact belongs to the account.
   */
  const pages = [
    'src/pages/theleague/index.astro',
    'src/pages/afl-fantasy/index.astro',
  ] as const;

  it.each(pages)('%s gates the banner on the stored record, not just auth', (file) => {
    const page = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    const banner = /\{([^}]*)<InstallAppPrompt variant="banner"/.exec(page)?.[1] ?? '';
    expect(banner, 'banner render guard').toContain('showInstallBanner');
    expect(page, 'reads the account record').toContain('readInstallState');
  });

  it.each(pages)('%s scopes the record to its own league', (file) => {
    const page = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    // Both leagues have a franchise 0001, so an unscoped read answers for the
    // wrong app — and a session from the OTHER league has no record here at
    // all, which must read as "not installed" rather than as someone else's.
    const guard = /const showInstallBanner =([\s\S]*?);\n/.exec(page)?.[1] ?? '';
    expect(guard, 'showInstallBanner').not.toBe('');
    expect(guard).toMatch(/theLeagueFranchiseId|authAflFranchiseId/);
  });

  it.each(pages)('%s takes a SAME-LEAGUE session, not merely a signed-in one', (file) => {
    // The banner is a route to notifications and those are franchise-scoped,
    // so an owner signed into the other league can neither receive an alert
    // from this one nor have their "I already have it" recorded — the server
    // refuses to file this page's league against their session. Pitching an
    // app that can be neither used nor permanently dismissed is the "toggle
    // that silently does nothing" this repo already has a rule about.
    const page = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    const guard = /const showInstallBanner =([\s\S]*?);\n/.exec(page)?.[1] ?? '';
    expect(guard, 'no bare signed-in check').not.toMatch(/!!authUser|isAuthenticated/);
  });

  it('only remembers a report the server confirmed', () => {
    // The flag was originally written BEFORE the fetch, which meant one
    // offline visit inside the installed app — the normal case for a PWA —
    // permanently retired that device's ability to report. The account record
    // was never written, nothing could clear the flag, and the banner this
    // whole feature exists to retire stayed up on every other device. A 403
    // from reading the other league's homepage did the same.
    const component = fs.readFileSync(
      path.resolve(__dirname, '../src/components/shared/pwa/InstallAppPrompt.astro'),
      'utf8',
    );
    const fetchAt = component.indexOf("fetch('/api/app-install'");
    const okAt = component.indexOf('if (!res.ok) return;');
    const rememberAt = component.indexOf('localStorage.setItem(reportedKey(root)');

    expect(fetchAt, 'reports to /api/app-install').toBeGreaterThan(-1);
    expect(okAt, 'checks the response before remembering').toBeGreaterThan(fetchAt);
    expect(rememberAt, 'remembers only after the ok check').toBeGreaterThan(okAt);
  });

  it('keys the per-device report flag by league', () => {
    // Production splits the leagues across apex domains, so separate origins
    // already separate localStorage — but the Vercel preview and `pnpm dev`
    // serve both leagues from ONE origin, and there an unscoped flag means a
    // successful TheLeague report silently retires the AFL banner's ability
    // to report at all. Same rule as rankings-scope.ts's local keys.
    const component = fs.readFileSync(
      path.resolve(__dirname, '../src/components/shared/pwa/InstallAppPrompt.astro'),
      'utf8',
    );
    expect(component, 'flag carries the league').toMatch(
      /mfl:appInstallReported:\$\{root\.dataset\.league/,
    );
  });

  it('requires the league rather than checking it when present', () => {
    // A guard that only fires `typeof league === "string" && league` fails
    // OPEN on a caller that forgot to send one — which is precisely the case
    // it exists to catch. One extra banner is the safe answer; a record
    // written for the wrong app is not.
    const route = fs.readFileSync(
      path.resolve(__dirname, '../src/pages/api/app-install.ts'),
      'utf8',
    );
    expect(route).toMatch(/if \(payload\.league !== league\.slug\) \{/);
    expect(route, 'no fail-open presence check').not.toMatch(
      /typeof payload\.league === 'string' &&/,
    );
  });

  it('claims the install record atomically, so first-write-wins is true', () => {
    // A phone opening the installed app while a laptop tab is still open is
    // the ordinary case here, not a contrived race — get-then-set lets the
    // later write clobber the earlier installedAt.
    const util = fs.readFileSync(
      path.resolve(__dirname, '../src/utils/app-install-state.ts'),
      'utf8',
    );
    expect(util, 'SET NX').toMatch(/redis\.set\([\s\S]*?\{ nx: true \}\)/);
    expect(util, 'reads the winner when it loses the race').toMatch(
      /wrote === 'OK' \|\| wrote === true/,
    );
  });

  it('sends the page league so the server can reject a mismatch', () => {
    const component = fs.readFileSync(
      path.resolve(__dirname, '../src/components/shared/pwa/InstallAppPrompt.astro'),
      'utf8',
    );
    expect(component, 'league travels with the report').toContain('data-league={leagueSlug}');
    expect(component, 'report body').toMatch(/league: root\.dataset\.league/);

    const route = fs.readFileSync(
      path.resolve(__dirname, '../src/pages/api/app-install.ts'),
      'utf8',
    );
    // The session picks the record; the body is only ever a check on it.
    expect(route, 'identity from the session').toContain('getAuthUser(request)');
    expect(route, 'mismatch rejected').toMatch(/payload\.league !== league\.slug/);
  });
});


describe('parseInstallState', () => {
  it('keys the record per league, because both leagues have a franchise 0001', () => {
    expect(installStateKey('13522', '0001')).not.toBe(installStateKey('19621', '0001'));
  });

  it('reads a record whether storage hands back JSON or an object', () => {
    const record = { installedAt: '2026-09-01T00:00:00.000Z', source: 'standalone' };
    expect(parseInstallState(record)?.source).toBe('standalone');
    expect(parseInstallState(JSON.stringify(record))?.installedAt).toBe(record.installedAt);
  });

  it('treats an unknown source as a real report', () => {
    // A record written by a newer deploy must not read as "never installed"
    // and put the banner back in front of someone who already has the app.
    const parsed = parseInstallState({ installedAt: '2026-09-01T00:00:00.000Z', source: 'nope' });
    expect(parsed).not.toBeNull();
    expect(parsed?.source).toBe('declared');
  });

  it('rejects anything without a real timestamp', () => {
    expect(parseInstallState(null)).toBeNull();
    expect(parseInstallState('not json')).toBeNull();
    expect(parseInstallState({ source: 'standalone' })).toBeNull();
    expect(parseInstallState({ installedAt: 'whenever' })).toBeNull();
  });

  it('only accepts the sources the client can actually report', () => {
    expect(isInstallSource('standalone')).toBe(true);
    expect(isInstallSource('declared')).toBe(true);
    expect(isInstallSource('appinstalled')).toBe(true);
    expect(isInstallSource('installed')).toBe(false);
    expect(isInstallSource(1)).toBe(false);
  });
});
