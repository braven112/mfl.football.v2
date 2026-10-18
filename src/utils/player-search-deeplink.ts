/**
 * Land on a Free Agents page with one player's sheet open:
 * `?player=<MFL id>&q=<name>` — the link a free agent's row in the header's
 * inline search (HeaderSearch.astro) builds.
 *
 * The Free Agents tables render client-side and page their rows ("Show
 * more"), so the player is usually NOT in the DOM on arrival. This types the
 * name into the page's own `#player-search` box first (the page's own filter
 * narrows the table to him), then clicks his `[data-player-modal]` name so the
 * sheet opens through the same delegated listener a tap would.
 *
 * Both TheLeague's /players and the shared FreeAgentsPage call it after their
 * modal trigger is bound. `player` is dropped from the URL once handled, so a
 * reload or Back does not reopen a sheet the owner closed; the name stays in
 * the box, which is what the page would show had they typed it.
 */
const WAIT_MS = 4000;
const STEP_MS = 100;

export function openSearchedPlayer(): void {
  const url = new URL(window.location.href);
  const id = url.searchParams.get('player');
  if (!id || !/^\d+$/.test(id)) return;
  const name = url.searchParams.get('q') ?? '';
  url.searchParams.delete('player');
  url.searchParams.delete('q');
  history.replaceState(history.state, '', url.toString());

  const box = document.getElementById('player-search') as HTMLInputElement | null;
  const tbody = document.getElementById('player-table-body');
  if (!tbody) return;

  const typeName = () => {
    if (!box || !name) return;
    box.value = name;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // After the page's own init has bound its input listener (same task queue).
  setTimeout(typeName, 0);

  const started = Date.now();
  const tick = () => {
    for (const el of Array.from(tbody.querySelectorAll<HTMLElement>('[data-player-modal]'))) {
      let parsed: { id?: unknown } | null = null;
      try {
        parsed = JSON.parse(el.getAttribute('data-player-modal') || 'null');
      } catch {
        continue;
      }
      if (String(parsed?.id ?? '') !== id) continue;
      el.closest('tr')?.scrollIntoView({ block: 'center' });
      el.click();
      return;
    }
    if (Date.now() - started < WAIT_MS) setTimeout(tick, STEP_MS);
  };
  setTimeout(tick, STEP_MS);
}
