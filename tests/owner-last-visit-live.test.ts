/**
 * The Activity pages read MFL's last-visit map from Redis when it is at least as
 * fresh as the committed copy, which is now a daily snapshot
 * (scripts/hold-owner-last-visit.mjs). Every commit to main is a production build.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { liveIsFresher, liveLastVisitKey, loadLiveLastVisit } from '../src/utils/owner-last-visit-live';
import { currentLastVisitFiles, heldChanges, LAST_VISIT_GROUPS, lastVisitKey } from '../scripts/lib/held-sync-files.mjs';

const disk = { generatedAt: '2026-10-22T04:57:20.065Z', lastVisit: { '0001': 1792555906 } };
const newer = { generatedAt: '2026-10-22T10:57:20.065Z', lastVisit: { '0001': 1792650000 } };
const older = { generatedAt: '2026-10-21T10:57:20.065Z', lastVisit: { '0001': 1792400000 } };
const client = (value: unknown) => async () => ({ get: async <T>() => value as T });

describe('loadLiveLastVisit', () => {
  it('uses the live copy when it is newer than the disk copy', async () => {
    expect(await loadLiveLastVisit('theleague', disk, client(JSON.stringify(newer)))).toEqual(newer);
    expect(await loadLiveLastVisit('theleague', disk, client(newer))).toEqual(newer);
  });

  it('keeps the disk copy when the live one is older, missing or broken', async () => {
    expect(await loadLiveLastVisit('theleague', disk, client(older))).toBe(disk);
    expect(await loadLiveLastVisit('theleague', disk, client(null))).toBe(disk);
    expect(await loadLiveLastVisit('theleague', disk, client('{not json'))).toBe(disk);
    expect(await loadLiveLastVisit('theleague', disk, client({ generatedAt: newer.generatedAt }))).toBe(disk);
    expect(await loadLiveLastVisit('theleague', disk, async () => null)).toBe(disk);
    expect(
      await loadLiveLastVisit('theleague', disk, async () => {
        throw new Error('Redis down');
      }),
    ).toBe(disk);
  });

  it('uses the live copy when there is no file on disk', async () => {
    expect(await loadLiveLastVisit('archies', null, client(newer))).toEqual(newer);
  });

  it('never lets an unstamped live copy beat a stamped disk copy', () => {
    expect(liveIsFresher({ lastVisit: {} }, disk)).toBe(false);
    expect(liveIsFresher({ lastVisit: {} }, null)).toBe(true);
  });
});

describe('the sync and the page agree on the key and the files', () => {
  it('uses one Redis key shape on both sides', () => {
    expect(lastVisitKey('archies')).toBe(liveLastVisitKey('archies'));
  });

  it('holds every league’s file and nothing else', () => {
    const paths = ['data/theleague/owner-last-visit.json', 'data/archies/owner-last-visit.json', 'data/theleague/mfl-feeds/2026/rosters.json'];
    expect(currentLastVisitFiles(paths)).toEqual([
      { path: 'data/theleague/owner-last-visit.json', key: 'mfl:owner-last-visit:theleague' },
      { path: 'data/archies/owner-last-visit.json', key: 'mfl:owner-last-visit:archies' },
    ]);
    expect([...heldChanges(paths, LAST_VISIT_GROUPS).get('owner-last-visit')!.files.map((f: { path: string }) => f.path)]).toEqual(paths.slice(0, 2));
  });
});

describe('wiring', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  it('holds the files right before the commit, with Redis credentials', () => {
    const wf = read('.github/workflows/sync-owner-last-visit.yml');
    const hold = wf.indexOf('run: node ./scripts/hold-owner-last-visit.mjs');
    const commit = wf.indexOf('- name: Commit and push');
    expect(hold, 'hold step missing').toBeGreaterThan(-1);
    expect(wf.slice(hold, commit)).not.toMatch(/\n\s+run:/);
    const step = wf.slice(wf.lastIndexOf('- name:', hold), hold);
    expect(step).toContain('UPSTASH_REDIS_REST_URL');
    expect(step).toContain('UPSTASH_REDIS_REST_TOKEN');
  });

  it('renders last visits through the live reader', () => {
    expect(read('src/components/shared/OwnerActivityPage.astro')).toMatch(/await loadLiveLastVisit\(leagueSlug, /);
  });
});
