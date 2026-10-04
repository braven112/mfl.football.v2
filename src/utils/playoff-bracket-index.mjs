/**
 * Which leagues have REAL playoff brackets on MFL — the gate that keeps a
 * package league's Playoffs page and its nav link hidden until the
 * commissioner has set the brackets up (the owner's call, Oct 2026).
 *
 * The index is data/playoff-bracket-leagues.json, a sorted list of slugs. The
 * feed sync adds a league the first run its real brackets arrive
 * (scripts/fetch-mfl-feeds.mjs) and never removes one: a league that has had
 * brackets keeps its page, with past seasons on it. It is committed rather than
 * read off the feeds at request time because the nav that reads it also ships
 * to the browser, where data/ does not exist.
 * tests/playoff-bracket-index.test.ts fails if it disagrees with the feeds.
 */
import fs from 'node:fs';
import path from 'node:path';

export const BRACKET_INDEX_PATH = 'data/playoff-bracket-leagues.json';

/**
 * Whether a playoff-brackets.json is MFL's real brackets. The sync writes a
 * standings-derived prediction (`predicted: true`) for TheLeague when MFL has
 * none yet — a guess, never something to render as a league's playoffs.
 */
export function isRealBracketFeed(feed) {
  return Boolean(feed && !feed.predicted && feed.brackets && Object.keys(feed.brackets).length > 0);
}

/** Every league directory under data/ with a real bracket feed in any season. */
export function leaguesWithRealBrackets(root) {
  const out = [];
  for (const slug of fs.readdirSync(path.join(root, 'data'))) {
    const feedsDir = path.join(root, 'data', slug, 'mfl-feeds');
    let years = [];
    try {
      years = fs.readdirSync(feedsDir).filter((d) => /^\d{4}$/.test(d));
    } catch {
      continue;
    }
    const real = years.some((y) => {
      try {
        return isRealBracketFeed(JSON.parse(fs.readFileSync(path.join(feedsDir, y, 'playoff-brackets.json'), 'utf8')));
      } catch {
        return false;
      }
    });
    if (real) out.push(slug);
  }
  return out.sort();
}

/** Add a league to the index (write only on change). Returns true when it was added. */
export function recordBracketLeague(root, slug) {
  const file = path.join(root, BRACKET_INDEX_PATH);
  let current = [];
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // first league to get brackets
  }
  if (current.includes(slug)) return false;
  fs.writeFileSync(file, JSON.stringify([...current, slug].sort(), null, 2) + '\n');
  return true;
}
