import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

/**
 * League-literal guardrail (refactor Phase 3).
 *
 * Scans src/ + scripts/ + .github/workflows/ for the league constants that
 * caused real bugs before the registry sweep (Phases 1-2): the MFL numeric
 * ids and hosts. It also scans for the two leagues' data-directory literals,
 * with a structural exemption for legitimate file-path references (Vite
 * import.meta.glob, static imports, path.join/readFile-style calls, and
 * template-literal glob-key reconstruction) — see "Design notes" below.
 *
 * `src/config/leagues-data.mjs` is the registry itself and is always exempt.
 * Everything else must either (a) not contain the literal, or (b) be listed
 * in ALLOWLIST with a one-line reason.
 */

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Forbidden literals
// ---------------------------------------------------------------------------

/**
 * MFL numeric league ids and hosts. These are checked everywhere (including
 * workflow YAML) with NO structural exemption — every historical bug this
 * refactor fixed (wrong host fallback, id-based ternaries) was one of these
 * four literals, so they stay strict.
 */
const ID_HOST_LITERALS = ['13522', '19621', '37610', 'www49.myfantasyleague', 'www44.myfantasyleague'];

/**
 * League data-directory literals. Checked only in src/ + scripts/ (not
 * workflow YAML — see "Workflow YAML" design note). These are syntactically
 * only ever found inside string/template literals (they contain `/`, which
 * can't appear in bare JS), so the interesting question isn't "is this in a
 * string" (always true) but "is this string a legitimate file-path
 * reference, or a hardcoded league-selection literal that should have come
 * from the registry?" See STRUCTURAL_MARKERS below for how we approximate
 * that distinction without a full parser.
 */
const DATA_PATH_LITERALS: Array<{ name: string; regex: RegExp }> = [
  { name: 'data/theleague', regex: /data\/theleague/g },
  { name: 'data/afl-fantasy', regex: /data\/afl-fantasy/g },
  // Bare 'data/afl' (no '-fantasy'), e.g. a typo'd or legacy directory.
  // Negative lookahead so this doesn't double-count data/afl-fantasy hits.
  { name: 'data/afl (bare)', regex: /data\/afl(?!-fantasy)/g },
  { name: 'data/best-ball-1', regex: /data\/best-ball-1/g },
];

/** The registry itself — the only unconditionally allowed source. */
const REGISTRY_FILE = 'src/config/leagues-data.mjs';

/**
 * Explicit, documented allowlist for structural cases that the automatic
 * exemptions below don't (or can't cleanly) cover. Keep this SHORT — every
 * entry must have a real, specific reason; if a file can be fixed instead,
 * fix it (see the refactor PR for cases that WERE fixed rather than
 * allowlisted: TheLeagueLayout.astro, HpUnsignedFaCard.astro, and ~15 other
 * src/components/** files that had literal leagueId/mflHost prop defaults or
 * hardcoded player-photo fallback URLs).
 *
 * Scoped by `literals` (not just `file`): a file being allowlisted only
 * exempts the SPECIFIC literal(s) named, not the whole file. A stray new
 * literal added anywhere else in an allowlisted file — e.g. a copy-pasted
 * host string riding along with an already-justified id — still fails the
 * guard and needs its own entry (code review caught this: a file-wide
 * exemption would have silently covered roster-sync.yml's second literal,
 * '19621', even though the allowlist reason only discussed '13522').
 */
