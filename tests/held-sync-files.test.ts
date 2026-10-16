/**
 * scripts/lib/held-sync-files.mjs keeps live-read roster-sync outputs
 * (injuries, TheLeague's salary copy) out of the sync commit, publishing them
 * to Redis and letting one snapshot a day through. Every commit to main is a
 * production build; with no Redis or on any Redis error, files commit as before.
 */
import { describe, expect, it } from 'vitest';
import {
  heldChanges,
  injuriesKey,
  modifiedPaths,
  planHeldFiles,
  SNAPSHOT_EVERY_MS,
} from '../scripts/lib/held-sync-files.mjs';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const INJ = 'data/theleague/mfl-feeds/2026/injuries.json';
const AFL_INJ = 'data/afl-fantasy/mfl-feeds/2026/injuries.json';
const SAL = 'src/data/theleague/mfl-player-salaries-2026.json';
const ROSTERS = 'data/theleague/mfl-feeds/2026/rosters.json';

const fakeRedis = (store: Record<string, string> = {}, { failOn }: { failOn?: string } = {}) => {
  const calls: string[][] = [];
  const command = async (_redis: unknown, body: string[]) => {
    calls.push(body);
    if (failOn && body[0] === failOn) throw new Error('Redis down');
    if (body[0] === 'GET') return store[body[1]] ?? null;
    if (body[0] === 'SET') {
      store[body[1]] = body[2];
      return 'OK';
    }
    return null;
  };
  return { store, calls, command };
};

const files: Record<string, string> = {
  [INJ]: JSON.stringify({ year: 2026, injuries: { '1': { injuryStatus: 'Out' } } }),
  [AFL_INJ]: JSON.stringify({ year: 2026, injuries: {} }),
  [SAL]: JSON.stringify({ players: [] }),
};
const readFile = (p: string) => files[p];

describe('which files are held', () => {
  it('takes only modified tracked files, never new ones', () => {
    const porcelain = [` M ${INJ}`, `M  ${SAL}`, `?? data/archies/mfl-feeds/2027/injuries.json`, ` M ${ROSTERS}`].join('\n');
    expect(modifiedPaths(porcelain)).toEqual([INJ, SAL, ROSTERS]);
  });

  it('groups injuries and the salary copy, and leaves league data alone', () => {
    const changes = heldChanges([INJ, AFL_INJ, SAL, ROSTERS, 'src/data/mfl-player-salaries-2026.json']);
    expect([...changes.keys()]).toEqual(['injuries', 'theleague-salaries']);
    expect(changes.get('injuries')!.files.map((f: { path: string }) => f.path)).toEqual([INJ, AFL_INJ]);
  });
});

describe('planHeldFiles', () => {
  it('publishes each league injury report under its own key and holds it out', async () => {
    const r = fakeRedis({ 'mfl:held-sync:snapshot-at:injuries': String(NOW - 60_000) });
    const plan = await planHeldFiles(heldChanges([INJ, AFL_INJ]), { redis: {}, readFile, command: r.command, nowMs: NOW });
    expect(plan).toEqual({ restore: [INJ, AFL_INJ], commit: [] });
    expect(JSON.parse(r.store[injuriesKey('theleague')])).toEqual(JSON.parse(files[INJ]));
    expect(r.store[injuriesKey('afl-fantasy')]).toBeDefined();
  });

  it('lets a group through once a day and restarts its clock', async () => {
    const r = fakeRedis({ 'mfl:held-sync:snapshot-at:theleague-salaries': String(NOW - SNAPSHOT_EVERY_MS) });
    const plan = await planHeldFiles(heldChanges([SAL]), { redis: {}, readFile, command: r.command, nowMs: NOW });
    expect(plan).toEqual({ restore: [], commit: [SAL] });
    expect(r.store['mfl:held-sync:snapshot-at:theleague-salaries']).toBe(String(NOW));
  });

  it('commits when no snapshot has ever been taken', async () => {
    const r = fakeRedis();
    const plan = await planHeldFiles(heldChanges([SAL]), { redis: {}, readFile, command: r.command, nowMs: NOW });
    expect(plan.commit).toEqual([SAL]);
  });

  it('commits as before when Redis fails, so nothing is lost', async () => {
    const r = fakeRedis({}, { failOn: 'SET' });
    const plan = await planHeldFiles(heldChanges([INJ]), { redis: {}, readFile, command: r.command, nowMs: NOW });
    expect(plan).toEqual({ restore: [], commit: [INJ] });
  });

  it('commits a malformed injury file instead of publishing it', async () => {
    const r = fakeRedis({ 'mfl:held-sync:snapshot-at:injuries': String(NOW) });
    const plan = await planHeldFiles(heldChanges([INJ]), {
      redis: {},
      readFile: () => '{not json',
      command: r.command,
      nowMs: NOW,
    });
    expect(plan.commit).toEqual([INJ]);
    expect(r.store[injuriesKey('theleague')]).toBeUndefined();
  });
});
