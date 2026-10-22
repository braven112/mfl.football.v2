#!/usr/bin/env node
/**
 * Runs right before sync-owner-last-visit's commit step: publishes each
 * league's owner-last-visit.json to Redis and restores the committed copies, so
 * the Activity pages show the new visits without a production build. Once a
 * day the files are let through instead (scripts/lib/held-sync-files.mjs).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRedisConfig } from './lib/redis.mjs';
import {
  currentLastVisitFiles,
  heldChanges,
  LAST_VISIT_GROUPS,
  modifiedPaths,
  planHeldFiles,
  publishLiveFiles,
} from './lib/held-sync-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

const redis = getRedisConfig();
if (!redis) {
  console.log('[held-sync] no Redis credentials — every file commits as before.');
} else {
  const log = (line) => console.log(line);
  const published = await publishLiveFiles(currentLastVisitFiles(git(['ls-files', '--cached', '--others', '--exclude-standard', '--', 'data']).split('\n')), {
    redis,
    readFile: (p) => fs.readFileSync(path.join(root, p), 'utf8'),
    log,
  });
  const changes = heldChanges(modifiedPaths(git(['status', '--porcelain', '--', 'data'])), LAST_VISIT_GROUPS);
  const { restore } = await planHeldFiles(changes, { redis, published, log });
  if (restore.length) git(['checkout', '--', ...restore]);
}
