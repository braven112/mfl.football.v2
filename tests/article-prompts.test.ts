/**
 * The column prompts' loader (scripts/article-utils/article-prompts.mjs).
 *
 * The wording itself lives in the private beat-reporter pack and is pinned
 * there. What is pinned here is the contract the public code relies on: a
 * missing prompt FAILS CLOSED (no column is written without its rules), the
 * fact sheet is inserted verbatim, and both runners handle the miss.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MissingPromptError,
  articlePrompt,
  setArticlePromptReader,
} from '../scripts/article-utils/article-prompts.mjs';

let restore: (() => void) | null = null;
const useReader = (fn: (rel: string) => string | null) => { restore = setArticlePromptReader(fn); };
afterEach(() => { restore?.(); restore = null; });

describe('articlePrompt', () => {
  it('reads prompts/articles/<type>.<part>.md from the pack', () => {
    const asked: string[] = [];
    useReader((rel) => { asked.push(rel); return rel.endsWith('.user.md') ? 'x {{FACT_SHEET}}' : 'x'; });
    articlePrompt('cut-watch', 'user', { FACT_SHEET: '' });
    articlePrompt('cut-watch', 'system');
    expect(asked).toEqual(['prompts/articles/cut-watch.user.md', 'prompts/articles/cut-watch.system.md']);
  });

  it('throws MissingPromptError when the pack has no such prompt (fail closed)', () => {
    useReader(() => null);
    expect(() => articlePrompt('matchup-preview', 'system')).toThrow(MissingPromptError);
    expect(() => articlePrompt('matchup-preview', 'user', { FACT_SHEET: 'f' })).toThrow(MissingPromptError);
  });

  it('gives a system prompt back the blank line buildCachedSystem expects', () => {
    useReader(() => 'ARTICLE TYPE: X');
    expect(articlePrompt('x', 'system')).toBe('\n\nARTICLE TYPE: X');
    expect(articlePrompt('x', 'user')).toBe('ARTICLE TYPE: X');
  });

  it('inserts the fact sheet verbatim, in one pass', () => {
    useReader(() => 'A {{FACT_SHEET}} B {{FRANCHISE_COUNT}}');
    const sheet = 'Team $& paid $1 {{FRANCHISE_COUNT}}';
    expect(articlePrompt('pecking-order', 'user', { FACT_SHEET: sheet, FRANCHISE_COUNT: 16 }))
      .toBe('A Team $& paid $1 {{FRANCHISE_COUNT}} B 16');
  });

  it('refuses a placeholder it was given no value for', () => {
    useReader(() => 'A {{FACT_SHEET}} {{WEEK}}');
    expect(() => articlePrompt('x', 'user', { FACT_SHEET: 'f' })).toThrow(/WEEK/);
  });
});

describe('the runners handle a missing prompt', () => {
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), 'utf8');

  it('schefter-weekly-articles skips the column on MissingPromptError', () => {
    const src = read('scripts/schefter-weekly-articles.mjs');
    expect(src).toMatch(/err instanceof MissingPromptError/);
    expect(src).toMatch(/\[skip\][^\n]*not writing/);
  });

  it('generate-pecking-order builds its prompts inside the try that keeps the templated voice', () => {
    const src = read('scripts/generate-pecking-order.mjs');
    const tryAt = src.indexOf('aiOutput = await callAnthropic(');
    const sysAt = src.indexOf('getSystemPrompt(league.name', tryAt);
    const catchAt = src.indexOf('Keeping templated voice', tryAt);
    expect(tryAt).toBeGreaterThan(-1);
    expect(sysAt).toBeGreaterThan(tryAt);
    expect(catchAt).toBeGreaterThan(sysAt);
  });
});