const ALLOWLIST: Array<{ file: string; literals: string[]; reason: string }> = [
  {
    file: '.github/workflows/roster-sync.yml',
    literals: ['13522', '19621'],
    reason:
      "fetch-mfl-feeds.mjs requires a non-empty MFL_LEAGUE_ID with no registry fallback (unlike apply-pending-contracts.mjs / sync-draft-pick-contracts.mjs, which do fall back to DEFAULT_LEAGUE_ID). Workflow YAML can't import src/config/leagues-data.mjs, so literal ids are the one documented exception here — theleague's ('13522') via vars.MFL_LEAGUE_ID override, AFL's ('19621') bare in the per-league bash array — kept in sync with LEAGUES.*.id by convention (see inline workflow comment).",
  },
  {
    file: '.github/workflows/schefter-trade-speculation.yml',
    literals: ['13522'],
    reason:
      "fetch-trade-bait.mjs requires a non-empty MFL_LEAGUE_ID with no registry fallback, same reasoning as roster-sync.yml above.",
  },
  {
    file: 'scripts/backfill-afl-championship-history.mjs',
    literals: ['data/theleague'],
    reason:
      "the literal appears inside a human-readable $comment string written into the output JSON ('Mirrors data/theleague/championship-history.json shape') — descriptive text about file shape, not a code path dependency.",
  },
  {
    file: 'src/pages/theleague/insights.astro',
    literals: ['data/theleague'],
    reason:
      "the 'AI Insights Corpus' dev-notes page — its body is prose documentation of engineering learnings for readers, including illustrative file-path examples in <code> tags. Not executable business logic.",
  },
  {
    file: 'src/utils/schefter-og.ts',
    literals: ['data/theleague', 'data/afl-fantasy'],
    reason:
      "FEED_PATHS maps league slug to its committed schefter-feed.json location, which is asymmetric — theleague's bundled copy lives under src/data/theleague/ (for static import elsewhere) while afl-fantasy's lives at the data/afl-fantasy/ root — so it isn't derivable from the single dataPath registry field. Not caught by a nearby call-site marker since it's a plain object literal, not a function argument.",
  },
];

