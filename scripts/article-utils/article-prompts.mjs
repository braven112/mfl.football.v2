/**
 * Column prompts — the article types' and the Pecking Order's own text.
 *
 * What each column asks the writer for (the Saturday preview's shape, the
 * grading rubric, the Pecking Order's voice rules) is part of the reporter's
 * trade secret and lives in the PRIVATE beat-reporter pack at
 * `prompts/articles/<type>.system.md` and `<type>.user.md`
 * (scripts/lib/beat-reporter-pack.mjs). The general house rules every column
 * shares (BASE_SYSTEM_PROMPT in ai-client.mjs) stay public.
 *
 * A missing prompt FAILS CLOSED: `articlePrompt` throws MissingPromptError and
 * the runner skips the column (schefter-weekly-articles) or keeps the
 * templated voice (generate-pecking-order). A column written without its
 * rules is worse than no column.
 *
 * A user prompt carries `{{FACT_SHEET}}` (and the Pecking Order's
 * `{{FRANCHISE_COUNT}}`). Placeholders are filled in ONE pass, so a fact
 * sheet that happens to contain `{{…}}` or `$&` is inserted verbatim.
 */

import { readPackText } from '../lib/beat-reporter-pack.mjs';

export class MissingPromptError extends Error {
  constructor(rel) {
    super(`private column prompt ${rel} is unavailable`);
    this.name = 'MissingPromptError';
    this.rel = rel;
  }
}

/** @type {(rel: string) => string | null} */
let reader = (rel) => readPackText(rel);

/**
 * Test seam: read prompts from somewhere else (a stub, for tests that check
 * structure rather than wording). Returns a function that restores the reader.
 *
 * @param {(rel: string) => string | null} fn
 */
export function setArticlePromptReader(fn) {
  const previous = reader;
  reader = fn;
  return () => { reader = previous; };
}

/**
 * One column prompt, filled.
 *
 * @param {string} type   e.g. 'matchup-preview', 'pecking-order'
 * @param {'system' | 'user'} part
 * @param {Record<string, string | number>} [vars]
 * @returns {string}  A system prompt comes back with the leading blank line
 *   buildCachedSystem expects (the pack's reader trims it off).
 */
export function articlePrompt(type, part, vars = {}) {
  const rel = `prompts/articles/${type}.${part}.md`;
  const text = reader(rel);
  if (!text) throw new MissingPromptError(rel);
  const filled = text.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!(key in vars)) throw new Error(`${rel}: no value for {{${key}}}`);
    return String(vars[key]);
  });
  return part === 'system' ? `\n\n${filled}` : filled;
}
