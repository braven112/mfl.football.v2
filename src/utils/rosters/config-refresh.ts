/**
 * Re-reading the roster page's `#roster-config` after a ClientRouter swap.
 *
 * The page's script is BUNDLED, so it evaluates once per session while the
 * DOM is swapped underneath it. A config parsed only at module scope kept the
 * FIRST load's `defaultTeamId` forever: Back from an in-page crest switch
 * swaps in the server's `?franchise=0001` render, and the re-init then
 * repainted the team the session had opened on.
 *
 * The refresh lives here, not in the page, so it can be exercised rather than
 * only grepped for (tests/rosters-config-refresh.test.ts).
 */

type Json = Record<string, any>;

/** Empty `target` and fill it from `source`, keeping `target`'s identity. */
export function replaceContents(target: Json, source: Json): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

/**
 * Re-read the config element when it is a NEW node, mutating `config` in
 * place (module helpers hold a reference to it). Returns the node now cached,
 * and whether anything changed.
 *
 * Keyed on the node because the page's init runs twice on the first load's
 * same DOM, and the payload is megabytes. Seasons MERGE: a frozen season the
 * page fetched on demand stays cached, while the arriving page's live seasons
 * win over the stale copies.
 */
export function refreshConfigFromElement(
  config: Json,
  cachedEl: Element | null,
  el: Element | null,
): { el: Element | null; refreshed: boolean } {
  if (!el || el === cachedEl) return { el: cachedEl, refreshed: false };
  let fresh: Json;
  try {
    fresh = JSON.parse(el.textContent || '{}');
  } catch {
    return { el: cachedEl, refreshed: false };
  }
  const seasons = { ...(config.seasons ?? {}), ...(fresh.seasons ?? {}) };
  replaceContents(config, { ...fresh, seasons });
  return { el, refreshed: true };
}
