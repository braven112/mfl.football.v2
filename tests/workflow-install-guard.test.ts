import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// js-yaml, not `yaml`: tests/schefter-league-contract.test.ts already reads
// workflow YAML with it, so this adds no new dependency surface.
import yaml from 'js-yaml';
import { expectClean, scanForbidden, walkFiles, REPO_ROOT } from './helpers/scan-guard';
import { moduleGraph } from './helpers/module-graph';

/**
 * Workflow install guard.
 *
 * This repo is pnpm: `pnpm-lock.yaml` is the only lockfile. `npm ci` / `npm
 * install` ignores it, re-resolves the whole tree from the registry and
 * enforces peer ranges strictly — so a job that installs with npm is at the
 * mercy of whatever was published overnight. On 2026-09-11 a new vite release
 * pulled a vitest peer that clashed with @storybook-astro/framework, npm
 * answered ERESOLVE, and every npm-installing workflow (Schefter scan, rumor
 * mill, trade speculation + milestone scan, Roger lineup reminders) died at
 * the install step for four days with no code change on our side.
 *
 * A bare `pnpm/action-setup` is the other half: with no `version:` and no
 * `packageManager` in package.json it fails "No pnpm version is specified",
 * which is how schedule-release failed daily. Both are closed by the one
 * shared preamble, `.github/actions/setup` (pnpm install --frozen-lockfile).
 *
 * The third failure mode is the quiet one, and it is why this file also walks
 * the import graph: a job that installs NOTHING does not fail at all. Every
 * `import` of a package is a dynamic one somewhere, so a missing node_modules
 * surfaces as schefter-scan's own comment records — "Redis import failed",
 * exit 0, no posts, green check. Eight workflows deliberately run without an
 * install because their scripts are dependency-free ESM; the test below is
 * what keeps that claim true as those scripts grow.
 *
 * Comment lines are not scanned — a comment may explain the history.
 *
 * Prose: docs/claude/rules/storage-and-build.md § "CI installs with pnpm".
 */

const ROOTS = ['.github/workflows', '.github/actions'];
const EXTS = ['.yml', '.yaml'];
const SHARED_SETUP = '.github/actions/setup/action.yml';
const WORKFLOWS = '.github/workflows';

