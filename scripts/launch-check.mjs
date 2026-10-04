#!/usr/bin/env node
/**
 * Launch check: load every page a league has, in light and dark, against a
 * running server, and report what a reviewer would otherwise click through
 * to find. Run by `/launch-check` (.claude/skills/launch-check/SKILL.md).
 *
 *   node scripts/launch-check.mjs <slug> [--base http://localhost:4321] [--cookie "session_token=…"] [--out DIR]
 *
 * Pages: a package league's entitled routes (src/config/package-league-routes.mjs);
 * any other league's site-search entries. Dynamic routes (a team's brand page,
 * a news post, a Pecking Order issue) are reached the way a visitor reaches
 * them — one example of each, followed from a link on a page already checked.
 *
 * Failures (exit 1): a non-2xx page, a script error, a leftover placeholder
 * or "undefined"/"NaN"/"[object Object]" on screen, a broken same-origin
 * image, or a link in the page body to a same-origin page that 404s.
 * Warnings: another league's name, or a link into another league, in the
 * page body — usually a copy-paste leak, sometimes deliberate.
 *
 * The page body is `<main>` (the shared header, nav and footer legitimately
 * name every league), falling back to `<body>`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { isPackageLeague, packageRoutesFor } from '../src/config/package-league-routes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const THEMES = ['light', 'dark'];
export const BAD_TEXT = [/__LEAGUE_[A-Z]+__/, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/];
const MAX_LINKS = 300;

/** `/brand/[team]` for `brand/[team].astro`; `/` for `index.astro`. */
export const routePath = (route) => `/${route.replace(/\.astro$/, '').replace(/\/?index$/, '')}`;
const isDynamic = (route) => route.includes('[');

/** Pages whose job is a non-2xx answer. */
export const EXPECTED_STATUS = { 'forbidden.astro': 403 };

