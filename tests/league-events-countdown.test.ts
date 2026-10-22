/**
 * resolved-events.json is recomputed on every Schefter scan, and most days only
 * each event's countdown moves. That change is left out of the commit (every
 * commit to main is a production build) because the site reads only startDate
 * and every reader of the countdown recomputes it in its own job.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { countdownOnlyChange } from '../scripts/lib/league-events-countdown.mjs';

const committed = {
  computedAt: '2026-10-21T07:04:13.139Z',
  leagueYear: 2026,
  events: [
    { id: 'afl-trade-deadline', name: 'Trade deadline', startDate: '2026-11-18T08:00:00.000Z', daysUntil: 28, isPast: false },
    { id: 'afl-nl-draft', name: 'NL draft', startDate: '2026-08-30T07:00:00.000Z', daysUntil: -1, isPast: false },
  ],
};
const tick = (o: typeof committed) => ({
  ...o,
  computedAt: '2026-10-22T07:04:49.992Z',
  events: o.events.map((e) => ({ ...e, daysUntil: e.daysUntil - 1, isPast: e.daysUntil - 1 < -1 })),
});

describe('countdownOnlyChange', () => {
  it('is true when only computedAt, daysUntil and isPast moved', () => {
    expect(countdownOnlyChange(committed, tick(committed))).toBe(true);
  });

  it('is false when an event moves, appears or is renamed', () => {
    const moved = tick(committed);
    moved.events[0] = { ...moved.events[0], startDate: '2026-11-25T08:00:00.000Z' };
    expect(countdownOnlyChange(committed, moved)).toBe(false);

    const added = tick(committed);
    added.events.push({ id: 'throwback-week-11', name: 'Throwback Week', startDate: '2026-11-17T08:00:00.000Z', daysUntil: 26, isPast: false });
    expect(countdownOnlyChange(committed, added)).toBe(false);

    const renamed = tick(committed);
    renamed.events[1] = { ...renamed.events[1], name: 'NL Draft' };
    expect(countdownOnlyChange(committed, renamed)).toBe(false);
  });

  it('is false when the league year rolls', () => {
    expect(countdownOnlyChange(committed, { ...tick(committed), leagueYear: 2027 })).toBe(false);
  });
});

describe('schefter-scan commit', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/schefter-scan.yml'), 'utf8');

  it('drops countdown-only event changes right before the commit, after the scan has read them', () => {
    const restore = wf.indexOf('run: node scripts/restore-countdown-only-events.mjs');
    const scan = wf.indexOf('run: node scripts/schefter-scan.mjs');
    const commit = wf.indexOf('- name: Commit and push feed updates');
    expect(restore, 'restore step missing').toBeGreaterThan(-1);
    expect(scan).toBeLessThan(restore);
    // Nothing may run between the restore and the commit, or it could rewrite the file.
    expect(wf.slice(restore, commit)).not.toMatch(/\n\s+run:/);
  });
});

describe('site readers of resolved-events.json', () => {
  it('read startDate, never the countdown the commit no longer carries', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/utils/schefter-season-mode.ts'), 'utf8');
    expect(src).toContain('resolved-events.json');
    expect(src).not.toMatch(/daysUntil|isPast/);
  });
});
