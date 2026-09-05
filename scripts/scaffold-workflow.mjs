#!/usr/bin/env node
/**
 * Scaffold a scheduled GitHub Actions job plus its script, with the repo's
 * cron rules already in place:
 *
 *   - NO `vars.*` feature gate: the on/off switch is a `const ENABLED` in the
 *     script; disabling the schedule means commenting out the `cron:` line
 *     (CLAUDE.md "Feature flags — code, not GitHub Actions variables";
 *     tests/workflow-feature-flag-guard.test.ts).
 *   - League ids/hosts/paths come from the registry, never literals
 *     (tests/league-literal-guard.test.ts).
 *   - A weekly job gates on `isSeasonWindowOpen`, NOT on "the feeds have a
 *     completed week" (CLAUDE.md "Year rollover — two independent clocks").
 *   - Data is written with `writeJsonIfChanged` so MFL's nondeterministic
 *     array order does not regrow .git (docs/claude/rules/storage-and-build.md).
 *   - Checkout with DEPLOY_KEY, the shared setup action, the shared
 *     commit-push action — the shape of .github/workflows/weekly-stats-sync.yml.
 *
 * Usage:
 *   node scripts/scaffold-workflow.mjs --name weekly-foo-sync --cron "0 13 * * 2" \
 *     --description "Refresh the foo table after MNF" [--add-paths data/] \
 *     [--season-gated] [--dry-run]
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

function parseArgs(argv) {
  const out = { addPaths: 'data/', seasonGated: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--name') out.name = next();
    else if (a === '--cron') out.cron = next();
    else if (a === '--description') out.description = next();
    else if (a === '--add-paths') out.addPaths = next();
    else if (a === '--season-gated') out.seasonGated = true;
    else if (a === '--dry-run') out.dryRun = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

const title = (s) => s.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function workflowSource(a) {
  return `name: ${title(a.name)}

# ${a.description}
#
# To disable this job, comment out the \`cron:\` line below and commit — never
# gate it on a GitHub Actions variable (CLAUDE.md "Feature flags — code, not
# GitHub Actions variables"). To switch the behaviour off while leaving the
# schedule, flip ENABLED in scripts/${a.name}.mjs.

on:
  schedule:
    # ${a.cron} UTC — write the PT equivalent here so the next reader does not have to convert.
    - cron: "${a.cron}"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: ${a.name}
  cancel-in-progress: false

jobs:
  ${a.name}:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6
        with:
          ssh-key: \${{ secrets.DEPLOY_KEY }}

      - name: Setup pnpm + Node + install
        uses: ./.github/actions/setup

      - name: ${title(a.name)}
        run: node ./scripts/${a.name}.mjs

      - name: Commit and push updates
        uses: ./.github/actions/commit-push
        with:
          add-paths: '${a.addPaths}'
          commit-message: 'chore: ${a.name}'
          no-changes-message: 'No ${a.name} changes to commit.'
          git-user-name: '${title(a.name)} Bot'
`;
}

function scriptSource(a) {
  const seasonGate = a.seasonGated
    ? `
  // Gate on the season actually being played. "The feeds have a completed
  // week" is NOT an offseason guard: from February to Labor Day the season
  // year resolves to LAST season, whose feeds are complete by definition, so
  // an ungated weekly job fires all preseason (CLAUDE.md "Year rollover — two
  // independent clocks").
  const { currentSeasonYear: seasonYear } = getCurrentYears();
  if (!isSeasonWindowOpen(seasonYear)) {
    console.log(\`${a.name}: season \${seasonYear} is not in progress — nothing to do.\`);
    return;
  }
`
    : '';
  const seasonImports = a.seasonGated
    ? `import { isSeasonWindowOpen } from '../src/utils/pecking-order-season-window.mjs';
import { getCurrentYears } from './lib/league-years.mjs';
`
    : '';
  return `#!/usr/bin/env node
/**
 * ${title(a.name)} — ${a.description}
 *
 * Runs from .github/workflows/${a.name}.yml on \`${a.cron}\` (UTC) and via
 * workflow_dispatch. Local: \`node scripts/${a.name}.mjs\`.
 */
import { join } from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { fetchExport, mflHostPrefix } from './lib/mfl-api.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';
${seasonImports}
/** Behaviour switch. Flip here, not in a GitHub Actions variable. */
const ENABLED = true;

async function main() {
  if (!ENABLED) {
    console.log('${a.name}: disabled by ENABLED const.');
    return;
  }
${seasonGate}
  for (const league of ALL_LEAGUES) {
    // Registry values only — never a literal id, host, or data path.
    const host = mflHostPrefix(league.mflHost);
    // TODO: pick the export type this job needs and the year clock it runs on.
    // const data = await fetchExport({ host, leagueId: league.id, year, type: 'league' }, { retries: 2, sleepMs: 500, timeoutMs: 10_000 });
    // writeJsonIfChanged(join(process.cwd(), league.dataPath, 'derived', '${a.name}.json'), data);
    console.log(\`${a.name}: \${league.slug} (\${host}) — TODO\`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const errors = [];
  if (!a.name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.name)) errors.push('--name must be kebab-case');
  if (!a.cron || a.cron.trim().split(/\s+/).length !== 5) errors.push('--cron must be a 5-field expression in UTC');
  if (!a.description) errors.push('--description is required');
  if (errors.length) {
    console.error('scaffold-workflow: cannot proceed\n  ' + errors.join('\n  '));
    process.exit(2);
  }
  const files = [
    { path: `.github/workflows/${a.name}.yml`, body: workflowSource(a) },
    { path: `scripts/${a.name}.mjs`, body: scriptSource(a) },
  ];
  const clashes = files.filter((f) => existsSync(join(ROOT, f.path))).map((f) => f.path);
  if (clashes.length) {
    console.error('scaffold-workflow: refusing to overwrite\n  ' + clashes.join('\n  '));
    process.exit(2);
  }
  for (const f of files) console.log(`${a.dryRun ? 'would write' : 'write'}  ${f.path}`);
  if (a.dryRun) return;
  for (const f of files) writeFileSync(join(ROOT, f.path), f.body);
  console.log(`
Next:
  1. Implement scripts/${a.name}.mjs (the TODOs), then: node --check scripts/${a.name}.mjs && node scripts/${a.name}.mjs
  2. node_modules/.bin/vitest run tests/workflow-feature-flag-guard.test.ts tests/league-literal-guard.test.ts
  3. Put the PT time in the cron comment. Add the job to docs if it writes a feed others read.`);
}

main();
