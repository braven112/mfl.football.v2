/**
 * The Owners' Poll homepage pop-up — who sees it, and how often.
 *
 * Ballots are standing votes, so "go vote" is only true for two owners: the
 * one with no ballot on file, and the one whose ballot has gone stale (the
 * server decides that, against one clock — see `isBallotStale`). Everyone with
 * a current ballot sees nothing, ever.
 *
 * Frequency is per device: once every POPUP_INTERVAL_DAYS. That is a viewer
 * convenience, not state anything else reads, so localStorage is the right
 * home for it and a cleared or blocked store simply means the pop-up may show
 * again — never that it breaks the page.
 */

export const POPUP_INTERVAL_DAYS = 7;

export type PopupReason = 'no-ballot' | 'stale';

export interface PopupInput {
  /** The ballot API's `status`; anything but 'open' (a pause) means no ask. */
  status: string | null | undefined;
  hasBallot: boolean;
  stale: boolean;
  /** ISO time this device last showed the pop-up, or null. */
  lastShownAt: string | null;
  now: Date;
  /**
   * `?pollPopup=new|stale` on the homepage: show that sheet regardless of the
   * viewer's ballot or the weekly cap, so it can be seen and checked by an
   * owner whose own ballot is current. Still silent while the poll is paused.
   */
  force?: string | null;
}

/** Reads the `?pollPopup=` preview value, or null for anything unrecognised. */
export function forcedPopupReason(search: string): PopupReason | null {
  const v = new URLSearchParams(search).get('pollPopup');
  return v === 'new' ? 'no-ballot' : v === 'stale' ? 'stale' : null;
}

export function popupReason(input: PopupInput): PopupReason | null {
  if (input.status !== 'open') return null;
  const forced = forcedPopupReason(input.force ? `?pollPopup=${input.force}` : '');
  if (forced) return forced;
  const reason: PopupReason | null = !input.hasBallot ? 'no-ballot' : input.stale ? 'stale' : null;
  if (!reason) return null;
  const last = Date.parse(input.lastShownAt ?? '');
  if (Number.isFinite(last) && input.now.getTime() - last < POPUP_INTERVAL_DAYS * 86400 * 1000) {
    return null;
  }
  return reason;
}

/**
 * Keyed per league: an owner in both leagues gets each league's ask on its own
 * schedule. Not per franchise — one device is one person.
 */
export function popupStorageKey(leagueSlug: string): string {
  return `ownersPoll.popupShownAt.${leagueSlug}`;
}
