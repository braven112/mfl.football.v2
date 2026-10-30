/**
 * A history entry the page router does not act on when it is popped.
 *
 * The TV's Back key never reaches a page as a key: the app hands it to the
 * WebView's history. So anything Back should undo on the broadcast (the
 * board's steering, the TV home's drawer) pushes an entry of its own and
 * handles the `popstate`.
 *
 * Astro's router hears that pop FIRST. Chromium runs a window's popstate
 * listeners in the order they were added, capture or not, and the router's
 * was added before any island's or page script's, so `stopImmediatePropagation`
 * cannot reach it — it re-rendered the whole page on every such Back. What
 * stops it is its own rule: it ignores a pop whose state is null. So the
 * entry UNDER ours holds null while ours is on top, and gets its state back
 * the moment ours is popped.
 */
export interface QuietEntry {
  /** The router's state for the entry underneath, parked while ours is on top. */
  parked: unknown;
}

/** Push an entry carrying `marker`, parking the state of the one beneath it. */
export function pushQuietEntry(marker: Record<string, unknown>): QuietEntry {
  const parked = history.state;
  history.replaceState(null, '');
  history.pushState({ ...((parked as object | null) ?? {}), ...marker }, '');
  return { parked };
}

/**
 * After our entry is popped: hand the entry now on top its state back, and
 * optionally a newer URL (a choice made while ours was on top rewrote OUR
 * entry's URL, which the pop just discarded).
 */
export function restoreUnderQuietEntry(entry: QuietEntry | null, href?: string): void {
  if (!entry || history.state !== null) return;
  try {
    history.replaceState(entry.parked, '', href);
  } catch {
    /* the router copes with a null entry: it ignores it */
  }
}
