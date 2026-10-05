/**
 * The league's news persona for server-rendered pages.
 *
 * The commissioner's override lives in Redis (src/utils/persona.mjs); pages
 * read it here. Cached per league for a minute: a persona changes rarely, and
 * the site header asks on every page view. Fails soft — no Redis, or a read
 * error, means the league's default persona (Schefter), which renders every
 * page exactly as it did before personas existed.
 */
import { ALL_LEAGUES, getLeagueBySlug } from '../config/leagues';
import { getRedis } from './redis-client';
import { personaByline, personaKey, personaLabels, resolvePersona } from './persona.mjs';

type Persona = ReturnType<typeof resolvePersona>;

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Persona }>();

export async function getLeaguePersona(slug: string): Promise<Persona> {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const league = getLeagueBySlug(slug) ?? null;
  let stored: unknown = null;
  try {
    const redis = league ? await getRedis() : null;
    if (redis) stored = await redis.get(personaKey(slug));
  } catch {
    stored = null;
  }
  const value = resolvePersona(league, stored);
  cache.set(slug, { at: Date.now(), value });
  return value;
}

/** Test hook. */
export function clearPersonaCache(): void {
  cache.clear();
}

/**
 * The persona for a post, from the league it records (`post.league` holds a
 * nav slug, or a canonical slug on a few older rows). Null when unknown.
 */
export async function getPostPersona(league: string | undefined | null): Promise<Persona | null> {
  if (!league) return null;
  // A lookup, never a throw: `getLeagueByNavSlug` throws on an unknown slug,
  // and a persona read must never be the reason a page 500s.
  const def = ALL_LEAGUES.find((l) => l.navSlug === league || l.slug === league);
  return def ? getLeaguePersona(def.slug) : null;
}

/** A post card's byline: the feed author, renamed to the league's persona when it is the persona writing. */
export async function postByline(
  post: { league?: string | null },
  author: { id: string; name: string; handle?: string },
  avatar: string,
): Promise<{ name: string; avatar: string; handle: string }> {
  return personaByline(author, avatar, await getPostPersona(post.league ?? null));
}

/**
 * The owner-facing labels ("The Schefter Report", "Tip Schefter", …) for a
 * league named by nav slug or canonical slug. An unknown league gets the
 * default persona's labels, which are the site's original wording.
 */
export async function getPersonaLabels(league: string | null | undefined): Promise<ReturnType<typeof personaLabels>> {
  return personaLabels(await getPostPersona(league ?? null));
}
