/**
 * Design-token guard
 *
 * Fails the build when a stylesheet references a CSS custom property that is
 * DEFINED NOWHERE in the repo. `var(--foo, #fff)` with an undefined --foo is
 * how the Admin Hub shipped broken dark mode in July 2026: every rule silently
 * fell back to its hardcoded light-mode value, light mode looked perfect, and
 * dark mode rendered white cards on a black page. The token system only works
 * when references point at tokens that exist (tokens.css + tokens-dark.css,
 * or a deliberate local definition).
 *
 * What counts as a definition (collected across ALL of src/):
 *   - `--name: value` declarations in .css / .scss / .astro style blocks
 *   - inline style objects / setProperty: `'--name': …` or setProperty('--name'
 *   - Astro `define:vars={{ name }}` (exposes --name to the scoped style)
 *
 * Definitions are collected repo-wide (not per-file) on purpose: parents
 * legitimately define tokens that child components consume via the cascade.
 * The failure mode this test targets is a token that exists NOWHERE.
 *
 * KNOWN LIMITATION: a definition inside one component's scoped style (even a
 * `:global(html.dark)`-only block) counts repo-wide, so a reference in an
 * unrelated file that the cascade never reaches will pass this test. The
 * repo convention that keeps that gap closed: define theme tokens globally
 * in tokens.css / tokens-dark.css, never as page-local vocabularies (see
 * CLAUDE.md "Design tokens").
 *
 * If you add a genuinely intentional reference to a token defined outside
 * src/ (e.g. injected by a third-party script at runtime), add it to
 * ALLOWED_EXTERNAL_TOKENS with a comment explaining where it comes from.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../src');

/** Tokens defined outside the repo that are legal to reference. */
const ALLOWED_EXTERNAL_TOKENS = new Set<string>([
  // Vend Sans is provided by the font loader at runtime (see tokens.css
  // --font-family-base fallback chain).
  'font-vend-sans',
]);

// References are checked in stylesheets and Astro components; definitions are
// additionally collected from scripts, because dynamic tokens (--team,
// --wp-split, draft-room splash colors, …) are set via setProperty / inline
// style objects in .ts/.tsx client code.
const REFERENCE_EXTS = new Set(['.astro', '.css', '.scss']);
const DEFINITION_EXTS = new Set([...REFERENCE_EXTS, '.ts', '.tsx', '.js', '.jsx', '.mjs']);

function walk(dir: string, exts: Set<string>): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walk(full, exts));
    } else if (exts.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const referenceFiles = walk(SRC, REFERENCE_EXTS);
const definitionFiles = walk(SRC, DEFINITION_EXTS);

// ---------------------------------------------------------------------------
// Collect definitions
// ---------------------------------------------------------------------------
const defined = new Set<string>(ALLOWED_EXTERNAL_TOKENS);

const DEFINITION_PATTERNS = [
  // CSS declaration: `--name: value`. The leading char class includes quotes
  // and backticks so definitions inside template-literal style attributes
  // (style={`--ev-accent: ${accent}`}) and string style props count too.
  /(?:^|[\s{;(`"'])--([a-zA-Z][\w-]*)\s*:/g,
  // style.setProperty('--name', …)
  /setProperty\(\s*["'`]--([a-zA-Z][\w-]*)/g,
  // JS object key: { '--name': value } (colon lands after the closing quote)
  /["'`]--([a-zA-Z][\w-]*)["'`]\s*:/g,
  // TSX computed key: { ['--name' as any]: value }
  /\[\s*["'`]--([a-zA-Z][\w-]*)["'`]/g,
];

// Astro define:vars={{ a, b: expr, 'kebab-name': expr }} exposes each key as
// a CSS custom property of the same name in the component's scoped style.
const DEFINE_VARS = /define:vars=\{\{([\s\S]*?)\}\}/g;

for (const file of definitionFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const pattern of DEFINITION_PATTERNS) {
    for (const m of text.matchAll(pattern)) defined.add(m[1]);
  }
  for (const dv of text.matchAll(DEFINE_VARS)) {
    for (const rawKey of dv[1].split(',')) {
      const key = rawKey.split(':')[0].trim().replace(/^["'`]|["'`]$/g, '');
      if (/^[a-zA-Z][\w-]*$/.test(key)) defined.add(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Collect references and diff
// ---------------------------------------------------------------------------
type Violation = { file: string; line: number; token: string; snippet: string };
const violations: Violation[] = [];

const REFERENCE = /var\(\s*--([a-zA-Z][\w-]*)/g;

// Blank out /* … */ block comments (preserving line structure) so commented-out
// or prose references to var(--x) don't count.
function stripBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

for (const file of referenceFiles) {
  const lines = stripBlockComments(fs.readFileSync(file, 'utf8')).split('\n');
  lines.forEach((lineText, i) => {
    for (const m of lineText.matchAll(REFERENCE)) {
      const token = m[1];
      // Template-constructed names (`var(--team-${id})`) match a trailing
      // dash — those are dynamic and out of scope for this static check.
      if (token.endsWith('-')) continue;
      if (!defined.has(token)) {
        violations.push({
          file: path.relative(path.resolve(__dirname, '..'), file),
          line: i + 1,
          token,
          snippet: lineText.trim().slice(0, 120),
        });
      }
    }
  });
}

describe('design-token guard', () => {
  it('collected a sane token registry', () => {
    // Guard against the collector itself breaking: the real registry has
    // hundreds of tokens; a tiny count means the parse regressed and the
    // reference check below would pass vacuously… or flag everything.
    expect(defined.size).toBeGreaterThan(200);
    for (const core of ['page-text', 'card-bg', 'card-surface', 'content-border', 'content-text-muted', 'color-primary']) {
      expect(defined.has(core), `core token --${core} missing from registry`).toBe(true);
    }
  });

  it('every var(--token) reference points at a token defined somewhere in src/', () => {
    const report = violations
      .map((v) => `  ${v.file}:${v.line}  var(--${v.token})  →  ${v.snippet}`)
      .join('\n');
    expect(
      violations,
      `Found ${violations.length} reference(s) to CSS custom properties that are defined nowhere in src/.\n` +
        `These silently resolve to their fallback (or nothing) in every theme — this is the exact bug that\n` +
        `broke Admin Hub dark mode (July 2026). Use the real tokens from src/styles/tokens.css /\n` +
        `tokens-dark.css, or define the property before referencing it.\n${report}`,
    ).toEqual([]);
  });
});
