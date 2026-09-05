import { describe, it, expect } from 'vitest';
// @ts-ignore — sibling .mjs module, no .d.ts
import {
  rosterIndex,
  rosteredInjuryMap,
  diffPlayerNews,
  isFirstRun,
  displayName,
  buildPlayerNewsNotifications,
} from '../scripts/lib/player-news-diff.mjs';

const rosters = {
  rosters: {
    franchise: [
      { id: '0001', player: [{ id: '100' }, { id: '101' }] },
      { id: '0002', player: [{ id: '200' }] },
      // MFL unwraps a single-player roster into a bare object, not a list.
      { id: '0003', player: { id: '300' } },
    ],
  },
};

const index = rosterIndex(rosters);

describe('rosterIndex', () => {
  it('maps every rostered player to its franchise', () => {
    expect(index.get('100')).toBe('0001');
    expect(index.get('200')).toBe('0002');
    expect(index.size).toBe(4);
  });

  it('accepts MFL’s unwrapped single-player roster', () => {
    expect(index.get('300')).toBe('0003');
  });

  it('survives an empty or malformed feed rather than throwing', () => {
    expect(rosterIndex(null).size).toBe(0);
    expect(rosterIndex({ rosters: {} }).size).toBe(0);
  });
});

describe('rosteredInjuryMap', () => {
  const injuries = {
    injuries: {
      '100': { injuryStatus: 'Questionable' },
      '200': { injuryStatus: 'Out' },
      // Free agent — nobody owns them, so nobody hears about them.
      '999': { injuryStatus: 'IR' },
    },
  };

  it('keeps only players someone actually rosters', () => {
    const map = rosteredInjuryMap(injuries, index);
    expect(Object.keys(map).sort()).toEqual(['100', '200']);
  });

  it('omits healthy players rather than storing "healthy" 400 times', () => {
    const map = rosteredInjuryMap(
      { injuries: { '100': { injuryStatus: '' }, '101': { injuryStatus: 'Healthy' } } },
      index,
    );
    expect(map).toEqual({});
  });
});

describe('diffPlayerNews', () => {
  it('reports a new injury', () => {
    const changes = diffPlayerNews({ previous: {}, current: { '100': 'Out' }, index });
    expect(changes).toEqual([
      { playerId: '100', franchiseId: '0001', from: 'healthy', to: 'Out', direction: 'worse' },
    ]);
  });

  it('reports a recovery — the most actionable thing it can say', () => {
    const changes = diffPlayerNews({ previous: { '100': 'Out' }, current: {}, index });
    expect(changes[0]).toMatchObject({ from: 'Out', to: 'healthy', direction: 'better' });
  });

  it('grades a downgrade and an upgrade in the right direction', () => {
    const worse = diffPlayerNews({
      previous: { '100': 'Questionable' },
      current: { '100': 'Out' },
      index,
    });
    expect(worse[0].direction).toBe('worse');

    const better = diffPlayerNews({
      previous: { '100': 'Out' },
      current: { '100': 'Questionable' },
      index,
    });
    expect(better[0].direction).toBe('better');
  });

  it('says nothing when the status is unchanged', () => {
    expect(
      diffPlayerNews({ previous: { '100': 'Out' }, current: { '100': 'Out' }, index }),
    ).toEqual([]);
  });

  /**
   * The trade case. Without this, a player moving between rosters between two
   * polls fires an injury alert at whichever owner happens to hold them.
   */
  it('drops a player nobody rosters any more', () => {
    expect(
      diffPlayerNews({ previous: { '999': 'Out' }, current: {}, index }),
    ).toEqual([]);
  });

  it('treats a status MFL invents as a concern rather than dropping it', () => {
    const changes = diffPlayerNews({
      previous: {},
      current: { '100': 'Limited Participant' },
      index,
    });
    expect(changes).toHaveLength(1);
    expect(changes[0].direction).toBe('worse');
  });

  it('is order-stable, so two runs read the same way', () => {
    const current = { '200': 'Out', '100': 'Out', '300': 'Out' };
    const a = diffPlayerNews({ previous: {}, current, index }).map((c: any) => c.playerId);
    const b = diffPlayerNews({ previous: {}, current, index }).map((c: any) => c.playerId);
    expect(a).toEqual(b);
    expect(a).toEqual(['100', '200', '300']);
  });
});

