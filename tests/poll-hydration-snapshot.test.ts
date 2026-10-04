/**
 * A shared poller lives at module scope, so by the time one island hydrates,
 * ANOTHER island may already have fetched. `useSyncExternalStore`'s third
 * argument (getServerSnapshot) is what React hydrates with; passing the live
 * `getState` there made the board's feed pill render "Tracking" over the
 * server's "Connecting", and React threw the tree away — every league's
 * live-scoring page, intermittently (found by scripts/launch-check.mjs).
 *
 * Every hook over a shared poller must hydrate with `serverPollState`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { serverPollState } from '../src/utils/live-poll-store';

const HOOKS = path.resolve(__dirname, '../src/hooks');

describe('poll hooks hydrate with the server snapshot', () => {
  const users = readdirSync(HOOKS)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ f, src: readFileSync(path.join(HOOKS, f), 'utf8') }))
    .filter(({ src }) => src.includes('createSharedPoller') && src.includes('useSyncExternalStore('));

  it('finds the poller hooks (sanity)', () => {
    expect(users.map((u) => u.f).sort()).toEqual(
      expect.arrayContaining(['useLiveScoringFeed.ts', 'useNflGameDetail.ts', 'useNflScoreboard.ts']),
    );
  });

  for (const { f, src } of users) {
    it(f, () => {
      expect(src, `${f} must pass serverPollState as getServerSnapshot`).toMatch(/serverPollState,?\s*\)/);
      expect(src).not.toMatch(/\(\) => poller\.getState\(params\),\s*\(\) => poller\.getState\(params\)/);
    });
  }

  it('the server snapshot is the never-fetched state', () => {
    expect(serverPollState()).toEqual({ data: null, status: 'idle', fetchedAt: 0 });
  });
});
