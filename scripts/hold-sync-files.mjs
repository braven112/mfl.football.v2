#!/usr/bin/env node
/**
 * Runs right before roster-sync's commit step: publishes the held files to
 * Redis and restores their committed copies (see scripts/lib/held-sync-files.mjs).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRedisConfig } from './lib/redis.mjs';
import {
  currentInjuryFiles,
  heldChanges,
  modifiedPaths,
  planHeldFiles,
  planLeagueDataHold,
  publishLiveFiles,
} from './lib/held-sync-files.mjs';
import { isSyncPublishedStoreFile, syncPublishedPatterns } from './lib/sync-published.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

const redis = getRedisConfig();
if (!redis) {
  console.log('[held-sync] no Redis credentials — every file commits as before.');
} else {
  const log = (line) => console.log(line);
  // Every current report, changed or not — see currentInjuryFiles.
  const published = await publishLiveFiles(currentInjuryFiles(git(['ls-files', '--cached', '--others', '--exclude-standard', '--', 'data']).split('\n')), {
    redis,
    readFile: (p) => fs.readFileSync(path.join(root, p), 'utf8'),
    log,
  });
  const changes = heldChanges(modifiedPaths(git(['status', '--porcelain', '--', 'data', 'src/data'])));
  const { restore } = await planHeldFiles(changes, { redis, published, log });
  if (restore.length) git(['checkout', '--', ...restore]);

  // The data the run just made live through the league-data pointer
  // (LEAGUE_DATA_PUBLISHED, set by the publish step) commits once a day.
  const patterns = syncPublishedPatterns();
  const restoreData = await planLeagueDataHold(git(['status', '--porcelain', '--untracked-files=all', '--', 'data', 'src/data']), {
    published: !!process.env.LEAGUE_DATA_PUBLISHED,
    isStoreFile: (p) => isSyncPublishedStoreFile(p, patterns),
    redis,
    log,
  });
  if (restoreData.length) git(['checkout', '--', ...restoreData]);
}