/**
 * The first run has no snapshot, so every rostered injury in the league reads
 * as brand new. Without this distinction the feature announces itself with a
 * hundred stale notifications to sixteen people.
 */
describe('isFirstRun', () => {
  it('separates "never ran" from "ran, nothing was hurt"', () => {
    expect(isFirstRun(null)).toBe(true);
    expect(isFirstRun(undefined)).toBe(true);
    expect(isFirstRun({})).toBe(false);
  });
});

describe('displayName', () => {
  it('flips MFL’s last-first storage', () => {
    expect(displayName('Mariota, Marcus')).toBe('Marcus Mariota');
  });

  it('leaves a name with no comma alone', () => {
    expect(displayName('Bills, Buffalo')).toBe('Buffalo Bills');
    expect(displayName('Cardinals')).toBe('Cardinals');
  });

  it('never renders undefined into a notification title', () => {
    expect(displayName(undefined)).toBe('A player');
    expect(displayName('')).toBe('A player');
  });
});

describe('buildPlayerNewsNotifications', () => {
  const lookup = (id: string) =>
    ({ '100': { name: 'Mariota, Marcus', position: 'QB', team: 'WAS' } })[id];

  it('writes the new-injury case', () => {
    const [n] = buildPlayerNewsNotifications({
      changes: [
        { playerId: '100', franchiseId: '0001', from: 'healthy', to: 'Out', direction: 'worse' },
      ],
      playerLookup: lookup,
    });
    expect(n.title).toBe('Marcus Mariota: Out');
    expect(n.body).toBe('QB · WAS. Newly listed as Out.');
    expect(n.franchiseId).toBe('0001');
  });

  it('writes the recovery case', () => {
    const [n] = buildPlayerNewsNotifications({
      changes: [
        { playerId: '100', franchiseId: '0001', from: 'Out', to: 'healthy', direction: 'better' },
      ],
      playerLookup: lookup,
    });
    expect(n.title).toBe('Marcus Mariota is off the injury report');
    expect(n.body).toContain('Cleared');
  });

  it('writes a status-to-status change as an arrow', () => {
    const [n] = buildPlayerNewsNotifications({
      changes: [
        {
          playerId: '100',
          franchiseId: '0001',
          from: 'Questionable',
          to: 'Doubtful',
          direction: 'worse',
        },
      ],
      playerLookup: lookup,
    });
    expect(n.body).toContain('Questionable → Doubtful');
  });

  /**
   * The tag is per PLAYER, not per change: a designation walks Questionable →
   * Doubtful → Out over a week, and the owner wants the current line on their
   * phone rather than three stale ones stacked above it.
   */
  it('tags per player so successive updates replace rather than stack', () => {
    const tags = buildPlayerNewsNotifications({
      changes: [
        { playerId: '100', franchiseId: '0001', from: 'healthy', to: 'Questionable', direction: 'worse' },
        { playerId: '100', franchiseId: '0001', from: 'Questionable', to: 'Out', direction: 'worse' },
      ],
      playerLookup: lookup,
    }).map((n: any) => n.tag);
    expect(new Set(tags).size).toBe(1);
    expect(tags[0]).toBe('player-news-100');
  });

  it('still sends when the player is missing from players.json', () => {
    const [n] = buildPlayerNewsNotifications({
      changes: [
        { playerId: '404', franchiseId: '0002', from: 'healthy', to: 'IR', direction: 'worse' },
      ],
      playerLookup: () => undefined,
    });
    expect(n.title).toBe('A player: IR');
    expect(n.body).toBe('Newly listed as IR.');
  });
});
