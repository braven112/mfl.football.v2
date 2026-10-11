/**
 * Every Haiku call reads its model from src/utils/claude-models.mjs, so an
 * upgrade is one line. Haiku 5.5 also rejects what 4.5 accepted: a
 * `temperature`/`top_p`/`top_k` is a 400, thinking is on unless the request
 * turns it off, and the answer is not always `content[0]`. These scans keep
 * a call site from regrowing any of that.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { HAIKU_MODEL, HAIKU_THINKING, responseText } from '../src/utils/claude-models.mjs';

const ROOT = join(__dirname, '..');
const MODULE = 'src/utils/claude-models.mjs';
const SCAN = ['src', 'scripts', 'tests', '.github'];
const SKIP = /(^|\/)(node_modules|data|fixtures)(\/|$)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p);
    if (SKIP.test(rel)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m?js|ts|astro|ya?ml)$/.test(name)) out.push(rel);
  }
  return out;
}

const files = SCAN.flatMap((d) => walk(join(ROOT, d)));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const self = relative(ROOT, __filename);

describe('Claude model registry', () => {
  it('no file names a Haiku model id except the registry', () => {
    const offenders = files.filter(
      (f) => f !== MODULE && f !== self && /['"`]claude-haiku-[\w.@-]+['"`]/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('a file that calls HAIKU_MODEL sends no sampling parameters and turns thinking off', () => {
    const problems: string[] = [];
    for (const f of files) {
      if (f === MODULE || f === self) continue;
      const src = read(f);
      if (!/model: (HAIKU_MODEL|MOVE_STORY_MODEL|MODEL|modelName|model)\b/.test(src)) continue;
      if (!src.includes('HAIKU_MODEL')) continue;
      if (/^\s*(temperature|top_p|top_k):/m.test(src)) problems.push(`${f}: sampling parameter`);
      // A request body (model then max_tokens) must carry the thinking setting.
      for (const m of src.matchAll(/model: HAIKU_MODEL,([\s\S]{0,160}?)max_tokens/g)) {
        if (!m[1].includes('HAIKU_THINKING')) problems.push(`${f}: request without HAIKU_THINKING`);
      }
      if (/\.content\??\.?\[0\]/.test(src)) problems.push(`${f}: reads content[0]`);
    }
    expect(problems).toEqual([]);
  });

  it('is Haiku 5.5 with thinking off', () => {
    expect(HAIKU_MODEL).toBe('claude-haiku-5-5');
    expect(HAIKU_THINKING).toEqual({ type: 'disabled' });
  });

  it('responseText joins text blocks and skips the rest', () => {
    expect(responseText({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('ab');
    expect(responseText({})).toBe('');
    expect(responseText(null)).toBe('');
  });
});
