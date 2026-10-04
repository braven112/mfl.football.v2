#!/usr/bin/env node
/**
 * Change an existing package league's features: set them in the registry,
 * then add/remove its pages, site-search entries and nav links to match
 * (scripts/lib/package-kit.mjs). Its scheduled jobs follow on their own —
 * they read the registry (scripts/lib/league-jobs.mjs).
 *
 *   node scripts/update-league-features.mjs '{"slug":"archies","features":{…}}' [--dry-run]
 *   UPDATE_SPEC='{…}' node scripts/update-league-features.mjs
 *
 * Run by .github/workflows/update-league.yml for the League Launcher's
 * "Change features" mode; the spec is validated again here because the
 * workflow can also be dispatched by hand.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { packageRoutesFor } from '../src/config/package-league-routes.mjs';
import { cleanUpdateSpec, updateSpecErrors } from '../src/config/launch-spec.mjs';
import { applyChanges, syncPlan } from './lib/package-kit.mjs';
import { setRegistryFeatures } from './new-league.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'src/config/leagues-data.mjs';

/** Every file change the update makes ({ path, content | null }). */
export function planUpdate(spec) {
  const league = getLeagueBySlug(spec.slug);
  const registry = fs.readFileSync(path.join(ROOT, REGISTRY), 'utf8');
  return [
    { path: REGISTRY, content: setRegistryFeatures(registry, spec.slug, spec.features) },
    ...syncPlan({ ...league, features: spec.features }),
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const raw = args.find((a) => a.trim().startsWith('{')) ?? process.env.UPDATE_SPEC;
  if (!raw) {
    console.error("Usage: node scripts/update-league-features.mjs '{\"slug\":…,\"features\":{…}}' [--dry-run]");
    process.exit(1);
  }
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch {
    console.error('The spec is not valid JSON.');
    process.exit(1);
  }
  const errors = updateSpecErrors(spec);
  if (errors.length) {
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  spec = cleanUpdateSpec(spec);

  const before = getLeagueBySlug(spec.slug).features;
  const changed = Object.keys(spec.features).filter((k) => Boolean(before[k]) !== spec.features[k]);
  console.log(`Updating ${spec.slug}: ${changed.map((k) => `${spec.features[k] ? '+' : '−'}${k}`).join(', ')}`);
  console.log(`  ${packageRoutesFor(spec.features).length} pages after the update`);

  const plan = planUpdate(spec);
  const dryRun = args.includes('--dry-run');
  for (const c of plan) console.log(`  ${dryRun ? 'would ' : ''}${c.content === null ? 'delete' : 'write'} ${c.path}`);
  if (!dryRun) applyChanges(plan);
}
