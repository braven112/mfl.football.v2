/**
 * PWA install prompt — the pure half.
 *
 * Deciding whether to pitch "install this app" is three questions that all
 * have to be answered on the CLIENT (display mode, user agent, whether the
 * browser fired `beforeinstallprompt`), so the decision itself lives here as
 * a pure function the component calls and `tests/pwa-install.test.ts` pins.
 *
 * Why the pitch matters at all: on iOS, Web Push ONLY works once the site is
 * on the Home Screen. Every notification category in
 * `src/config/notification-categories.ts` is therefore unreachable for an
 * iPhone owner browsing in Safari, and nothing in the UI said so outside one
 * line of hint text on /notifications. See docs/features/web-push.md.
 */

/** What, if anything, to show an owner about installing the app. */
export type InstallPitch =
  /** Already running as an installed app — never pitch. */
  | 'installed'
  /** iOS/iPadOS Safari: no install API exists, so we show the manual steps. */
  | 'ios-manual'
  /** Chrome/Edge/Android fired `beforeinstallprompt` — we can install for real. */
  | 'prompt'
  /** Desktop Safari, Firefox, in-app browsers: no install path worth pitching. */
  | 'unsupported';

export interface InstallPitchInput {
  userAgent: string;
  /** `display-mode: standalone` matches, or iOS `navigator.standalone`. */
  standalone: boolean;
  /** A `beforeinstallprompt` event has been captured and is still usable. */
  promptAvailable: boolean;
}

/**
 * iOS detection has to cover iPadOS 13+, which reports a desktop Mac UA and is
 * distinguishable only by the touch points. The caller passes the UA string;
 * `maxTouchPoints` is folded in by the caller for the iPad case rather than
 * widening this signature, because a Mac with a touch bar is not an iPad and
 * the component is the only place that can tell.
 */
export function isIosSafari(userAgent: string): boolean {
  const ua = userAgent || '';
  if (!/iPad|iPhone|iPod/.test(ua)) return false;
  // Chrome (CriOS), Firefox (FxiOS) and Edge (EdgiOS) on iOS all wrap WebKit
  // but none of them can add to the Home Screen — only Safari's share sheet
  // has the item, so pitching the steps in those browsers sends owners
  // looking for a menu entry that is not there.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

/**
 * In-app browsers (the GroupMe/Facebook/Instagram webviews owners land in
 * when they tap a league link in chat) can neither install nor show the
 * share sheet item. Pitching there is pure noise.
 */
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|Instagram|Line\/|Twitter|GroupMe/i.test(userAgent || '');
}

/** The whole decision, in one place. */
export function resolveInstallPitch({
  userAgent,
  standalone,
  promptAvailable,
}: InstallPitchInput): InstallPitch {
  if (standalone) return 'installed';
  if (isInAppBrowser(userAgent)) return 'unsupported';
  // The real install API wins when it is available: a Chrome-on-Android owner
  // gets a one-tap install rather than instructions for a menu they'd have to
  // find themselves.
  if (promptAvailable) return 'prompt';
  if (isIosSafari(userAgent)) return 'ios-manual';
  return 'unsupported';
}

/** localStorage key holding the ms timestamp of the last dismissal. */
export const INSTALL_DISMISS_KEY = 'mfl:installPitchDismissedAt';

/**
 * How long a dismissal sticks.
 *
 * Deliberately NOT forever. An owner who swipes the banner away in June has
 * no idea it is the only route to lineup alerts in September, and a pitch
 * that can never return means the push categories stay unreachable for them
 * for good. Sixty days is long enough that it never feels nagging and short
 * enough that everyone sees it again before a season starts.
 */
export const INSTALL_DISMISS_MS = 60 * 24 * 60 * 60 * 1000;

/** Whether a stored dismissal still suppresses the pitch. */
export function isDismissalActive(storedValue: string | null, now = Date.now()): boolean {
  if (!storedValue) return false;
  const at = Number(storedValue);
  if (!Number.isFinite(at) || at <= 0) return false;
  // A timestamp in the future is a clock change or a hand-edited value, not a
  // real dismissal — treat it as active rather than spamming the banner, but
  // let it expire on the same window.
  return now - at < INSTALL_DISMISS_MS;
}