// ---------------------------------------------------------------------------
// Directory walk
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.astro', '.mjs', '.js']);
const WORKFLOW_EXTENSIONS = new Set(['.yml', '.yaml']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', '.vercel']);

function walk(baseDir: string, extensions: Set<string>): string[] {
  const abs = join(ROOT, baseDir);
  const results: string[] = [];
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(abs, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...walk(relative(ROOT, full), extensions));
    } else if (extensions.has(extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Comment / regex-literal-aware stripping
// ---------------------------------------------------------------------------

const REGEX_PRECEDER_CHARS = new Set(['(', ',', '=', ':', ';', '!', '&', '|', '?', '{', '[', '\n', '']);
const REGEX_PRECEDER_WORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await',
]);

function isIdentChar(c: string): boolean {
  return /[A-Za-z0-9_$]/.test(c);
}

/**
 * Strips `//` and `/* *‍/` comments from JS/TS source while leaving string,
 * template, and regex literal *contents* untouched (so a literal like
 * 'www49.myfantasyleague.com' inside a string is preserved for scanning,
 * while the same text inside a comment is removed).
 *
 * Regex literals get special handling: naively toggling "inside a string"
 * on every quote character breaks on patterns like /MFL_USER_ID="([^"]+)"/,
 * whose embedded `"` characters would otherwise desync quote-tracking for
 * the rest of the file. We use the standard lightweight-tokenizer heuristic
 * (a `/` following an operator/keyword/start-of-file is a regex literal;
 * following an identifier/number/closing-bracket/string is division) and,
 * once inside a regex literal, scan for its terminating `/` respecting
 * `\`-escapes and `[...]` character classes (where an unescaped `/` is
 * literal, not a terminator).
 *
 * Newlines are always preserved (even inside stripped comments) so that
 * line numbers computed from the stripped text match the original file.
 */
function stripJsComments(src: string): string {
  const out: string[] = [];
  const n = src.length;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLine = false;
  let inBlock = false;
  let lastSig = '';
  let curWord = '';
  let lastWord = '';

  const flushWord = () => {
    if (curWord) lastWord = curWord;
    curWord = '';
  };

  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : '';

    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out.push(c);
      }
      i++;
      continue;
    }
    if (inBlock) {
      if (c === '*' && c2 === '/') {
        inBlock = false;
        i += 2;
        continue;
      }
      if (c === '\n') out.push(c);
      i++;
      continue;
    }
    if (inSingle) {
      // Defense-in-depth: single/double-quoted strings can't legally
      // contain a literal unescaped newline in JS/TS, so hitting one here
      // means the regex-vs-division heuristic above misjudged something
      // earlier on this line (missed a regex literal, or a preceding-token
      // shape it doesn't recognize) and left us in a fake "inside a
      // string" state. Reset at the newline so the damage is capped to the
      // single line it happened on, instead of silently un-stripping every
      // comment for the rest of the file (the exact failure mode that hid
      // the original src/utils/mfl-login.ts bug — see the scanner
      // self-test below and docs/claude/insights/features/league-literal-guard.md).
      if (c === '\n') {
        inSingle = false;
        out.push(c);
        i++;
        continue;
      }
      out.push(c);
      if (c === '\\') {
        if (i + 1 < n) out.push(src[i + 1]);
        i += 2;
        continue;
      }
      if (c === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '\n') {
        inDouble = false;
        out.push(c);
        i++;
        continue;
      }
      out.push(c);
      if (c === '\\') {
        if (i + 1 < n) out.push(src[i + 1]);
        i += 2;
        continue;
      }
      if (c === '"') inDouble = false;
      i++;
      continue;
    }
    if (inTemplate) {
      out.push(c);
      if (c === '\\') {
        if (i + 1 < n) out.push(src[i + 1]);
        i += 2;
        continue;
      }
      if (c === '`') inTemplate = false;
      i++;
      continue;
    }

    // --- not inside any string/comment state ---
    if (c === '/' && c2 === '/') {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === '/' && c2 === '*') {
      inBlock = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      flushWord();
      inSingle = true;
      out.push(c);
      lastSig = c;
      i++;
      continue;
    }
    if (c === '"') {
      flushWord();
      inDouble = true;
      out.push(c);
      lastSig = c;
      i++;
      continue;
    }
    if (c === '`') {
      flushWord();
      inTemplate = true;
      out.push(c);
      lastSig = c;
      i++;
      continue;
    }
    if (c === '/') {
      flushWord();
      const isRegex =
        REGEX_PRECEDER_CHARS.has(lastSig) ||
        REGEX_PRECEDER_WORDS.has(lastWord) ||
        !(/[)\]}A-Za-z0-9_$'"`]/.test(lastSig));

      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        let foundEnd = false;
        while (j < n) {
          const cj = src[j];
          if (cj === '\\') {
            j += 2;
            continue;
          }
          if (cj === '\n') break;
          if (inClass) {
            if (cj === ']') inClass = false;
            j++;
            continue;
          }
          if (cj === '[') {
            inClass = true;
            j++;
            continue;
          }
          if (cj === '/') {
            foundEnd = true;
            j++;
            break;
          }
          j++;
        }
        if (foundEnd) {
          while (j < n && /[A-Za-z]/.test(src[j])) j++;
          out.push(src.slice(i, j));
          lastSig = '/';
          i = j;
          continue;
        }
        // No closing '/' before a newline — not a valid regex literal,
        // fall through and treat as a division operator character.
      }
      out.push(c);
      lastSig = c;
      i++;
      continue;
    }

    if (/\s/.test(c)) {
      out.push(c);
      flushWord();
      i++;
      continue;
    }
    if (isIdentChar(c)) {
      curWord += c;
      out.push(c);
      lastSig = c;
      i++;
      continue;
    }
    flushWord();
    out.push(c);
    lastSig = c;
    i++;
  }
  return out.join('');
}

/**
 * .astro files mix HTML/template markup with JS (frontmatter + <script>
 * blocks). We only run the JS comment-stripper over the frontmatter fence
 * and <script> blocks; the template/markup section is passed through raw.
 * (Deliberate: naively running the JS stripper over prose text would
 * mis-toggle string state on stray apostrophes like "owner's".)
 */
