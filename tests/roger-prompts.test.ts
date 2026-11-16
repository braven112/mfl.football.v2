/**
 * Ask Roger's instructions come from the PRIVATE beat-reporter pack
 * (src/utils/roger-prompts.ts), compiled into the server bundle at build time.
 * Their wording is pinned in that repo. What is pinned here is the plumbing
 * the public code is responsible for:
 *
 *  1. the prompts fill in one pass and refuse an unfilled placeholder;
 *  2. every caller still gets a working Roger from the public stubs, so a
 *     preview or a laptop without the pack is degraded, never broken;
 *  3. the build step that fetches the pack FAILS a production build without
 *     it, never leaks the token, and never deletes an existing checkout;
 *  4. the private text can never reach browser code;
 *  5. the anchor whitelist matches the real prompt (when the pack is here);
 *  6. the GroupMe clapback stays silent without its private prompt.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { rogerPrompt, rogerPackPresent } from '../src/utils/roger-prompts';
import { buildRulesQaPrompt } from '../src/utils/league-rulebook';
import { THELEAGUE_RULES_QA_SYSTEM_PROMPT } from '../src/data/rules-qa-system-prompt';
import { RULEBOOK_ANCHORS } from '../src/data/rulebook-anchors';
import { LEAGUE_CONSTITUTION } from '../src/data/league-constitution';
import { fetchBeatReporter, PACK_MARKER } from '../scripts/fetch-beat-reporter.mjs';
import { generateClapback } from '../scripts/lib/roger-clapback.mjs';
import { privateLoreRoot } from '../scripts/lib/schefter-lore.mjs';

const ROOT = process.cwd();

describe('rogerPrompt', () => {
  it('inserts a constitution verbatim, in one pass', () => {
    const text = rogerPrompt('theleague', { CONSTITUTION: 'Rule $& and {{SOURCES}} stay as written.' });
    expect(text).toContain('Rule $& and {{SOURCES}} stay as written.');
  });

  it('refuses a placeholder it was given no value for', () => {
    expect(() => rogerPrompt('theleague', {})).toThrow(/CONSTITUTION/);
  });

  it("TheLeague's prompt carries the whole constitution", () => {
    expect(THELEAGUE_RULES_QA_SYSTEM_PROMPT.endsWith(LEAGUE_CONSTITUTION)).toBe(true);
    expect(THELEAGUE_RULES_QA_SYSTEM_PROMPT).toContain('Roger');
  });

  it("a package league's prompt keeps its sources and links, pack or not", () => {
    const prompt = buildRulesQaPrompt({ name: 'Smith Family League', slug: 'smith' }, { constitution: 'Rule 1.', mflSettings: '- Roster 14' });
    expect(prompt).toContain('Smith Family League');
    expect(prompt).toContain('/smith/rules#rulebook');
    expect(prompt).toContain('/smith/rules#mfl-settings');
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});

describe('fetch-beat-reporter (the build step)', () => {
  const quiet = { log: () => {}, warn: () => {}, error: () => {} };
  const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), 'br-')), 'beat-reporter');
  const fakeClone = (withMarker: boolean) => (_cmd: string, args: string[]) => {
    const dest = args[args.length - 1];
    mkdirSync(path.join(dest, path.dirname(PACK_MARKER)), { recursive: true });
    if (withMarker) writeFileSync(path.join(dest, PACK_MARKER), 'x');
    return Buffer.from('');
  };

  it('is a no-op when the pack is already checked out', () => {
    const root = tmp();
    mkdirSync(path.join(root, path.dirname(PACK_MARKER)), { recursive: true });
    writeFileSync(path.join(root, PACK_MARKER), 'x');
    const exec = () => { throw new Error('must not clone'); };
    expect(fetchBeatReporter({ env: {}, root, exec: exec as any, log: quiet }).ok).toBe(true);
  });

  it('fails a PRODUCTION build that cannot get the pack, and only a production build', () => {
    expect(fetchBeatReporter({ env: { VERCEL_ENV: 'production' }, root: tmp(), log: quiet }).fatal).toBe(true);
    expect(fetchBeatReporter({ env: { VERCEL_ENV: 'preview' }, root: tmp(), log: quiet }).fatal).toBe(false);
    expect(fetchBeatReporter({ env: {}, root: tmp(), log: quiet }).fatal).toBe(false);
    const empty = fetchBeatReporter({ env: { VERCEL_ENV: 'production', BEAT_REPORTER_TOKEN: 't' }, root: tmp(), exec: fakeClone(false) as any, log: quiet });
    expect(empty).toMatchObject({ ok: false, fatal: true });
  });

  it('clones with the token and reports success', () => {
    const calls: string[][] = [];
    const exec = (cmd: string, args: string[]) => { calls.push([cmd, ...args]); return fakeClone(true)(cmd, args); };
    const r = fetchBeatReporter({ env: { VERCEL_ENV: 'production', BEAT_REPORTER_TOKEN: 'sekrit' }, root: tmp(), exec: exec as any, log: quiet });
    expect(r).toMatchObject({ ok: true, reason: 'cloned' });
    expect(calls[0][0]).toBe('git');
    expect(calls[0].join(' ')).toContain('x-access-token:sekrit@github.com/');
  });

  it('also takes the token under its Vercel name', () => {
    const r = fetchBeatReporter({ env: { VERCEL_ENV: 'production', VERCEL_BEAT_REPORTER_TOKEN: 'v' }, root: tmp(), exec: fakeClone(true) as any, log: quiet });
    expect(r).toMatchObject({ ok: true, reason: 'cloned' });
  });

  it('never prints the token, even when git echoes it back', () => {
    const lines: string[] = [];
    const log = { log: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
    const exec = () => {
      const err: any = new Error('clone failed');
      err.stderr = 'fatal: could not read from https://x-access-token:sekrit@github.com/x.git';
      throw err;
    };
    fetchBeatReporter({ env: { VERCEL_ENV: 'production', BEAT_REPORTER_TOKEN: 'sekrit' }, root: tmp(), exec: exec as any, log });
    expect(lines.join('\n')).not.toContain('sekrit');
    expect(lines.join('\n')).toContain('***');
  });

  it('never deletes an existing directory that lacks the prompts', () => {
    const root = tmp();
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'keep-me.txt'), 'local work');
    const exec = () => { throw new Error('must not clone over it'); };
    const r = fetchBeatReporter({ env: { BEAT_REPORTER_TOKEN: 't' }, root, exec: exec as any, log: quiet });
    expect(r.ok).toBe(false);
    expect(existsSync(path.join(root, 'keep-me.txt'))).toBe(true);
  });

  it('runs first in the prebuild, fatal, and in every build (never previewSkip)', () => {
    const src = readFileSync(path.join(ROOT, 'scripts/prebuild.mjs'), 'utf8');
    const seq = src.slice(src.indexOf('const SEQUENTIAL = ['));
    const firstStep = seq.match(/\{\s*name:\s*'([^']+)'[^}]*\}/);
    expect(firstStep?.[1]).toBe('fetch:beat-reporter');
    expect(firstStep?.[0]).toContain('fatal: true');
    expect(firstStep?.[0]).not.toContain('previewSkip');
    expect(src).toMatch(/if \(fatal\) process\.exit\(1\)/);
  });
});

/**
 * The private text is compiled into whatever bundle imports roger-prompts.ts.
 * The server bundle is fine; a CLIENT bundle would hand it to every visitor.
 * Client code is every React island (.tsx/.jsx) and every bundled <script> in
 * an .astro file, so walk each one's local imports and fail on a path that
 * reaches the module.
 */
