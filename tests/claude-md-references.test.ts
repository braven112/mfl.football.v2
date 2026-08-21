import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * CLAUDE.md cross-reference guardrail.
 *
 * CLAUDE.md is a router (Aug 2026): repo-wide rules live in it, and everything
 * domain-specific lives in `docs/claude/rules/<domain>.md`. Code comments,
 * workflow headers, agent definitions and human-facing notification text cite
 * those rules by name — and those citations are unenforced string literals.
 * Rename or move a section and every pointer to it breaks silently, because
 * a dangling citation still *reads* fine; you only find out when someone
 * follows it, finds nothing, and re-derives the rule wrong.
 *
 * That is not hypothetical. The router split broke seven live citations in one
 * commit, and the sweep that found them also turned up `.claude/commands/
 * feature.md` sending every `/feature` run to an "Editorial Design Standard"
 * section of CLAUDE.md that has NEVER existed there (it lives in
 * `docs/claude/loading-standards.md`). A missing prompt input fails silently
 * and the output still looks plausible, so it survived unnoticed indefinitely.
 *
 * Two assertions, both cheap:
 *   1. Every `CLAUDE.md "<Title>"` citation names text that is actually in
 *      CLAUDE.md.
 *   2. Every `docs/claude/rules/<file>.md` path referenced anywhere resolves
 *      to a file that exists.
 */

const ROOT = process.cwd();

/**
 * Live code and config — the places where a dangling pointer misleads someone
 * (or something) doing work right now.
 */
const SCAN_DIRS = [
  'src',
  'scripts',
  'tests',
  '.github/workflows',
  '.claude/agents',
  '.claude/commands',
  '.claude/skills',
  'docs/claude/rules',
];

/** Repo-root docs that route agents and external reviewers. */
const SCAN_ROOT_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'];

const SCAN_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.astro', '.yml', '.yaml', '.md'];

/**
 * Historical records are deliberately NOT scanned. `docs/claude/insights/`,
 * `docs/plans/`, `docs/features/` and `.claude/plans/` are dated journals —
 * they record what CLAUDE.md said at the time, and rewriting them to track a
 * later reorganization would falsify the record.
 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', '.vercel', 'insights', 'plans']);

/**
 * Citations that are intentionally dangling, with the reason. Both predate the
 * router split: they quote a CLAUDE.md rule *as it used to be worded* in order
 * to explain why that rule was wrong. Repointing them at current text would
 * destroy the correction they document.
 */
const ALLOWLIST: Array<{ quote: string; why: string }> = [
  {
    quote: 'over-matching is the safe direction',
    why: 'schefter-rumor-scan.mjs + its test quote the superseded redaction rule to explain why it was wrong ("[a team]" is a semantic insertion, not a fuzz)',
  },
  {
    quote: 'Commish credentials restricted to contracts only',
    why: 'throwback-preference.ts cites a CLAUDE.md rule that predates the router split and has no current equivalent; the auth constraint it describes is still enforced in the route itself',
  },
  {
    quote: "don't reinvent it inline",
    why: 'roger-notify.mjs quotes an older CLAUDE.md phrasing that was reworded before the router split',
  },
];

const ALLOWED = new Set(ALLOWLIST.map((a) => a.quote));

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCAN_EXTENSIONS.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const SELF = 'tests/claude-md-references.test.ts';

const files = [
  ...SCAN_DIRS.flatMap((d) => walk(join(ROOT, d))),
  ...SCAN_ROOT_FILES.map((f) => join(ROOT, f)).filter((f) => existsSync(f)),
]
  .map((f) => relative(ROOT, f))
  .filter((f) => f !== SELF);

const claudeMd = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');

/**
 * A citation is `CLAUDE.md` followed within a short window by a quoted title.
 * The window keeps us from pairing an unrelated later quote further down.
 *
 * Citations wrap across lines — a comment reads `CLAUDE.md →\n * "Some Title"`
 * — so the pattern must cross newlines, and comment gutters (` * `, `# `, `// `)
 * have to come off first or they end up inside the captured title. An earlier
 * newline-free version of this regex silently passed three genuinely dangling
 * citations that happened to wrap (`rules-qa-flags.ts`, `roger-notify.mjs`,
 * `lineup-submit-state.ts`).
 *
 * The gap must be CONNECTORS ONLY (`'s`, `\u2192`, `:`, `(`, `,`, dashes) — never
 * sentence text. A window that merely counted characters paired "(CLAUDE.md
 * rule)." in a workflow header with a cron string two lines below it.
 */
const CITATION = /CLAUDE\.md`?(?:['\u2019]s)?\s*(?:[\u2192:,(\-\u2014]\s*)*"([^"]{3,120})"/g;

/** Strip line-leading comment gutters so a wrapped citation reads as prose. */
const degutter = (s: string) => s.replace(/^[ \t]*(?:\*|\/\/|#)[ \t]?/gm, '');

/** Whitespace-insensitive: CLAUDE.md wraps prose, citations usually don't. */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const claudeFlat = flat(claudeMd);

describe('CLAUDE.md cross-references', () => {
  it('every cited CLAUDE.md section actually exists in CLAUDE.md', () => {
    const dangling: string[] = [];

    for (const file of files) {
      const raw = readFileSync(join(ROOT, file), 'utf8');
      const body = degutter(raw);
      for (const match of body.matchAll(CITATION)) {
        const quote = match[1];
        if (ALLOWED.has(quote)) continue;
        if (claudeFlat.includes(flat(quote))) continue;

        const line = body.slice(0, match.index).split('\n').length;
        dangling.push(`${file}:${line} cites CLAUDE.md "${quote}" — no such text in CLAUDE.md`);
      }
    }

    expect(
      dangling,
      'A citation pointing at a CLAUDE.md section that no longer exists sends the ' +
        'reader nowhere, and they re-derive the rule from scratch — usually wrong. ' +
        'Either repoint it at the docs/claude/rules/ file the section moved to, or ' +
        'add it to ALLOWLIST with a reason if it deliberately quotes superseded text.',
    ).toEqual([]);
  });

  it('every referenced docs/claude/rules/ file exists', () => {
    const broken: string[] = [];
    const RULES_PATH = /docs\/claude\/rules\/([a-z0-9-]+\.md)/g;

    for (const file of files) {
      const body = readFileSync(join(ROOT, file), 'utf8');
      for (const match of body.matchAll(RULES_PATH)) {
        const target = join(ROOT, 'docs/claude/rules', match[1]);
        if (existsSync(target)) continue;
        const line = body.slice(0, match.index).split('\n').length;
        broken.push(`${file}:${line} → docs/claude/rules/${match[1]} does not exist`);
      }
    }

    expect(broken, 'A rules doc was renamed or deleted without updating its pointers.').toEqual([]);
  });

  it("CLAUDE.md's router table points at rules files that exist", () => {
    // The "Read before you touch" table is the entry point for every domain.
    // A typo here is worse than a broken comment: it misroutes every session.
    const rows = [...claudeMd.matchAll(/\|\s*`(docs\/claude\/rules\/[a-z0-9-]+\.md)`\s*\|/g)];
    expect(rows.length, 'router table has no rules-doc rows — did the table format change?').toBeGreaterThan(5);

    const missing = rows.map((r) => r[1]).filter((p) => !existsSync(join(ROOT, p)));
    expect(missing, 'router table points at a rules doc that does not exist').toEqual([]);
  });
});
