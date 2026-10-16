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
import { heldChanges, modifiedPaths, planHeldFiles } from './lib/held-sync-files.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

const redis = getRedisConfig();
if (!redis) {
  console.log('[held-sync] no Redis credentials — every file commits as before.');
} else {
  const changes = heldChanges(modifiedPaths(git(['status', '--porcelain', '--', 'data', 'src/data'])));
  const { restore } = await planHeldFiles(changes, {
    redis,
    readFile: (p) => fs.readFileSync(path.join(root, p), 'utf8'),
    log: (line) => console.log(line),
  });
  if (restore.length) git(['checkout', '--', ...restore]);
}
