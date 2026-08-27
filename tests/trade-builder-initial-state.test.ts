/**
 * The Trade Builder's opening state must not depend on the environment.
 *
 * An owner clicking the roster page's 🏷️ trade-block badge lands on
 * `/theleague/trade-builder?b=<franchiseId>`. The island read
 * `window.location.search` while deriving its initial state, so the server
 * rendered the owner's default team and the browser rendered franchise `b` —
 * React 19 flagged the mismatch (#418) and `reportError` raised it as an
 * uncaught window error, which the roster page's diagnostic banner then
 * painted over a page that had otherwise recovered fine.
 *
 * These tests pin the two halves of the fix: the derivation is pure and
 * search-driven, and the page actually feeds it the server's query string.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  resolveInitialTradeState,
  type InitialStateTeam,
} from '../src/utils/trade-builder-initial-state';

const TEAMS: InitialStateTeam[] = [
  { franchiseId: '0001', currentCapSpace: 40 },
  { franchiseId: '0003', currentCapSpace: 90 },
  { franchiseId: '0005', currentCapSpace: 70 },
];

const read = (rel: string) =>
  readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('resolveInitialTradeState', () => {
  it('restores the team from the roster trade-block link (?b=)', () => {
    const state = resolveInitialTradeState({
      search: '?b=0005',
      defaultTeamId: '0001',
      teams: TEAMS,
    });
    expect(state.teamB.franchiseId).toBe('0005');
  });

  it('gives the SAME answer on the server and in the browser', () => {
    // The bug in one assertion: the server had no `window`, so it fell through
    // to the default-team branch while the browser took the ?b= branch.
    const input = {
      search: '?b=0005',
      defaultTeamId: '0001',
      teams: TEAMS,
    };
    const serverPass = resolveInitialTradeState(input);

    const hadWindow = 'window' in globalThis;
    (globalThis as Record<string, unknown>).window = {
      location: { search: '?a=0009&b=0009' },
    };
    try {
      const clientPass = resolveInitialTradeState(input);
      expect(clientPass).toEqual(serverPass);
    } finally {
      if (!hadWindow) delete (globalThis as Record<string, unknown>).window;
    }
  });

  it('is pure — repeated calls with the same input agree', () => {
    const input = { search: '?a=0001&ap=1234,5678&b=0005', defaultTeamId: '', teams: TEAMS };
    expect(resolveInitialTradeState(input)).toEqual(resolveInitialTradeState(input));
  });

  it('accepts the search string with or without its leading "?"', () => {
    const withQ = resolveInitialTradeState({ search: '?b=0005', defaultTeamId: '', teams: TEAMS });
    const without = resolveInitialTradeState({ search: 'b=0005', defaultTeamId: '', teams: TEAMS });
    expect(without).toEqual(withQ);
  });

  it('falls back to the owner default when the URL carries no trade', () => {
    const state = resolveInitialTradeState({
      search: '',
      defaultTeamId: '0001',
      teams: TEAMS,
    });
    expect(state.teamA.franchiseId).toBe('0001');
    expect(state.teamB.franchiseId).toBeNull();
  });

  it('falls back to the two roomiest caps when there is no default', () => {
    const state = resolveInitialTradeState({
      search: '',
      defaultTeamId: '',
      teams: TEAMS,
    });
    expect(state.teamA.franchiseId).toBe('0003');
    expect(state.teamB.franchiseId).toBe('0005');
  });
});

describe('trade builder hydration wiring', () => {
  const island = read('src/components/theleague/trade-builder/TradeBuilder.tsx');
  const page = read('src/pages/theleague/trade-builder.astro');

  it('the page hands the island the SERVER query string', () => {
    expect(page).toMatch(/initialSearch=\{Astro\.url\.search\}/);
  });

  it('the island never reads window.location during render', () => {
    // The render path runs on the server too. Everything below it (effects,
    // event handlers) is browser-only and may touch window freely.
    const renderPath = island
      .slice(
        island.indexOf('export default function TradeBuilder'),
        island.indexOf('const [state, dispatch] = useReducer')
      )
      // Comments in this region explain the bug BY NAME — strip them so the
      // guard reads code, not prose.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(renderPath).not.toContain('window.location');
  });

  it('the island derives its initial state from the prop, not the browser', () => {
    expect(island).toContain('resolveInitialTradeState({');
    expect(island).toMatch(/search:\s*initialSearch/);
  });
});

describe('roster diagnostic banner stays on the roster page', () => {
  const rosters = read('src/pages/theleague/rosters.astro');

  it('removes its window listeners when ClientRouter navigates away', () => {
    // Without this the banner outlives the page and reports errors thrown by
    // whatever the owner opened next — which is how a trade-builder hydration
    // error got reported as a roster-page bug.
    expect(rosters).toContain("document.addEventListener('astro:before-swap'");
    expect(rosters).toContain("window.removeEventListener('error', onError)");
    expect(rosters).toContain(
      "window.removeEventListener('unhandledrejection', onRejection)"
    );
  });

  it('installs only once per visit', () => {
    expect(rosters).toContain('window.__diagErrorBannerInstalled');
  });
});
