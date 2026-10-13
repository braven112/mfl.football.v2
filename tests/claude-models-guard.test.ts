/**
 * Every Claude call reads its model from src/utils/claude-models.mjs, so an
 * upgrade is one line. The 5.5 models also reject what older ones accepted: a
 * `temperature`/`top_p`/`top_k` is a 400, thinking is on unless the request
 * turns it off, and the answer is not always `content[0]`. These scans keep
 * a call site from regrowing any of that.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  HAIKU_MODEL,
  HAIKU_THINKING,
  OPUS_MODEL,
  SONNET_MODEL,
  responseText,
} from '../src/utils/claude-models.mjs';

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
  it('no file names a Claude model id except the registry', () => {
    const offenders = files.filter(
      (f) =>
        f !== MODULE &&
        f !== self &&
        /['"`]claude-(haiku|sonnet|opus)-[\w.@-]+['"`]/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('a file that calls a registry model sends no sampling parameters, and Haiku turns thinking off', () => {
    const problems: string[] = [];
    for (const f of files) {
      if (f === MODULE || f === self) continue;
      const src = read(f);
      if (!/model: (HAIKU_MODEL|MOVE_STORY_MODEL|MODEL|modelName|model)\b/.test(src)) continue;
      if (!/\b(HAIKU|SONNET|OPUS)_MODEL\b/.test(src)) continue;
      if (/^\s*(temperature|top_p|top_k):/m.test(src)) problems.push(`${f}: sampling parameter`);
      // A Haiku request body (model then max_tokens) must carry the thinking
      // setting, including the call sites that alias the model to a local name.
      if (src.includes('HAIKU_MODEL')) {
        const request =
          /\bmodel(?:: (?:HAIKU_MODEL|MOVE_STORY_MODEL|MODEL|modelName|model))?,([\s\S]{0,160}?)max_tokens/g;
        for (const m of src.matchAll(request)) {
          if (!m[1].includes('HAIKU_THINKING')) problems.push(`${f}: request without HAIKU_THINKING`);
        }
      }
      if (/\.content\??\.?\[0\]/.test(src)) problems.push(`${f}: reads content[0]`);
    }
    expect(problems).toEqual([]);
  });

  it('is Haiku 5.5 with thinking off', () => {
    expect(HAIKU_MODEL).toBe('claude-haiku-5-5');
    expect(HAIKU_THINKING).toEqual({ type: 'disabled' });
  });

  it('is Opus 5.5 and Sonnet 5.5', () => {
    expect(OPUS_MODEL).toBe('claude-opus-5-5');
    expect(SONNET_MODEL).toBe('claude-sonnet-5-5');
  });

  it('responseText joins text blocks and skips the rest', () => {
    expect(responseText({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toBe('ab');
    expect(responseText({})).toBe('');
    expect(responseText(null)).toBe('');
  });
});
