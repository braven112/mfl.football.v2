/**
 * Specifiers that compile data into the Vercel function: `import.meta.glob`s
 * over data paths and static/dynamic imports of a data JSON. Shared by the
 * guards that keep league data out of the bundle
 * (tests/league-data-store.test.ts, tests/sync-published-reads.test.ts).
 */
const GLOB_RE = /import\.meta\.glob(?:<[^>]*>)?\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|`[^`]*`)/g;
const STATIC_IMPORT_RE = /(?:^|\n)\s*import\s+[^'"`;]*?from\s+['"]([^'"]+\.json)['"]/g;
// `typeof import('…json')` is a type and erased at build, so it is not a read.
const DYNAMIC_IMPORT_RE = /(?<!typeof\s+)\bimport\(\s*['"]([^'"]+\.json)['"]\s*\)/g;
const isDataPath = (spec) => /(^|\/)data\//.test(spec);

/**
 * Every bundled data specifier in `text`, as written (quotes and array
 * brackets of a glob included).
 * @param {string} text
 * @returns {string[]}
 */
export function bundledDataReads(text) {
  const out = [];
  for (const m of text.matchAll(GLOB_RE)) if (isDataPath(m[1])) out.push(m[1]);
  for (const m of text.matchAll(STATIC_IMPORT_RE)) if (isDataPath(m[1])) out.push(m[1]);
  for (const m of text.matchAll(DYNAMIC_IMPORT_RE)) if (isDataPath(m[1])) out.push(m[1]);
  return out;
}

/**
 * The repo-relative glob(s) one specifier reads, resolved against the file
 * that wrote it. A glob array yields one entry per element.
 * @param {string} spec as returned by bundledDataReads
 * @param {string} fromFile repo-relative path of the importing file
 * @returns {string[]}
 */
export function resolveDataSpecifier(spec, fromFile) {
  const parts = spec.startsWith('[') ? [...spec.matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]) : [spec.replace(/^['"`]|['"`]$/g, '')];
  const dir = fromFile.split('/').slice(0, -1);
  return parts.map((p) => {
    const segs = p.startsWith('/') ? p.slice(1).split('/') : [...dir, ...p.split('/')];
    const out = [];
    for (const s of segs) {
      if (s === '..') out.pop();
      else if (s !== '.' && s !== '') out.push(s);
    }
    return out.join('/');
  });
}
