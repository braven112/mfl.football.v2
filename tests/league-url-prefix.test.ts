import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_LEAGUES,
  leagueUrl,
  stripLeaguePrefix,
  ensureLeaguePrefix,
  buildHostToSlugMap,
} from '../src/config/leagues';
import { ANNOUNCE_TARGETS, buildDeepLink, announcePostId } from '../src/utils/schefter-announce-core.mjs';
import { SCHEFTER_LEAGUES } from '../scripts/lib/schefter-leagues.mjs';
import { buildGroupMePromo as cutWatchPromo } from '../scripts/article-types/cut-watch.mjs';
import { buildGroupMePromo as gauntletPromo } from '../scripts/article-types/schedule-strength.mjs';

/**
 * Redundant-league-prefix guard.
 *
 * Internal routes are stored PREFIXED (`/theleague/calendar`) because that's
 * the real Astro route and the only form that resolves on the shared host.
 * A league's own apex domain serves the BARE path (middleware rewrite), and
 * vercel.json 301s the prefixed form back to it — so concatenating an origin
 * with a prefixed path produces owner-facing links that read
 * `theleague.us/theleague/calendar` and burn a redirect hop.
 *
 * That shipped in Roger's reminders, Schefter's Trade Builder CTAs, both
 * article promos, the August-cut touches, and the AFL announcement deep link
 * (Aug 2026). `leagueUrl()` is the fix; these tests exercise the real
 * builders so a hand-rolled concatenation can't creep back in.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Every league's own prefix, as it would appear doubled in a URL. */
const DOUBLED_PREFIXES = ALL_LEAGUES.flatMap((l) =>
  (l.domains ?? []).map((d) => `${d}/${l.slug}`),
);

function expectNoDoubledPrefix(text: string) {
  for (const bad of DOUBLED_PREFIXES) {
    expect(text, `"${bad}" is a redundant prefix — use leagueUrl()`).not.toContain(bad);
  }
}

describe('Schefter league table — absolute URLs are prefix-free and cookie-safe', () => {
  for (const league of SCHEFTER_LEAGUES) {
    it(`${league.slug}: baseUrl / calendarUrl / url() drop the league prefix`, () => {
      expectNoDoubledPrefix(league.baseUrl);
      expectNoDoubledPrefix(league.calendarUrl);
      expectNoDoubledPrefix(league.url(`/${league.registrySlug}/live-scoring`));

      // Roger's reminder CTA — the lane that shipped the bug.
      expect(league.calendarUrl).toBe(`${league.baseUrl}/calendar`);

      // Cookie-safe canonical host: session cookies are host-only, so a bare
      // apex link opens logged-out (see leagueOrigin in the registry).
      expect(league.baseUrl.startsWith('https://www.')).toBe(true);
    });
  }

  it('keeps a CROSS-league prefix — only a league\'s own slug is redundant', () => {
    const tl = SCHEFTER_LEAGUES.find((l) => l.slug === 'theleague')!;
    expect(tl.url('/afl-fantasy/standings')).toBe(
      'https://www.theleague.us/afl-fantasy/standings',
    );
  });
});

describe('article GroupMe promos link the article without a doubled prefix', () => {
  it('cut watch', () => {
    const text = cutWatchPromo(
      { link: '/theleague/news/sf_2026_cut_watch_0814' },
      { overLimit: [{ name: 'Pacific Pigskins', count: 25, over: 3, hasPlan: false }] },
      { league: 'theleague', now: new Date('2026-08-14T12:00:00-07:00') },
    );
    expect(text).toContain('https://www.theleague.us/news/sf_2026_cut_watch_0814');
    expectNoDoubledPrefix(text as string);
  });

  it('the gauntlet (both leagues)', () => {
    for (const [league, host] of [
      ['theleague', 'https://www.theleague.us'],
      ['afl-fantasy', 'https://www.afl-fantasy.com'],
    ] as const) {
      const text = gauntletPromo(
        { link: `/${league}/news/sf_2026_gauntlet_w05` },
        { hardest: { name: 'A', difficulty: 88 }, easiest: { name: 'B' }, week: 5 },
        { league },
      );
      expect(text).toContain(`${host}/news/sf_2026_gauntlet_w05`);
      expectNoDoubledPrefix(text as string);
    }
  });
});

describe('announcement deep links', () => {
  for (const [key, target] of Object.entries(ANNOUNCE_TARGETS)) {
    it(`${key}: news path carries no league prefix`, () => {
      const link = buildDeepLink({
        baseUrl: target.baseUrl,
        newsPath: target.newsPath,
        postId: announcePostId('demo'),
      });
      expect(target.newsPath).toBe('/news');
      expectNoDoubledPrefix(link);
    });

    it(`${key}: baseUrl is the canonical (cookie-safe) www host`, () => {
      // The deep link ships in a GroupMe message; session cookies are
      // host-only, so a bare-apex link opens the reader logged-out.
      expect(target.baseUrl).toMatch(/^https:\/\/www\./);
      const league = ALL_LEAGUES.find((l) => l.navSlug === target.navSlug)!;
      expect(target.baseUrl).toBe(`https://${league.canonicalDomain}`);
    });
  }
});

