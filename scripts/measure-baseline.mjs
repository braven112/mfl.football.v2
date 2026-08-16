#!/usr/bin/env node
/**
 * measure-baseline.mjs — read-only snapshot of the repo's storage + churn
 * health. Prints one JSON document so before/after comparisons across the
 * performance/storage phases are a single diff.
 *
 * Usage:
 *   node scripts/measure-baseline.mjs            # repo + file metrics
 *   node scripts/measure-baseline.mjs --ttfb     # also curl prod TTFB (network)
 *
 * Never writes anything. Safe to run from any checkout (worktrees share the
 * object store, so git numbers reflect the main repo).
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const sh = (cmd) => {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
};

// ---------- git ----------

const countObjects = Object.fromEntries(
  sh('git count-objects -vH')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(':').map((s) => s.trim()))
);

const branchCount = Number(sh('git branch -a --format="%(refname)" | wc -l'));
const worktreeCount = sh('git worktree list --porcelain')
  .split('\n')
  .filter((l) => l.startsWith('worktree ')).length;

const commitsTouching = (pathspec, days) =>
  Number(sh(`git log --oneline --since="${days} days ago" -- ${pathspec} | wc -l`));

const DAYS = 7;
const git = {
  countObjects,
  branchCount,
  worktreeCount,
  commitsLast7d: {
    total: Number(sh(`git log --oneline --since="${DAYS} days ago" | wc -l`)),
    touchingData: commitsTouching('data', DAYS),
    touchingSrcData: commitsTouching('src/data', DAYS),
  },
};

// ---------- file metrics ----------

const bytesOf = (p) => {
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
};

const dirStats = (dir) => {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        files += 1;
        bytes += fs.statSync(p).size;
      }
    }
  };
  walk(dir);
  return { files, bytes };
};

const jsonEntryCount = (p, key) => {
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = key ? data[key] : data;
    return Array.isArray(arr) ? arr.length : null;
  } catch {
    return null;
  }
};

const leagues = {};
for (const league of Object.values(LEAGUES)) {
  const feedsDir = path.join(league.dataPath, 'mfl-feeds');
  const rosterHistory = {};
  let years = [];
  try {
    years = fs.readdirSync(feedsDir).filter((y) => /^\d{4}$/.test(y));
  } catch {
    // league without committed feeds (e.g. best-ball) — skip
  }
  for (const year of years) {
    const dir = path.join(feedsDir, year, 'roster-history');
    if (fs.existsSync(dir)) rosterHistory[year] = dirStats(dir);
  }
  const schefterFeedPath =
    league.schefterFeedPath ?? path.join(league.dataPath, 'schefter-feed.json');
  leagues[league.slug] = {
    mflFeeds: fs.existsSync(feedsDir) ? dirStats(feedsDir) : null,
    rosterHistory,
    schefterFeed: {
      path: schefterFeedPath,
      bytes: bytesOf(schefterFeedPath),
      posts: jsonEntryCount(schefterFeedPath, 'posts'),
    },
  };
}

const files = {
  leagues,
  whatsNew: {
    bytes: bytesOf('src/data/whats-new.json'),
    entries: jsonEntryCount('src/data/whats-new.json'),
    screenshots: fs.existsSync('public/assets/whats-new')
      ? dirStats('public/assets/whats-new')
      : null,
  },
};

// ---------- optional prod TTFB ----------

let ttfb = null;
if (process.argv.includes('--ttfb')) {
  const targets = [];
  for (const league of Object.values(LEAGUES)) {
    if (!league.canonicalDomain) continue;
    for (const p of ['/', '/players', '/rosters', '/news', '/mvp', '/rivalries']) {
      targets.push(`https://${league.canonicalDomain}${p}`);
    }
  }
  ttfb = {};
  for (const url of targets) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const t = sh(
        `curl -o /dev/null -s -w '%{http_code} %{time_starttransfer}' --max-time 30 '${url}'`
      );
      const [code, seconds] = t.split(' ');
      if (code && seconds) runs.push({ code: Number(code), seconds: Number(seconds) });
    }
    ttfb[url] = runs;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  git,
  files,
  ...(ttfb ? { ttfb } : {}),
};

console.log(JSON.stringify(report, null, 2));
