#!/usr/bin/env node
/**
 * Scaffold a new page the way this repo says pages must be built, so the
 * rules are in the generator instead of in four separate reminders:
 *
 *   - ONE shared page component under src/components/shared/<route>/
 *     (CLAUDE.md "Second league's copy of a page — build a component, not a
 *     second page"; tests/page-fork-ratchet.test.ts fails a new fork).
 *   - A THIN route wrapper per league under src/pages/<league>/<route>.astro
 *     holding the auth gate — Astro.redirect() only redirects from a PAGE, a
 *     gate inside the component ships a blank 200 (see the Astro.redirect
 *     note under CLAUDE.md "Rankings are per-league").
 *   - One src/data/page-directory.json entry PER LEAGUE, each with 10+ tags
 *     (CLAUDE.md "Page directory registry — required for every new page";
 *     tests/page-directory-data.test.ts enforces the shape). A bare path
 *     ("/trade-ledger") registers the page for the default league only —
 *     search filters with pathBelongsToLeague — so every other league gets
 *     its prefixed twin ("/afl-fantasy/trade-ledger", id "afl-trade-ledger"),
 *     which is how every shared page in the directory is registered today.
 *
 * Usage:
 *   node scripts/scaffold-page.mjs --route trade-ledger --title "Trade Ledger" \
 *     --description "Every trade, graded" --category reports --icon rank \
 *     --tags "trades,trade history,ledger,grades,who won the trade,swap,deal,transactions,trade log,trade record" \
 *     [--leagues theleague,afl-fantasy] [--auth] [--dry-run]
 *
 * Refuses to overwrite anything. Refuses fewer than 10 tags — a placeholder
 * tag would pass the test and defeat the point of the registry.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ALL_LEAGUES, DEFAULT_LEAGUE_SLUG, LEAGUES } from '../src/config/leagues-data.mjs';

const ROOT = process.cwd();
const DIRECTORY = 'src/data/page-directory.json';
const CATEGORIES = ['popular', 'my-team', 'reports', 'tools', 'info'];

function parseArgs(argv) {
  const out = { leagues: null, auth: false, dryRun: false, tags: [], visibility: 'all', popularity: 30 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--route') out.route = next();
    else if (a === '--title') out.title = next();
    else if (a === '--description') out.description = next();
    else if (a === '--category') out.category = next();
    else if (a === '--icon') out.icon = next();
    else if (a === '--tags') out.tags = next().split(',').map((t) => t.trim()).filter(Boolean);
    else if (a === '--leagues') out.leagues = next().split(',').map((s) => s.trim());
    else if (a === '--visibility') out.visibility = next();
    else if (a === '--popularity') out.popularity = Number(next());
    else if (a === '--auth') out.auth = true;
    else if (a === '--dry-run') out.dryRun = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

const pascal = (s) => s.split(/[^a-z0-9]+/i).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');

function validate(a) {
  const errors = [];
  if (!a.route || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.route)) errors.push('--route must be kebab-case (e.g. trade-ledger)');
  if (!a.title) errors.push('--title is required');
  if (!a.description) errors.push('--description is required (one sentence, what the page answers)');
  if (!CATEGORIES.includes(a.category)) errors.push(`--category must be one of ${CATEGORIES.join(', ')}`);
  if (!a.icon) errors.push('--icon is required (a sprite icon id used elsewhere in page-directory.json)');
  if (a.tags.length < 10) errors.push(`--tags needs 10+ comma-separated tags (got ${a.tags.length}); write synonyms, data types, actions, slang`);
  const known = ALL_LEAGUES.map((l) => l.slug);
  // Default: every non-best-ball league with a page directory. Best-ball is
  // draft-only with opt-in nav (docs/claude/rules/best-ball.md) — name it
  // explicitly with --leagues when a page really belongs there.
  const leagues = a.leagues ?? known.filter((slug) => !LEAGUES[slug].bestBall && existsSync(join(ROOT, 'src/pages', slug)));
  for (const l of leagues) if (!known.includes(l)) errors.push(`unknown league ${l}; registry has ${known.join(', ')}`);
  return { errors, leagues };
}

function componentSource(a) {
  const name = `${pascal(a.route)}Page`;
  return `---
/**
 * ${a.title} — shared render for every league that has the route.
 *
 * Thin route wrappers under src/pages/<league>/${a.route}.astro own the
 * auth gate and any per-league static data import; this component owns the
 * markup. Keep it that way: Astro.redirect() only works from a page, and a
 * static import specifier cannot be a runtime variable.
 */
import TheLeagueLayout from '../../../layouts/TheLeagueLayout.astro';
import { resolveLeaguePath } from '../../../utils/nav-utils';
import { getLeagueBySlug } from '../../../config/leagues';
import type { CanonicalLeagueSlug } from '../../../config/leagues';

interface Props {
  leagueSlug: CanonicalLeagueSlug;
}

