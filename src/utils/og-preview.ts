/**
 * Open Graph Preview Fetcher
 *
 * Fetches a URL, parses OG/Twitter meta tags, returns rich preview data.
 * Caches results in Upstash Redis for 7 days.
 *
 * Used to render link-preview cards in the Schefter feed for GroupMe posts.
 */

import { validatePublicUrl } from './url-guard';

type RedisClient = {
  get: <T>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown, opts?: { ex?: number }) => Promise<string>;
};

let _redis: RedisClient | null | undefined;

async function getRedis(): Promise<RedisClient | null> {
  if (_redis !== undefined) return _redis;

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }

  try {
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token }) as unknown as RedisClient;
    return _redis;
  } catch (err) {
    console.warn('[og-preview] Redis unavailable:', err);
    _redis = null;
    return null;
  }
}

export interface OgPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  domain: string;
  /** Timestamp when this was fetched (ms since epoch) */
  fetchedAt: number;
  /** True if the fetch failed — used as a negative cache marker */
  failed?: boolean;
}

const CACHE_KEY_PREFIX = 'og:preview:';
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const FAILED_CACHE_TTL_SECONDS = 60 * 60; // 1 hour for failures (retry sooner)
const FETCH_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

/**
 * Fetch with manual redirect following, validating every hop against the
 * SSRF guard — `redirect: 'follow'` would let a public URL bounce us into
 * private address space.
 */
async function fetchWithGuardedRedirects(url: string, signal: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const reason = await validatePublicUrl(current);
    if (reason) throw new Error(`Blocked URL (${reason}): ${current}`);

    const res = await fetch(current, {
      signal,
      headers: {
        // Masquerade as a regular browser — many sites block bots
        'User-Agent': 'Mozilla/5.0 (compatible; MFLFootballBot/1.0; +https://theleague.football)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'manual',
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return res;
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

/** Fetch and parse OG/Twitter meta tags from a URL */
async function fetchAndParse(url: string): Promise<OgPreview> {
  const domain = extractDomain(url);
  const result: OgPreview = { url, domain, fetchedAt: Date.now() };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetchWithGuardedRedirects(url, controller.signal);
    clearTimeout(timeout);

    if (!res.ok) {
      result.failed = true;
      return result;
    }

    // Only read the first 128KB — OG tags are always in the <head>
    const reader = res.body?.getReader();
    if (!reader) {
      result.failed = true;
      return result;
    }

    const decoder = new TextDecoder('utf-8');
    let html = '';
    const MAX_BYTES = 128 * 1024;
    let bytesRead = 0;
    while (bytesRead < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytesRead += value.length;
      // Stop early if we've passed </head>
      if (html.includes('</head>') || html.includes('</HEAD>')) break;
    }
    try { await reader.cancel(); } catch { /* ignore */ }

    // Parse meta tags
    const get = (patterns: RegExp[]): string | undefined => {
      for (const re of patterns) {
        const m = html.match(re);
        if (m?.[1]) return decodeHtmlEntities(m[1].trim());
      }
      return undefined;
    };

    result.title = get([
      /<meta\s+(?:[^>]*?\s+)?property=["']og:title["'][^>]*?content=["']([^"']+)["']/i,
      /<meta\s+(?:[^>]*?\s+)?content=["']([^"']+)["'][^>]*?property=["']og:title["']/i,
      /<meta\s+(?:[^>]*?\s+)?name=["']twitter:title["'][^>]*?content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i,
    ]);

    result.description = get([
      /<meta\s+(?:[^>]*?\s+)?property=["']og:description["'][^>]*?content=["']([^"']+)["']/i,
      /<meta\s+(?:[^>]*?\s+)?content=["']([^"']+)["'][^>]*?property=["']og:description["']/i,
      /<meta\s+(?:[^>]*?\s+)?name=["']twitter:description["'][^>]*?content=["']([^"']+)["']/i,
      /<meta\s+(?:[^>]*?\s+)?name=["']description["'][^>]*?content=["']([^"']+)["']/i,
    ]);

    const rawImage = get([
      /<meta\s+(?:[^>]*?\s+)?property=["']og:image["'][^>]*?content=["']([^"']+)["']/i,
      /<meta\s+(?:[^>]*?\s+)?content=["']([^"']+)["'][^>]*?property=["']og:image["']/i,
      /<meta\s+(?:[^>]*?\s+)?name=["']twitter:image["'][^>]*?content=["']([^"']+)["']/i,
    ]);
    if (rawImage) {
      result.image = resolveUrl(rawImage, url);
    }

    result.siteName = get([
      /<meta\s+(?:[^>]*?\s+)?property=["']og:site_name["'][^>]*?content=["']([^"']+)["']/i,
      /<meta\s+(?:[^>]*?\s+)?content=["']([^"']+)["'][^>]*?property=["']og:site_name["']/i,
    ]);

    // Truncate for clean display
    if (result.title) result.title = truncate(result.title, 140);
    if (result.description) result.description = truncate(result.description, 220);

    return result;
  } catch (err) {
    console.warn('[og-preview] Fetch failed for', url, err instanceof Error ? err.message : err);
    result.failed = true;
    return result;
  }
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function resolveUrl(maybeRelative: string, base: string): string {
  try { return new URL(maybeRelative, base).toString(); }
  catch { return maybeRelative; }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&nbsp;/g, ' ');
}

/**
 * Get OG preview for a URL, using Redis cache.
 * Returns null if fetch failed and no cached data is available.
 */
export async function getOgPreview(url: string): Promise<OgPreview | null> {
  const cacheKey = CACHE_KEY_PREFIX + url;
  const redis = await getRedis();

  // Check cache
  if (redis) {
    try {
      const cached = await redis.get<OgPreview | string>(cacheKey);
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        return parsed as OgPreview;
      }
    } catch { /* cache miss */ }
  }

  // Fetch fresh
  const preview = await fetchAndParse(url);

  // Cache (shorter TTL on failure)
  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(preview), {
        ex: preview.failed ? FAILED_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS,
      });
    } catch { /* ignore cache write failures */ }
  }

  return preview.failed && !preview.title && !preview.image ? null : preview;
}

/** Batch fetch OG previews in parallel, tolerating individual failures */
export async function getOgPreviewsBatch(urls: string[]): Promise<Map<string, OgPreview>> {
  const results = new Map<string, OgPreview>();
  const unique = Array.from(new Set(urls));
  await Promise.all(
    unique.map(async url => {
      try {
        const preview = await getOgPreview(url);
        if (preview) results.set(url, preview);
      } catch { /* ignore — absent from map means "no preview" */ }
    }),
  );
  return results;
}
