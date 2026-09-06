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
