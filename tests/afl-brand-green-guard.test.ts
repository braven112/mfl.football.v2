/**
 * AFL brand-green guard
 *
 * Fails the build when an AFL-only file styles against TheLeague's brand
 * green — either the token (`--color-secondary`, `--color-secondary-light`)
 * or its literal values.
 *
 * This is a DIFFERENT failure than the one design-token-guard catches, and
 * that test structurally cannot see it. design-token-guard asks "is this
 * custom property defined anywhere?" — and `--color-secondary` is a perfectly
 * real token with real light and dark values (tokens.css `#2e8743`,
 * tokens-dark.css `#10b981`). It just happens to be the OTHER league's brand
 * color. The AFL theme blocks (`html[data-league="afl"]`,
 * `html.dark[data-league="afl"]`) override --league-accent, links, nav and the
 * whole surface ramp, but never touch --color-secondary — so an AFL page that
 * references it renders TheLeague green, in both themes, with every test
 * green. That is exactly how `/afl-fantasy/playoffs` shipped its bracket
 * labels in TheLeague's green (August 2026).
 *
 * The hex list matters as much as the token list: the live-refresh progress
 * bar on the same page hardcoded `linear-gradient(90deg, #1c497c, #2e8743)`,
 * which a token-name grep walks straight past. It also only renders on
 * `[data-status='live']` cards, so it survived every screenshot taken in an
 * offseason.
 *
 * NOT every green on an AFL page is a violation. Three kinds, and only the
 * first is a bug:
 *   - brand voice (a link hover, a badge fill) -> use --league-accent
 *   - semantic affirmative (filled/confirmed/success) -> use --color-success
 *   - categorical palette (position colors) -> leave it alone
 * The allowlist below carries the second and third kinds, each with a reason.
 * Adding an entry is a design decision — write down why.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

/** Files whose entire tree is AFL-only, so TheLeague's brand has no business in them. */
const AFL_DIRS = [
  path.join(SRC, 'pages', 'afl-fantasy'),
  path.join(SRC, 'components', 'afl-fantasy'),
  path.join(SRC, 'components', 'afl'),
];

/**
 * TheLeague's brand green: the tokens, and the literal values they resolve to.
 *
 * Deliberately NOT listed: `#10b981`. It is --color-secondary's DARK value,
 * but it is also --color-success's LIGHT value (tokens.css), so it appears as
 * a legitimate fallback on semantic-green references
 * (`var(--color-success, #10b981)`). An ambiguous hex can't distinguish the
 * bug from the correct usage, and a guard that cries wolf gets allowlisted
 * into uselessness. The unambiguous hexes below carry the check.
 */
const FORBIDDEN = [
  '--color-secondary',       // also catches --color-secondary-light
  '#2e8743',                 // tokens.css   --color-secondary (light)
  '#3c9950',                 // tokens.css   --color-secondary-light
  '#4ade80',                 // tokens-dark.css --color-secondary-light
];

/**
 * Sanctioned exceptions: `<relative path>:<forbidden string>` -> why it stays.
 * Every entry is a green that is NOT brand voice.
 */
const ALLOWLIST = new Map<string, string>([
  [
    'pages/afl-fantasy/lineup.astro:--color-secondary',
    'Categorical position palette (--lineup-pos-rb) + the swapped-slot accent. ' +
      'src/pages/theleague/lineup.astro declares an identical token block, so ' +
      'recoloring only the AFL diverges two sibling pages, and a red RB chip ' +
      'would collide with the error red on the same screen.',
  ],
  [
    'pages/afl-fantasy/lineup.astro:#2e8743',
    'Fallback hex on the --lineup-pos-rb / --lineup-slot-swapped-accent / ' +
      '--btn-secondary-bg references above — same categorical-palette reason.',
  ],
  [
    'pages/afl-fantasy/players.astro:#4ade80',
    'Conference tag chip. Its own light/dark pair (#15803d / #4ade80) rather ' +
      'than a --color-secondary reference, and it is a categorical tag color, ' +
      'not brand voice. Recoloring it is a separate AL/NL design question.',
  ],
]);

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(astro|css|tsx?|jsx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('AFL brand-green guard', () => {
  it('no AFL-only file styles against TheLeague brand green', () => {
    const violations: string[] = [];

    for (const dir of AFL_DIRS) {
      for (const file of walk(dir)) {
        const rel = path.relative(SRC, file).split(path.sep).join('/');
        const lines = fs.readFileSync(file, 'utf8').split('\n');

        // Comments are where we EXPLAIN the rule — don't flag the explanation.
        // Needs real block-comment state, not a startsWith('*') check: a
        // wrapped sentence inside /* … */ often begins with an ordinary word.
        let inBlockComment = false;

        lines.forEach((line, i) => {
          const trimmed = line.trim();
          const opens = line.lastIndexOf('/*');
          const closes = line.lastIndexOf('*/');
          const wasInBlockComment = inBlockComment;
          if (opens !== -1 && opens > closes) inBlockComment = true;
          else if (closes !== -1 && closes > opens) inBlockComment = false;

          if (wasInBlockComment || inBlockComment || trimmed.startsWith('//')) return;

          for (const needle of FORBIDDEN) {
            if (!line.toLowerCase().includes(needle.toLowerCase())) continue;
            if (ALLOWLIST.has(`${rel}:${needle}`)) continue;
            violations.push(`${rel}:${i + 1} — ${needle} in: ${trimmed.slice(0, 100)}`);
          }
        });
      }
    }

    expect(
      violations,
      `AFL files styling against TheLeague's brand green.\n\n` +
        `--color-secondary is TheLeague's brand token; the AFL theme never overrides it, ` +
        `so it renders TheLeague green on AFL pages in BOTH themes.\n` +
        `Use --league-accent for brand voice, --color-success for semantic green, or add ` +
        `an ALLOWLIST entry in this file explaining why the green is correct.\n\n` +
        violations.join('\n'),
    ).toEqual([]);
  });

  it('the allowlist has no stale entries', () => {
    const stale: string[] = [];

    for (const key of ALLOWLIST.keys()) {
      const [rel, needle] = key.split(/:(?=[^:]*$)/);
      const full = path.join(SRC, rel);
      if (!fs.existsSync(full)) {
        stale.push(`${key} — file no longer exists`);
        continue;
      }
      if (!fs.readFileSync(full, 'utf8').toLowerCase().includes(needle.toLowerCase())) {
        stale.push(`${key} — string no longer present; drop the allowlist entry`);
      }
    }

    expect(stale, `Stale AFL brand-green allowlist entries:\n${stale.join('\n')}`).toEqual([]);
  });
});
