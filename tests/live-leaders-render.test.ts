import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import LvLeaders from '../src/components/shared/live/LvLeaders';
import type { LiveLeaderPlayer, LiveLeaders } from '../src/types/live';
import type { PlayerMeta } from '../src/types/live-scoring';

/**
 * The Top Performances strip, RENDERED — not just built.
 *
 * `tests/live-league-board-outside.test.ts` pins `buildLeaders`: one row per
 * player, every owner in `owners`. That is necessary and not sufficient — the
 * hotfix (#1249) that introduced `owners` also rewrote the component, and a
 * component that renders `owners[0]` alone, or one `<li>` per owner, would
 * pass every builder test while putting the AFL's duplicate rows (or its
 * dropped owners) straight back on the board. Asserting on the markup is the
 * only check the component cannot satisfy by accident.
 */

const meta: Record<string, PlayerMeta> = {
  '15000': { name: 'Josh Allen', position: 'QB', nflTeam: 'BUF' } as PlayerMeta,
  '16000': { name: "Ja'Marr Chase", position: 'WR', nflTeam: 'CIN' } as PlayerMeta,
};

const player = (over: Partial<LiveLeaderPlayer> = {}): LiveLeaderPlayer => ({
  playerId: '15000',
  owners: [{ franchiseId: '0001', franchiseName: 'Pigskins' }],
  points: 31.4,
  secondsRemaining: 0,
  ...over,
});

const ssr = (leaders: LiveLeaders | null) =>
  renderToString(createElement(LvLeaders, { leaders, meta }));

const rows = (html: string) => html.match(/<li class="lv-leaders__row"/g) ?? [];

describe('LvLeaders — Top Performances render', () => {
  it('renders a player started by three owners as ONE row naming all three', () => {
    const html = ssr({
      teams: [],
      players: [
        player({
          owners: [
            { franchiseId: '0003', franchiseName: 'Alpha' },
            { franchiseId: '0014', franchiseName: 'Bravo' },
            { franchiseId: '0021', franchiseName: 'Charlie' },
          ],
        }),
      ],
    });
    expect(rows(html), 'one player must be one row, however many owners start him').toHaveLength(1);
    expect(html.match(/Josh Allen/g)).toHaveLength(1);
    expect(html).toContain('Alpha, Bravo, Charlie');
  });

  it('renders one row per PLAYER across a mixed strip', () => {
    const html = ssr({
      teams: [],
      players: [
        player({
          owners: [
            { franchiseId: '0001', franchiseName: 'Pigskins' },
            { franchiseId: '0013', franchiseName: 'Smokane' },
          ],
        }),
        player({ playerId: '16000', points: 24.2 }),
      ],
    });
    expect(rows(html)).toHaveLength(2);
    expect(html).toContain('Pigskins, Smokane');
    expect(html).toContain('Ja&#x27;Marr Chase');
  });

  it('marks a still-playing performance after the owners, separated once', () => {
    const html = ssr({ teams: [], players: [player({ secondsRemaining: 900 })] });
    expect(html).toContain('Pigskins · playing');
  });

  it('keeps the row when owners is missing (a board built before owners existed)', () => {
    const legacy = { ...player(), owners: undefined } as unknown as LiveLeaderPlayer;
    const html = ssr({ teams: [], players: [legacy] });
    expect(rows(html)).toHaveLength(1);
    expect(html).toContain('Josh Allen');
  });

  it('does not lead the owner line with a separator when there are no owners', () => {
    const html = ssr({ teams: [], players: [player({ owners: [], secondsRemaining: 60 })] });
    expect(html).toMatch(/lv-leaders__owners">playing</);
  });

  it('names an id missing from playerMeta rather than dropping the row', () => {
    const html = ssr({ teams: [], players: [player({ playerId: '99999' })] });
    expect(html).toContain('Player 99999');
  });

  it('renders nothing for a week with no leaders', () => {
    expect(ssr({ teams: [], players: [] })).toBe('');
    expect(ssr(null)).toBe('');
  });
});
