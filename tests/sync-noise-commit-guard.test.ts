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
});