/** The dynamic route (`brand/[team].astro`) an unprefixed path is an example of, or null. */
export function dynamicRouteFor(p, routes) {
  const segs = p.split(/[?#]/)[0].replace(/^\/+|\/+$/g, '').split('/');
  return (
    routes.find((r) => {
      const pat = routePath(r).slice(1).split('/');
      return pat.length === segs.length && pat.every((x, i) => (x.startsWith('[') ? Boolean(segs[i]) : x === segs[i]));
    }) ?? null
  );
}

/** The pages to start from: [{ path, route }], league-prefixed, plus the dynamic routes to reach by link. */
export function startingPages(league, directory = readDirectory()) {
  const prefix = `/${league.slug}`;
  if (isPackageLeague(league)) {
    const routes = packageRoutesFor(league.features);
    return {
      pages: routes.filter((r) => !isDynamic(r)).map((r) => ({ path: prefix + routePath(r).replace(/\/$/, ''), route: r })),
      dynamic: routes.filter(isDynamic),
    };
  }
  const own = directory.filter((e) => e.visibility === 'all' && (e.path === prefix || e.path.startsWith(`${prefix}/`)));
  return { pages: [...new Set(own.map((e) => e.path))].map((p) => ({ path: p, route: null })), dynamic: [] };
}

function readDirectory() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/page-directory.json'), 'utf8'));
}

/** Other leagues' names and path prefixes to look for in this league's page body. */
export function leakNeedles(league, leagues = ALL_LEAGUES) {
  const own = [league.name, league.shortName].filter(Boolean).map((s) => s.toLowerCase());
  const names = new Set();
  const prefixes = new Set();
  for (const l of leagues) {
    if (l.slug === league.slug) continue;
    for (const n of [l.name, l.shortName]) {
      // Short or generic names ("The League") collide with ordinary prose; only
      // flag names at least 5 characters long that this league's own names do not contain.
      if (n && n.length >= 5 && !own.some((o) => o.includes(n.toLowerCase()))) names.add(n);
    }
    prefixes.add(`/${l.slug}`);
    if (l.navSlug && l.navSlug !== l.slug) prefixes.add(`/${l.navSlug}`);
  }
  return { names: [...names], prefixes: [...prefixes] };
}

/** Findings from one page's body text and in-body links. Pure, so it is unit-tested. */
export function inspectBody({ text, hrefs }, needles) {
  const errors = [];
  const warnings = [];
  for (const re of BAD_TEXT) {
    const m = text.match(re);
    if (m) {
      const at = Math.max(0, m.index - 40);
      errors.push(`shows "${m[0]}": …${text.slice(at, m.index + m[0].length + 40).replace(/\s+/g, ' ').trim()}…`);
    }
  }
  for (const n of needles.names) if (text.includes(n)) warnings.push(`names another league: "${n}"`);
  for (const href of hrefs) {
    const p = href.split(/[?#]/)[0];
    const hit = needles.prefixes.find((pre) => p === pre || p.startsWith(`${pre}/`));
    if (hit) warnings.push(`links into another league: ${href}`);
  }
  return { errors, warnings: [...new Set(warnings)] };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const valued = new Set(['--base', '--cookie', '--out']);
  const slug = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
  const league = slug && getLeagueBySlug(slug);
  if (!league) {
    console.error('Usage: node scripts/launch-check.mjs <slug> [--base URL] [--cookie "name=value"] [--out DIR]');
    process.exit(1);
  }
  const base = opt('--base', 'http://localhost:4321').replace(/\/$/, '');
  const cookie = opt('--cookie', null);
  const out = path.resolve(opt('--out', path.join(ROOT, '.launch-check', league.slug)));
  fs.mkdirSync(out, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' });
  const needles = leakNeedles(league);
  const { pages, dynamic } = startingPages(league);
  const queue = [...pages];
  const seenPaths = new Set(queue.map((p) => p.path));
  const reachedDynamic = new Set();
  const bodyLinks = new Map(); // href → first page it was seen on
  const results = [];

  const contexts = {};
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const cookies = [{ name: 'theme_pref', value: theme, url: base }];
    if (cookie) {
      const [name, ...rest] = cookie.split('=');
      cookies.push({ name, value: rest.join('='), url: base });
    }
    await ctx.addCookies(cookies);
    contexts[theme] = ctx;
  }

  while (queue.length) {
    const page = queue.shift();
    const row = { path: page.path, route: page.route, status: {}, errors: [], warnings: [], shots: {} };
    for (const theme of THEMES) {
      const tab = await contexts[theme].newPage();
      const scriptErrors = [];
      tab.on('pageerror', (e) => scriptErrors.push(e.message.split('\n')[0]));
      let res = null;
      try {
        res = await tab.goto(base + page.path, { waitUntil: 'load', timeout: 120000 });
      } catch (e) {
        row.errors.push(`${theme}: did not load (${e.message.split('\n')[0]})`);
      }
      row.status[theme] = res?.status() ?? 0;
      const expected = EXPECTED_STATUS[page.route] ?? null;
      if (res && (expected ? res.status() !== expected : !res.ok())) row.errors.push(`${theme}: HTTP ${res.status()}`);
      if (res) {
        const body = await tab.evaluate(() => {
          const root = document.querySelector('main') ?? document.body;
          const brokenImages = [...root.querySelectorAll('img')]
            // An <img> with no src yet is a lazy placeholder, not a broken image.
            .filter((img) => img.getAttribute('src') && img.complete && img.naturalWidth === 0 && new URL(img.src, location.href).origin === location.origin)
            .map((img) => img.getAttribute('src'));
          const hrefs = [...root.querySelectorAll('a[href]')]
            .map((a) => a.getAttribute('href'))
            .filter((h) => h && h.startsWith('/') && !h.startsWith('//'));
          return { text: root.innerText, hrefs, brokenImages };
        });
        const found = inspectBody(body, needles);
        // Text and links are the same in both themes; report them once.
        if (theme === THEMES[0]) {
          row.errors.push(...found.errors);
          row.warnings.push(...found.warnings);
          for (const h of body.hrefs) if (!bodyLinks.has(h)) bodyLinks.set(h, page.path);
          // Reach one example of each dynamic route through a real link.
          for (const h of body.hrefs) {
            const p = h.split(/[?#]/)[0];
            if (!p.startsWith(`/${league.slug}/`) || seenPaths.has(p)) continue;
            const route = dynamicRouteFor(p.slice(league.slug.length + 1), dynamic);
            if (route && !reachedDynamic.has(route)) {
              reachedDynamic.add(route);
              seenPaths.add(p);
              queue.push({ path: p, route });
            }
          }
        }
        for (const src of body.brokenImages) row.errors.push(`${theme}: broken image ${src}`);
        for (const e of scriptErrors) row.errors.push(`${theme}: script error: ${e}`);
        const file = `${page.path.replace(/^\//, '').replace(/[^\w-]+/g, '_') || 'home'}-${theme}.png`;
        await tab.screenshot({ path: path.join(out, file), fullPage: true });
        row.shots[theme] = file;
      }
      await tab.close();
    }
    row.errors = [...new Set(row.errors)];
    results.push(row);
    console.log(`${row.errors.length ? '✗' : row.warnings.length ? '!' : '✓'} ${page.path}`);
  }

  // Links in page bodies that point at this server: each must resolve.
  const deadLinks = [];
  for (const [href, from] of [...bodyLinks].slice(0, MAX_LINKS)) {
    if (seenPaths.has(href.split(/[?#]/)[0])) continue;
    try {
      const res = await fetch(base + href, { redirect: 'manual', headers: cookie ? { cookie } : {} });
      if (res.status === 404 || res.status >= 500) deadLinks.push({ href, from, status: res.status });
    } catch {
      deadLinks.push({ href, from, status: 0 });
    }
  }
  await browser.close();

  const unreached = dynamic.filter((r) => !reachedDynamic.has(r));
  const failed = results.filter((r) => r.errors.length).length + deadLinks.length;
  const report = renderReport({ league, base, results, deadLinks, unreached });
  fs.writeFileSync(path.join(out, 'report.md'), report);
  console.log(`\n${results.length} pages × ${THEMES.length} themes · ${failed} failing · report: ${path.relative(ROOT, out)}/report.md`);
  process.exit(failed ? 1 : 0);
}

function renderReport({ league, base, results, deadLinks, unreached }) {
  const lines = [
    `# Launch check — ${league.name}`,
    '',
    `${base}/${league.slug} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
    '| Page | Light | Dark | Problems |',
    '|---|---|---|---|',
  ];
  for (const r of results) {
    const problems = [...r.errors.map((e) => `✗ ${e}`), ...r.warnings.map((w) => `! ${w}`)].join('<br>') || '✓';
    const shot = (t) => (r.shots[t] ? `[${r.status[t]}](${r.shots[t]})` : String(r.status[t] ?? '—'));
    lines.push(`| \`${r.path}\` | ${shot('light')} | ${shot('dark')} | ${problems.replace(/\|/g, '\\|')} |`);
  }
  if (deadLinks.length) {
    lines.push('', '## Dead links in page bodies', '');
    for (const d of deadLinks) lines.push(`- \`${d.href}\` → ${d.status || 'no response'} (on \`${d.from}\`)`);
  }
  if (unreached.length) {
    lines.push('', '## Not reached', '', 'No page linked to an example of these, so they were not checked:', '');
    for (const r of unreached) lines.push(`- \`${routePath(r)}\``);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