const { leagueSlug } = Astro.props;
const league = getLeagueBySlug(leagueSlug);
if (!league) throw new Error(\`${name}: unknown league \${leagueSlug}\`);

// Every internal href on this page goes through resolveLeaguePath so apex
// hosts (theleague.us) do not get a doubled league prefix.
const basePath = resolveLeaguePath(\`/\${leagueSlug}/${a.route}\`, Astro.locals.hideLeaguePrefix ?? false);
---

<TheLeagueLayout title={\`${a.title} | \${league.name}\`}>
  <main class="${a.route}">
    <header class="${a.route}__header">
      <h1><a href={basePath}>${a.title}</a></h1>
      <p>${a.description}</p>
    </header>
    <!-- TODO: page body. Use chooseTeamName() for team names, PlayerCell.astro for players,
         section titles uppercase + left-border, tabular-nums for numbers (docs/claude/loading-standards.md). -->
    <p class="${a.route}__empty">Nothing to show yet.</p>
  </main>
</TheLeagueLayout>

<style>
  /* Tokens only — a var() with no definition renders its fallback in BOTH
     themes (docs/claude/rules/theming-and-assets.md); tests/design-token-guard.test.ts
     fails the build on one. These four exist in src/styles/tokens.css. */
  .${a.route} {
    max-width: var(--container-max-width, 1100px);
    margin: 0 auto;
    padding: var(--spacing-lg, 1.5rem) var(--spacing-md, 1rem);
  }
  .${a.route}__empty {
    color: var(--color-gray-500, #6b7280);
  }
</style>
`;
}

function routeSource(a, slug) {
  const name = `${pascal(a.route)}Page`;
  const gate = a.auth
    ? `
const user = getAuthUser(Astro.request);
if (!user || !isAuthorizedForLeague(user, LEAGUE.id)) {
  return Astro.redirect('/${slug}');
}
`
    : '';
  const authImports = a.auth
    ? `import { getAuthUser, isAuthorizedForLeague } from '../../utils/auth';
import { getLeagueBySlug } from '../../config/leagues';
`
    : '';
  const leagueConst = a.auth ? `const LEAGUE = getLeagueBySlug('${slug}')!;\n` : '';
  return `---
/**
 * ${a.title} (${slug}) — thin route wrapper.
 *
 * Shared implementation lives in components/shared/${a.route}/${name}.
 * The ${a.auth ? 'auth gate lives HERE, not in the component: ' : 'redirect (if one is ever needed) must live HERE: '}
 * Astro.redirect() only redirects from a PAGE. Per-league static data imports
 * also belong here — a static import specifier can't be a runtime variable.
 */
import ${name} from '../../components/shared/${a.route}/${name}.astro';
${authImports}
export const prerender = false;
${leagueConst}${gate}---

<${name} leagueSlug="${slug}" />
`;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const { errors, leagues } = validate(a);
  if (errors.length) {
    console.error('scaffold-page: cannot proceed\n  ' + errors.join('\n  '));
    process.exit(2);
  }

  const name = `${pascal(a.route)}Page`;
  const files = [
    { path: `src/components/shared/${a.route}/${name}.astro`, body: componentSource(a) },
    ...leagues.map((slug) => ({ path: `src/pages/${slug}/${a.route}.astro`, body: routeSource(a, slug) })),
  ];

  const directory = JSON.parse(readFileSync(join(ROOT, DIRECTORY), 'utf8'));
  const entries = leagues.map((slug) => {
    const isDefault = slug === DEFAULT_LEAGUE_SLUG;
    return {
      id: isDefault ? a.route : `${LEAGUES[slug].navSlug}-${a.route}`,
      title: a.title,
      description: a.description,
      path: isDefault ? `/${a.route}` : `/${slug}/${a.route}`,
      icon: a.icon,
      category: a.category,
      tags: a.tags,
      visibility: a.visibility,
      popularity: a.popularity,
    };
  });
  const clashes = files.filter((f) => existsSync(join(ROOT, f.path))).map((f) => f.path);
  for (const entry of entries) {
    if (directory.some((e) => e.id === entry.id || e.path === entry.path)) clashes.push(`${DIRECTORY} (id ${entry.id} / path ${entry.path})`);
  }
  if (clashes.length) {
    console.error('scaffold-page: refusing to overwrite\n  ' + clashes.join('\n  '));
    process.exit(2);
  }

  for (const f of files) console.log(`${a.dryRun ? 'would write' : 'write'}  ${f.path}`);
  for (const entry of entries) console.log(`${a.dryRun ? 'would append' : 'append'} ${DIRECTORY} ← ${JSON.stringify({ id: entry.id, path: entry.path, tags: entry.tags.length })}`);
  if (a.dryRun) return;

  for (const f of files) {
    mkdirSync(dirname(join(ROOT, f.path)), { recursive: true });
    writeFileSync(join(ROOT, f.path), f.body);
  }
  directory.push(...entries);
  writeFileSync(join(ROOT, DIRECTORY), JSON.stringify(directory, null, 2) + '\n');

  console.log(`
Next:
  1. Fill in the body of ${files[0].path}.
  2. node_modules/.bin/vitest run tests/page-directory-data.test.ts tests/page-fork-ratchet.test.ts tests/design-token-guard.test.ts
  3. Add a story if the page has visual states (docs/claude/rules/storybook.md).
  4. /update-whats-new — a new page needs an entry with a screenshot and inline links.
  5. If the page shows a year: /rollover-check /${leagues[0]}/${a.route}`);
}

main();
