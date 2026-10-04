#!/usr/bin/env node
/**
 * Print the leagues a recurring job runs for (scripts/lib/league-jobs.mjs),
 * one per line, so a workflow loops the registry instead of a hand-kept list.
 *
 *   node scripts/league-jobs.mjs <job> [--format '{slug}'] [--join ',']
 *
 *   node scripts/league-jobs.mjs mfl-sync --format '{navSlug}:{id}:{features.salaryCap}'
 *   node scripts/league-jobs.mjs pecking-order --format '{dataPath}/pecking-order' --join ,
 *
 * Exits 1 on an unknown job or field — never prints an empty list for a typo.
 * An empty list for a REAL job is legitimate (no league qualifies) and exits 0.
 */
import { JOB_NAMES, formatLeague, leaguesFor } from './lib/league-jobs.mjs';

const args = process.argv.slice(2);
const job = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

if (!job || job.startsWith('-')) {
  console.error(`Usage: node scripts/league-jobs.mjs <job> [--format '{slug}'] [--join SEP]\nJobs: ${JOB_NAMES.join(', ')}`);
  process.exit(1);
}

try {
  const format = opt('--format', '{slug}');
  const lines = leaguesFor(job).map((l) => formatLeague(format, l));
  const out = lines.join(opt('--join', '\n'));
  if (out) process.stdout.write(`${out}\n`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
