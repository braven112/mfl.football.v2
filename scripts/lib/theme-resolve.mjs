/**
 * Resolve a theme's values to what the browser computes on <html>.
 *
 * A theme value may be a var() of one of the theme's own tokens or of a shared
 * default (tokens.css `:root`, plus tokens-dark.css `html.dark` in dark), so
 * the file says `var(--league-palette-accent)` where the page renders
 * `#44aaff`. Anything that needs the colour itself — a contrast check, a test
 * pinning a value, the theme review page — reads it through here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function declsUnder(rel, selector) {
  const out = new Map();
  postcss.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')).walkRules((rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls((d) => {
      if (d.prop.startsWith('--')) out.set(d.prop, d.value);
    });
  });
  return out;
}

let shared;
/** The shared defaults each mode starts from, before any theme. */
export function sharedDefaults() {
  if (!shared) {
    const light = declsUnder('src/styles/tokens.css', ':root');
    shared = { light, dark: new Map([...light, ...declsUnder('src/styles/tokens-dark.css', 'html.dark')]) };
  }
  return shared;
}

function topLevelComma(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) return i;
  }
  return -1;
}

/** Substitute every var() in `value` from `scope`; null if one cannot resolve. */
export function substitute(value, scope, seen = new Set()) {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf('var(', i);
    if (start < 0) return (out + value.slice(i)).trim();
    out += value.slice(i, start);
    let depth = 0;
    let end = start + 3;
    for (; end < value.length; end++) {
      if (value[end] === '(') depth++;
      else if (value[end] === ')' && --depth === 0) break;
    }
    const inner = value.slice(start + 4, end);
    const comma = topLevelComma(inner);
    const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma < 0 ? null : inner.slice(comma + 1).trim();
    let resolved = null;
    if (scope.has(name) && !seen.has(name)) resolved = substitute(scope.get(name), scope, new Set([...seen, name]));
    if (resolved == null && fallback != null) resolved = substitute(fallback, scope, seen);
    if (resolved == null) return null;
    out += resolved;
    i = end + 1;
  }
  return out.trim();
}

/**
 * token → resolved value (null where the theme leaves it unset) for one mode.
 * @param {{ light: Record<string, string | null>, dark: Record<string, string | null> }} theme
 * @param {'light' | 'dark'} mode
 * @returns {Record<string, string | null>}
 */
export function resolveTheme(theme, mode) {
  const scope = new Map(sharedDefaults()[mode]);
  for (const [token, value] of Object.entries(theme[mode])) {
    if (value == null) scope.delete(token);
    else scope.set(token, value);
  }
  /** @type {Record<string, string | null>} */
  const out = {};
  for (const [token, value] of Object.entries(theme[mode])) {
    out[token] = value == null ? null : substitute(value, scope, new Set([token]));
  }
  return out;
}
