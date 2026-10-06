/**
 * The roster page re-reads `#roster-config` after a ClientRouter swap.
 *
 * Its bundled script runs once per session, so a config parsed only at module
 * scope kept the first load's `defaultTeamId`: Back after a crest switch
 * showed the session's opening team under a `?franchise=0001` URL. These
 * exercise the refresh itself — the page-side wiring is pinned in
 * rosters-team-nav-clientrouter.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { refreshConfigFromElement, replaceContents } from '../src/utils/rosters/config-refresh';

/** A stand-in for the `<script type="application/json">` node. */
const node = (payload: unknown) => ({ textContent: JSON.stringify(payload) }) as unknown as Element;

const firstLoad = () => ({
  defaultTeamId: '0003',
  defaultSeason: '2026',
  authUser: { franchiseId: '0001' },
  seasons: {
    '2026': { teams: { '0003': { stale: true } } },
    // Fetched on demand after load — not in any server render.
    '2019': { teams: { '0003': { frozen: true } } },
  },
});

describe('refreshConfigFromElement', () => {
  it("takes the arriving page's defaultTeamId and live seasons", () => {
    const config: any = firstLoad();
    const el0 = node(config);
    const el1 = node({
      defaultTeamId: '0001',
      defaultSeason: '2026',
      authUser: { franchiseId: '0001' },
      seasons: { '2026': { teams: { '0001': { fresh: true } } } },
    });

    const result = refreshConfigFromElement(config, el0, el1);

    expect(result).toEqual({ el: el1, refreshed: true });
    expect(config.defaultTeamId).toBe('0001');
    expect(config.seasons['2026']).toEqual({ teams: { '0001': { fresh: true } } });
  });

  it('keeps a season fetched on demand', () => {
    const config: any = firstLoad();
    refreshConfigFromElement(config, null, node({ defaultTeamId: '0001', seasons: {} }));
    expect(config.seasons['2019']).toEqual({ teams: { '0003': { frozen: true } } });
  });

  it('mutates in place, so module helpers holding `config` see the new values', () => {
    const config: any = firstLoad();
    const held = config;
    refreshConfigFromElement(config, null, node({ defaultTeamId: '0005' }));
    expect(held.defaultTeamId).toBe('0005');
  });

  it('drops keys the arriving page no longer sends (a demo-swapped authUser)', () => {
    const config: any = firstLoad();
    refreshConfigFromElement(config, null, node({ defaultTeamId: '0001' }));
    expect(config.authUser).toBeUndefined();
  });

  it('is a no-op on the same node — init runs twice on the first load', () => {
    const config: any = firstLoad();
    const el0 = node({ defaultTeamId: '9999' });
    const result = refreshConfigFromElement(config, el0, el0);
    expect(result).toEqual({ el: el0, refreshed: false });
    expect(config.defaultTeamId).toBe('0003');
  });

  it('keeps the old config when the node is missing or unparseable', () => {
    const config: any = firstLoad();
    const el0 = node(config);
    expect(refreshConfigFromElement(config, el0, null)).toEqual({ el: el0, refreshed: false });
    const bad = { textContent: '{not json' } as unknown as Element;
    expect(refreshConfigFromElement(config, el0, bad)).toEqual({ el: el0, refreshed: false });
    expect(config.defaultTeamId).toBe('0003');
  });
});

describe('replaceContents', () => {
  it('replaces every key but keeps the object identity', () => {
    const target: any = { a: 1, b: 2 };
    const held = target;
    replaceContents(target, { c: 3 });
    expect(held).toEqual({ c: 3 });
  });
});
