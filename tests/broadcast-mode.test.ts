/**
 * TV or handheld — the decision that must never move a television.
 *
 * docs/plans/broadcast-handheld.md: width alone catches some TV browsers
 * (Fire TV Silk reports ~960x540), and a coarse pointer alone catches set-top
 * boxes (an Xbox cursor is a thumbstick). A device is handheld only with a
 * touch screen, a coarse pointer AND a short screen side.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  HANDHELD_MAX_SHORT_SIDE,
  looksHandheld,
  modeCookieAction,
  parseModeChoice,
  resolveBroadcastMode,
  type ModeSignals,
} from '../src/utils/broadcast-mode';

const phone: ModeSignals = { maxTouchPoints: 5, coarsePointer: true, screenShortSide: 390 };
const ipadPro: ModeSignals = { maxTouchPoints: 5, coarsePointer: true, screenShortSide: 1024 };
const tv1080: ModeSignals = { maxTouchPoints: 0, coarsePointer: false, screenShortSide: 1080 };
const fireTv: ModeSignals = { maxTouchPoints: 0, coarsePointer: true, screenShortSide: 540 };
const xbox: ModeSignals = { maxTouchPoints: 0, coarsePointer: true, screenShortSide: 1080 };
const touchLaptop: ModeSignals = { maxTouchPoints: 10, coarsePointer: false, screenShortSide: 900 };
const touchTv: ModeSignals = { maxTouchPoints: 10, coarsePointer: true, screenShortSide: 2160 };

describe('the device heuristic', () => {
  it('calls a phone and a tablet handheld', () => {
    expect(resolveBroadcastMode(phone)).toBe('handheld');
    expect(resolveBroadcastMode(ipadPro)).toBe('handheld');
  });

  it('never calls a television handheld — the TV board must not change', () => {
    expect(resolveBroadcastMode(tv1080)).toBe('tv');
    // Small reported screen AND a coarse pointer, but no touch points.
    expect(resolveBroadcastMode(fireTv)).toBe('tv');
    expect(resolveBroadcastMode(xbox)).toBe('tv');
    // A touch-screen TV is still too big to be in a hand.
    expect(resolveBroadcastMode(touchTv)).toBe('tv');
  });

  it('keeps a touch laptop with a mouse on the TV board', () => {
    expect(resolveBroadcastMode(touchLaptop)).toBe('tv');
  });

  it('treats an unknown screen size as not handheld', () => {
    expect(looksHandheld({ maxTouchPoints: 5, coarsePointer: true, screenShortSide: 0 })).toBe(false);
  });
});

describe('an explicit choice wins', () => {
  it('?mode= overrides the heuristic both ways', () => {
    expect(resolveBroadcastMode({ ...tv1080, param: 'handheld' })).toBe('handheld');
    expect(resolveBroadcastMode({ ...phone, param: 'tv' })).toBe('tv');
  });

  it('the remembered cookie applies when there is no param', () => {
    expect(resolveBroadcastMode({ ...phone, cookie: 'tv' })).toBe('tv');
    expect(resolveBroadcastMode({ ...tv1080, cookie: 'handheld' })).toBe('handheld');
  });

  it('the param beats the cookie', () => {
    expect(resolveBroadcastMode({ ...phone, cookie: 'tv', param: 'handheld' })).toBe('handheld');
  });

  it('?mode=auto ignores the cookie and asks the device', () => {
    expect(resolveBroadcastMode({ ...phone, cookie: 'tv', param: 'auto' })).toBe('handheld');
  });

  it('junk is not a choice', () => {
    expect(parseModeChoice('phone')).toBeNull();
    expect(resolveBroadcastMode({ ...tv1080, param: 'phone', cookie: '' })).toBe('tv');
  });

  it('a TV-pinned page (the landing preview) is the TV board whatever is asked', () => {
    expect(resolveBroadcastMode({ ...phone, hint: 'tv', param: 'handheld', cookie: 'handheld' })).toBe('tv');
  });
});

describe('the cookie follows the URL, and only when asked', () => {
  it('remembers tv / handheld, forgets on auto, leaves it alone otherwise', () => {
    expect(modeCookieAction('handheld')).toEqual({ set: 'handheld' });
    expect(modeCookieAction('TV')).toEqual({ set: 'tv' });
    expect(modeCookieAction('auto')).toBe('clear');
    expect(modeCookieAction(null)).toBeNull();
    expect(modeCookieAction('nonsense')).toBeNull();
  });
});

describe('the pre-paint script agrees with the resolver', () => {
  it('uses the same short-side threshold', () => {
    const page = readFileSync('src/components/shared/live-broadcast/HandheldPrepaint.astro', 'utf8');
    const m = page.match(/short > 0 && short <= (\d+)/);
    expect(m, 'pre-paint handheld check not found in HandheldPrepaint.astro').not.toBeNull();
    expect(Number(m![1])).toBe(HANDHELD_MAX_SHORT_SIDE);
    // And it asks for touch points, the signal that keeps every TV out.
    expect(page).toMatch(/navigator\.maxTouchPoints > 0/);
  });
});
