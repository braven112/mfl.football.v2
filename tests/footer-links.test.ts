import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  getFooterColumns,
  getDeepCuts,
  pathBelongsToLeague,
} from "../src/config/footer-config";
import { getFooterChampions } from "../src/utils/footer-champions";
import { getSearchPath, resolveDirectoryHref } from "../src/utils/nav-utils";
import type { CanonicalLeagueSlug } from "../src/config/leagues";
import type { LeagueSlug } from "../src/types/nav";

/**
 * Every footer link must resolve to a route that actually exists.
 *
 * This exists because two 404s shipped past both a config review and a
 * per-league column review:
 *
 *  - `/afl-fantasy/league-comparison` — the AFL deck listed the directory id
 *    `league-comparison`, whose path is the bare `/league-comparison`. Bare
 *    paths are TheLeague's, so prefixing it for AFL invented a route. (It is
 *    also a salary-cap tool, and AFL runs salaryCap:false.)
 *  - `/afl-fantasy/search` and `/best-ball-1/search` — the utility bar's
 *    Search link, on EVERY page of two leagues. (The AFL has a real search
 *    route as of Sep 2026; Best Ball still has none, and getSearchPath() is
 *    what keeps the link off its pages.)
 *
 * Neither was catchable by the existing tests, which assert column structure
 * but never resolve a link and never look at src/pages/. This one does both.
 */

const ROOT = process.cwd();
const PAGES = path.join(ROOT, "src/pages");

const NAV_SLUG: Record<CanonicalLeagueSlug, LeagueSlug> = {
  theleague: "theleague",
  "afl-fantasy": "afl",
  "best-ball-1": "bb1",
};

const LEAGUES = Object.keys(NAV_SLUG) as CanonicalLeagueSlug[];

/**
 * Does an Astro route back this pathname?
 *
 * Checks the concrete forms a static route can take. Deliberately does NOT
 * treat catch-all routes as a match: `src/pages/[...path].astro` matches
 * everything and explicitly returns 404, so counting it would make this test
 * pass on exactly the bugs it exists to catch.
 */
function routeExists(pathname: string): boolean {
  const clean = pathname.split("?")[0].split("#")[0].replace(/\/$/, "");
  if (!clean || clean === "/")
    return existsSync(path.join(PAGES, "index.astro"));
  const rel = clean.replace(/^\//, "");
  return (
    existsSync(path.join(PAGES, `${rel}.astro`)) ||
    existsSync(path.join(PAGES, rel, "index.astro")) ||
    existsSync(path.join(PAGES, `${rel}.ts`)) ||
    existsSync(path.join(PAGES, `${rel}.md`))
  );
}

/** Every href the footer renders for a league, as the browser would see it. */
function renderedHrefs(
  slug: CanonicalLeagueSlug,
): Array<{ label: string; href: string }> {
  const nav = NAV_SLUG[slug];
  const columns = getFooterColumns(slug);
  const out: Array<{ label: string; href: string }> = [];

  for (const col of columns) {
    for (const l of col.links) {
      // Planned pages render as inert text, not links.
      if (l.soon || !l.path) continue;
      out.push({
        label: `${col.title} › ${l.label}`,
        href: resolveDirectoryHref(l.path, nav),
      });
    }
  }
  for (const cut of getDeepCuts(slug, columns)) {
    out.push({
      label: `Deep Cuts › ${cut.label}`,
      href: resolveDirectoryHref(cut.path!, nav),
    });
  }
  // Trophy Case + champion cards, which build hrefs outside the config.
  if (slug !== "best-ball-1") {
    out.push({
      label: "Trophy Case",
      href: resolveDirectoryHref("/franchises", nav),
    });
  }
  for (const champ of getFooterChampions(slug)) {
    out.push({ label: `Champion › ${champ.team}`, href: champ.href });
  }
  const searchPath = getSearchPath(slug);
  if (searchPath) {
    out.push({
      label: "Utility › Search",
      href: resolveDirectoryHref(searchPath, nav),
    });
  }
  return out;
}

describe("every footer link resolves to a real route", () => {
  for (const slug of LEAGUES) {
    describe(slug, () => {
      const hrefs = renderedHrefs(slug);

      it("renders at least one link", () => {
        expect(hrefs.length).toBeGreaterThan(0);
      });

      it("has no dead links", () => {
        const dead = hrefs.filter((h) => !routeExists(h.href));
        expect(
          dead.map((d) => `${d.label} -> ${d.href}`),
          `Footer links with no backing route under src/pages/ for ${slug}`,
        ).toEqual([]);
      });

      it("never points at another league", () => {
        const foreign = hrefs.filter((h) => {
          for (const other of LEAGUES) {
            if (other === slug) continue;
            if (h.href === `/${other}` || h.href.startsWith(`/${other}/`))
              return true;
          }
          return false;
        });
        expect(
          foreign.map((f) => `${f.label} -> ${f.href}`),
          `Footer links leaking into another league from ${slug}`,
        ).toEqual([]);
      });

      it("never double-prefixes", () => {
        const doubled = hrefs.filter((h) =>
          /^\/(theleague|afl-fantasy|best-ball-1)\/(theleague|afl-fantasy|best-ball-1)\//.test(
            h.href,
          ),
        );
        expect(doubled.map((d) => d.href)).toEqual([]);
      });
    });
  }
});

