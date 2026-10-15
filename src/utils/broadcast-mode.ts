/**
 * TV or handheld — which board does this device get?
 *
 * The broadcast board is built for a television read from ten feet. A phone or
 * tablet lying beside the owner gets a second rendering of the SAME poll — the
 * handheld board (docs/plans/broadcast-handheld.md). This module decides which
 * one a device sees, and it is PURE so the decision is testable without a DOM.
 *
 * The decision is the riskiest thing in the feature, because getting it wrong
 * changes the television, and the television must not change:
 *
 *  - WIDTH ALONE IS WRONG. A landscape phone is ~844 CSS px wide and some TV
 *    browsers (Fire TV Silk) report ~960x540, so any width threshold that
 *    catches the phone also catches a television.
 *  - `pointer: coarse` ALONE IS WRONG. Set-top boxes report a coarse pointer
 *    too — an Xbox cursor is nudged with a thumbstick.
 *  - So a device is handheld only when it has a TOUCH SCREEN, a coarse
 *    pointer, AND a short side no longer than `HANDHELD_MAX_SHORT_SIDE`. A
 *    television browser reports no touch points.
 *
 * An explicit choice always wins, because a heuristic will eventually meet a
 * device it gets wrong: `?mode=tv` / `?mode=handheld` on the URL, remembered
 * in the `bc_mode` cookie, and `?mode=auto` to forget it. A page that must
 * always show the TV board (the landing page's preview of what the TV shows)
 * pins it with a `hint`.
 */

export type BroadcastMode = 'tv' | 'handheld';

/** The cookie that remembers an explicit `?mode=` choice on this device. */
export const BROADCAST_MODE_COOKIE = 'bc_mode';

/**
 * The longest SHORT side, in CSS px, that still counts as a hand-held screen.
 *
 * Measured on the SCREEN, never the viewport, so rotating a phone or opening
 * a split view does not flip the decision. A 12.9" iPad Pro is 1024 on its
 * short side; nothing hand-held is past 1100. Mirrored in the pre-paint script
 * in `LiveBroadcastPage.astro` — `tests/broadcast-mode.test.ts` pins the two
 * equal.
 */
export const HANDHELD_MAX_SHORT_SIDE = 1100;

export interface ModeSignals {
  /** A page that must render the TV board whatever the device (a preview). */
  hint?: 'tv' | null;
  /** The raw `?mode=` value, if any. */
  param?: string | null;
  /** The raw `bc_mode` cookie, if any. */
  cookie?: string | null;
  /** `navigator.maxTouchPoints`. */
  maxTouchPoints: number;
  /** `matchMedia('(pointer: coarse)').matches`. */
  coarsePointer: boolean;
  /** `Math.min(screen.width, screen.height)`, in CSS px. */
  screenShortSide: number;
}

/** A `?mode=` / cookie value, or null for anything that is not a choice. */
export function parseModeChoice(raw: string | null | undefined): BroadcastMode | null {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'tv' || v === 'handheld' ? v : null;
}

/** The device heuristic on its own — what `auto` means. */
export function looksHandheld(s: Pick<ModeSignals, 'maxTouchPoints' | 'coarsePointer' | 'screenShortSide'>): boolean {
  return (
    s.maxTouchPoints > 0 &&
    s.coarsePointer &&
    s.screenShortSide > 0 &&
    s.screenShortSide <= HANDHELD_MAX_SHORT_SIDE
  );
}

/** Which board this device renders. */
export function resolveBroadcastMode(s: ModeSignals): BroadcastMode {
  if (s.hint === 'tv') return 'tv';
  const param = (s.param ?? '').trim().toLowerCase();
  if (param !== 'auto') {
    const chosen = parseModeChoice(param) ?? parseModeChoice(s.cookie);
    if (chosen) return chosen;
  }
  return looksHandheld(s) ? 'handheld' : 'tv';
}

/**
 * What to do with the cookie after reading `?mode=`.
 *
 * `set` remembers an explicit choice, `clear` forgets one (`?mode=auto`), and
 * null leaves the cookie alone — a page load with no `?mode=` must never
 * overwrite a choice made earlier.
 */
export function modeCookieAction(param: string | null | undefined): { set: BroadcastMode } | 'clear' | null {
  const v = (param ?? '').trim().toLowerCase();
  if (v === 'auto') return 'clear';
  const chosen = parseModeChoice(v);
  return chosen ? { set: chosen } : null;
}
