import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ALL_LEAGUES } from '../src/config/leagues';
import { astroRouteExists } from './helpers/astro-routes';

/**
 * Every `url:` a push sender attaches has to be a real page.
 *
 * The service worker resolves the url against the origin the subscription was
 * made on (`new URL(url, self.location.origin)`), and each league sits on its
 * own apex domain — so a sender writes the BARE path and the root catch-all
 * (`src/pages/[...path].astro`) maps it into that league's page. Two ways that
 * goes wrong, neither of which anything else notices:
 *
 *   - The path names a route that does not exist. Nothing fails at send time;
 *     the alert arrives, the owner taps it, and gets a 404. That shipped once
 *     already — the game-day alerts pointed at `/live` when the route is
 *     `live-scoring.astro`.
 *   - The path is written league-PREFIXED (`/theleague/lineup`). On the
 *     league's own apex domain that becomes theleague.us/theleague/lineup —
 *     the double-prefixed form a redirect cleans up on the way through, so it
 *     is not a dead link, but every tap pays for a round trip it does not
 *     need and it contradicts the rule the other senders follow. It is also
 *     one edit away from being a genuine cross-league link.
 *
 * Both are cheap to check and impossible to notice by hand, because the only
 * symptom is on a phone, after a real game.
 */

const ROOT = path.resolve(__dirname, '..');
/**
 * Both trees, not just `scripts/`.
 *
 * The first cut walked only the cron senders — and missed a league-prefixed
 * url in `src/pages/api/push/test.ts`, which is the one push every owner sends
 * themselves while deciding whether the feature works.
 */
const SEARCH_DIRS = [path.join(ROOT, 'scripts'), path.join(ROOT, 'src')];

/** Every `url: '/…'` literal in a push sender, with its file for the message. */
function collectSenderUrls(): Array<{ source: string; url: string }> {
  const found: Array<{ source: string; url: string }> = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(mjs|ts)$/.test(entry.name)) continue;
      const src = readFileSync(full, 'utf8');
      // Only files that actually send a push. `url:` is a common key — the
      // page directory, nav config and article types all use it for links
      // that are NOT notification targets and are legitimately prefixed.
      if (!/sendPushToFranchise|sendPushFanout|broadcast\(/.test(src)) continue;
      // Only the object-literal form the senders use. A computed url would not
      // be checkable here.
      for (const m of src.matchAll(/\burl:\s*'(\/[^']*)'/g)) {
        found.push({ source: path.relative(ROOT, full), url: m[1] });
      }
      // Template-literal urls, which is how a prefixed one gets written.
      for (const m of src.matchAll(/\burl:\s*[^'\n]*`(\/[^`]*)`/g)) {
        found.push({ source: path.relative(ROOT, full), url: m[1] });
      }
    }
  };
  for (const dir of SEARCH_DIRS) walk(dir);
  return found;
}

/**
 * Every url literal in a push sender that does NOT start with `/`.
 *
 * The collector above only matches paths, so an ABSOLUTE url was invisible to
 * it — and absolute is the tempting mistake, because the thing you want to
 * link is often off-site. The service worker takes `data.url` only when it
 * `startsWith('/')` and silently rewrites anything else to `/`, so such an
 * alert lands the reader on the homepage while its body promises a deep link.
 * That shipped in the first cut of the job-failure watcher, pointing at
 * `run.html_url` on github.com.
 */
function collectNonRelativeSenderUrls(): Array<{ source: string; url: string }> {
  const found: Array<{ source: string; url: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(mjs|ts)$/.test(entry.name)) continue;
      const src = readFileSync(full, 'utf8');
      // Senders, AND the pure modules that BUILD payloads for them.
      //
      // Matching only on a sender call was how the first version of this guard
      // passed while the bug was present: `scripts/lib/job-failures.mjs`
      // composes the notification and `scripts/push-job-failures.mjs` sends
      // it, so the file holding the bad url called no sender at all. The
      // payload SHAPE is the reliable signal — title + body + tag together is
      // a push notification and essentially nothing else.
      const isSender = /sendPushToFranchise|sendPushFanout|sendOpsAlert|broadcast\(/.test(src);
      const buildsPayload = /\btitle:/.test(src) && /\bbody:/.test(src) && /\btag:/.test(src);
      if (!isSender && !buildsPayload) continue;
      for (const m of src.matchAll(/\burl:\s*(?:'([^']*)'|`([^`]*)`)/g)) {
        const value = m[1] ?? m[2] ?? '';
        // A `${...}` at the very start is a computed path this cannot judge.
        if (value.startsWith('/') || value.startsWith('${')) continue;
        found.push({ source: path.relative(ROOT, full), url: value });
      }
    }
  };
  for (const dir of SEARCH_DIRS) walk(dir);
  return found;
}

const senderUrls = collectSenderUrls();

/**
 * Only leagues that can actually receive a push.
 *
 * Defined by having a `/notifications` page, because that page is where an
 * owner subscribes — a league without one has no subscribers, so a path that
 * does not resolve there cannot 404 anybody. Best Ball is the case today: it
 * is draft-only, and has no lineup, news or Pecking Order page to link to.
 * Derived rather than listed, so adding the page to a league also starts
 * checking its routes.
 */
const PUSH_LEAGUES = ALL_LEAGUES.filter((l) => astroRouteExists(`/${l.slug}/notifications`));

describe('push notification target URLs', () => {
  it('has at least the two leagues that send push today', () => {
    expect(PUSH_LEAGUES.length).toBeGreaterThanOrEqual(2);
  });

  it('finds the senders at all — a silent zero would pass every check below', () => {
    expect(senderUrls.length).toBeGreaterThan(4);
  });

  it('never attaches a url the service worker will throw away', () => {
    // public/sw.js: `data.url.startsWith('/') ? data.url : '/'`. An absolute
    // url is not a link, it is a promise of one that silently resolves to the
    // homepage — so it must be caught here rather than on somebody's phone.
    const offenders = collectNonRelativeSenderUrls();
    expect(
      offenders,
      `These push urls do not start with '/', so the service worker rewrites ` +
        `them to '/' and the notification opens the homepage instead:\n  ` +
        offenders.map((o) => `${o.source}: ${o.url}`).join('\n  '),
    ).toEqual([]);
  });

  it('every url resolves to a real route in EVERY league that can send it', () => {
    const broken: string[] = [];
    for (const { source, url } of senderUrls) {
      for (const league of PUSH_LEAGUES) {
        if (!astroRouteExists(`/${league.slug}${url}`)) {
          broken.push(`${source}: "${url}" → no /${league.slug}${url}`);
        }
      }
    }
    expect(
      broken,
      'A push url with no matching route lands the owner who taps it nowhere:\n  '
        + broken.join('\n  '),
    ).toEqual([]);
  });

  it('no url is league-prefixed — the service worker is already on the right origin', () => {
    const prefixes = ALL_LEAGUES.map((l) => `/${l.slug}`);
    const prefixed = senderUrls.filter(({ url }) =>
      prefixes.some((p) => url === p || url.startsWith(`${p}/`)),
    );
    expect(
      prefixed.map((p) => `${p.source}: ${p.url}`),
      'A league-prefixed push url double-prefixes on the league’s own domain — '
        + 'a redirect round trip on every tap, and a cross-league link one edit away',
    ).toEqual([]);
  });
});
