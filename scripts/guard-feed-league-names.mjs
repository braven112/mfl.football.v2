#!/usr/bin/env node
/**
 * Rewrite any post naming another league, in every league's Schefter feed on
 * disk, before a workflow commits it.
 *
 * The feed-specific committer (commit-feed-and-push.mjs) guards its own
 * writes; this covers the OTHER door — `.github/actions/commit-push`, whose
 * `data/ src/data/` commits (roster sync: milestone posts, poll posts, the
 * Pecking Order) carry feeds too. The action runs this before `git add`.
 * See src/utils/league-name-guard.mjs for the rule.
 *
 * A clean feed is left byte-identical (no write), so this never makes a
 * commit on its own. Dependency-free: node built-ins plus the registry.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { scrubFeedText } from '../src/utils/league-name-guard.mjs';

let fixedTotal = 0;
for (const [slug, reg] of Object.entries(LEAGUES)) {
  const feedPath = reg?.schefterFeedPath;
  if (!feedPath) continue;
  let result;
  try {
    // Read once and act on what was read — no exists-then-read window.
    result = scrubFeedText(readFileSync(feedPath, 'utf8'), slug);
  } catch (err) {
    if (err?.code === 'ENOENT') continue; // a league with no feed yet
    console.warn(`[league-name] ${feedPath}: could not read or parse (${err.message}) — left as-is.`);
    continue;
  }
  if (result.fixed.length) {
    writeFileSync(feedPath, result.text);
    fixedTotal += result.fixed.length;
    console.warn(`[league-name] ${feedPath}: rewrote another league's name in ${result.fixed.join(', ')}`);
  }
}
if (fixedTotal === 0) console.log('[league-name] every feed names only its own league.');