describe('Roger\'s private prompt never reaches browser code', () => {
  const TARGET = path.join(ROOT, 'src/utils/roger-prompts.ts');
  const SPEC_RE = /\b(?:from|import)\s*\(?\s*['"]([^'"\n]+)['"]/g;
  const SUFFIXES = ['', '.ts', '.tsx', '.mjs', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.mjs', '/index.js'];

  const resolve = (spec: string, from: string): string | null => {
    let base: string;
    if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
    else if (spec.startsWith('@/')) base = path.join(ROOT, 'src', spec.slice(2));
    else return null;
    for (const s of SUFFIXES) {
      const c = base + s;
      if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
  };

  const specsOf = (code: string) => [...code.matchAll(SPEC_RE)].map((m) => m[1]);

  function reachesTarget(entryFile: string, entrySpecs: string[]): string[] | null {
    const parent = new Map<string, string>();
    const queue: string[] = [];
    for (const spec of entrySpecs) {
      const r = resolve(spec, entryFile);
      if (r && !parent.has(r)) { parent.set(r, entryFile); queue.push(r); }
    }
    while (queue.length) {
      const file = queue.shift()!;
      if (file === TARGET) {
        const chain = [file];
        let p = parent.get(file);
        while (p && p !== entryFile) { chain.unshift(p); p = parent.get(p); }
        return chain.map((f) => path.relative(ROOT, f));
      }
      if (!/\.(m?[jt]sx?)$/.test(file)) continue;
      for (const spec of specsOf(readFileSync(file, 'utf8'))) {
        const r = resolve(spec, file);
        if (r && !parent.has(r)) { parent.set(r, file); queue.push(r); }
      }
    }
    return null;
  }

  const files = execSync("git ls-files 'src/**/*.tsx' 'src/**/*.jsx' 'src/**/*.astro'", { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean).map((f) => path.join(ROOT, f));

  it('has client entries to check', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no island or page script imports it, directly or transitively', () => {
    const leaks: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      let specs: string[];
      if (file.endsWith('.astro')) {
        // Only bundled <script> blocks ship to the browser; frontmatter and
        // is:inline scripts do not import modules.
        specs = [...src.matchAll(/<script(?![^>]*is:inline)[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => specsOf(m[1]));
      } else {
        specs = specsOf(src);
      }
      if (!specs.length) continue;
      const chain = reachesTarget(file, specs);
      if (chain) leaks.push(`${path.relative(ROOT, file)} → ${chain.join(' → ')}`);
    }
    expect(leaks, 'browser code reaches Roger\'s private prompt').toEqual([]);
  });
});

describe('the private prompt (when the pack is checked out)', () => {
  const present = rogerPackPresent();

  it.skipIf(!present)("TheLeague's anchor whitelist matches the RULEBOOK SECTIONS Roger is shown", () => {
    for (const anchor of RULEBOOK_ANCHORS) expect(THELEAGUE_RULES_QA_SYSTEM_PROMPT).toContain(`${anchor} —`);
    const offered = [...THELEAGUE_RULES_QA_SYSTEM_PROMPT.matchAll(/^ {2}(#[a-z0-9-]+) —/gm)].map((m) => m[1]);
    expect(offered.length).toBeGreaterThan(0);
    for (const anchor of offered) expect(RULEBOOK_ANCHORS).toContain(anchor);
  });

  it.skipIf(!present)('the bundled files are the ones the node jobs read', () => {
    const dir = path.join(privateLoreRoot(), 'prompts', 'roger');
    expect(readdirSync(dir).sort()).toEqual(['afl.md', 'clapback.md', 'package-league.md', 'theleague.md']);
  });
});

describe('the GroupMe clapback without its private prompt', () => {
  it('stays silent rather than improvise', async () => {
    const old = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key';
    try {
      const fetchImpl = async () => { throw new Error('must not call the API'); };
      const r = await generateClapback({ ownerText: 'roger you suck', factSheet: '', fetchImpl, system: null });
      expect(r).toEqual({ shot: false, reason: 'no-private-prompt' });
    } finally {
      if (old === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = old;
    }
  });
});
