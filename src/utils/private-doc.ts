/**
 * Private admin documents — commissioner-only pages whose TEXT never enters
 * this repository.
 *
 * WHY THE CONTENT LIVES IN REDIS AND NOT IN A FILE. This repository is public
 * on GitHub. A page gated by login still ships its source to anyone who reads
 * the repo, so a business proposal (pricing, client names, internal notes)
 * committed as a `.md` or baked into an `.astro` file is public no matter what
 * the page does at request time. The page is code; the document is data, kept
 * under `private-doc:<slug>` and written only through the page's own form.
 *
 * WHO CAN READ IT. The routes decide, not this file: each league's
 * `/<league>/admin/proposal` wrapper runs the standard league admin gate
 * (`isCommissionerOrAdmin` + `isAuthorizedForLeague`), the same one every
 * other `/admin/*` page uses. Both leagues read the SAME document.
 */

import { getRedis } from './redis-client';

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

/** Everything the shared view needs, after an optional save. */
export interface PrivateDocPageState {
  doc: PrivateDoc | null;
  redisAvailable: boolean;
  editing: boolean;
  justSaved: boolean;
  draft: string | null;
  saveError: string | null;
}

export type PrivateDocPageResult =
  | { kind: 'redirect'; location: string }
  | { kind: 'forbidden' }
  | { kind: 'render'; state: PrivateDocPageState };

/**
 * Handle one request to a private document route: save on POST
 * (Post/Redirect/Get, same-origin only), then read for render. Call ONLY after
 * the route's own auth gate has passed — this function does no auth.
 *
 * The session cookie is SameSite=Lax, which already keeps it off a cross-site
 * POST; the Origin check is belt and braces.
 */
export async function handlePrivateDocRequest(
  slug: PrivateDocSlug,
  request: Request,
  url: URL,
): Promise<PrivateDocPageResult> {
  let draft: string | null = null;
  let saveError: string | null = null;

  if (request.method === 'POST') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return { kind: 'forbidden' };
    const form = await request.formData();
    const markdown = String(form.get('markdown') ?? '').replace(/\r\n?/g, '\n');
    const result = await savePrivateDoc(slug, markdown);
    if (result.ok) return { kind: 'redirect', location: `${url.pathname}?saved=1` };
    saveError = result.error;
    draft = markdown;
  }

  const redisAvailable = Boolean(await getRedis());
  const doc = await readPrivateDoc(slug);
  return {
    kind: 'render',
    state: {
      doc,
      redisAvailable,
      editing: draft !== null || url.searchParams.get('edit') === '1' || !doc,
      justSaved: url.searchParams.get('saved') === '1',
      draft,
      saveError,
    },
  };
}
