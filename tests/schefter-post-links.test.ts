import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  tradeBuilderPath,
  tipPagePath,
  transactionCta,
  defaultTransactionCta,
  franchiseDeepLinkAllowed,
  franchiseIdsInLink,
  FRANCHISE_NAMING_SCOPES,
  TRANSACTION_CTA_KINDS,
} from '../scripts/lib/schefter-links.mjs';
import { LEAGUES, ALL_LEAGUES } from '../src/config/leagues-data.mjs';
import { astroRouteExists } from './helpers/astro-routes';

/**
 * Links on the SHORT Schefter posts — transactions, rumors, speculation.
 *
 * The article pipeline is covered by schefter-links.test.ts. These are the
 * other three producers, and each had its own version of the same problem:
 * transaction posts carried no link at all (19 of 19 in TheLeague's feed),
 * trade-speculation posts named two teams and two players and offered nothing
 * to click, and the rumor mill's deep link named a franchise its own prose was
 * forbidden from naming.
 */

const routeExists = astroRouteExists;
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const LEAGUE_SLUGS = ['theleague', 'afl-fantasy'];

describe('deep links use the params each league actually reads', () => {
  /**
   * The two Trade Builders are different implementations. TheLeague's is a
   * React island restoring `?a`/`?b` client-side; the AFL's is server-rendered
   * on `?from`/`?to`. The rumor mill hardcoded `?b=` for both, so every AFL
   * trade CTA opened an empty builder — no 404, just a silently dead deep
   * link, which is why it survived.
   */
  it('TheLeague reads a/b; the AFL reads from/to', () => {
    expect(tradeBuilderPath('theleague', { us: '0001', them: '0012' })).toBe(
      '/theleague/trade-builder?a=0001&b=0012',
    );
    expect(tradeBuilderPath('afl-fantasy', { us: '0001', them: '0022' })).toBe(
      '/afl-fantasy/trade-builder?from=0001&to=0022',
    );
  });

  it('every param it emits is one the destination page parses', () => {
    // Read from the pages themselves, so a rename on either side fails here
    // rather than shipping a link nothing reads.
    const tl = read('src/utils/trade-calculations.ts');
    for (const p of ['a', 'b', 'ap', 'bp']) {
      expect(tl, `TheLeague builder no longer reads ?${p}=`).toContain(`params.get('${p}')`);
    }
    const afl = read('src/pages/afl-fantasy/trade-builder.astro');
    for (const p of ['from', 'to', 'player', 'target']) {
      expect(afl, `the AFL builder no longer reads ?${p}=`).toContain(`searchParams.get('${p}')`);
    }
  });

  it('drops the extra players the AFL builder cannot hold, rather than sending a list it ignores', () => {
    // TheLeague restores a whole side; the AFL pre-selects exactly one player.
    // A comma-joined list would match no player and silently select nothing.
    expect(tradeBuilderPath('theleague', { usPlayers: ['1', '2'], themPlayers: ['3'] })).toBe(
      '/theleague/trade-builder?ap=1%2C2&bp=3',
    );
    expect(tradeBuilderPath('afl-fantasy', { usPlayers: ['1', '2'], themPlayers: ['3'] })).toBe(
      '/afl-fantasy/trade-builder?player=1&target=3',
    );
  });

  it('returns the bare builder when there is no franchise to pre-load', () => {
    for (const league of LEAGUE_SLUGS) {
      expect(tradeBuilderPath(league)).toBe(`/${LEAGUES[league].slug}/trade-builder`);
      expect(routeExists(tradeBuilderPath(league))).toBe(true);
    }
  });

  it('builds tip-page paths that resolve, prefixed', () => {
    for (const league of LEAGUE_SLUGS) {
      const bare = tipPagePath(league);
      expect(bare).toBe(`/${LEAGUES[league].slug}/schefter/tip`);
      expect(routeExists(bare)).toBe(true);
      expect(tipPagePath(league, { target: '0003' })).toBe(`${bare}?target=0003`);
    }
  });

  it('rejects an unknown league rather than emitting an unprefixed path', () => {
    // An unprefixed `/schefter/tip` resolves ONLY on a league apex host; on the
    // shared host it falls through to the 404 catch-all.
    expect(() => tradeBuilderPath('nope')).toThrow(/unknown league/);
    expect(() => tipPagePath('nope')).toThrow(/unknown league/);
  });
});

