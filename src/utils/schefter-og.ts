/**
 * Schefter post → Open Graph image renderer.
 *
 * Powers /api/og/schefter/[postId].png — the unfurl card GroupMe (and any
 * other link preview) shows when a Schefter feed deep-link is dropped in
 * chat. Renders the player-composite language from the composite heroes
 * (team-color gradient + ghost wordmark + team glow + transparent ESPN
 * cutout + headline) as a real 1200×630 PNG via satori + resvg — OG images
 * can't be CSS.
 *
 * Composite rules (see docs/claude/insights/features/player-composites.md):
 *   - `playerIds[0]` is the featured player; resolve through getPlayerMap.
 *   - Never composite a DEF or an MFL JPG headshot — only transparent
 *     espncdn.com cutouts. Anything else gets the branded text-only card.
 *   - The ESPN fetch is our constructed URL (not user-supplied) but runs
 *     with a hard timeout; any failure degrades to the text-only card so a
 *     slow CDN can never hang or break an unfurl.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import type { SchefterFeed, SchefterPost } from '../types/schefter';
import { getPlayerMap, type PlayerIdentity } from './player-map';
import { getCurrentLeagueYear } from './league-year';
import { getNflTeamColors, hexToRgba } from './nfl-team-colors';
import { normalizeTeamCode } from './nfl-logo';
import { schefterPostOgText } from './schefter-feed';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export type OgLeague = 'theleague' | 'afl-fantasy';

/** Feed post ids are machine-generated (sf_*, espn_*, wire_*, …) — this
 *  charset covers all of them and rejects anything path-traversal-shaped. */
export function isValidPostId(id: string): boolean {
  return /^[A-Za-z0-9_.-]{1,120}$/.test(id);
}

// ── Feed lookup ──────────────────────────────────────────────────────────

const FEED_PATHS: Record<OgLeague, string> = {
  theleague: 'src/data/theleague/schefter-feed.json',
  'afl-fantasy': 'data/afl-fantasy/schefter-feed.json',
};

interface FeedCacheEntry {
  mtimeMs: number;
  byId: Map<string, SchefterPost>;
}

// Feeds are rewritten by cron scans while the server runs — read with fs
// (never `import`) and re-parse only when the file mtime moves.
const feedCache = new Map<OgLeague, FeedCacheEntry>();

function getFeedIndex(league: OgLeague): Map<string, SchefterPost> {
  const filePath = join(process.cwd(), FEED_PATHS[league]);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
  } catch {
    return new Map();
  }
  const cached = feedCache.get(league);
  if (cached && cached.mtimeMs === mtimeMs) return cached.byId;

  const byId = new Map<string, SchefterPost>();
  try {
    const feed = JSON.parse(readFileSync(filePath, 'utf-8')) as SchefterFeed;
    for (const post of feed.posts ?? []) byId.set(post.id, post);
  } catch {
    return new Map();
  }
  feedCache.set(league, { mtimeMs, byId });
  return byId;
}

/** Look a post up by id across both leagues' feeds (ids never collide —
 *  they embed source timestamps/hashes). Returns null for unknown ids so
 *  the endpoint can 404 instead of rendering arbitrary requests. */
export function findSchefterPost(
  postId: string
): { post: SchefterPost; league: OgLeague } | null {
  for (const league of ['theleague', 'afl-fantasy'] as const) {
    const post = getFeedIndex(league).get(postId);
    if (post) return { post, league };
  }
  return null;
}

// ── Featured player resolution ───────────────────────────────────────────

/** Same gate as hero-casting's isCompositable: transparent ESPN cutout only. */
function isCompositable(player: PlayerIdentity): boolean {
  return player.position !== 'DEF' && player.headshot.includes('espncdn.com');
}

function resolveFeaturedPlayer(post: SchefterPost): PlayerIdentity | null {
  const playerId = post.playerIds?.[0];
  if (!playerId) return null;
  // Older posts may reference players that dropped out of the current-year
  // feed — try the prior year before giving up. MFL player ids are global,
  // so theleague's player map resolves AFL posts too.
  const year = getCurrentLeagueYear();
  for (const y of [year, year - 1]) {
    const player = getPlayerMap(y).get(playerId);
    if (player) return isCompositable(player) ? player : null;
  }
  return null;
}

// ── Assets (fonts, logos, headshots) ─────────────────────────────────────

const FONT_DIR = 'src/assets/fonts/og';

let fontCache: { name: string; data: Buffer; weight: 400 | 500 | 700; style: 'normal' }[] | null = null;