describe('scanner sources build absolute URLs through the registry helper', () => {
  it('the rumor scanner routes CTA URLs through publicUrl(), not raw concatenation', () => {
    const src = read('scripts/schefter-rumor-scan.mjs');
    // The helper honors a SCHEFTER_PUBLIC_BASE_URL override (preview deploys
    // need the prefix) and only strips on the league's own apex host.
    expect(src).toMatch(/const\s+publicUrl\s*=\s*\(p\)\s*=>/);
    expect(src).toMatch(/groupMeUrl:\s*publicUrl\(path\)/);
    // No hand-rolled origin + prefixed-path concatenation left.
    expect(src).not.toMatch(/groupMeUrl:\s*`\$\{PUBLIC_BASE_URL\}\$\{path\}`/);
    // Own-apex detection is registry-derived, not a string compare against the
    // canonical origin — an operator can spell the same host many ways.
    expect(src).toMatch(/buildHostToSlugMap\(\)/);
    expect(src).not.toMatch(/PUBLIC_BASE_URL === SCHEFTER_LEAGUE\.baseUrl/);
    // ...and it requires the apex ROOT, not just a matching hostname: a
    // non-default port or a path suffix isn't served by the rewrite.
    expect(src).toMatch(/u\.port !== ''/);
    expect(src).toMatch(/u\.pathname !== '\/'/);
    // The base is normalized (query/fragment dropped) before anything is
    // concatenated onto it, and an unparseable override dies at startup
    // rather than poisoning every CTA the run ships.
    expect(src).toMatch(/function normalizeBaseUrl/);
    expect(src).toMatch(/const PUBLIC_BASE_URL = normalizeBaseUrl\(/);
    // The tip path is PREFIXED — post.link is persisted and rendered raw, and
    // the bare form 404s on the shared host.
    expect(src).toMatch(/const\s+TIP_PAGE_PATH\s*=\s*`\/\$\{LEAGUE_SLUG\}\/schefter\/tip`/);
  });

  it('every apex-ROOT spelling strips; everything else keeps the prefix', () => {
    // Mirrors the scanner's isOwnApexBase() + publicUrl() decision. The rule
    // is "is this base a place the middleware rewrite actually runs", which is
    // the apex hostname AT THE ROOT on the default port — not merely a URL
    // that happens to share the hostname.
    const tl = ALL_LEAGUES.find((l) => l.slug === 'theleague')!;
    const hostMap = buildHostToSlugMap();
    const isOwnApexBase = (base: string) => {
      let u: URL;
      try { u = new URL(base); } catch { return false; }
      if (u.port !== '') return false;
      if (u.pathname !== '/' && u.pathname !== '') return false;
      if (u.search !== '' || u.hash !== '') return false;
      return hostMap[u.hostname.toLowerCase()] === tl.slug;
    };
    const decide = (base: string) => {
      const P = base.replace(/\/+$/, '');
      const p = '/theleague/trade-builder?b=0003';
      return isOwnApexBase(base)
        ? `${P}${stripLeaguePrefix(tl, p)}`
        : `${P}${ensureLeaguePrefix(tl, p)}`;
    };

    // Equivalent spellings of the apex ROOT — every one must strip. A string
    // compare against the canonical origin would only catch the first.
    for (const base of [
      'https://www.theleague.us',
      'https://theleague.us',
      'https://WWW.THELEAGUE.US',
      'http://www.theleague.us',
      'https://www.theleague.us:443',
      'http://www.theleague.us:80',
      'https://www.theleague.us/',
    ]) {
      expect(decide(base), `${base} should strip`).toMatch(/\/trade-builder\?b=0003$/);
      expectNoDoubledPrefix(decide(base));
    }

    // Same hostname, but NOT the apex root — a non-default port or a path
    // suffix isn't served by the rewrite, so stripping there yields a path
    // nothing serves. These must keep the prefix.
    for (const base of [
      'https://www.theleague.us:444',
      'http://www.theleague.us:8080',
      'https://www.theleague.us/preview',
      // Shared host and previews: no rewrite at all.
      'https://mfl.football',
      'https://mflfootballv2-git-x.vercel.app',
      'not a url',
    ]) {
      expect(decide(base), `${base} should keep the prefix`).toContain(
        '/theleague/trade-builder',
      );
    }
  });

  it('the transaction scanner builds Roger link overrides with league.url()', () => {
    const src = read('scripts/schefter-scan.mjs');
    expect(src).toMatch(/groupMeUrlOverrides\.set\(postId,\s*league\.url\(link\)\)/);
    expect(src).not.toMatch(/`\$\{league\.baseUrl\}\$\{link\}`/);
  });

  it('the August-cut Roger touches link rosters through leagueUrl()', () => {
    const src = read('scripts/apply-august-cuts.mjs');
    expect(src).toMatch(/const\s+ROSTERS_URL\s*=\s*leagueUrl\(/);
    expectNoDoubledPrefix(src);
  });
});

describe('leagueUrl is the only sanctioned builder', () => {
  it('produces a prefix-free URL for every league page path', () => {
    for (const league of ALL_LEAGUES) {
      if (league.domains.length === 0) continue; // path-only league keeps its prefix
      expectNoDoubledPrefix(leagueUrl(league, `/${league.slug}/calendar`));
    }
  });
});
