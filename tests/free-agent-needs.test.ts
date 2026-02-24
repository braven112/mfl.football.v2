import { describe, it, expect } from 'vitest';
import { analyzeFreeAgentNeeds } from '../src/utils/free-agent-needs';

// Helper to build a player feed entry
function player(id: string, name: string, position: string, team = 'NYG') {
  return { id, name, position, team };
}

// Helper to build projected score entry
function proj(id: string, score: number) {
  return { id, score: String(score) };
}

// Helper to build roster assignment
function rostered(id: string, franchiseId: string) {
  return [id, { franchiseId }] as const;
}

describe('analyzeFreeAgentNeeds', () => {
  const MY_TEAM = '0099';

  describe('QB need detection (top 8, need 1)', () => {
    it('identifies QB need when team has no top-8 QB', () => {
      const playersFeed: Record<string, any> = {};
      const scores: Array<{ id: string; score: string }> = [];
      const roster: Record<string, { franchiseId: string }> = {};

      // Create 10 QBs — team 0099 has the 9th-best (outside top 8)
      for (let i = 1; i <= 10; i++) {
        const id = `qb${i}`;
        playersFeed[id] = player(id, `QB${i}, Player`, 'QB');
        scores.push(proj(id, 300 - i * 10));
        if (i === 9) {
          roster[id] = { franchiseId: MY_TEAM };
        } else if (i <= 8) {
          roster[id] = { franchiseId: `000${i}` };
        }
        // qb10 is a free agent
      }

      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, playersFeed, roster);
      const qbNeed = result.find((n) => n.position === 'QB');
      expect(qbNeed).toBeTruthy();
      expect(qbNeed!.topFreeAgents.length).toBe(1); // Only qb10 is a FA
      expect(qbNeed!.topFreeAgents[0].id).toBe('qb10');
    });

    it('does not flag QB need when team has a top-8 QB', () => {
      const playersFeed: Record<string, any> = {};
      const scores: Array<{ id: string; score: string }> = [];
      const roster: Record<string, { franchiseId: string }> = {};

      for (let i = 1; i <= 10; i++) {
        const id = `qb${i}`;
        playersFeed[id] = player(id, `QB${i}, Player`, 'QB');
        scores.push(proj(id, 300 - i * 10));
        if (i === 3) {
          roster[id] = { franchiseId: MY_TEAM }; // 3rd best QB
        } else if (i <= 8) {
          roster[id] = { franchiseId: `000${i}` };
        }
      }

      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, playersFeed, roster);
      const qbNeed = result.find((n) => n.position === 'QB');
      expect(qbNeed).toBeUndefined();
    });
  });

  describe('WR need detection (top 16, need 2)', () => {
    it('identifies WR need when team has only 1 top-16 WR', () => {
      const playersFeed: Record<string, any> = {};
      const scores: Array<{ id: string; score: string }> = [];
      const roster: Record<string, { franchiseId: string }> = {};

      for (let i = 1; i <= 20; i++) {
        const id = `wr${i}`;
        playersFeed[id] = player(id, `WR${i}, Player`, 'WR');
        scores.push(proj(id, 250 - i * 5));
        if (i === 5) {
          roster[id] = { franchiseId: MY_TEAM }; // 1 top-16 WR
        } else if (i <= 16) {
          roster[id] = { franchiseId: `000${(i % 11) + 1}` };
        }
        // i > 16 are free agents (and i=5 is on our team)
      }

      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, playersFeed, roster);
      const wrNeed = result.find((n) => n.position === 'WR');
      expect(wrNeed).toBeTruthy();
    });

    it('does not flag WR need when team has 2 top-16 WRs', () => {
      const playersFeed: Record<string, any> = {};
      const scores: Array<{ id: string; score: string }> = [];
      const roster: Record<string, { franchiseId: string }> = {};

      for (let i = 1; i <= 20; i++) {
        const id = `wr${i}`;
        playersFeed[id] = player(id, `WR${i}, Player`, 'WR');
        scores.push(proj(id, 250 - i * 5));
        if (i === 3 || i === 7) {
          roster[id] = { franchiseId: MY_TEAM }; // 2 top-16 WRs
        } else if (i <= 16) {
          roster[id] = { franchiseId: `000${(i % 11) + 1}` };
        }
      }

      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, playersFeed, roster);
      const wrNeed = result.find((n) => n.position === 'WR');
      expect(wrNeed).toBeUndefined();
    });
  });

  describe('RB need detection (top 16, need 2)', () => {
    it('identifies RB need when team has 0 top-16 RBs', () => {
      const playersFeed: Record<string, any> = {};
      const scores: Array<{ id: string; score: string }> = [];
      const roster: Record<string, { franchiseId: string }> = {};

      for (let i = 1; i <= 20; i++) {
        const id = `rb${i}`;
        playersFeed[id] = player(id, `RB${i}, Player`, 'RB');
        scores.push(proj(id, 200 - i * 5));
        if (i === 18) {
          roster[id] = { franchiseId: MY_TEAM }; // Below top 16
        } else if (i <= 16) {
          roster[id] = { franchiseId: `000${(i % 11) + 1}` };
        }
      }

      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, playersFeed, roster);
      const rbNeed = result.find((n) => n.position === 'RB');
      expect(rbNeed).toBeTruthy();
    });
  });

  describe('top free agents list', () => {
    it('returns max 5 free agents per position', () => {
      const playersFeed: Record<string, any> = {};
      const scores: Array<{ id: string; score: string }> = [];
      const roster: Record<string, { franchiseId: string }> = {};

      // 10 TEs, all free agents except the top 8 are on other teams
      // Team has no TE → need
      for (let i = 1; i <= 10; i++) {
        const id = `te${i}`;
        playersFeed[id] = player(id, `TE${i}, Player`, 'TE');
        scores.push(proj(id, 150 - i * 5));
        // None rostered by our team, some by others
        if (i <= 4) {
          roster[id] = { franchiseId: `000${i + 1}` };
        }
        // te5-te10 are free agents
      }

      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, playersFeed, roster);
      const teNeed = result.find((n) => n.position === 'TE');
      expect(teNeed).toBeTruthy();
      expect(teNeed!.topFreeAgents.length).toBe(5);
      // Should be te5, te6, te7, te8, te9 (top 5 FAs by score)
      expect(teNeed!.topFreeAgents[0].id).toBe('te5');
      expect(teNeed!.topFreeAgents[4].id).toBe('te9');
    });

    it('excludes rostered players from FA list', () => {
      const playersFeed: Record<string, any> = {};
      const scores: Array<{ id: string; score: string }> = [];
      const roster: Record<string, { franchiseId: string }> = {};

      for (let i = 1; i <= 5; i++) {
        const id = `pk${i}`;
        playersFeed[id] = player(id, `PK${i}, Player`, 'PK');
        scores.push(proj(id, 100 - i * 5));
        if (i <= 3) {
          roster[id] = { franchiseId: `000${i + 1}` };
        }
        // pk4, pk5 are free agents
      }

      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, playersFeed, roster);
      const pkNeed = result.find((n) => n.position === 'PK');
      expect(pkNeed).toBeTruthy();
      for (const fa of pkNeed!.topFreeAgents) {
        expect(roster[fa.id]).toBeUndefined();
      }
    });
  });

  describe('name formatting', () => {
    it('formats MFL names from "Last, First" to "First Last"', () => {
      const playersFeed: Record<string, any> = {
        p1: player('p1', 'Mahomes, Patrick', 'QB'),
      };
      const scores = [proj('p1', 300)];
      // p1 is a free agent, team has no QBs
      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, playersFeed, {});
      const qbNeed = result.find((n) => n.position === 'QB');
      expect(qbNeed!.topFreeAgents[0].name).toBe('Patrick Mahomes');
    });
  });

  describe('position ordering', () => {
    it('returns needs in canonical position order (QB, RB, WR, TE, PK, DEF)', () => {
      const playersFeed: Record<string, any> = {};
      const scores: Array<{ id: string; score: string }> = [];

      // Create 1 FA per position with projections, no roster → all needs
      const positions = ['QB', 'RB', 'WR', 'TE', 'PK', 'Def'];
      positions.forEach((pos, i) => {
        const id = `p${i}`;
        playersFeed[id] = player(id, `P${i}, Player`, pos);
        scores.push(proj(id, 100));
      });

      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, playersFeed, {});
      const positionOrder = result.map((n) => n.position);
      expect(positionOrder).toEqual(['QB', 'RB', 'WR', 'TE', 'PK', 'DEF']);
    });
  });

  describe('edge cases', () => {
    it('handles empty projected scores gracefully', () => {
      const playersFeed = { p1: player('p1', 'Test, Player', 'QB') };
      const result = analyzeFreeAgentNeeds(MY_TEAM, [], playersFeed, {});
      expect(result).toEqual([]);
    });

    it('handles empty players feed gracefully', () => {
      const scores = [proj('p1', 100)];
      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, {}, {});
      expect(result).toEqual([]);
    });

    it('handles players with zero projected score', () => {
      const playersFeed = { p1: player('p1', 'Test, Player', 'QB') };
      const scores = [proj('p1', 0)];
      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, playersFeed, {});
      expect(result).toEqual([]);
    });

    it('normalizes Def position to DEF', () => {
      const playersFeed: Record<string, any> = {
        d1: player('d1', 'Team, Defense', 'Def'),
      };
      const scores = [proj('d1', 80)];
      const result = analyzeFreeAgentNeeds(MY_TEAM, scores, playersFeed, {});
      const defNeed = result.find((n) => n.position === 'DEF');
      expect(defNeed).toBeTruthy();
    });
  });
});