function loadFonts() {
  if (fontCache) return fontCache;
  const load = (file: string) => readFileSync(join(process.cwd(), FONT_DIR, file));
  fontCache = [
    { name: 'UFC Sans', data: load('UFCSans-Regular.ttf'), weight: 400, style: 'normal' },
    { name: 'UFC Sans', data: load('UFCSans-Medium.ttf'), weight: 500, style: 'normal' },
    { name: 'UFC Sans Condensed', data: load('UFCSans-CondensedBold.ttf'), weight: 700, style: 'normal' },
  ];
  return fontCache;
}

const logoCache = new Map<OgLeague, string | null>();

/** League logo (dark-theme variant — the card is always dark) as a data URI. */
function loadLeagueLogo(league: OgLeague): string | null {
  if (logoCache.has(league)) return logoCache.get(league)!;
  const file =
    league === 'afl-fantasy'
      ? 'public/assets/logos/afl-logo-dark.svg'
      : 'public/assets/logos/theleague-logo-dark.svg';
  let uri: string | null = null;
  try {
    const svg = readFileSync(join(process.cwd(), file));
    uri = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  } catch {
    uri = null;
  }
  logoCache.set(league, uri);
  return uri;
}

const HEADSHOT_TIMEOUT_MS = 4000;
const HEADSHOT_CACHE_MAX = 50;

// Successful fetches only — a transient ESPN failure shouldn't pin a post's
// card to the text fallback for the life of the server process.
const headshotCache = new Map<string, string>();

/** Fetch the ESPN cutout server-side and inline it as a data URI. Returns
 *  null on any failure (timeout, 404, non-image) — caller falls back to the
 *  text-only card. */
