import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  GROUPME_MAX_CHARS,
  buildSaturdayLineupPost,
  isChatQuietDay,
  leagueWeekday,
  playingFranchiseIds,
  problemSummary,
} from '../scripts/lib/lineup-broadcast.mjs';
import { EXEMPT_KINDS, bypassesDayCap } from '../scripts/lib/groupme-day-plan.mjs';

const URL = 'https://theleague.us/lineup';

function warning(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    franchiseId: id,
    franchiseName: name,
    noLineup: false,
    emptySlots: 0,
    problems: [{ playerId: `p${id}`, playerName: 'Joe Burrow', position: 'QB', type: 'OUT' }],
    ...extra,
  };
}

describe('Saturday lineup roll call', () => {
  it('names every flagged team, no-lineup teams first, link last with no trailing punctuation', () => {
    const post = buildSaturdayLineupPost({
      week: 10,
      lineupUrl: URL,
      warnings: [
        warning('0002', 'Vitside'),
        warning('0001', 'Pacific Pigskins', { noLineup: true, problems: [] }),
      ],
    })!;
    expect(post.text).toContain('Week 10 lineup check: 2 teams have something to fix before Sunday');
    expect(post.text.indexOf('Pacific Pigskins: no lineup set')).toBeLessThan(post.text.indexOf('Vitside'));
    expect(post.text).toContain('Vitside: Joe Burrow (OUT)');
    expect(post.text.endsWith(URL)).toBe(true);
    expect(post.named).toEqual(['0001', '0002']);
  });

  it('returns null when every lineup is set', () => {
    expect(buildSaturdayLineupPost({ week: 10, lineupUrl: URL, warnings: [] })).toBeNull();
  });

  it('stays under the GroupMe cap by shedding detail, then names, and says how many it dropped', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      warning(String(i + 1).padStart(4, '0'), `Franchise With A Long Name ${i + 1}`),
    );
    const post = buildSaturdayLineupPost({ week: 10, lineupUrl: URL, warnings: many })!;
    expect(post.text.length).toBeLessThanOrEqual(GROUPME_MAX_CHARS);
    expect(post.text).toMatch(/…and \d+ more/);
    expect(post.text.endsWith(URL)).toBe(true);
    expect(post.named.length).toBeLessThan(40);
  });

  it('@-mentions owners it can resolve, with loci on the final text', () => {
    const post = buildSaturdayLineupPost({
      week: 10,
      lineupUrl: URL,
      warnings: [warning('0002', 'Vitside')],
      mentions: new Map([['0002', { userId: '123' }]]),
    })!;
    expect(post.text).toContain('@Vitside: Joe Burrow (OUT)');
    expect(post.attachments).toHaveLength(1);
    const [start, len] = (post.attachments[0] as any).loci[0];
    expect(post.text.slice(start, start + len)).toBe('@Vitside');
  });

  it('writes empty slots into the summary', () => {
    expect(problemSummary(warning('1', 'A', { problems: [], emptySlots: 2 }))).toBe('2 empty slots');
  });
});

describe('who counts as playing this week', () => {
  it('keeps matchup franchises and drops unmatched ones (bye or eliminated)', () => {
    const ids = playingFranchiseIds({
      weeklyResults: {
        matchup: [{ franchise: [{ id: '0001' }, { id: '0002' }] }],
        franchise: [{ id: '0003' }],
      },
    });
    expect([...ids].sort()).toEqual(['0001', '0002']);
  });
});

describe('no lineup chat on Sunday', () => {
  it('reads the weekday in the league clock, not UTC', () => {
    // Monday 03:00 UTC is still Sunday evening in Pacific time.
    const sundayNightPt = new Date('2026-11-16T03:00:00Z');
    expect(leagueWeekday(sundayNightPt, 'America/Los_Angeles')).toBe(0);
    expect(isChatQuietDay(sundayNightPt, 'America/Los_Angeles')).toBe(true);
    expect(isChatQuietDay(new Date('2026-11-14T17:00:00Z'), 'America/Los_Angeles')).toBe(false);
  });

  it('the kickoff check returns before any chat post on Sunday', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'schefter-lineup-check.mjs'), 'utf8');
    const sunday = src.indexOf('isChatQuietDay(now');
    const firstChatPost = src.indexOf("kind: 'lineup-deadline'");
    expect(sunday).toBeGreaterThan(-1);
    expect(sunday).toBeLessThan(firstChatPost);
  });
});

describe('the Saturday roll call never costs the preview its slot', () => {
  it('is an exempt kind', () => {
    expect(EXEMPT_KINDS.has('lineup-saturday')).toBe(true);
    expect(bypassesDayCap('lineup-saturday')).toBe(true);
  });

  it('never spends the daily slot or marks the week alerted', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'schefter-lineup-check.mjs'), 'utf8');
    const start = src.indexOf('async function saturdayRollCall');
    const body = src.slice(start, src.indexOf('// ── Main', start));
    expect(body).not.toMatch(/consumeDailyPost|recordDelivery|alertedKey/);
  });
});
