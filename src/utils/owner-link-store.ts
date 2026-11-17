/**
 * Owner links — the Redis store.
 *
 * One hash per league, `owner-links:<registry slug>`, field = link id, value =
 * the link record as JSON. Keyed by the REGISTRY SLUG, never a franchise id:
 * both leagues have a franchise 0001, and owner ids (`own-0001`) are global,
 * so only the slug makes a key unambiguous. The slug always comes from the
 * caller's session (`leagueForSession`), never from a request parameter.
 *
 * A link moves through three states:
 *   pending  — an owner asked for these seasons; changes nothing on the site
 *   approved — live on the next request (owner-link-live.ts applies it)
 *   rejected — declined, or an approved link the commissioner took back
 * A commissioner's own link is created approved.
 *
 * The set is tiny (a league's whole history is a few dozen tenures), so a
 * single HGETALL is the read path; there is no index to keep in sync.
 *
 * With no Redis configured, local dev falls back to an in-process map so the
 * pages can be driven end to end; production refuses to write instead (the
 * API answers 503) — a link that silently vanished on the next cold start
 * would be worse than one that was never accepted.
 */
import { getRedis, type RedisClient } from './redis-client';

export type OwnerLinkStatus = 'pending' | 'approved' | 'rejected';

export interface OwnerLinkActor {
  userId: string;
  name: string;
  franchiseId: string;
  role: 'owner' | 'commissioner' | 'admin';
}

export interface OwnerLink {
  id: string;
  /** Registry league slug. */
  league: string;
  status: OwnerLinkStatus;
  /** The owner (registry person id) the seasons join. */
  targetOwnerId: string;
  /** Their owner-page slug when the link was filed — display only. */
  targetSlug: string;
  targetTitle: string;
  franchiseId: string;
  yearStart: number;
  yearEnd: number;
  /** Team names worn in the range when filed — display only. */
  names: string[];
  /** Whose seasons these were before the link — display only. */
  fromOwnerId: string | null;
  fromTitle: string | null;
  note: string | null;
  proposedBy: OwnerLinkActor;
  proposedAt: string;
  decidedBy: OwnerLinkActor | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export const ownerLinksKey = (leagueSlug: string) => `owner-links:${leagueSlug}`;

type Store = Pick<RedisClient, 'hgetall' | 'hset' | 'hget'>;

const devMemory = new Map<string, Map<string, string>>();
const memoryStore: Store = {
  hgetall: async <T>(key: string) =>
    (devMemory.has(key) ? Object.fromEntries(devMemory.get(key)!) : null) as Record<string, T> | null,
  hget: async <T>(key: string, field: string) => (devMemory.get(key)?.get(field) ?? null) as T | null,
  hset: async (key: string, values: Record<string, unknown>) => {
    const h = devMemory.get(key) ?? new Map<string, string>();
    for (const [f, v] of Object.entries(values)) h.set(f, typeof v === 'string' ? v : JSON.stringify(v));
    devMemory.set(key, h);
    return Object.keys(values).length;
  },
};

/** The store, or null when there is nowhere durable to write. */
async function store(): Promise<Store | null> {
  const redis = await getRedis();
  if (redis) return redis;
  return import.meta.env?.DEV || import.meta.env?.MODE === 'test' ? memoryStore : null;
}

export class OwnerLinkStoreUnavailable extends Error {
  constructor() {
    super('Owner links storage is not configured.');
  }
}

const parse = (raw: unknown): OwnerLink | null => {
  if (!raw) return null;
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return value && typeof value === 'object' && (value as OwnerLink).id ? (value as OwnerLink) : null;
  } catch {
    return null;
  }
};

/** Every link for a league, newest first. Empty (never throws) without storage. */
export async function listOwnerLinks(leagueSlug: string): Promise<OwnerLink[]> {
  const s = await store();
  if (!s) return [];
  const all = (await s.hgetall<unknown>(ownerLinksKey(leagueSlug))) ?? {};
  return Object.values(all)
    .map(parse)
    .filter((l): l is OwnerLink => Boolean(l) && l!.league === leagueSlug)
    .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt) || b.id.localeCompare(a.id));
}

export async function getOwnerLink(leagueSlug: string, id: string): Promise<OwnerLink | null> {
  const s = await store();
  if (!s) return null;
  const link = parse(await s.hget<unknown>(ownerLinksKey(leagueSlug), id));
  return link && link.league === leagueSlug ? link : null;
}

async function save(link: OwnerLink): Promise<OwnerLink> {
  const s = await store();
  if (!s) throw new OwnerLinkStoreUnavailable();
  await s.hset(ownerLinksKey(link.league), { [link.id]: JSON.stringify(link) });
  return link;
}

const newId = () => `ol_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export type NewOwnerLink = Omit<
  OwnerLink,
  'id' | 'status' | 'proposedAt' | 'decidedBy' | 'decidedAt' | 'decisionNote'
>;

/** An owner's request: pending until the commissioner decides. */
export function proposeOwnerLink(input: NewOwnerLink, now = new Date()): Promise<OwnerLink> {
  return save({
    ...input,
    id: newId(),
    status: 'pending',
    proposedAt: now.toISOString(),
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
  });
}

/** A commissioner's link: approved — and so live — the moment it is saved. */
export function createApprovedOwnerLink(input: NewOwnerLink, now = new Date()): Promise<OwnerLink> {
  const at = now.toISOString();
  return save({
    ...input,
    id: newId(),
    status: 'approved',
    proposedAt: at,
    decidedBy: input.proposedBy,
    decidedAt: at,
    decisionNote: null,
  });
}

/**
 * Approve or reject a link. Approving a pending link makes it live; rejecting
 * an approved one takes it back off the site. Re-deciding to the same state
 * is refused, so a double click cannot rewrite who decided it.
 */
export async function decideOwnerLink(
  leagueSlug: string,
  id: string,
  decision: 'approved' | 'rejected',
  by: OwnerLinkActor,
  note: string | null = null,
  now = new Date(),
): Promise<{ ok: true; link: OwnerLink } | { ok: false; reason: 'not-found' | 'unchanged' | 'not-allowed' }> {
  const link = await getOwnerLink(leagueSlug, id);
  if (!link) return { ok: false, reason: 'not-found' };
  if (link.status === decision) return { ok: false, reason: 'unchanged' };
  // A rejected request is closed; the owner files a new one.
  if (link.status === 'rejected') return { ok: false, reason: 'not-allowed' };
  const next: OwnerLink = {
    ...link,
    status: decision,
    decidedBy: by,
    decidedAt: now.toISOString(),
    decisionNote: note,
  };
  await save(next);
  return { ok: true, link: next };
}

/** Test seam: clear the dev/test in-process store. */
export function _resetOwnerLinkMemory(): void {
  devMemory.clear();
}
