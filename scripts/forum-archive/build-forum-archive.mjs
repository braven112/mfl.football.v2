#!/usr/bin/env node
/**
 * Build TheLeague's forum archive JSON from the phpBB database export.
 *
 *   node scripts/forum-archive/build-forum-archive.mjs <export.sql> <out.json>
 *
 * The output is what the archive page's commissioner import panel accepts
 * (it can also take the .sql directly). NEVER write the output inside the
 * repo: it is members-only league content and the repo is public.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildForumArchive } from '../../src/utils/forum-archive/build-archive.mjs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/forum-archive/build-forum-archive.mjs <export.sql> <out.json>');
  process.exit(1);
}

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
if (!relative(repoRoot, resolve(output)).startsWith('..')) {
  console.error('Refusing to write the archive inside the repo — it is members-only and the repo is public.');
  process.exit(1);
}

const archive = buildForumArchive(readFileSync(input, 'utf8'));
writeFileSync(output, JSON.stringify(archive));
console.log(`${archive.posts.length} posts in ${archive.topics.length} threads across ${archive.forums.length} forums → ${output}`);
