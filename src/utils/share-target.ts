/**
 * Web Share Target — turning an OS share into a Schefter tip draft.
 *
 * An installed app can register itself in the phone's share sheet, which a
 * website cannot do at all. Ours points at the tip form: an owner reading a
 * beat writer's post about someone's rookie can share it straight into the
 * rumor mill instead of copying a URL between apps.
 *
 * The share is a PREFILL, never a submission. Two reasons, both load-bearing:
 *
 *  - `/api/schefter/tip` requires a topic, which no share sheet can supply,
 *    and rate-limits to 3 tips per owner per day. Auto-filing would spend an
 *    owner's daily quota on something they never confirmed sending.
 *  - Shared text is whatever the source app put on the clipboard. It reaches
 *    the page as the VALUE of a textarea (escaped by Astro like any other
 *    expression, never `set:html`), so the owner reads and edits it before
 *    anything is submitted.
 */

import { TIP_TEXT_MAX } from '../types/schefter-tips';

export interface SharedPayload {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

/**
 * Compose the three share-sheet fields into one tip draft.
 *
 * Android hands a link over in `text` about as often as in `url`, and some
 * apps send the page title as `title` with the same string repeated in `text`
 * — so duplicates are dropped rather than concatenated, or half the shares
 * arrive with the headline printed twice.
 *
 * Returns '' when there is nothing usable, which the caller treats as "not a
 * share" and renders the ordinary empty form.
 */
export function composeSharedTip(payload: SharedPayload): string {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const raw of [payload.title, payload.text, payload.url]) {
    const value = (raw ?? '').trim();
    if (!value) continue;
    // Case-insensitive: a title shared as "Rookie WR Traded" and text as
    // "rookie wr traded" is the same sentence twice.
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    // A url already contained in the text adds nothing but length.
    if (parts.some((p) => p.toLowerCase().includes(key))) continue;
    seen.add(key);
    parts.push(value);
  }

  // Truncated rather than rejected: the owner is about to edit this anyway,
  // and an empty box after a share reads as the feature being broken.
  return parts.join('\n\n').slice(0, TIP_TEXT_MAX);
}

/** Pull the share-sheet fields out of a URL, using the manifest's param names. */
export function readSharedPayload(searchParams: URLSearchParams): SharedPayload {
  return {
    title: searchParams.get('shared_title'),
    text: searchParams.get('shared_text'),
    url: searchParams.get('shared_url'),
  };
}
