/**
 * Server side of guest-names.mjs: the name masker for a league, built once per
 * warm instance from that league's owner-tenures.json, and the HTML response
 * filter the middleware applies to signed-out visitors.
 *
 * Fails CLOSED for a masked league: if the owner list cannot be read, the
 * page is answered with an error rather than served unmasked, because the
 * whole point is that a stranger never sees a name.
 */
import { getLeagueBySlug } from '../../config/leagues';
import { loadLeagueData, onLeagueDataChange } from '../league-data';
import { GUEST_MASKED_LEAGUES, buildNameMasker, maskJson, ownerStandIns } from './guest-names.mjs';

export type NameMasker = (text: string) => string;

const maskers = new Map<string, Promise<NameMasker>>();
// A new owner list (a live data update) rebuilds the masker on next use.
onLeagueDataChange(() => maskers.clear());

export function isGuestMaskedLeague(slug: string): boolean {
  return GUEST_MASKED_LEAGUES.includes(slug);
}

/** The league's masker, or null for a league whose names are not hidden. */
export function guestMasker(slug: string): Promise<NameMasker> | null {
  if (!isGuestMaskedLeague(slug)) return null;
  let m = maskers.get(slug);
  if (!m) {
    const league = getLeagueBySlug(slug);
    if (!league) return null;
    m = loadLeagueData(`${league.dataPath}/derived/owner-tenures.json`).then((t) => buildNameMasker(ownerStandIns(t)) as NameMasker);
    // A failed read must not be cached for the life of the instance.
    m.catch(() => maskers.delete(slug));
    maskers.set(slug, m);
  }
  return m;
}

/** A deep copy of `value` with every owner name swapped for its stand-in. */
export function maskValue<T>(value: T, mask: NameMasker): T {
  return maskJson(value, mask) as T;
}

/** Datasets masked once per instance: they are large and never change between deploys. */
const maskedData = new WeakMap<object, unknown>();
export function maskDataset<T extends object>(value: T, mask: NameMasker): T {
  const hit = maskedData.get(value);
  if (hit) return hit as T;
  const masked = maskValue(value, mask);
  maskedData.set(value, masked);
  return masked;
}

export const MASKED_HEADER = 'x-owner-names';

/**
 * The page with every owner name swapped, for a signed-out visitor. Only HTML
 * is touched; a response already masked (the middleware re-runs on a
 * rewrite) passes through.
 */
export async function maskHtmlResponse(response: Response, slug: string): Promise<Response> {
  if (response.headers.get(MASKED_HEADER) === 'hidden') return response;
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) return response;
  const masker = guestMasker(slug);
  if (!masker) return response;
  let mask: NameMasker;
  try {
    mask = await masker;
  } catch (e) {
    console.error('[guest-mask] owner list unavailable:', e);
    return new Response('This page is unavailable right now. Try again in a minute.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const html = mask(await response.text());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set(MASKED_HEADER, 'hidden');
  // A masked page and a real one share a URL; neither may be cached for the other.
  headers.set('Cache-Control', 'private, no-store');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
