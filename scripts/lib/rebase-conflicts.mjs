/**
 * Conflict classification for `git rebase origin/main`, per CLAUDE.md
 * "Merge conflicts — always rebase, resolve autonomously".
 *
 * Pure: the CLI (scripts/resolve-rebase-conflicts.mjs) does the git calls,
 * this decides what each conflicted path IS and which side wins.
 *
 * THE SIDE TRAP. During a rebase the labels flip: HEAD is main's tip, so
 * `--ours` is MAIN and `--theirs` is the branch commit being replayed. During
 * a merge it is the other way round. A resolver that hardcodes --theirs for
 * feed files (merge wording) is exactly backwards under a rebase: it takes
 * the branch's stale feed snapshot over main's live one, which is the outcome
 * the rule exists to prevent. Always ask `mainSide()`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The six classes from CLAUDE.md, in the order they must be handled. */
export const CLASSES = /** @type {const} */ ([
  'package-json',
  'lockfile',
  'generated-data',
  'ratchet-baseline',
  'docs',
  'source',
]);

/**
 * Generated-data patterns come from .gitattributes, the file that already
 * declares them `merge=binary` — one source of truth, and no league data
 * path literal here for tests/league-literal-guard.test.ts to object to.
 * The two suffix patterns are CLAUDE.md's additions (`*-feed.json`, `*.lock`).
 */
export function generatedPatternsFrom(gitattributesText) {
  const fromAttrs = gitattributesText
    .split('\n')
    .filter((l) => /\bmerge=binary\b/.test(l) && !l.trim().startsWith('#'))
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((pattern) => pattern !== 'pnpm-lock.yaml')
    .map((pattern) => {
      // Escape regex metacharacters, then expand globs. `**` is swapped for a
      // placeholder first so the single-star pass cannot eat the star in `.*`.
      const re = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '\u0000/')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000\//g, '(?:.*/)?')
        .replace(/\u0000/g, '.*');
      return new RegExp(`^${re}$`);
    });
  return [...fromAttrs, /-feed\.json$/, /\.lock$/];
}

let generatedPatterns = null;
function isGenerated(file) {
  if (!generatedPatterns) {
    let text = '';
    try {
      text = readFileSync(join(process.cwd(), '.gitattributes'), 'utf8');
    } catch {
      /* no .gitattributes: fall back to the suffix patterns alone */
    }
    generatedPatterns = generatedPatternsFrom(text);
  }
  return generatedPatterns.some((re) => re.test(file));
}

const RATCHET_BASELINES = new Set([
  'tests/fixtures/typecheck-baseline.json',
  'tests/fixtures/page-fork-baseline.json',
]);

/**
 * @param {string} file repo-relative path
 * @returns {{ file: string, klass: typeof CLASSES[number], auto: boolean, action: string }}
 */
export function classifyConflict(file) {
  if (file === 'package.json') {
    return {
      file,
      klass: 'package-json',
      auto: false,
      action:
        'Union both sides (.gitattributes declares merge=union, so a remaining conflict is the SAME key changed twice: keep the newer version spec).',
    };
  }
  if (file === 'pnpm-lock.yaml') {
    return {
      file,
      klass: 'lockfile',
      auto: true,
      action: "Never hand-resolve: take main's copy, then `pnpm install` after package.json settles and commit the regenerated lock.",
    };
  }
  if (isGenerated(file)) {
    return {
      file,
      klass: 'generated-data',
      auto: true,
      action: "Cron writes these on main; the branch's snapshot is stale by definition. Take main's side whole — never merge row by row.",
    };
  }
  if (RATCHET_BASELINES.has(file)) {
    return {
      file,
      klass: 'ratchet-baseline',
      auto: true,
      action:
        "Neither side is right (both measured trees that no longer exist). Take main's copy to clear the markers, then re-measure with `node scripts/ratchet.mjs --write` before the final commit.",
    };
  }
  if (file === 'CLAUDE.md' || file.startsWith('docs/') || file.endsWith('.md')) {
    return {
      file,
      klass: 'docs',
      auto: false,
      action: "Additive: both sides' new sections survive. Never drop a section.",
    };
  }
  return {
    file,
    klass: 'source',
    auto: false,
    action:
      "Integrate the intent: new imports/helpers stack additively; if the same function body changed on both sides, keep main's structural change and re-apply the branch's behavioral change on top.",
  };
}

/**
 * Which `git checkout --<side>` names MAIN right now.
 * @param {'rebase'|'merge'} mode
 */
export function mainSide(mode) {
  return mode === 'rebase' ? 'ours' : 'theirs';
}

/** Order conflicts for handling: package.json first (the lock depends on it), then the rest by class. */
export function orderConflicts(files) {
  const rank = new Map(CLASSES.map((c, i) => [c, i]));
  return files
    .map(classifyConflict)
    .sort((a, b) => rank.get(a.klass) - rank.get(b.klass) || a.file.localeCompare(b.file));
}