function stripAstroComments(content: string): string {
  const regions: Array<[number, number]> = [];
  if (content.startsWith('---')) {
    const closeIdx = content.indexOf('\n---', 3);
    if (closeIdx !== -1) regions.push([0, closeIdx + 4]);
  }
  const scriptRe = /<script[^>]*>[\s\S]*?<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(content))) {
    regions.push([m.index, m.index + m[0].length]);
  }
  regions.sort((a, b) => a[0] - b[0]);

  let out = '';
  let cursor = 0;
  for (const [s, e] of regions) {
    if (s < cursor) continue;
    out += content.slice(cursor, s);
    out += stripJsComments(content.slice(s, e));
    cursor = e;
  }
  out += content.slice(cursor);
  return out;
}

/** YAML `#` comments, respecting quoted strings. Line-oriented, like YAML. */
function stripYamlComments(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inSingle) {
          if (c === "'") inSingle = false;
          continue;
        }
        if (inDouble) {
          if (c === '"') inDouble = false;
          continue;
        }
        if (c === "'") {
          inSingle = true;
          continue;
        }
        if (c === '"') {
          inDouble = true;
          continue;
        }
        if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

function stripComments(content: string, ext: string): string {
  if (ext === '.yml' || ext === '.yaml') return stripYamlComments(content);
  if (ext === '.astro') return stripAstroComments(content);
  return stripJsComments(content);
}

// ---------------------------------------------------------------------------
// Structural exemption for data-path literals
// ---------------------------------------------------------------------------

/**
 * Design note: data-path literals can only occur inside a string/template
 * literal (they contain `/`), and in this codebase every legitimate use is
 * exactly that: a Vite `import.meta.glob(...)` pattern or its reconstructed
 * object key, a static `import ... from '...'`, or an argument to a
 * file-I/O-ish call (path.join, readFileSync, a local readJsonFile-style
 * helper, etc). We approximate "is this legitimate" with two checks:
 *
 *  1. A nearby (same-statement-ish window) call/import marker — covers
 *     import specifiers, import.meta.glob (including generic-typed
 *     `import.meta.glob<T>(...)`), path.join/resolve, and any function
 *     whose name contains a file-I/O-flavored word (read/write/load/save/
 *     json/glob/fetch/feed/path).
 *  2. The literal sits inside a template literal that also contains a
 *     `${` interpolation — covers the `feeds[\`.../mfl-feeds/${year}/x.json\`]`
 *     glob-result-key-reconstruction pattern used on several pages.
 *
 * This is a heuristic, not a parser. It errs toward NOT flagging legitimate
 * file paths (verified empirically: it exempts every real occurrence in the
 * current tree except the ALLOWLIST entries above) while still catching
 * the actual historical bug shape — a hardcoded id/host, or a literal
 * embedded directly in business logic (e.g. a ternary) with no nearby I/O
 * call. Because the id/host checks above have NO such exemption, a
 * ternary like `leagueId === '19621' ? 'data/afl-fantasy' : 'data/theleague'`
 * is still caught via its '19621' literal even in the (unlikely) case a
 * stray I/O marker sits within the data-path window.
 *
 * The window is 250 chars — measured against every legitimate occurrence in
 * the tree, the single farthest real marker (a multi-line generic-typed
 * `import.meta.glob<{...}>(...)` call) needs ~213. src/utils/schefter-og.ts
 * needed ~390 to reach an unrelated `import` statement at the top of the
 * file — that was a coincidental pass, not a real same-statement marker, so
 * it's an explicit ALLOWLIST entry instead of a wider window that would
 * mask real violations elsewhere.
 */
