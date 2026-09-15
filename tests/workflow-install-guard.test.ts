import { describe, it, expect } from 'vitest';
import { expectClean, scanForbidden, walkFiles } from './helpers/scan-guard';

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
 * A bare `pnpm/action-setup` is the other half: with no `version:` (and no
 * `packageManager` in package.json) it fails "No pnpm version is specified",
 * which is how schedule-release failed daily. Both are closed by the one
 * shared preamble, `.github/actions/setup` (pnpm install --frozen-lockfile,
 * version pinned in one place).
 *
 * Comment lines are not scanned — a comment may explain the history.
 */

const ROOTS = ['.github/workflows', '.github/actions'];
const EXTS = ['.yml', '.yaml'];
const SHARED_SETUP = '.github/actions/setup/action.yml';

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

  it('pnpm/action-setup is only used inside the shared setup action (it pins the version)', () => {
    const result = scanForbidden({
      roots: ROOTS,
      extensions: EXTS,
      forbidden: [{ name: 'raw pnpm/action-setup', pattern: /^[^#\n]*\buses:\s*pnpm\/action-setup@/gm }],
      exempt: ({ file }) => file === SHARED_SETUP,
    });
    expectClean(
      result,
      'Use `uses: ./.github/actions/setup` instead of pnpm/action-setup directly — without a version it fails "No pnpm version is specified".',
    );
  });

  it('scans the directories it claims to', () => {
    const files = walkFiles({ roots: ROOTS, extensions: EXTS });
    expect(files).toContain('.github/workflows/ci.yml');
    expect(files).toContain(SHARED_SETUP);
  });
});
