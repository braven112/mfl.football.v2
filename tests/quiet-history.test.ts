/**
 * Astro's router ignores a popstate whose state is null, and hears every pop
 * before the broadcast's own listeners. A quiet entry parks null under itself
 * so the TV's Back closes the drawer / ends steering without a page re-render,
 * then hands the entry beneath its state back (and the newest URL).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pushQuietEntry, restoreUnderQuietEntry } from '../src/utils/quiet-history';

type Entry = { state: unknown; url: string };
let stack: Entry[];
let at: number;

beforeEach(() => {
  stack = [{ state: { index: 0, scrollY: 0 }, url: '/live/broadcast' }];
  at = 0;
  vi.stubGlobal('history', {
    get state() {
      return stack[at].state;
    },
    replaceState(state: unknown, _t: string, url?: string) {
      stack[at] = { state, url: url ?? stack[at].url };
    },
    pushState(state: unknown, _t: string, url?: string) {
      stack = stack.slice(0, at + 1);
      stack.push({ state, url: url ?? stack[at].url });
      at += 1;
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const back = () => {
  at -= 1;
};

describe('quiet history entries', () => {
  it('leaves null under its own entry while it is on top, so a pop to it is one the router ignores', () => {
    pushQuietEntry({ bclDrawer: true });
    expect(stack[0].state).toBeNull();
    expect(stack[1].state).toEqual({ index: 0, scrollY: 0, bclDrawer: true });
  });

  it('hands the entry beneath its state back once popped, with the newest URL when given one', () => {
    const entry = pushQuietEntry({ bclDrawer: true });
    history.replaceState(history.state, '', '/live/broadcast?leagues=1');
    back();
    restoreUnderQuietEntry(entry, '/live/broadcast?leagues=1');
    expect(stack[0]).toEqual({ state: { index: 0, scrollY: 0 }, url: '/live/broadcast?leagues=1' });
  });

  it('nests: steering under the drawer each restore their own entry', () => {
    const steer = pushQuietEntry({ lbcSteer: true });
    const drawer = pushQuietEntry({ bclDrawer: true });
    back();
    restoreUnderQuietEntry(drawer);
    expect(stack[1].state).toEqual({ index: 0, scrollY: 0, lbcSteer: true });
    back();
    restoreUnderQuietEntry(steer);
    expect(stack[0].state).toEqual({ index: 0, scrollY: 0 });
  });

  it('never overwrites an entry that already has its own state', () => {
    const entry = pushQuietEntry({ bclDrawer: true });
    back();
    history.replaceState({ other: true }, '');
    restoreUnderQuietEntry(entry);
    expect(stack[0].state).toEqual({ other: true });
  });
});