describe('transaction cards all have somewhere to go', () => {
  for (const league of LEAGUE_SLUGS) {
    for (const kind of TRANSACTION_CTA_KINDS) {
      it(`${league}: "${kind}" points at a real page with a label`, () => {
        const cta = transactionCta(league, kind);
        expect(cta, `${kind} has no CTA`).toBeTruthy();
        expect(routeExists(cta!.link), `${cta!.link} has no route`).toBe(true);
        expect(cta!.link.startsWith(`/${LEAGUES[league].slug}/`)).toBe(true);
        expect(cta!.linkLabel.trim().length).toBeGreaterThan(0);
      });
    }

    it(`${league}: has a fallback for a transaction type nobody mapped`, () => {
      const cta = defaultTransactionCta(league);
      expect(cta).toBeTruthy();
      expect(routeExists(cta!.link)).toBe(true);
    });
  }

  it('sends a drop to the wire and a pickup to the rosters', () => {
    // Not cosmetic: a dropped player is claimable by whoever is reading, so
    // that card belongs on the free agent board. A pickup is somebody's roster.
    expect(transactionCta('theleague', 'drop')!.link).toBe('/theleague/players');
    expect(transactionCta('theleague', 'big-drop')!.link).toBe('/theleague/players');
    expect(transactionCta('theleague', 'pickup')!.link).toBe('/theleague/rosters');
    expect(transactionCta('theleague', 'trade')!.link).toBe('/theleague/rosters');
  });

  it('returns null for an unknown kind instead of guessing a page', () => {
    expect(transactionCta('theleague', 'not-a-kind')).toBeNull();
  });

  it('every generator in schefter-scan.mjs attaches a CTA', () => {
    // Mechanical: the scanner has five post-return sites across three
    // generators, and a sixth added later must not slip through. The backfill
    // below is the floor, but it logs — it is not meant to be load-bearing.
    const src = read('scripts/schefter-scan.mjs');
    const ctaCalls = src.match(/transactionCta\(registrySlug, '[a-z-]+'\)/g) ?? [];
    expect(ctaCalls.length, 'a generator stopped attaching a CTA').toBeGreaterThanOrEqual(5);
    expect(src).toMatch(/if \(!post\.link\) \{/);
    expect(src).toContain('defaultTransactionCta(registrySlug)');
    // The link needs the REGISTRY slug: posts carry the nav slug ('afl'), but
    // the path prefix is /afl-fantasy. Passing `leagueSlug` here would 404.
    expect(src).toMatch(/const registrySlug = league\.registrySlug;/);
    expect(src).not.toMatch(/transactionCta\(leagueSlug/);
  });

  it('trade speculation pre-loads the whole hypothetical', () => {
    const src = read('scripts/schefter-trade-speculation.mjs');
    expect(src).toContain('tradeBuilderPath(');
    expect(src).toMatch(/usPlayers: \[winner\.marquee\.id\]/);
    expect(src).toMatch(/themPlayers: winner\.returnPkg\.map/);
    expect(src).toMatch(/linkLabel: 'Build this trade →'/);
  });
});

describe('a rumor link may not name a team its prose may not name', () => {
  /**
   * The redaction rules let Schefter name a franchise on exactly three scopes.
   * A LINK identifies a team as well as a sentence does, so the href answers to
   * the same rule — otherwise the body reads "a team in the AL East" over a
   * button that pre-loads franchise 0022, and the leak has simply moved
   * somewhere none of the redaction tests were looking.
   */
  it('mirrors the scanner\'s own NAMING_ALLOWED_SCOPES, exactly', () => {
    const src = read('scripts/schefter-rumor-scan.mjs');
    const block = src.slice(src.indexOf('const NAMING_ALLOWED_SCOPES'));
    const scanner = [...block.slice(0, block.indexOf(']')).matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(scanner.length).toBe(3);
    expect(new Set(scanner)).toEqual(FRANCHISE_NAMING_SCOPES);
  });

  it('allows a franchise deep link only on those three', () => {
    for (const kind of ['franchise-multi-source', 'franchise-explicit-pick', 'trade-bait']) {
      expect(franchiseDeepLinkAllowed(kind), `${kind} should allow naming`).toBe(true);
    }
    for (const kind of ['division', 'league-wide', 'commish', 'tier', 'groupme-public', undefined, null, '']) {
      expect(franchiseDeepLinkAllowed(kind as string), `${kind} must not name`).toBe(false);
    }
  });

  it('reads franchise ids only from params that carry them on that page', () => {
    // `target` is a FRANCHISE on the tip page and a PLAYER on the AFL Trade
    // Builder. A guard that treated every 4-digit value as a franchise would
    // flag a player id, and a guard everyone ignores guards nothing.
    expect(franchiseIdsInLink('/afl-fantasy/schefter/tip?target=0023')).toEqual(['0023']);
    expect(franchiseIdsInLink('/afl-fantasy/trade-builder?to=0022&target=1234')).toEqual(['0022']);
    expect(franchiseIdsInLink('/theleague/trade-builder?a=0009&b=0016&ap=1234')).toEqual(['0009', '0016']);
    expect(franchiseIdsInLink('/theleague/players')).toEqual([]);
    expect(franchiseIdsInLink('/theleague/rosters?view=coach')).toEqual([]);
  });

  it('sweeps an UNKNOWN page by shape, so a new deep link cannot slip past', () => {
    expect(franchiseIdsInLink('/theleague/some-new-page?team=0007')).toEqual(['0007']);
  });

  it('feeds the gate the SAME scope object the anonymizer used for the prose', () => {
    // The gate's behavior is covered in schefter-trade-cta.test.ts; what is
    // checked here is the wiring — a gate fed a different scope than the
    // redactor used would pass every behavioral test and still leak.
    const src = read('scripts/schefter-rumor-scan.mjs');
    expect(src).toMatch(/beat\?\.anonymized\?\.\[0\]\?\.scope\?\.kind/);
    expect(src).toMatch(/resolveCta\(beatBuckets\[i\], beatScopeKind\)/);
  });

  it('routes the rumor CTA through the league-aware builder, not a hardcoded ?b=', () => {
    const src = read('scripts/schefter-rumor-scan.mjs');
    expect(src).toContain('tradeBuilderPath(SCHEFTER_LEAGUE_REGISTRY.slug');
    expect(src).not.toMatch(/trade-builder\?b=\$\{/);
  });
});

describe('the card reads a CTA the way the link meant it', () => {
  /**
   * `?target=` means a FRANCHISE desk on the tip page and a PLAYER on the AFL
   * Trade Builder. The cards used to style any `?target=` link as the
   * "your move" dare — megaphone icon and all — so an AFL trade deep link
   * would have worn the wrong badge.
   */
  for (const file of [
    'src/components/shared/SchefterPostCard.astro',
    'src/components/shared/SchefterPostCardCompact.astro',
  ]) {
    it(`${path.basename(file)} scopes the directed-CTA styling to the tip page`, () => {
      const src = read(file);
      expect(src).toMatch(/const isDirectedCta =/);
      expect(src).toMatch(/schefter\\\/tip/);
      // The old blanket check must be gone from the markup, or the fix is
      // only half-applied and the other half still mislabels.
      expect(src).not.toMatch(/post\.link\.includes\('\?target='\)/);
    });
  }

  it('an AFL trade deep link is not mistaken for a desk dare', () => {
    const tradeLink = tradeBuilderPath('afl-fantasy', { them: '0022', themPlayers: ['16185'] });
    expect(tradeLink).toContain('target=16185');
    expect(/\/schefter\/tip\?/.test(tradeLink)).toBe(false);
    // ...while the real dare still is one.
    expect(/\/schefter\/tip\?/.test(tipPagePath('afl-fantasy', { target: '0022' }))).toBe(true);
  });
});

describe('published feed posts link somewhere real', () => {
  const feeds = ALL_LEAGUES
    .map((league: { slug: string; schefterFeedPath: string }) => ({
      league,
      file: path.resolve(__dirname, '..', ...String(league.schefterFeedPath).split('/')),
    }))
    .filter(({ file }) => existsSync(file));

  it('finds the feeds (sanity)', () => {
    expect(feeds.length).toBeGreaterThan(0);
  });

  for (const { league, file } of feeds) {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const posts = ((Array.isArray(raw) ? raw : raw.posts) ?? []) as {
      id: string;
      link?: string;
      type?: string;
    }[];
    // Only internal links: ESPN items in the feed carry absolute URLs, which
    // are somebody else's problem to keep alive.
    const internal = posts.filter((p) => typeof p.link === 'string' && p.link.startsWith('/'));

    it(`${league.slug}: every internal post link resolves to a route`, () => {
      const broken = internal.filter((p) => !routeExists(p.link!)).map((p) => `${p.id} -> ${p.link}`);
      expect(broken, 'a shipped post links to a page that does not exist').toEqual([]);
    });

    it(`${league.slug}: every transaction post has somewhere to go`, () => {
      // 19 of TheLeague's 19 and 29 of the AFL's 32 shipped with no link at
      // all — a card reporting a drop with no way to go claim the player.
      const linkless = posts
        .filter((p) => p.type === 'transaction' && !p.link)
        .map((p) => `${p.id} (${(p as { transactionSubType?: string }).transactionSubType})`);
      expect(linkless, 'a transaction card with nothing to click').toEqual([]);
    });

    it(`${league.slug}: every internal post link carries its league prefix`, () => {
      // A bare `/schefter/tip` resolves ONLY on a league apex host — on the
      // shared host it falls through to the 404 catch-all. One AFL rumor from
      // July 2026 shipped exactly that.
      const unprefixed = internal
        .filter((p) => !ALL_LEAGUES.some((l: { slug: string }) => p.link!.startsWith(`/${l.slug}/`)))
        .map((p) => `${p.id} -> ${p.link}`);
      expect(unprefixed, 'unprefixed link 404s on the shared host').toEqual([]);
    });
  }
});