describe('workflow install guard', () => {
  it('no workflow installs dependencies with npm (use ./.github/actions/setup)', () => {
    const result = scanForbidden({
      roots: ROOTS,
      extensions: EXTS,
      forbidden: [{ name: 'npm install in CI', pattern: /^[^#\n]*\bnpm\s+(?:ci|install|i)\b/gm }],
    });
    expectClean(
      result,
      'Install with the shared composite action `uses: ./.github/actions/setup` (pnpm install --frozen-lockfile). ' +
        'npm ignores pnpm-lock.yaml and re-resolves peers from the registry — see tests/workflow-install-guard.test.ts.',
    );
  });

  it('pnpm/action-setup is only used inside the shared setup action (it reads the pinned version)', () => {
    const result = scanForbidden({
      roots: ROOTS,
      extensions: EXTS,
      forbidden: [{ name: 'raw pnpm/action-setup', pattern: /^[^#\n]*\buses:\s*pnpm\/action-setup@/gm }],
      exempt: ({ file }) => file === SHARED_SETUP,
    });
    expectClean(
      result,
      'Use `uses: ./.github/actions/setup` instead of pnpm/action-setup directly — on its own it installs nothing.',
    );
  });

  it('scans the directories it claims to', () => {
    const files = walkFiles({ roots: ROOTS, extensions: EXTS });
    expect(files).toContain('.github/workflows/ci.yml');
    expect(files).toContain(SHARED_SETUP);
  });
});

/**
 * The pnpm version lives in exactly one place.
 *
 * `pnpm/action-setup` reads `packageManager` from package.json when no
 * `version:` is given, and ERRORS when both exist and disagree. So a
 * `version:` in the composite action is not a backup — it is a second copy
 * that turns a routine pnpm bump into a CI outage. Vercel and local corepack
 * read the same field, which is the point: one number, three consumers.
 */
describe('pnpm version is single-sourced', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

  it('package.json pins packageManager to a concrete pnpm version', () => {
    expect(
      pkg.packageManager,
      'package.json needs `"packageManager": "pnpm@<x.y.z>"` — without it `pnpm/action-setup` fails ' +
        '"No pnpm version is specified" and every workflow using .github/actions/setup dies at install.',
    ).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });

  it('the shared setup action does not carry a second copy of the version', () => {
    const action = readFileSync(path.join(REPO_ROOT, SHARED_SETUP), 'utf8');
    const offenders = action
      .split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => !line.startsWith('#') && /^version:\s*\S/.test(line));
    expect(
      offenders.map((o) => `${SHARED_SETUP}:${o.n}  ${o.line}`),
      'Remove the `version:` input — pnpm/action-setup reads package.json#packageManager, and a second copy ' +
        'that disagrees makes the action throw "Multiple versions of pnpm specified".',
    ).toEqual([]);
  });
});

/**
 * A workflow that installs nothing must run scripts that need nothing.
 *
 * `node scripts/foo.mjs` with no node_modules does not crash at the workflow
 * level — the import that fails is dynamic and caught, so the job goes green
 * having done nothing. This walks each no-install workflow's entrypoints
 * transitively and fails with the exact `workflow → script → package` chain.
 */
/**
 * A job that installs nothing must run scripts that need nothing.
 *
 * `node scripts/foo.mjs` with no node_modules does not crash at the workflow
 * level — the import that fails is dynamic and caught, so the job goes green
 * having done nothing. This walks each no-install job's entrypoints
 * transitively and fails with the exact `workflow -> script -> package` chain.
 *
 * The unit is the JOB, not the file. Each job gets its own runner and its own
 * checkout, so one job using the shared action says nothing about its
 * siblings — a file-level check would read a workflow whose build job installs
 * and whose cron job does not as "installs", and skip the half that matters.
 * Nothing in the repo has that shape today; the guard should not be the reason
 * we find out when something does.
 */
describe('no-install jobs run dependency-free scripts', () => {
  // Tokenize the line rather than matching "runner … script" with one regex.
  // The regex form needed a `(?:[^\s;|&]+\s+)*?` middle to tolerate flags like
  // `node --import tsx scripts/x.ts`, and nested quantifiers of that shape are
  // a ReDoS (CodeQL js/redos, severity error, on this very line). Splitting on
  // shell separators is both safer and easier to read.
  const RUNNER_TOKENS = new Set(['node', 'npx', 'tsx', 'ts-node', 'pnpm']);
  const SCRIPT_TOKEN_RE = /^(?:\.\/)?((?:scripts|src)\/[A-Za-z0-9._/-]+\.(?:mjs|js|ts))$/;
  // Inline code and version probes run no repo script and need no install.
  const INLINE_NODE_RE = /\bnode\s+(?:-e|-p|--eval|--print|--check|-c|--version|-v)\b/;

  const tokensOf = (line: string): string[] => line.split(/[\s;|&()]+/).filter(Boolean);
  const hasRunner = (line: string): boolean => tokensOf(line).some((t) => RUNNER_TOKENS.has(t));

  /**
   * Every repo script named after a runner on this line. Over-matching is
   * harmless (we check a script that may not run); under-matching means a job
   * is never checked at all, which is the failure this guard exists to stop.
   */
  const entrypointsIn = (line: string): string[] => {
    const found: string[] = [];
    let sawRunner = false;
    for (const token of tokensOf(line)) {
      if (RUNNER_TOKENS.has(token)) {
        sawRunner = true;
        continue;
      }
      const match = SCRIPT_TOKEN_RE.exec(token);
      if (match && sawRunner) found.push(match[1]);
    }
    return found;
  };
  const SHARED_SETUP_USES = './.github/actions/setup';

  interface Job {
    workflow: string;
    job: string;
    installs: boolean;
    entrypoints: string[];
    unclassifiedRunners: string[];
  }

  const parseFailures: string[] = [];

  const jobs: Job[] = walkFiles({ roots: [WORKFLOWS], extensions: EXTS }).flatMap((file) => {
    let doc: { jobs?: Record<string, { steps?: { uses?: unknown; run?: unknown }[] }> };
    try {
      doc = yaml.load(readFileSync(path.join(REPO_ROOT, file), 'utf8')) as typeof doc;
    } catch (err) {
      // A workflow we cannot read is a workflow we are not guarding. Say so.
      parseFailures.push(`${file}: ${(err as Error).message}`);
      return [];
    }
    return Object.entries(doc?.jobs ?? {}).map(([name, job]) => {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      const installs = steps.some((s) => typeof s?.uses === 'string' && s.uses.trim() === SHARED_SETUP_USES);
      const runs = steps.map((s) => (typeof s?.run === 'string' ? s.run : '')).filter(Boolean);
      const lines = runs.flatMap((run) => run.split('\n')).filter((line) => !line.trimStart().startsWith('#'));

      const entrypoints = [...new Set(lines.flatMap(entrypointsIn))].sort();

      const unclassifiedRunners = lines
        .filter((line) => hasRunner(line) && !INLINE_NODE_RE.test(line) && entrypointsIn(line).length === 0)
        .map((line) => `${file} [${name}]  ${line.trim()}`);

      return { workflow: file, job: name, installs, entrypoints, unclassifiedRunners };
    });
  });

  it('parses every workflow (an unreadable one is an unguarded one)', () => {
    expect(parseFailures, `workflows that failed to parse:\n  ${parseFailures.join('\n  ')}`).toEqual([]);
    expect(jobs.length).toBeGreaterThan(40);
  });

  it('finds the node entrypoints it is meant to check', () => {
    // Sanity: if the regex stops matching, every assertion below passes vacuously.
    const all = jobs.flatMap((j) => j.entrypoints);
    expect(all).toContain('scripts/schefter-scan.mjs');
    expect(all).toContain('scripts/apply-august-cuts.mjs');
    expect(jobs.filter((j) => !j.installs && j.entrypoints.length > 0).length).toBeGreaterThan(0);
  });

  it('every entrypoint a job names actually exists', () => {
    // existsSync, not moduleGraph().files — asking the walker whether it saw
    // the file it was handed is a question it used to answer yes to for a
    // path that does not exist, which made this assertion vacuous.
    const missing = jobs.flatMap(({ workflow, job, entrypoints }) =>
      entrypoints
        .filter((entry) => !existsSync(path.join(REPO_ROOT, entry)))
        .map((entry) => `${workflow} [${job}] -> ${entry}`),
    );
    expect(missing, `jobs referencing scripts that are not on disk:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('classifies every runner invocation in a no-install job', () => {
    // A guard that silently skips what it cannot parse is a guard that passes.
    const unclassified = jobs.filter((j) => !j.installs).flatMap((j) => j.unclassifiedRunners);
    expect(
      unclassified,
      'These lines invoke a runner in a job that installs nothing, but no repo script could be\n' +
        'extracted from them — so nothing was checked. Either they are inline code (add the form to\n' +
        'INLINE_NODE_RE), or the entrypoint regex needs to learn the shape:\n  ' +
        unclassified.join('\n  '),
    ).toEqual([]);
  });

  it('a job with no install reaches no node_modules package', () => {
    const offenders: string[] = [];
    for (const { workflow, job, installs, entrypoints } of jobs) {
      if (installs) continue;
      for (const entry of entrypoints) {
        const graph = moduleGraph(entry);
        for (const [pkgName, importer] of graph.packages) {
          offenders.push(`${workflow} [${job}] -> ${entry} needs "${pkgName}" (imported by ${importer})`);
        }
        // An import we cannot resolve is unknown, not absent. Saying nothing
        // about it is exactly the false negative this guard exists to prevent.
        for (const dyn of graph.dynamicUnresolved) {
          offenders.push(`${workflow} [${job}] -> ${entry} has an unresolvable dynamic import: ${dyn}`);
        }
      }
    }
    expect(
      offenders.sort(),
      'These jobs run without `uses: ./.github/actions/setup`, so node_modules is empty at runtime and the\n' +
        'import fails silently (dynamic import in a try/catch → "import failed", exit 0, green check).\n' +
        'Either add the shared setup step, or keep the script dependency-free:\n  ' +
        offenders.sort().join('\n  '),
    ).toEqual([]);
  });
});

describe('moduleGraph sees every import shape', () => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'module-graph-'));
  afterAll(() => rmSync(fixture, { recursive: true, force: true }));

  const write = (name: string, body: string) => {
    const file = path.join(fixture, name);
    writeFileSync(file, body);
    return file;
  };

  it('catches static, side-effect, dynamic and require specifiers', () => {
    const entry = write(
      'entry.mjs',
      [
        "import { a } from 'pkg-static';",
        "import 'pkg-side-effect';",
        "const b = await import('pkg-dynamic');",
        "const c = require('pkg-require');",
        "import { d } from './local.mjs';",
        'export { a, b, c, d };',
      ].join('\n'),
    );
    write('local.mjs', "export { e } from 'pkg-transitive';\n");

    const { packages } = moduleGraph(entry);
    expect([...packages.keys()].sort()).toEqual([
      'pkg-dynamic',
      'pkg-require',
      'pkg-side-effect',
      'pkg-static',
      'pkg-transitive',
    ]);
  });

  it('scopes @org/name as one package, and ignores node builtins', () => {
    const entry = write(
      'scoped.mjs',
      [
        "import { Redis } from '@upstash/redis';",
        "import { deep } from '@scope/pkg/sub/path.js';",
        "import fs from 'node:fs';",
        "import path from 'path';",
        'export { Redis, deep, fs, path };',
      ].join('\n'),
    );
    expect([...moduleGraph(entry).packages.keys()].sort()).toEqual(['@scope/pkg', '@upstash/redis']);
  });

  it('does not count a specifier quoted in a comment', () => {
    const entry = write(
      'commented.mjs',
      [
        '/**',
        " * Callers do `import { x } from 'pkg-in-doc-comment'`.",
        ' */',
        "// import 'pkg-in-line-comment';",
        'export const x = 1;',
      ].join('\n'),
    );
    expect([...moduleGraph(entry).packages.keys()]).toEqual([]);
  });

  it('sees a specifier split across lines', () => {
    // Valid JS, and invisible to a line-by-line scan — the shape a reviewer
    // found missing in the first version of this walker.
    const entry = write(
      'multiline.mjs',
      ['export async function p() {', "  return await import(", "    'pkg-wrapped'", '  );', '}'].join('\n'),
    );
    expect([...moduleGraph(entry).packages.keys()]).toEqual(['pkg-wrapped']);
  });

  it('expands a template-literal local import to the directory it names', () => {
    mkdirSync(path.join(fixture, 'kinds'), { recursive: true });
    writeFileSync(path.join(fixture, 'kinds', 'alpha.mjs'), "import 'pkg-from-alpha';\nexport const a = 1;\n");
    writeFileSync(path.join(fixture, 'kinds', 'beta.mjs'), 'export const b = 2;\n');
    const entry = write('loader.mjs', ['export const load = (k) => import(`./kinds/${k}.mjs`);'].join('\n'));

    const graph = moduleGraph(entry);
    expect([...graph.packages.keys()]).toEqual(['pkg-from-alpha']);
    expect(graph.dynamicUnresolved).toEqual([]);
  });

  it('reports a dynamic import it cannot expand rather than ignoring it', () => {
    const entry = write('opaque.mjs', ['export const load = (p) => import(`${p}`);'].join('\n'));
    expect(moduleGraph(entry).dynamicUnresolved).toHaveLength(1);
  });

  it('does not report a file that does not exist as seen', () => {
    // files.includes(entry) is used as an existence check; it must not just
    // echo its argument back.
    expect(moduleGraph('scripts/definitely-not-a-real-script.mjs').files).toEqual([]);
  });

  it('agrees with the real files the guard depends on', () => {
    // The whole split exists so these two answers differ.
    expect([...moduleGraph('scripts/lib/redis-client.mjs').packages.keys()]).toEqual(['@upstash/redis']);
    expect([...moduleGraph('scripts/lib/redis.mjs').packages.keys()]).toEqual([]);
  });
});
