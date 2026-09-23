/**
 * Private documents on the shared app host — owner-only pages whose TEXT
 * never enters this repository.
 *
 * WHY THE CONTENT LIVES IN REDIS AND NOT IN A FILE. This repository is public
 * on GitHub. A page gated by login still ships its source to anyone who reads
 * the repo, so a business proposal (pricing, client names, internal notes)
 * committed as a `.md` or baked into an `.astro` file is public no matter what
 * the page does at request time. The page is code; the document is data, kept
 * under `private-doc:<slug>` and written only through the page's own form.
 *
 * WHO CAN READ IT. `PRIVATE_DOC_OWNERS` — a comma-separated list of MFL
 * usernames, compared case-insensitively against the signed session's
 * `name`. It is an env var rather than a literal because a username is half a
 * credential, and this file is public. Unset or empty means NOBODY: the gate
 * fails closed, so a missing env renders a 404, never the document.
 *
 * Session `name` is the username the owner typed at MFL sign-in
 * (`src/pages/api/auth/login.ts`), carried in the signed JWT — it is not
 * client-controllable (see `getAuthUser`).
 */

import { getRedis } from './redis-client';
import type { AuthUser } from './auth';

/** The documents that exist. A slug outside this list is a 404, never a new key. */
export const PRIVATE_DOC_SLUGS = ['proposal'] as const;
export type PrivateDocSlug = (typeof PRIVATE_DOC_SLUGS)[number];

/** Upper bound on a saved document — far above any proposal, far below Redis's value cap. */
export const PRIVATE_DOC_MAX_CHARS = 200_000;

export interface PrivateDoc {
  markdown: string;
  /** ISO timestamp of the last save. */
  updatedAt: string;
}

export function isPrivateDocSlug(value: string | undefined): value is PrivateDocSlug {
  return typeof value === 'string' && (PRIVATE_DOC_SLUGS as readonly string[]).includes(value);
}

/** Parse the owner list. Empty entries are dropped so `"a,,b,"` cannot admit a blank name. */
export function parsePrivateDocOwners(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * May this session read and edit private documents? Fails closed on a missing
 * session, a missing name, or an unset owner list.
 */
export function isPrivateDocOwner(
  user: AuthUser | null,
  rawOwners: string | undefined | null = process.env.PRIVATE_DOC_OWNERS,
): boolean {
  if (!user) return false;
  const name = (user.name ?? '').trim().toLowerCase();
  if (!name) return false;
  return parsePrivateDocOwners(rawOwners).includes(name);
}

const keyFor = (slug: PrivateDocSlug) => `private-doc:${slug}`;

/** Read a document. `null` = never saved OR Redis unavailable; the page says which via `redisAvailable`. */
export async function readPrivateDoc(slug: PrivateDocSlug): Promise<PrivateDoc | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const stored = await redis.get<PrivateDoc>(keyFor(slug));
  if (!stored || typeof stored.markdown !== 'string') return null;
  return stored;
}

export type SaveResult = { ok: true; doc: PrivateDoc } | { ok: false; error: string };

export async function savePrivateDoc(slug: PrivateDocSlug, markdown: string): Promise<SaveResult> {
  if (markdown.length > PRIVATE_DOC_MAX_CHARS) {
    return { ok: false, error: `Too long: ${markdown.length.toLocaleString()} characters (limit ${PRIVATE_DOC_MAX_CHARS.toLocaleString()}).` };
  }
  const redis = await getRedis();
  if (!redis) return { ok: false, error: 'Storage is not configured, so nothing was saved.' };
  const doc: PrivateDoc = { markdown, updatedAt: new Date().toISOString() };
  await redis.set(keyFor(slug), doc);
  return { ok: true, doc };
}
