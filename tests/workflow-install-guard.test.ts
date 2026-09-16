import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
describe('no-install workflows run dependency-free scripts', () => {
  // `node [--flags] scripts/x.mjs` / `node ./src/y.mjs`. `node -e` / `node -p`
  // are inline code with no repo script and are not matched.
  const NODE_SCRIPT_RE = /\bnode\s+(?:--?[^\s]+\s+)*(?:\.\/)?((?:scripts|src)\/[A-Za-z0-9._/-]+\.(?:mjs|js|ts))/g;
  const INSTALLS_RE = /^[^#\n]*uses:\s*\.\/\.github\/actions\/setup\s*$/m;

  const workflows = walkFiles({ roots: [WORKFLOWS], extensions: EXTS }).map((file) => {
    const src = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const entrypoints = [
      ...new Set(
        src
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('#'))
          .flatMap((line) => [...line.matchAll(NODE_SCRIPT_RE)].map((m) => m[1])),
      ),
    ].sort();
    return { file, installs: INSTALLS_RE.test(src), entrypoints };
  });

  it('finds the node entrypoints it is meant to check', () => {
    // Sanity: if the regex stops matching, every assertion below passes vacuously.
    const scan = workflows.find((w) => w.file === `${WORKFLOWS}/schefter-scan.yml`);
    expect(scan?.entrypoints).toContain('scripts/schefter-scan.mjs');
    const cuts = workflows.find((w) => w.file === `${WORKFLOWS}/apply-august-cuts.yml`);
    expect(cuts?.entrypoints).toContain('scripts/apply-august-cuts.mjs');
    expect(workflows.filter((w) => !w.installs && w.entrypoints.length > 0).length).toBeGreaterThan(0);
  });

  it('every entrypoint a workflow names actually exists', () => {
    const missing: string[] = [];
    for (const { file, entrypoints } of workflows) {
      for (const entry of entrypoints) {
        if (!moduleGraph(entry).files.includes(entry)) missing.push(`${file} -> ${entry}`);
      }
    }
    expect(missing, `workflows referencing scripts that are not on disk:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('a workflow with no install reaches no node_modules package', () => {
    const offenders: string[] = [];
    for (const { file, installs, entrypoints } of workflows) {
      if (installs) continue;
      for (const entry of entrypoints) {
        for (const [pkgName, importer] of moduleGraph(entry).packages) {
          offenders.push(`${file} -> ${entry} needs "${pkgName}" (imported by ${importer})`);
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

/**
 * The graph walker's own self-test.
 *
 * Everything above rests on `moduleGraph()` seeing every dependency, and a
 * FALSE NEGATIVE here is silent in both directions: the guard passes, the
 * workflow keeps its no-install step, and the package is still missing at
 * runtime. The four specifier shapes are pinned because a regex built around
 * `from '…'` misses `import 'x';` — that gap once reported a file pinned into
 * production as dead (docs/claude/insights/features/dead-code-detection.md).
 */
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

  it('agrees with the real files the guard depends on', () => {
    // The whole split exists so these two answers differ.
    expect([...moduleGraph('scripts/lib/redis-client.mjs').packages.keys()]).toEqual(['@upstash/redis']);
    expect([...moduleGraph('scripts/lib/redis.mjs').packages.keys()]).toEqual([]);
  });
});