const STRUCTURAL_MARKERS = [
  'readfile', 'writefile', 'readjson', 'loadjson', 'savejson',
  'path.join', 'path.resolve', 'join(', 'resolve(', 'import.meta.glob',
  "from '", 'from "', 'from `', 'require(', 'import(', 'readdir',
  'existssync', 'fetch(', 'mkdir', 'unlink', 'createreadstream',
  'createwritestream', 'json.parse', 'json.stringify',
];
const STRUCTURAL_WINDOW = 250;

/**
 * True when `matchIndex` sits strictly inside a template literal that also
 * contains a `${` interpolation somewhere in that same literal.
 *
 * Uses backtick parity (not a nearest-backtick search) to find the
 * enclosing literal: code review caught that a naive
 * `lastIndexOf('\`')` / `indexOf('\`')` pair can span from an unrelated
 * template literal *before* the match to a different, also-unrelated one
 * *after* it — and if a `${` happens to appear anywhere in that spanned
 * text (e.g. inside an ordinary string like `'Use ${variable} syntax'`
 * sitting between the two literals), the match gets wrongly exempted even
 * though it isn't inside any template literal at all. Counting backticks
 * before the match tells us definitively whether we're inside one (odd
 * count) or not (even count), and — if inside — exactly which pair of
 * backticks encloses it.
 */
function isInsideInterpolatedTemplateLiteral(stripped: string, matchIndex: number): boolean {
  let count = 0;
  let lastOpen = -1;
  for (let i = 0; i < matchIndex; i++) {
    if (stripped[i] === '`') {
      count++;
      if (count % 2 === 1) lastOpen = i;
    }
  }
  if (count % 2 !== 1) return false; // not inside any template literal
  const close = stripped.indexOf('`', matchIndex);
  if (close === -1) return false;
  return stripped.slice(lastOpen, close + 1).includes('${');
}

function isStructurallyExempt(stripped: string, matchIndex: number): boolean {
  const windowStart = Math.max(0, matchIndex - STRUCTURAL_WINDOW);
  const window = stripped.slice(windowStart, matchIndex).toLowerCase();
  if (STRUCTURAL_MARKERS.some((marker) => window.includes(marker))) return true;

  return isInsideInterpolatedTemplateLiteral(stripped, matchIndex);
}

// ---------------------------------------------------------------------------
// Core scan
// ---------------------------------------------------------------------------

interface Violation {
  file: string;
  line: number;
  pattern: string;
}

function lineOf(stripped: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (stripped[i] === '\n') line++;
  }
  return line;
}

function findViolations(
  stripped: string,
  opts: { checkDataPaths: boolean },
): Array<{ pattern: string; index: number }> {
  const found: Array<{ pattern: string; index: number }> = [];

  for (const literal of ID_HOST_LITERALS) {
    let idx = stripped.indexOf(literal);
    while (idx !== -1) {
      found.push({ pattern: literal, index: idx });
      idx = stripped.indexOf(literal, idx + 1);
    }
  }

  if (opts.checkDataPaths) {
    for (const { name, regex } of DATA_PATH_LITERALS) {
      const re = new RegExp(regex.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(stripped))) {
        if (!isStructurallyExempt(stripped, m.index)) {
          found.push({ pattern: name, index: m.index });
        }
      }
    }
  }

  return found;
}

