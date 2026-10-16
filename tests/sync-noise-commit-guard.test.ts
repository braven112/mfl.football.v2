/**
 * A sync that found nothing must commit nothing — every commit to `main` is a
 * production build. Over 8 days in Oct 2026, 137 of 602 roster-sync and
 * Schefter-scan commits changed only a run timestamp: `generatedAt` in
 * injuries.json, `fetchedAt` in tradeBait-by-franchise.json, and
 * `lastScanTimestamp` in the Schefter feed on a scan with no new moves.
 * These scans pin each of those three writers to the skip-if-unchanged path.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { stripScheduleSpreads } from '../scripts/lib/mfl-schedule-feed.mjs';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('sync writers skip timestamp-only changes', () => {
  const feeds = read('scripts/fetch-mfl-feeds.mjs');

  it('treats generatedAt as volatile for every feed write', () => {
    const m = feeds.match(/const VOLATILE_FEED_KEYS = \[([^\]]*)\]/);
    expect(m, 'VOLATILE_FEED_KEYS not found').toBeTruthy();
    expect(m![1]).toContain("'generatedAt'");
  });

  it('writes tradeBait-by-franchise.json through writeJsonIfChanged, ignoring fetchedAt', () => {
    const start = feeds.indexOf('const writeTradeBaitByFranchise');
    const body = feeds.slice(start, feeds.indexOf('\n};', start));
    expect(body).toMatch(/writeJsonIfChanged\(file, payload, \{ ignoreKeys: \['fetchedAt'\] \}\)/);
    expect(body).not.toMatch(/fs\.writeFileSync/);
  });

  it('leaves the Schefter feed untouched on a scan with no new transactions', () => {
    const scan = read('scripts/schefter-scan.mjs');
    const start = scan.indexOf('if (newTxns.length === 0) {');
    expect(start).toBeGreaterThan(-1);
    const block = scan.slice(start, scan.indexOf('return 0;', start));
    expect(block).not.toMatch(/fs\.writeFile/);
    expect(block).not.toMatch(/lastScanTimestamp\s*=/);
  });

  it('stores trade-bait state through setTradeBaitState, which stamps only a change', () => {
    // mergeFeed picks the trade-bait state by tradeBaitStateAt, so every write
    // must go through the helper that maintains it.
    const scan = read('scripts/schefter-scan.mjs');
    // The one direct assignment allowed is inside the helper itself.
    expect(scan.match(/feed\.tradeBaitState\s*=(?!=)/g)?.length).toBe(1);
    expect(scan.match(/(?<!function )setTradeBaitState\(feed, nextState\)/g)?.length).toBe(2);
  });

  it('drops the projected matchup spreads from schedule.json before writing', () => {
    // MFL recomputes these from live projections, so they moved on most
    // syncs and kept schedule.json a "real" change no reader cared about.
    expect(feeds).toMatch(/key: 'schedule',[\s\S]{0,200}parser: \(t\) => stripScheduleSpreads\(JSON\.parse\(t\)\)/);
    const feed = {
      schedule: {
        weeklySchedule: [
          { week: '9', matchup: [{ franchise: [{ id: '0001', spread: '1.4', isHome: '1' }, { id: '0002', spread: '-1.4' }] }] },
          // MFL collapses one-element arrays to a bare object.
          { week: '10', matchup: { franchise: { id: '0003', spread: '7', score: '101.2' } } },
        ],
      },
    };
    expect(stripScheduleSpreads(feed)).toEqual({
      schedule: {
        weeklySchedule: [
          { week: '9', matchup: [{ franchise: [{ id: '0001', isHome: '1' }, { id: '0002' }] }] },
          { week: '10', matchup: { franchise: { id: '0003', score: '101.2' } } },
        ],
      },
    });
  });

  it('holds live-read files out of the roster-sync commit, right before it', () => {
    const wf = read('.github/workflows/roster-sync.yml');
    const hold = wf.indexOf('run: node ./scripts/hold-sync-files.mjs');
    const commit = wf.indexOf('- name: Commit and push updates');
    expect(hold, 'hold step missing').toBeGreaterThan(-1);
    // Nothing may run between the hold and the commit, or it could rewrite a restored file.
    expect(wf.slice(hold, commit)).not.toMatch(/\n\s+run:/);
    const step = wf.slice(wf.lastIndexOf('- name:', hold), hold);
    expect(step).toContain('UPSTASH_REDIS_REST_URL');
    expect(step).toContain('UPSTASH_REDIS_REST_TOKEN');
  });

  it('leaves live-odds.json alone in season, when the site reads ESPN instead', () => {
    const odds = read('scripts/fetch-live-odds.mjs');
    expect(odds).toMatch(/if \(weekIndex === -1 && !isOffSeason\(\)\)/);
    expect(read('src/utils/coach-data.ts')).toMatch(/if \(isOffSeason && fallbackData\) return fallbackData;/);
  });

  it('renders injuries through the live reader, since the committed copy is a daily snapshot', () => {
    for (const page of [
      'src/components/shared/rosters/RostersPage.astro',
      'src/components/shared/free-agents/FreeAgentsPage.astro',
      'src/components/shared/lineup/LineupPage.astro',
      'src/pages/theleague/rosters.astro',
    ]) {
      const src = read(page);
      expect(src, page).toMatch(/await loadLiveInjuryMap\(/);
      expect(src, page).not.toMatch(/\bloadInjuryMap\(/);
    }
  });

  it('feeds the lineup warnings and app badge the live report, not the disk copy alone', () => {
    for (const file of ['src/utils/my-team-week.ts', 'src/pages/api/app-badge.ts']) {
      expect(read(file), file).toMatch(/await loadLiveInjuryFeed\(league\.slug, \w+, readFeed\(league, \w+, 'injuries\.json'\)/);
    }
  });
});

