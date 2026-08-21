#!/usr/bin/env node
/**
 * Repair a stored Ask Roger answer.
 *
 * The problem this exists for (docs/claude/rules/roger.md): Roger generates
 * each answer ONCE and the POST handler persists it to Redis under a single
 * key. Nothing regenerates a stored answer, so correcting the constitution
 * fixes future questions and leaves every already-published card serving the
 * old ruling. The UI's only lever is deletion, which throws away the owner's
 * question and the card's place in the feed along with the bad answer.
 *
 * So: rewrite the `answer` field in place, preserving id / askedBy /
 * createdAt. The replacement text lives in the repo (data/roger-repairs/) so
 * a rewrite of a league-facing ruling is reviewable in a diff rather than
 * typed into a prompt box once and lost.
 *
 * Usage:
 *   node scripts/fix-rules-qa-answer.mjs --list [--search <term>] [--full]
 *   node scripts/fix-rules-qa-answer.mjs --show <id>
 *   node scripts/fix-rules-qa-answer.mjs --apply [--dry-run]
 *
 * Options:
 *   --league <slug>   theleague (default) | afl-fantasy
 *   --search <term>   case-insensitive substring over question + answer
 *   --full            print whole answers instead of a 160-char digest
 *   --dry-run         with --apply: print what would change, write nothing
 *
 * Env (standard triple fallback, see scripts/lib/redis.mjs):
 *   UPSTASH_REDIS_REST_URL / _TOKEN, or KV_REST_API_*, or STORAGE_REST_API_*
 *
 * The creds are repo secrets, so in practice this runs from CI
 * (.github/workflows/rules-qa-repair.yml, workflow_dispatch) or from a
 * checkout with `pnpm dlx vercel env pull`. It is idempotent: an answer that
 * already matches its repair file reports "unchanged" and no write happens.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRedisConfig, redisCommand } from './lib/redis.mjs';
import { RULES_QA_KEYS } from '../src/config/rules-qa-keys.mjs';
import {
  matchesSearch,
  summarizeEntry,
  applyRepairs,
  assertOnlyAnswersChanged,
} from './lib/rules-qa-repair.mjs';

const TAG = '[rules-qa-repair]';
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
/** One .md per repaired answer, named <qaId>.md, grouped by league slug. */
const REPAIR_DIR = join(repoRoot, 'data', 'roger-repairs');

function parseArgs(argv) {
  const flag = (name) => argv.includes(`--${name}`);
  const value = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  return {
    list: flag('list'),
    show: value('show'),
    apply: flag('apply'),
    dryRun: flag('dry-run'),
    full: flag('full'),
    search: value('search'),
    league: value('league') || 'theleague',
  };
}

/** Read the whole stored array. GET returns the JSON string @upstash/redis wrote. */
async function readAnswers(redis, key) {
  const raw = await redisCommand(redis, ['GET', key]);
  if (raw === null || raw === undefined) return [];
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(parsed)) {
    throw new Error(`${key} does not hold an array — refusing to touch it.`);
  }
  return parsed;
}

/** Load data/roger-repairs/<league>/*.md as [{ id, answer }], id from the filename. */
function loadRepairs(league) {
  const dir = join(REPAIR_DIR, league);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({
      id: f.replace(/\.md$/, ''),
      // Trailing newline is a file convention, not part of the answer the
      // card renders — strip it so a repaired answer can report "unchanged"
      // on the next run instead of rewriting forever.
      answer: readFileSync(join(dir, f), 'utf-8').replace(/\n+$/, ''),
      file: `data/roger-repairs/${league}/${f}`,
    }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const keys = RULES_QA_KEYS[args.league];
  if (!keys) {
    console.error(`${TAG} Unknown league "${args.league}". Known: ${Object.keys(RULES_QA_KEYS).join(', ')}`);
    process.exit(1);
  }

  const config = getRedisConfig();
  if (!config) {
    console.error(
      `${TAG} No Redis credentials. Set UPSTASH_REDIS_REST_URL/_TOKEN (or the KV_/STORAGE_ equivalents) — run this from CI or after \`pnpm dlx vercel env pull\`.`,
    );
    process.exit(1);
  }

  const entries = await readAnswers(config, keys.answers);
  console.log(`${TAG} ${keys.label}: ${entries.length} stored answers in ${keys.answers}`);

  if (args.show) {
    const entry = entries.find((e) => e.id === args.show);
    if (!entry) {
      console.error(`${TAG} No stored answer with id ${args.show}`);
      process.exit(1);
    }
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  if (args.list || (!args.apply && !args.show)) {
    const matches = entries.filter((e) => matchesSearch(e, args.search));
    console.log(
      `${TAG} ${matches.length} match${matches.length === 1 ? '' : 'es'}${args.search ? ` for "${args.search}"` : ''}\n`,
    );
    for (const entry of matches) {
      console.log(summarizeEntry(entry, { answerChars: args.full ? Infinity : 160 }));
      console.log('---');
    }
    return;
  }

  const repairs = loadRepairs(args.league);
  if (repairs.length === 0) {
    console.log(`${TAG} No repair files in data/roger-repairs/${args.league}/ — nothing to apply.`);
    return;
  }
  console.log(`${TAG} ${repairs.length} repair file(s): ${repairs.map((r) => r.file).join(', ')}`);

  const { updated, results } = applyRepairs(entries, repairs);
  for (const result of results) {
    if (result.status === 'not-found') {
      console.error(`${TAG} NOT FOUND: ${result.id} — no stored answer with that id (deleted, or a typo'd filename).`);
    } else if (result.status === 'unchanged') {
      console.log(`${TAG} unchanged: ${result.id} (already matches its repair file)`);
    } else {
      console.log(`${TAG} UPDATE ${result.id}`);
      console.log(`  before: ${result.before.replace(/\s+/g, ' ').slice(0, 300)}`);
      console.log(`  after:  ${result.after.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  }

  const missing = results.filter((r) => r.status === 'not-found');
  const changes = results.filter((r) => r.status === 'updated');

  if (changes.length === 0) {
    console.log(`${TAG} Nothing to write.`);
    if (missing.length > 0) process.exit(1);
    return;
  }

  assertOnlyAnswersChanged(entries, updated);

  if (args.dryRun) {
    console.log(`${TAG} --dry-run: would rewrite ${changes.length} answer(s). Nothing written.`);
    if (missing.length > 0) process.exit(1);
    return;
  }

  // Snapshot the pre-repair array first. The write below replaces every
  // stored answer since launch under one key; a rolling backup makes a bad
  // repair recoverable instead of archaeological.
  await redisCommand(config, [
    'SET',
    `${keys.answers}:repair-backup`,
    JSON.stringify({ savedAt: new Date().toISOString(), entries }),
  ]);
  await redisCommand(config, ['SET', keys.answers, JSON.stringify(updated)]);
  console.log(
    `${TAG} Wrote ${changes.length} repaired answer(s). Previous array saved to ${keys.answers}:repair-backup.`,
  );
  if (missing.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`${TAG} Failed:`, err);
  process.exit(1);
});
