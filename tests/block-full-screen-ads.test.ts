/**
 * The MFL skin hides Google's full-screen "vignette" ad. Hiding it is the easy
 * half: the ad HOLDS the tap that triggered it, so a hidden ad with nothing
 * else would leave the owner on the old page with a dead link. These tests pin
 * that the tap still lands where it was aimed, and that nothing else is
 * touched when no ad shows.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

type Listener = (e: any) => void;

function makeEnv(startUrl = 'https://www44.myfantasyleague.com/2026/live_scoring_summary?L=1') {
  const listeners: Record<string, Listener[]> = {};
  let href = startUrl;
  const removed: string[] = [];
  const adNodes = [{ remove: () => removed.push('ins') }];
  const location = {
    get href() { return href; },
    get hash() { const i = href.indexOf('#'); return i < 0 ? '' : href.slice(i); },
    assign: vi.fn((u: string) => { href = u; }),
  };
  const htmlStyle: any = { overflow: 'hidden', position: '' };
  const bodyStyle: any = { overflow: 'hidden', position: 'fixed' };
  const win: any = {
    location,
    history: { state: null, replaceState: vi.fn((_s: any, _t: string, u: string) => { href = u; }) },
    addEventListener: (t: string, fn: Listener) => { (listeners[t] ||= []).push(fn); },
  };
  const doc: any = {
    documentElement: { style: htmlStyle },
    body: { style: bodyStyle },
    querySelectorAll: () => adNodes,
  };
  return {
    win, doc, removed, htmlStyle, bodyStyle,
    setHash(h: string) { href = href.split('#')[0] + h; },
    fire(type: string, e: any = {}) { (listeners[type] || []).forEach((fn) => fn(e)); },
    tap(linkHref: string, target = '') {
      const link = { href: linkHref, getAttribute: (n: string) => (n === 'target' ? target : null) };
      this.fire('click', { target: { closest: () => link } });
    },
  };
}

let env: ReturnType<typeof makeEnv>;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  env = makeEnv();
  vi.stubGlobal('window', env.win);
  vi.stubGlobal('document', env.doc);
  const mod = await import('../src/scripts/shared/blockFullScreenAds.js');
  mod.initBlockFullScreenAds();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('full-screen ad shield', () => {
  it('finishes the tapped navigation when the vignette hash appears', () => {
    env.tap('https://www44.myfantasyleague.com/2026/options?L=1&O=07');
    env.setHash('#google_vignette');
    env.fire('hashchange');
    expect(env.win.location.assign).toHaveBeenCalledWith(
      'https://www44.myfantasyleague.com/2026/options?L=1&O=07',
    );
    expect(env.removed.length).toBe(1);
    expect(env.htmlStyle.overflow).toBe('');
    expect(env.bodyStyle.position).toBe('');
  });

  it('catches an ad hash set without a hashchange event (pushState)', () => {
    env.tap('https://www44.myfantasyleague.com/2026/home/1');
    env.setHash('#goog_fullscreen_ad');
    vi.advanceTimersByTime(250);
    expect(env.win.location.assign).toHaveBeenCalledWith('https://www44.myfantasyleague.com/2026/home/1');
  });

  it('does nothing on an ordinary tap with no ad', () => {
    env.tap('https://www44.myfantasyleague.com/2026/home/1');
    vi.advanceTimersByTime(5000);
    expect(env.win.location.assign).not.toHaveBeenCalled();
    expect(env.removed.length).toBe(0);
    expect(env.bodyStyle.overflow).toBe('hidden');
  });

  it('ignores new-tab links and only strips the hash', () => {
    env.tap('https://example.com/', '_blank');
    env.setHash('#google_vignette');
    env.fire('hashchange');
    expect(env.win.location.assign).not.toHaveBeenCalled();
    expect(env.win.history.replaceState).toHaveBeenCalled();
    expect(env.win.location.hash).toBe('');
  });
});

describe('skin CSS', () => {
  it('hides the vignette container in the source every league bundle uses', () => {
    const css = readFileSync('src/assets/css/src/_misc.scss', 'utf8');
    expect(css).toContain('ins.adsbygoogle[data-vignette-loaded]');
  });
});
