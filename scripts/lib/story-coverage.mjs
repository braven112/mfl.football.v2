/**
 * Storybook coverage of the SHARED components — one classifier, read by the
 * report (scripts/story-coverage.mjs) and the guard
 * (tests/story-coverage.test.ts), so the two can never disagree.
 *
 * Every `.astro` / `.tsx` under src/components/shared/ lands in exactly one
 * bucket:
 *
 *   story      a story file imports it directly — it is a story's subject.
 *   covered    no story of its own, but a storied component renders it, so it
 *              is in a snapshot anyway (LvLineup renders LvPlayerRow).
 *   page       a whole page body (`*Page.astro`/`*Page.tsx`). docs/claude/rules/
 *              storybook.md § "Not every component can have a story": these
 *              read feeds, the clock and the session, so args cannot drive them.
 *   dataBound  not a page, but resolves its own data in frontmatter (session,
 *              cookies, feed globs, dynamic imports, the year clocks, fetch) or,
 *              for a React island, fetches at runtime. A frozen fixture only
 *              freezes what a component takes as args (§ "Deleted: the Pecking
 *              Order stories"), so a story of one of these snapshots live data.
 *   nonVisual  renders no element of its own — a <style>/<script> injector
 *              such as ThemeScript or the *DarkStyles sheets. A story would be
 *              a blank canvas.
 *   exempt     presentational by the rules above but cannot take a story for a
 *              reason the fixture records in words. Reviewable, never silent.
 *   backlog    presentational, storyable, no story yet. THE number that
 *              matters: the guard pins it and lets it only shrink.
 *
 * The categories other than `exempt` are DERIVED from the source, never
 * hand-labelled — so a component cannot be waved through as "a page" by
 * editing a list. Hand judgement lives only in `exempt`, with a reason.
 */
import fs from 'node:fs';
import path from 'node:path';

export const SHARED_DIR = 'src/components/shared';
const EXT = ['', '.astro', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'];
const IMPORT_RE = /(?:from\s*|import\s*\(\s*|import\s+)(['"])(\.[^'"\n]+)\1/g;

/** Frontmatter reads that make an `.astro` component resolve its own data. */
const ASTRO_DATA_RE =
  /getAuthUser\(|Astro\.cookies|Astro\.request|Astro\.url|import\.meta\.glob|await import\(|getCurrent(?:Season|League)Year\(|getLeagueYearForSlug\(|\bfetch\(/;
/** A React island that fetches on its own. */
const TSX_DATA_RE = /\bfetch\(|new EventSource\(|new WebSocket\(/;

/**
 * Every file under `dir`, read from DISK rather than `git ls-files`. The index
 * would hide a component or story nobody has `git add`-ed yet, which is
 * exactly the state a new one is in while its author runs this guard.
 */
function walk(root, dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.relative(root, path.join(d.parentPath ?? d.path, d.name)));
}

function resolveSpec(root, fromRel, spec) {
  const base = path.resolve(root, path.dirname(fromRel), spec.split('?')[0]);
  for (const e of EXT) {
    const p = base + e;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return path.relative(root, p);
  }
  return null;
}

function importsOf(root, rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const r = resolveSpec(root, rel, m[2]);
    if (r) out.push(r);
  }
  return out;
}

const isComponent = (f) => /^src\/components\/.+\.(astro|tsx)$/.test(f);

/** The frontmatter of an .astro file (between the first two `---` fences). */
function frontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

/**
 * The element names a template opens, in order — a scan, not a strip.
 *
 * A <script>/<style> body is skipped whole (matched case-insensitively), so a
 * `'<div>'` string inside a client script is not read as markup; so are HTML
 * and JSX comments. Written as a walk rather than as chained `.replace()`
 * calls on purpose: removing tag-shaped spans with regexes is the
 * "incomplete multi-character sanitization" pattern CodeQL flags, and it also
 * missed an upper-case `<SCRIPT>`. Nothing here sanitizes anything — the input
 * is this repo's own source and the output is a list of names.
 */
function templateTags(src) {
  const body = src.replace(/^---\r?\n[\s\S]*?\r?\n---/, '');
  const lower = body.toLowerCase();
  const tags = [];
  let i = 0;
  while (i < body.length) {
    const lt = body.indexOf('<', i);
    const jsxComment = body.indexOf('{/*', i);
    if (jsxComment !== -1 && (lt === -1 || jsxComment < lt)) {
      const end = body.indexOf('*/}', jsxComment + 3);
      i = end === -1 ? body.length : end + 3;
      continue;
    }
    if (lt === -1) break;
    if (body.startsWith('<!--', lt)) {
      const end = body.indexOf('-->', lt + 4);
      i = end === -1 ? body.length : end + 3;
      continue;
    }
    const m = /^<([A-Za-z][\w.-]*)/.exec(body.slice(lt, lt + 64));
    if (!m) {
      i = lt + 1;
      continue;
    }
    tags.push(m[1]);
    const name = m[1].toLowerCase();
    if (name === 'script' || name === 'style') {
      const close = lower.indexOf(`</${name}`, lt + m[0].length);
      i = close === -1 ? body.length : close + name.length + 2;
      continue;
    }
    i = lt + m[0].length;
  }
  return tags;
}

/** True when the template renders no element besides style/script. */
function rendersNothing(src) {
  return templateTags(src).every((t) => t === 'Fragment' || /^(style|script)$/i.test(t));
}

export function classify(file, src) {
  if (/Page\.(astro|tsx)$/.test(file)) return 'page';
  if (file.endsWith('.astro')) {
    if (rendersNothing(src)) return 'nonVisual';
    if (ASTRO_DATA_RE.test(frontmatter(src))) return 'dataBound';
    return null;
  }
  if (TSX_DATA_RE.test(src)) return 'dataBound';
  return null;
}

/**
 * @param {string} root repo root
 * @param {{ exempt?: Record<string, string> }} [opts]
 * @returns {{ buckets: Record<string, string[]>, byFile: Record<string, string> }}
 */
export function measureStoryCoverage(root, opts = {}) {
  const exempt = opts.exempt ?? {};
  const shared = walk(root, SHARED_DIR).filter((f) => /\.(astro|tsx)$/.test(f));
  const stories = walk(root, 'stories').filter((f) => /\.(ts|tsx|js|jsx|mdx|astro)$/.test(f));

  const direct = new Set();
  for (const s of stories) for (const t of importsOf(root, s)) if (isComponent(t)) direct.add(t);

  // Everything a storied component renders, transitively, is in a snapshot.
  const covered = new Set();
  const queue = [...direct];
  while (queue.length) {
    const f = queue.pop();
    for (const t of importsOf(root, f)) {
      if (!isComponent(t) || direct.has(t) || covered.has(t)) continue;
      covered.add(t);
      queue.push(t);
    }
  }

  const buckets = { story: [], covered: [], page: [], dataBound: [], nonVisual: [], exempt: [], backlog: [] };
  const byFile = {};
  for (const f of shared.sort()) {
    let b;
    if (direct.has(f)) b = 'story';
    else if (covered.has(f)) b = 'covered';
    else b = classify(f, fs.readFileSync(path.join(root, f), 'utf8')) ?? (f in exempt ? 'exempt' : 'backlog');
    buckets[b].push(f);
    byFile[f] = b;
  }
  return { buckets, byFile };
}
