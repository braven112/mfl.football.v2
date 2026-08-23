import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DESTINATIONS,
  hasDestination,
  articleLink,
  primaryLink,
  featureLink,
  linkList,
  applyArticleLinks,
  linkDirective,
  withLinkDirective,
} from '../scripts/article-utils/article-links.mjs';
import { LEAGUES, ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { astroRouteExists } from './helpers/astro-routes';

/**
 * Schefter has to link to the thing he is talking about.
 *
 * The 2026 schedule-release column ran eight paragraphs about a schedule and
 * never linked to the schedule release page — the one page the whole article
 * existed to point at. It was not a one-off: a `grep '<a '` over the published
 * feed at the time returned ZERO across 396 posts. No article type had ever
 * emitted a link, and nothing would have told us.
 *
 * These tests are the "never again" half. They cover the three places it can
 * break: a type that declares no link, a link to a page that does not exist,
 * and a model that ignores the instruction at generation time.
 */

const TYPES_DIR = path.resolve(__dirname, '../scripts/article-types');
const PIPELINE = path.resolve(__dirname, '../scripts/schefter-weekly-articles.mjs');

const typeFiles = readdirSync(TYPES_DIR).filter((f) => f.endsWith('.mjs')).sort();

/** Leagues the pipeline will accept on --league, read from the pipeline itself. */
const pipelineLeagues = (): string[] => {
  const src = readFileSync(PIPELINE, 'utf8');
  const m = src.match(/const VALID_LEAGUES = \[([^\]]*)\]/);
  if (!m) throw new Error('VALID_LEAGUES not found in the pipeline');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

/**
 * Does an href resolve to a real Astro route? See tests/helpers/astro-routes.
 * Dynamic segments count — an article permalink is served by `news/[id].astro`,
 * and a literal-file-only check would call every such link broken.
 */
const routeExists = astroRouteExists;

describe('the route resolver itself', () => {
  it('resolves a dynamic article permalink, which a literal-file check would call broken', () => {
    expect(routeExists('/theleague/news/sf_2026_cut_watch_0802')).toBe(true);
    expect(routeExists('/theleague/power-rankings/2026')).toBe(true);
    expect(routeExists('/theleague/pecking-order')).toBe(true);
  });

  it('still says no to a page that does not exist', () => {
    // The root [...path].astro catch-all would otherwise make every string a
    // valid route and this whole guard a no-op that reports green.
    expect(routeExists('/theleague/nope')).toBe(false);
    expect(routeExists('/theleague/keepers')).toBe(false); // AFL-only
    expect(routeExists('/schefter/tip')).toBe(false); // unprefixed: 404s on the shared host
  });

  it('strips the query before resolving', () => {
    expect(routeExists('/theleague/trade-builder?b=0012')).toBe(true);
    expect(routeExists('/theleague/rosters?view=coach')).toBe(true);
  });
});

describe('article links — destinations are real pages', () => {
  const leagues = pipelineLeagues();

  it('the pipeline accepts more than one league (sanity)', () => {
    expect(leagues.length).toBeGreaterThan(1);
  });

  // Checked BOTH ways. A listed league that lacks the page is a dead link in
  // an article nobody re-reads; an unlisted league that HAS the page is a
  // feature Schefter is silently not allowed to mention there, which is the
  // failure mode that hides — nothing breaks, the plug just never appears.
  for (const league of pipelineLeagues()) {
    for (const [key, destination] of Object.entries(DESTINATIONS)) {
      const listed = destination.leagues.includes(league);
      it(`${league}: ${key} is ${listed ? 'listed and real' : 'correctly absent'}`, () => {
        const href = `/${LEAGUES[league].slug}${destination.path}`;
        expect(
          routeExists(href),
          listed
            ? `${key} is listed for ${league} but ${href} has no route`
            : `${league} HAS ${href} — add '${league}' to DESTINATIONS.${key}.leagues so Schefter can plug it`,
        ).toBe(listed);
        expect(hasDestination(league, key)).toBe(listed);
      });
    }
  }

  it('rejects an unknown destination rather than emitting a guessed path', () => {
    expect(() => articleLink('theleague', 'not-a-page' as never)).toThrow(/unknown destination/);
    expect(() => articleLink('not-a-league', 'standings')).toThrow(/unknown league/);
  });

  it('returns null — not a broken link — for a page the league lacks', () => {
    // The AFL has no salary cap, so cap-flavoured plugs simply drop out.
    expect(articleLink('afl-fantasy', 'contracts')).toBeNull();
    expect(featureLink('afl-fantasy', 'calculator')).toBeNull();
    expect(articleLink('theleague', 'keepers')).toBeNull();
    expect(linkList(articleLink('afl-fantasy', 'contracts'), articleLink('afl-fantasy', 'standings'))).toHaveLength(1);
  });

  it('throws on a PRIMARY link the league lacks, rather than publishing a linkless column', () => {
    expect(() => primaryLink('afl-fantasy', 'contracts')).toThrow(/has no "contracts" page/);
  });

  it('uses the per-league label where the same path is a different page', () => {
    // /activity is owner-visit tracking in TheLeague and the transaction log
    // in the AFL. One label would promise the wrong page in one of them.
    expect(articleLink('theleague', 'activity')!.label).toBe('the activity tracker');
    expect(articleLink('afl-fantasy', 'activity')!.label).toBe('the transaction log');
  });

  it('prefixes the league, and leaves an already-prefixed path alone', () => {
    expect(articleLink('theleague', 'standings').href).toBe('/theleague/standings');
    expect(articleLink('afl-fantasy', 'standings').href).toBe('/afl-fantasy/standings');
    // Both leagues are real registry entries, so a typo'd slug can't pass.
    expect(LEAGUES['theleague']).toBeTruthy();
    expect(LEAGUES['afl-fantasy']).toBeTruthy();
  });
});

describe('article links — every type declares where it points', () => {
  for (const file of typeFiles) {
    for (const league of pipelineLeagues()) {
      it(`${file} (${league}) declares exactly one primary link, all resolvable`, async () => {
        const mod = await import(path.join(TYPES_DIR, file));
        const links = mod.relatedLinks({ year: 2026, week: 1 }, { league });

        expect(Array.isArray(links), `${file}: relatedLinks must return an array`).toBe(true);
        expect(links.length, `${file}: an article with no links is the bug this guards`).toBeGreaterThan(0);

        const primaries = links.filter((l: { primary?: boolean }) => l.primary);
        expect(
          primaries.length,
          `${file}: exactly one link is THE thing the article is about — got ${primaries.length}`,
        ).toBe(1);

        for (const link of links) {
          expect(link.href.startsWith(`/${LEAGUES[league].slug}/`), `${file}: ${link.href} is not scoped to ${league}`).toBe(true);
          expect(routeExists(link.href), `${file}: ${link.href} has no route under src/pages/`).toBe(true);
          expect(link.label?.trim(), `${file}: ${link.href} has no anchor text`).toBeTruthy();
          expect(link.cta?.trim(), `${file}: ${link.href} has no fallback call-to-action`).toBeTruthy();
        }

        // No duplicate destinations — the same page offered twice reads as
        // two different suggestions to the model and gets linked twice.
        const hrefs = links.map((l: { href: string }) => l.href);
        expect(new Set(hrefs).size, `${file}: duplicate destination in relatedLinks`).toBe(hrefs.length);
      });

      it(`${file} (${league}) offers site features to plug`, () => {
        // Referencing site features is a standing goal, not an accident of
        // whichever type someone remembered. Every column gets something to
        // promote in every league, or the goal is only half-implemented.
        return import(path.join(TYPES_DIR, file)).then((mod) => {
          const promos = mod
            .relatedLinks({ year: 2026, week: 1 }, { league })
            .filter((l: { promo?: boolean }) => l.promo);
          expect(
            promos.length,
            `${file}: no site features offered for ${league} — Schefter has nothing to plug`,
          ).toBeGreaterThan(0);
          for (const p of promos) {
            expect(p.primary, `${file}: a link cannot be both the subject and a plug`).toBe(false);
          }
        });
      });
    }
  }

  it('schedule-release leads with the schedule release page', async () => {
    // The specific regression: this column exists to send people to that page.
    const mod = await import(path.join(TYPES_DIR, 'schedule-release.mjs'));
    for (const league of pipelineLeagues()) {
      const links = mod.relatedLinks({}, { league });
      const primary = links.find((l: { primary?: boolean }) => l.primary);
      expect(primary.href).toBe(`/${LEAGUES[league].slug}/schedule-release`);
    }
  });
});

describe('article links — the prompt directive', () => {
  const links = [
    primaryLink('theleague', 'schedule-release', { label: 'the full schedule release' }),
    articleLink('theleague', 'rivalries'),
  ];

  it('asks for a feature plug, and says why it must not be forced', () => {
    const withPromo = [...links, featureLink('theleague', 'trade-builder')];
    const directive = linkDirective(withPromo);
    expect(directive).toContain('SITE FEATURES');
    expect(directive).toContain('<a href="/theleague/trade-builder">the trade builder</a>');
    expect(directive).toMatch(/plug at least ONE/);
    expect(directive).toMatch(/forced plug is worse than none/);
  });

  it('omits the feature section entirely when there is nothing to plug', () => {
    expect(linkDirective(links)).not.toContain('SITE FEATURES');
  });

  it('hands the model copy-ready anchors, not a description of a link', () => {
    const directive = linkDirective(links);
    expect(directive).toContain('<a href="/theleague/schedule-release">the full schedule release</a>');
    expect(directive).toContain('<a href="/theleague/rivalries">');
    expect(directive).toMatch(/Never invent an href/);
  });

  it('appends to the fact sheet without disturbing it', () => {
    const sheet = 'LEAGUE: The League\nSEASON: 2026';
    const combined = withLinkDirective(sheet, links);
    expect(combined.startsWith(sheet)).toBe(true);
    expect(combined).toContain('/theleague/schedule-release');
  });

  it('is empty when a type genuinely has no links, rather than emitting a stub', () => {
    expect(linkDirective([])).toBe('');
    expect(withLinkDirective('SHEET', [])).toBe('SHEET');
  });
});

describe('article links — enforcement on the built post', () => {
  const links = () => [
    primaryLink('theleague', 'schedule-release', {
      label: 'the full schedule release',
      cta: 'Go see the whole thing on the schedule release page.',
    }),
    articleLink('theleague', 'rivalries'),
  ];

  it('leaves an article that already links correctly untouched', () => {
    const post = {
      content: [
        '<p>The schedule is out.</p>',
        '<p>Go read <a href="/theleague/schedule-release">the full schedule release</a>.</p>',
      ],
    };
    const { post: out, notices } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(notices).toEqual([]);
    expect(out.content).toHaveLength(2);
    expect(out.content[1]).toContain('href="/theleague/schedule-release"');
  });

  it('injects the primary link when the model ignored the instruction', () => {
    // This is the 2026 column, verbatim in shape: eight paragraphs, no links.
    const post = { content: ['<p>Boom! The schedule is out.</p>', '<p>Week 1 is a rivalry game.</p>'] };
    const { post: out, notices } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(notices.some((n) => n.includes('injected'))).toBe(true);
    expect(out.content.join('')).toContain('href="/theleague/schedule-release"');
    // High in the article, not buried under the column — a link nobody
    // scrolls to is the same as no link.
    expect(out.content[1]).toContain('href="/theleague/schedule-release"');
  });

  it('never injects a FEATURE PLUG the model could not fit', () => {
    // A plug that had to be wedged in reads as an ad. Offered, never forced.
    const withPromo = [...links(), featureLink('theleague', 'trade-builder')];
    const post = {
      content: ['<p>Out now.</p>', '<p>See <a href="/theleague/schedule-release">the reveal</a>.</p>'],
    };
    const { post: out, notices } = applyArticleLinks(post, withPromo, { league: 'theleague' });
    expect(out.content.join('')).not.toContain('/theleague/trade-builder');
    expect(notices).toEqual([]);
  });

  it('does not inject a SECONDARY link the model chose not to use', () => {
    const post = {
      content: ['<p>Out now.</p>', '<p>See <a href="/theleague/schedule-release">the reveal</a>.</p>'],
    };
    const { post: out } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(out.content.join('')).not.toContain('/theleague/rivalries');
  });

  it('unwraps an invented href instead of shipping a 404', () => {
    const post = {
      content: [
        '<p>Read <a href="/theleague/schedule">the schedule</a> and <a href="https://example.com/x">this</a>.</p>',
        '<p><a href="/theleague/schedule-release">the reveal</a></p>',
      ],
    };
    const { post: out, notices } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(out.content[0]).toBe('<p>Read the schedule and this.</p>');
    expect(notices.filter((n) => n.startsWith('stripped'))).toHaveLength(2);
  });

  it('repairs the unprefixed spelling the site nav uses', () => {
    // On an apex domain the nav renders /schedule-release, so a model with
    // both spellings in context reaches for the short one. That is a repair,
    // not a strip — it can only ever map back to this league's own page.
    const post = { content: ['<p>a</p>', '<p><a href="/schedule-release">go</a></p>'] };
    const { post: out, notices } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(out.content[1]).toBe('<p><a href="/theleague/schedule-release">go</a></p>');
    expect(notices).toEqual([]);
  });

  it('accepts an absolute URL to the same page and normalises it to a path', () => {
    const post = { content: ['<p>a</p>', '<p><a href="https://www.theleague.us/schedule-release/">go</a></p>'] };
    const { post: out } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(out.content[1]).toBe('<p><a href="/theleague/schedule-release">go</a></p>');
  });

  it('strips attributes the model decorated the anchor with', () => {
    const post = {
      content: ['<p>a</p>', '<p><a href="/theleague/schedule-release" target="_blank" onclick="x()">go</a></p>'],
    };
    const { post: out } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(out.content[1]).not.toContain('onclick');
    expect(out.content[1]).not.toContain('target');
  });

  it('sanitizes the EXCERPT, which the feed card also renders with set:html', () => {
    // `post.body` is a string, not an array, and SchefterPostCard renders it
    // raw — so an href invented there shipped unvalidated past every other
    // check, including the published-feed guard.
    const post = {
      content: ['<p>a</p>', '<p><a href="/theleague/schedule-release">the reveal</a></p>'],
      body: 'Teaser with <a href="/theleague/invented">a made-up link</a>.',
    };
    const { post: out, notices } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(out.body).toBe('Teaser with a made-up link.');
    expect(notices.some((n) => n.startsWith('stripped'))).toBe(true);
  });

  it('does NOT let a link in the excerpt satisfy the primary-link requirement', () => {
    // The excerpt is a teaser on a card that is itself a link to the article.
    // Counting it would let the article body ship with nothing to click.
    const post = {
      content: ['<p>a</p>', '<p>b</p>'],
      body: 'See <a href="/theleague/schedule-release">the reveal</a>.',
    };
    const { post: out, notices } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(notices.some((n) => n.includes('injected'))).toBe(true);
    expect(out.content.join('')).toContain('href="/theleague/schedule-release"');
  });

  it('does not rewrite an EXTERNAL url whose path collides with a destination', () => {
    // Dropping the host from any absolute URL turns somebody else's link into
    // one of ours, silently. Only our own hosts collapse to a path.
    const post = {
      content: [
        '<p><a href="https://example.com/theleague/schedule-release">not ours</a></p>',
        '<p><a href="/theleague/schedule-release">ours</a></p>',
      ],
    };
    const { post: out, notices } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(out.content[0]).toBe('<p>not ours</p>');
    expect(notices.some((n) => n.includes('example.com'))).toBe(true);
  });

  it('writes an empty paragraph, not the text "null", for a malformed response', () => {
    const post = { content: ['<p><a href="/theleague/schedule-release">x</a></p>', null] };
    const { post: out } = applyArticleLinks(post as never, links(), { league: 'theleague' });
    expect(out.content[1]).toBe('');
  });

  it('covers the grade-card shape, not just content[]', () => {
    // draft-grades / team-grades put prose in intro[] + grades[].body. Those
    // were the one place a hallucinated href could still have shipped.
    const post = {
      intro: ['<p>Grades are in.</p>'],
      grades: [{ franchiseId: '0001', body: 'Nice haul — <a href="/theleague/made-up">see it</a>.' }],
    };
    const { post: out, notices } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(out.grades[0].body).toBe('Nice haul — see it.');
    expect(notices.some((n) => n.startsWith('stripped'))).toBe(true);
    // The primary link still has to land somewhere the reader sees.
    expect(out.intro.join('')).toContain('href="/theleague/schedule-release"');
  });

  it('counts a link inside a grade card as present', () => {
    const post = {
      intro: ['<p>Grades are in.</p>'],
      grades: [{ franchiseId: '0001', body: '<a href="/theleague/schedule-release">the reveal</a>' }],
    };
    const { post: out, notices } = applyArticleLinks(post, links(), { league: 'theleague' });
    expect(notices).toEqual([]);
    expect(out.intro).toHaveLength(1);
  });

  it('is a no-op on a post with no declared links', () => {
    const post = { content: ['<p>a</p>'] };
    const { post: out, notices } = applyArticleLinks(post, [], { league: 'theleague' });
    expect(out.content).toEqual(['<p>a</p>']);
    expect(notices).toEqual([]);
  });
});

describe('article links — the pipeline actually runs the enforcement', () => {
  const src = readFileSync(PIPELINE, 'utf8');

  it('appends the directive to the fact sheet before the model call', () => {
    expect(src).toMatch(/getUserPrompt\(withLinkDirective\(factSheet, links\)\)/);
  });

  it('applies the links to the post BEFORE it is written to the feed', () => {
    const applyAt = src.indexOf('applyArticleLinks(post');
    const appendAt = src.indexOf('appendToFeed(feedPath, post)');
    expect(applyAt).toBeGreaterThan(-1);
    expect(appendAt).toBeGreaterThan(-1);
    expect(applyAt, 'enforcement must run before the feed write, or it enforces nothing').toBeLessThan(appendAt);
  });

  it('calls relatedLinks unguarded, so the interface test can demand it', () => {
    // If this call is ever wrapped in `typeof mod.relatedLinks === 'function'`,
    // article-type-interface.test.ts stops requiring it and a new type can
    // ship linkless again.
    expect(src).toMatch(/mod\.relatedLinks\(/);
    expect(src).not.toMatch(/typeof\s+mod\.relatedLinks\s*===/);
  });
});

/**
 * The published feeds, not just the generator.
 *
 * The generator guarantees future articles. These check the articles that are
 * live on the news page RIGHT NOW, which is where the complaint started: a
 * schedule-release column that never linked to the schedule release page.
 * They also catch a hand-edited feed, which no amount of pipeline enforcement
 * would.
 */
describe('published articles carry their links', () => {
  const feeds = ALL_LEAGUES
    .map((league) => ({
      league,
      file: path.resolve(__dirname, '..', ...String(league.schefterFeedPath).split('/')),
    }))
    .filter(({ file }) => existsSync(file));

  it('finds the feeds (sanity — a moved feed must not silently skip this suite)', () => {
    expect(feeds.length).toBeGreaterThan(0);
  });

  for (const { league, file } of feeds) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const posts = (Array.isArray(raw) ? raw : raw.posts) ?? [];
    const articles = posts.filter((p: { type?: string }) => p.type === 'article');
    const prose = (p: { content?: string[]; intro?: string[]; grades?: { body?: string }[] }) =>
      [...(p.content ?? []), ...(p.intro ?? []), ...(p.grades ?? []).map((g) => g.body ?? '')].join('');

    for (const post of articles) {
      it(`${league.slug}: "${post.headline}" links somewhere`, () => {
        expect(prose(post)).toContain('<a href="');
      });

      it(`${league.slug}: "${post.headline}" links only to real pages`, () => {
        const hrefs = [...prose(post).matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
        for (const href of hrefs) {
          expect(href.startsWith('/'), `${href} is not a root-relative internal link`).toBe(true);
          expect(routeExists(href), `${post.id} links to ${href}, which has no route`).toBe(true);
        }
      });
    }

    it(`${league.slug}: the schedule-release column points at the schedule release page`, () => {
      // The original regression, pinned against the shipped data.
      const release = articles.find((p: { id: string }) => p.id.includes('schedule_release'));
      if (!release) return; // league hasn't run one yet
      expect(prose(release)).toContain(`href="/${league.slug}/schedule-release"`);
    });
  }
});
