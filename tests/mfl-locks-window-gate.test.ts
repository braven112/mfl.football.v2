/**
 * MFL's `locked` flag may only be read THROUGH the waiver window.
 *
 * `export?TYPE=freeAgents` tags `status: "locked"` on every player who cannot be
 * added INSTANTLY. In the waiver window that is the whole pool (812/812 AL,
 * 814/814 NL, 619/619 TheLeague on 2026-09-30), and a queued claim is how those
 * players get added. A pre-check that read the flag raw refused every waiver
 * claim in both leagues for three days and hid Add on every free agent
 * (hotfix #1280, follow-up #1281).
 *
 * The fix routes every read through `fetchDropLocks(…, mode)`, which answers
 * null outside FCFS without asking MFL. This file pins that it stays the ONLY
 * door: the raw reader is private, nobody outside the util parses the export,
 * and the pages decide the window from MFL's live calendar before reading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const fetchWithTimeout = vi.fn();
vi.mock('../src/utils/fetch-with-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));
const mflFetch = vi.fn();
vi.mock('../src/utils/mfl-fetch', () => ({
  mflFetch: (...args: unknown[]) => mflFetch(...args),
}));

const { fetchDropLocks } = await import('../src/utils/mfl-locked-players');
const lockedModule = await import('../src/utils/mfl-locked-players');
const { waiverEventsLiveFirst, _resetLiveWaiverCalendarCache } = await import(
  '../src/utils/live-waiver-calendar'
);

const ROOT = join(__dirname, '..');
const UTIL = 'src/utils/mfl-locked-players.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|astro|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}
const SRC = walk(join(ROOT, 'src')).map((f) => ({
  path: relative(ROOT, f).split('\\').join('/'),
  text: readFileSync(f, 'utf8'),
}));

const WHOLE_POOL_LOCKED = {
  freeAgents: {
    leagueUnit: {
      unit: 'LEAGUE',
      player: [
        { id: '16168', status: 'locked' },
        { id: '13604', status: 'locked' },
      ],
    },
  },
};

beforeEach(() => {
  fetchWithTimeout.mockReset();
  mflFetch.mockReset();
  _resetLiveWaiverCalendarCache();
});

describe('fetchDropLocks — the window gate', () => {
  it.each(['waiver', 'unknown'] as const)('answers null in the %s window WITHOUT reading MFL', async (mode) => {
    fetchWithTimeout.mockResolvedValue({ ok: true, json: async () => WHOLE_POOL_LOCKED });
    expect(await fetchDropLocks('L', 2026, mode, { fresh: true })).toBeNull();
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('honours the flag in FCFS, where a lock is a recent drop MFL will refuse', async () => {
    fetchWithTimeout.mockResolvedValue({ ok: true, json: async () => WHOLE_POOL_LOCKED });
    const locks = await fetchDropLocks('L', 2026, 'fcfs', { fresh: true });
    expect(locks?.['']?.has('13604')).toBe(true);
  });
});

describe('the raw lock reader is not reachable', () => {
  it('mfl-locked-players does not export fetchLockedPlayers', () => {
    expect('fetchLockedPlayers' in lockedModule).toBe(false);
    expect(readFileSync(join(ROOT, UTIL), 'utf8')).not.toMatch(/export\s+(async\s+)?function\s+fetchLockedPlayers/);
  });

  it('nothing outside the util parses the freeAgents lock flag', () => {
    const offenders = SRC.filter(
      (f) =>
        f.path !== UTIL &&
        (/\bparseLockedPlayers\s*\(/.test(f.text) || /\bfetchLockedPlayers\b/.test(f.text)),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('every consumer of isPlayerLocked or the lock list reads it through fetchDropLocks', () => {
    const consumers = SRC.filter((f) => f.path !== UTIL && /mfl-locked-players/.test(f.text));
    expect(consumers.length).toBeGreaterThan(0);
    const offenders = consumers.filter((f) => !/\bfetchDropLocks\s*\(/.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe('the Free Agents pages decide the window from the LIVE calendar', () => {
  // A page that read only the synced calendar.json could show the wrong
  // window's locks while the claim route — which reads live — decided the
  // other way. Both pages ask MFL first and fall back to the synced copy.
  it.each(['src/pages/theleague/players.astro', 'src/components/shared/free-agents/FreeAgentsPage.astro'])(
    '%s reads waiverEventsLiveFirst before fetchDropLocks',
    (path) => {
      const text = readFileSync(join(ROOT, path), 'utf8');
      const live = text.indexOf('waiverEventsLiveFirst(');
      const locks = text.indexOf('fetchDropLocks(');
      expect(live).toBeGreaterThan(-1);
      expect(locks).toBeGreaterThan(live);
    },
  );

  it('falls back to the committed calendar for a viewer with no league session', async () => {
    const committed = [{ type: 'WAIVER_REQUEST' }] as never[];
    expect(await waiverEventsLiveFirst(2026, 'L', null, committed)).toBe(committed);
    expect(mflFetch).not.toHaveBeenCalled();
  });

  it('falls back to the committed calendar when MFL answers no events (owner-gated / error body)', async () => {
    mflFetch.mockResolvedValue({ json: async () => ({ error: { $t: 'API requires a logged in user' } }) });
    const committed = [{ type: 'WAIVER_REQUEST' }] as never[];
    expect(await waiverEventsLiveFirst(2026, 'L', 'cookie', committed)).toBe(committed);
  });

  it('prefers the live calendar, and caches a usable read per league', async () => {
    const live = [{ type: 'FCFS_WAIVER', start_time: '1', end_time: '2' }] as never[];
    mflFetch.mockResolvedValue({ json: async () => ({ calendar: { event: live } }) });
    expect(await waiverEventsLiveFirst(2026, 'L', 'cookie', [])).toEqual(live);
    expect(await waiverEventsLiveFirst(2026, 'L', 'other-cookie', [])).toEqual(live);
    expect(mflFetch).toHaveBeenCalledTimes(1);
  });
});