function scanRepo(): Violation[] {
  const violations: Violation[] = [];
  const codeFiles = [...walk('src', CODE_EXTENSIONS), ...walk('scripts', CODE_EXTENSIONS)];
  const workflowFiles = walk('.github/workflows', WORKFLOW_EXTENSIONS);

  // Literal-scoped, not file-wide: an allowlisted file is still scanned, and
  // only the specific literals its entry excuses are ignored — a NEW forbidden
  // literal added to an allowlisted file is still reported.
  const allowedLiterals = new Map(ALLOWLIST.map((a) => [a.file, new Set(a.literals)]));

  for (const absPath of [...codeFiles, ...workflowFiles]) {
    const rel = relative(ROOT, absPath).split('\\').join('/');
    if (rel === REGISTRY_FILE) continue;

    const ext = extname(absPath);
    const raw = readFileSync(absPath, 'utf8');
    const stripped = stripComments(raw, ext);
    const isWorkflow = WORKFLOW_EXTENSIONS.has(ext);
    const excused = allowedLiterals.get(rel);

    const hits = findViolations(stripped, { checkDataPaths: !isWorkflow });
    for (const hit of hits) {
      if (excused?.has(hit.pattern)) continue;
      violations.push({ file: rel, line: lineOf(stripped, hit.index), pattern: hit.pattern });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('league literal guard', () => {
  it('has no unregistered league id/host/data-path literals in src/, scripts/, or .github/workflows/', () => {
    const violations = scanRepo();
    if (violations.length > 0) {
      const formatted = violations
        .map((v) => `  ${v.file}:${v.line}  contains forbidden literal "${v.pattern}"`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} hardcoded league literal(s) outside the registry ` +
          `(src/config/leagues-data.mjs). Import from the registry instead, or if this is a ` +
          `genuine structural exception, add a justified entry to ALLOWLIST in ` +
          `tests/league-literal-guard.test.ts:\n${formatted}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('every ALLOWLIST entry still exists and still contains the literal it excuses', () => {
    // Guards against a stale allowlist entry silently surviving after the
    // underlying file was fixed or deleted.
    for (const entry of ALLOWLIST) {
      const absPath = join(ROOT, entry.file);
      let raw: string;
      try {
        raw = readFileSync(absPath, 'utf8');
      } catch {
        throw new Error(`ALLOWLIST entry "${entry.file}" no longer exists — remove it.`);
      }
      const ext = extname(absPath);
      const stripped = stripComments(raw, ext);
      const isWorkflow = WORKFLOW_EXTENSIONS.has(ext);
      const hits = findViolations(stripped, { checkDataPaths: !isWorkflow });
      const present = new Set(hits.map((h) => h.pattern));
      for (const literal of entry.literals) {
        expect(
          present.has(literal),
          `ALLOWLIST entry "${entry.file}" excuses "${literal}" but the file no longer ` +
            `contains it — remove the literal from (or the whole) entry.`,
        ).toBe(true);
      }
    }
  });
});

describe('league literal guard — scanner self-test', () => {
  // Proves the scanner actually catches the historical bug shapes (never
  // touches real files — pure function calls against synthetic snippets).
  // Also serves as the durable version of the "seed a violation, watch it
  // fail" verification step from the refactor plan.

  it('flags a hardcoded id fallback (the roster-constants.ts-style bug)', () => {
    const src = stripJsComments("const leagueId = user.leagueId || '13522';");
    const hits = findViolations(src, { checkDataPaths: true });
    expect(hits.map((h) => h.pattern)).toContain('13522');
  });

  it('flags a hardcoded host fallback (the playoffs.astro-style bug)', () => {
    const src = stripJsComments("const mflHost = host || 'www49.myfantasyleague.com';");
    const hits = findViolations(src, { checkDataPaths: true });
    expect(hits.map((h) => h.pattern)).toContain('www49.myfantasyleague');
  });

  it('flags an id-selected data-dir ternary (the "4 scripts reimplement the id→slug ternary" bug)', () => {
    const src = stripJsComments(
      "const dataDir = leagueId === '19621' ? 'data/afl-fantasy' : 'data/theleague';",
    );
    const hits = findViolations(src, { checkDataPaths: true });
    const patterns = hits.map((h) => h.pattern);
    expect(patterns).toContain('19621');
    expect(patterns).toContain('data/afl-fantasy');
    expect(patterns).toContain('data/theleague');
  });

  it('flags a bare "data/afl" typo without exempting it as data/afl-fantasy', () => {
    const src = stripJsComments("const p = 'data/afl/afl.config.json';");
    const hits = findViolations(src, { checkDataPaths: true });
    expect(hits.map((h) => h.pattern)).toContain('data/afl (bare)');
  });

  it('does not flag the registry-derived id used correctly', () => {
    const src = stripJsComments("const leagueId = DEFAULT_LEAGUE_ID;");
    const hits = findViolations(src, { checkDataPaths: true });
    expect(hits).toEqual([]);
  });

  it('does not flag a static import of a bundled per-league data file', () => {
    const src = stripJsComments("import feedData from '../../data/theleague/schefter-feed.json';");
    const hits = findViolations(src, { checkDataPaths: true });
    expect(hits).toEqual([]);
  });

  it('does not flag a generic-typed import.meta.glob call', () => {
    const src = stripJsComments(
      "const g = import.meta.glob<{ default: unknown }>('../../data/afl-fantasy/championship-history.json', { eager: true });",
    );
    const hits = findViolations(src, { checkDataPaths: true });
    expect(hits).toEqual([]);
  });

  it('does not flag a path.join call building a fetch-pipeline data path', () => {
    const src = stripJsComments(
      "const p = path.join(root, 'data/theleague/mfl-feeds/2025/standings.json');",
    );
    const hits = findViolations(src, { checkDataPaths: true });
    expect(hits).toEqual([]);
  });

  it('does not flag a glob-result key reconstructed via a template literal', () => {
    const src = stripJsComments(
      "const feed = standingsFeeds[`../../../data/afl-fantasy/mfl-feeds/${y}/standings.json`];",
    );
    const hits = findViolations(src, { checkDataPaths: true });
    expect(hits).toEqual([]);
  });

  it('still flags a business-logic literal sitting between two UNRELATED template literals (code review regression)', () => {
    // Code review (GitHub Copilot) caught that a naive nearest-backtick
    // search for the template-literal exemption could span from an
    // unrelated template literal *before* the match to a different,
    // unrelated one *after* it — and if an ordinary string containing the
    // literal text "${" happens to sit in that gap, the match got wrongly
    // exempted even though it isn't inside any template literal at all.
    // This reproduces that exact false-negative and asserts it's fixed.
    const src = stripJsComments(
      [
        'const a = `foo`;',
        "const label = 'Use ${variable} syntax';",
        "const dataDir = leagueId === '19621' ? 'data/afl-fantasy' : 'data/theleague';",
        'const b = `bar`;',
      ].join('\n'),
    );
    const hits = findViolations(src, { checkDataPaths: true });
    const patterns = hits.map((h) => h.pattern);
    expect(patterns).toContain('19621');
    expect(patterns).toContain('data/afl-fantasy');
    expect(patterns).toContain('data/theleague');
  });

  it('strips JSDoc/line comments so documentation examples do not trip the guard', () => {
    const src = stripJsComments(
      "/**\n * @param leagueId - e.g. \"13522\"\n */\nfunction f() { return DEFAULT_LEAGUE_ID; }",
    );
    const hits = findViolations(src, { checkDataPaths: true });
    expect(hits).toEqual([]);
  });

  it('does not desync string-tracking on a regex literal containing quote characters', () => {
    // This exact pattern (from src/utils/mfl-login.ts) previously broke a
    // naive quote-toggling stripper: the embedded `"` chars inside the
    // regex literal left the parser stuck in a fake "inside a string"
    // state for the rest of the file, silently un-stripping every
    // subsequent comment (masking real violations AND creating false
    // positives out of documentation text).
    const src = stripJsComments(
      [
        'const cookieMatch = xml.match(/MFL_USER_ID="([^"]+)"/);',
        '/**',
        ' * @param leagueId - League ID to match against (e.g. "13522")',
        ' */',
        'function f() { return DEFAULT_LEAGUE_ID; }',
      ].join('\n'),
    );
    const hits = findViolations(src, { checkDataPaths: true });
    expect(hits).toEqual([]);
  });
});
