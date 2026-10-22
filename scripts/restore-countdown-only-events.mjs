#!/usr/bin/env node
/**
 * Runs right before schefter-scan's commit step: puts each league's
 * resolved-events.json back to its committed copy when the scan's recompute
 * changed only the countdown (see scripts/lib/league-events-countdown.mjs), so
 * the commit, and the production build behind it, happens only for a real
 * event change.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { countdownOnlyChange } from './lib/league-events-countdown.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

for (const league of ALL_LEAGUES) {
  const p = league.schefter?.eventsPath;
  if (!p || !fs.existsSync(path.join(root, p))) continue;
  let committed;
  try {
    committed = JSON.parse(git(['show', `HEAD:${p}`]));
  } catch {
    continue; // Not committed yet (or unreadable): let the commit carry it.
  }
  let current;
  try {
    current = JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  } catch {
    continue; // Malformed on disk: the commit step's own checks decide.
  }
  if (countdownOnlyChange(committed, current) && git(['status', '--porcelain', '--', p]).trim()) {
    git(['checkout', '--', p]);
    console.log(`[events] ${p}: only the countdown moved — left out of the commit`);
  }
}