/**
 * Footer links must point at server-rendered pages, for the same reason nav
 * links must: on a league's apex host the bare paths (`/owners`, `/salary`, `/mvp`) are clean
 * URLs rewritten to `/theleague/...` at RUNTIME, so a prerendered page is
 * never reached through the href the footer actually renders.
 *
 * `tests/nav-drawer-links.test.ts` has pinned that rule since the nav
 * redesign — but only for pages listed in `nav-config.json`, which is a
 * narrower set than "pages this site links to". 22 of TheLeague's 46 footer
 * links were outside it, and the gap is silent in both directions: a page in
 * both the nav and the footer is covered by accident, and it stops being
 * covered the moment someone tidies the nav entry away. That is exactly what
 * happened to `/owners` in Sept 2026 — removed from the drawer as a duplicate
 * of the footer entry, correct in itself, and it took the page's prerender
 * guard with it.
 *
 * So the footer asserts it for its own link set. The two guards overlap on
 * purpose: neither registry is the authority on which pages exist, and a page
 * should not lose a correctness check by moving between them.
 */
// Anchored and multiline, matching tests/nav-drawer-links.test.ts. An
// unanchored version matches `// export const prerender = true;` — a comment
// several pages carry to record that they are DELIBERATELY server-rendered,
// which is the opposite of the thing being caught.
const PRERENDER_TRUE_EXPORT = /^\s*export const prerender\s*=\s*true\b/m;

describe("footer links stay server-rendered for clean URL rewrites", () => {
  // Every league with an apex domain gets the rewrite, so every league gets
  // the rule. The nav guard checks TheLeague alone; that predates the AFL
  // having afl-fantasy.com, and there is no reason left for the asymmetry.
  for (const slug of LEAGUES) {
    describe(slug, () => {
      const cols = getFooterColumns(slug);
      const links: Array<{ label: string; path: string }> = [];
      for (const col of cols) {
        for (const l of col.links) {
          if (l.soon || !l.path) continue;
          links.push({ label: `${col.title} \u203a ${l.label}`, path: l.path });
        }
      }
      for (const cut of getDeepCuts(slug, cols)) {
        links.push({ label: `Deep Cuts \u203a ${cut.label}`, path: cut.path! });
      }

      it("covers every rendered footer link", () => {
        expect(links.length).toBeGreaterThan(0);
      });

      it("never links to a prerendered page", () => {
        const prerendered: string[] = [];

        for (const { label, path: linkPath } of links) {
          const rel = resolveDirectoryHref(linkPath, NAV_SLUG[slug])
            .split("?")[0]
            .split("#")[0]
            .replace(/^\/+/, "")
            .replace(/\/$/, "");

          // A footer link with no backing page is the OTHER test's failure; do not
          // double-report it here.
          const sourceFile = [
            path.join(PAGES, `${rel}.astro`),
            path.join(PAGES, rel, "index.astro"),
          ].find((f) => existsSync(f));
          if (!sourceFile) continue;

          if (PRERENDER_TRUE_EXPORT.test(readFileSync(sourceFile, "utf8"))) {
            prerendered.push(`${label} -> ${sourceFile}`);
          }
        }

        expect(
          prerendered,
          `These ${slug} pages are prerendered, so the clean-URL rewrite cannot reach them`,
        ).toEqual([]);
      });
    });
  }
});

describe("pathBelongsToLeague", () => {
  it("treats a BARE directory path as TheLeague, not as shared", () => {
    // The bug: assuming bare == shared invents /afl-fantasy/league-comparison.
    expect(pathBelongsToLeague("/league-comparison", "theleague")).toBe(true);
    expect(pathBelongsToLeague("/league-comparison", "afl-fantasy")).toBe(
      false,
    );
    expect(pathBelongsToLeague("/search", "best-ball-1")).toBe(false);
  });

  it("assigns prefixed paths to their own league", () => {
    expect(pathBelongsToLeague("/afl-fantasy/rosters", "afl-fantasy")).toBe(
      true,
    );
    expect(pathBelongsToLeague("/afl-fantasy/rosters", "theleague")).toBe(
      false,
    );
    expect(pathBelongsToLeague("/best-ball-1/rules", "best-ball-1")).toBe(true);
    expect(pathBelongsToLeague("/theleague/lineup", "theleague")).toBe(true);
  });
});