async function fetchHeadshotDataUri(url: string): Promise<string | null> {
  const cached = headshotCache.get(url);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEADSHOT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    const uri = `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
    if (headshotCache.size >= HEADSHOT_CACHE_MAX) {
      const oldest = headshotCache.keys().next().value;
      if (oldest) headshotCache.delete(oldest);
    }
    headshotCache.set(url, uri);
    return uri;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Card content helpers ─────────────────────────────────────────────────

interface TierBadge {
  label: string;
  ghost: string;
  color: string;
}

function tierBadge(post: SchefterPost): TierBadge {
  const sub = post.transactionSubType ?? '';
  if (sub === 'rumor_mill' || sub === 'trade_speculation' || post.tier === ('rumor' as string)) {
    return { label: 'RUMOR MILL', ghost: 'RUMOR', color: '#d97706' };
  }
  if (post.tier === 'breaking') {
    return { label: 'BREAKING NEWS', ghost: 'BREAKING', color: '#dc2626' };
  }
  return { label: 'LEAGUE WIRE', ghost: 'SCHEFTER', color: '#2563eb' };
}

const LEAGUE_BRAND: Record<OgLeague, { name: string; domain: string; primary: string }> = {
  theleague: { name: 'The League', domain: 'theleague.us', primary: '#1c497c' },
  'afl-fantasy': { name: 'AFL Fantasy', domain: 'afl-fantasy.com', primary: '#002244' },
};

// ── Satori node helpers (object form — no JSX in .ts) ────────────────────

type SatoriNode = {
  type: string;
  props: Record<string, unknown> & { children?: SatoriNode | SatoriNode[] | string };
};

function el(
  type: string,
  style: Record<string, unknown>,
  children?: SatoriNode | SatoriNode[] | string,
  extraProps: Record<string, unknown> = {}
): SatoriNode {
  return { type, props: { style, ...extraProps, ...(children !== undefined ? { children } : {}) } };
}

function buildCardTree(opts: {
  post: SchefterPost;
  league: OgLeague;
  player: PlayerIdentity | null;
  headshotUri: string | null;
}): SatoriNode {
  const { post, league, player, headshotUri } = opts;
  const brand = LEAGUE_BRAND[league];
  const badge = tierBadge(post);
  const hasComposite = !!(player && headshotUri);

  const teamCode = player ? normalizeTeamCode(player.nflTeam) : '';
  const accent = hasComposite ? getNflTeamColors(teamCode).primary : brand.primary;

  const title = schefterPostOgText(post).title;
  const titleSize = title.length > 90 ? 44 : title.length > 60 ? 52 : 62;

  const children: SatoriNode[] = [];

  // Ghost wordmark — the composite heroes' signature backdrop typography.
  children.push(
    el(
      'div',
      {
        position: 'absolute',
        top: -34,
        left: 16,
        fontFamily: 'UFC Sans Condensed',
        fontWeight: 700,
        fontSize: 236,
        letterSpacing: '-0.01em',
        color: 'rgba(255, 255, 255, 0.05)',
        whiteSpace: 'nowrap',
      },
      badge.ghost
    )
  );

  // Team-color glow behind the player flank.
  children.push(
    el('div', {
      position: 'absolute',
      right: -140,
      top: -80,
      width: 760,
      height: 760,
      borderRadius: 9999,
      background: `radial-gradient(circle, ${hexToRgba(accent, 0.52)} 0%, rgba(0,0,0,0) 68%)`,
    })
  );

  if (hasComposite) {
    // ESPN full headshots are 350×254 — scale preserving that ratio and
    // anchor to the bottom edge like the hero composites.
    children.push(
      el(
        'img',
        {
          position: 'absolute',
          right: 24,
          bottom: 0,
          width: 640,
          height: 465,
          objectFit: 'contain',
        },
        undefined,
        { src: headshotUri }
      )
    );
  } else {
    const logo = loadLeagueLogo(league);
    if (logo) {
      children.push(
        el(
          'img',
          {
            position: 'absolute',
            right: 90,
            top: 150,
            width: 330,
            height: 330,
            objectFit: 'contain',
            opacity: 0.92,
          },
          undefined,
          { src: logo }
        )
      );
    }
  }

  // Left content column.
  const column: SatoriNode[] = [
    // Brand row: tier pill + masthead.
    el(
      'div',
      { display: 'flex', alignItems: 'center', gap: 18 },
      [
        el(
          'div',
          {
            display: 'flex',
            backgroundColor: badge.color,
            color: '#ffffff',
            fontFamily: 'UFC Sans Condensed',
            fontWeight: 700,
            fontSize: 26,
            letterSpacing: '0.08em',
            padding: '8px 18px',
            borderRadius: 8,
          },
          badge.label
        ),
        el(
          'div',
          {
            display: 'flex',
            fontFamily: 'UFC Sans',
            fontWeight: 500,
            fontSize: 24,
            letterSpacing: '0.14em',
            color: 'rgba(255, 255, 255, 0.72)',
          },
          'THE SCHEFTER REPORT'
        ),
      ]
    ),
    // Headline.
    el(
      'div',
      {
        display: 'flex',
        marginTop: 34,
        fontFamily: 'UFC Sans Condensed',
        fontWeight: 700,
        fontSize: titleSize,
        lineHeight: 1.08,
        color: '#ffffff',
        maxWidth: hasComposite ? 660 : 700,
        lineClamp: 4,
      },
      title
    ),
  ];

  // Bottom row: player chip (composite only) + league footer.
  const footer: SatoriNode[] = [];
  if (hasComposite && player) {
    footer.push(
      el(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'rgba(10, 16, 24, 0.55)',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          borderRadius: 14,
          padding: '12px 20px',
          marginBottom: 18,
          alignSelf: 'flex-start',
        },
        [
          el(
            'div',
            { display: 'flex', fontFamily: 'UFC Sans', fontWeight: 500, fontSize: 28, color: '#ffffff' },
            player.name
          ),
          el(
            'div',
            {
              display: 'flex',
              fontFamily: 'UFC Sans',
              fontWeight: 400,
              fontSize: 21,
              letterSpacing: '0.06em',
              color: 'rgba(255, 255, 255, 0.75)',
            },
            `${player.position} · ${teamCode}`
          ),
        ]
      )
    );
  }
  footer.push(
    el(
      'div',
      {
        display: 'flex',
        fontFamily: 'UFC Sans',
        fontWeight: 500,
        fontSize: 24,
        letterSpacing: '0.1em',
        color: 'rgba(255, 255, 255, 0.6)',
      },
      `${brand.name.toUpperCase()} · ${brand.domain}`
    )
  );

  children.push(
    el(
      'div',
      {
        position: 'absolute',
        top: 0,
        left: 0,
        width: OG_WIDTH,
        height: OG_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '56px 60px 48px',
      },
      [
        el('div', { display: 'flex', flexDirection: 'column' }, column),
        el('div', { display: 'flex', flexDirection: 'column' }, footer),
      ]
    )
  );

  return el(
    'div',
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      display: 'flex',
      position: 'relative',
      background: `linear-gradient(115deg, #0d1b2c 0%, #122a44 52%, ${accent} 100%)`,
    },
    children
  );
}

// ── Public renderer ──────────────────────────────────────────────────────

/**
 * Render the OG PNG for a feed post. Always resolves to a PNG buffer for a
 * known post: composite when a compositable featured player + headshot are
 * available, branded text-only card otherwise.
 */
export async function renderSchefterOgPng(post: SchefterPost, league: OgLeague): Promise<Buffer> {
  const player = resolveFeaturedPlayer(post);
  const headshotUri = player ? await fetchHeadshotDataUri(player.headshot) : null;

  const tree = buildCardTree({ post, league, player, headshotUri });
  const svg = await satori(tree as never, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: loadFonts(),
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: OG_WIDTH },
  });
  return Buffer.from(resvg.render().asPng());
}
