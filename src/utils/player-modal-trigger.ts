/**
 * Player Modal Trigger — shared click handler for PlayerDetailsModal
 *
 * Attaches a delegated click listener to a container element. When a
 * `[data-player-modal]` element is clicked, the JSON payload is decoded
 * and passed to `window.openPlayerDetailsModal()`.
 *
 * Works with both the Astro `PlayerCell` component (which sets
 * `data-player-modal` on the name element) and the `buildPlayerCellHTML()`
 * utility for JS-rendered contexts.
 *
 * @example
 * ```ts
 * import { initPlayerModalTrigger } from '../utils/player-modal-trigger';
 *
 * const table = document.getElementById('roster-table');
 * if (table) initPlayerModalTrigger(table);
 * ```
 */

/** Data shape accepted by PlayerDetailsModal's `openPlayerDetailsModal()` */
export interface PlayerModalData {
  id?: string;
  espnId?: string;
  name?: string;
  position?: string;
  nflTeam?: string;
  status?: string;
  salary?: number | null;
  contractYears?: number | null;
  totalRemaining?: number | null;
  contractType?: string | null;
  points?: number | null;
  byeWeek?: number | null;
  draftYear?: number | null;
  draftRound?: number | null;
  draftPick?: number | null;
  draftTeam?: string | null;
  birthdate?: number | null;
  franchiseId?: string | null;
  rosterSlot?: string | null;
  college?: string | null;
  collegeLogo?: string | null;
  height?: number | null;
  weight?: number | null;
  number?: number | null;
  experience?: number | null;
  depthChartPosition?: string | null;
  depthChartOrder?: number | null;
  depthChartAhead?: Array<{ name: string }> | null;
  injuryStatus?: string | null;
  injuryBodyPart?: string | null;
  sleeperId?: string | null;
  sleeperFullName?: string | null;
  sleeperPosition?: string | null;
  fantasyPositions?: string | null;
  gsisId?: string | null;
  sleeperAge?: number | null;
  sleeperStatus?: string | null;
  sleeperActive?: boolean | null;
  offenseSnaps?: number | null;
  defenseSnaps?: number | null;
  stSnaps?: number | null;
}

/**
 * Attach a delegated click listener that opens PlayerDetailsModal
 * when a `[data-player-modal]` element is clicked.
 *
 * @param container - The parent element to listen on (e.g. a table body)
 */
export function initPlayerModalTrigger(container: HTMLElement): void {
  container.addEventListener('click', (e) => {
    const clicked = e.target as HTMLElement;
    const modalTrigger = clicked.closest<HTMLElement>('[data-player-modal]');
    if (!modalTrigger) return;

    // Don't open the modal when user clicks a nested interactive element
    // (e.g. injury indicator button, trade bait link)
    const nestedInteractive = clicked.closest('a, button');
    if (nestedInteractive && nestedInteractive !== modalTrigger && modalTrigger.contains(nestedInteractive)) {
      return;
    }

    const raw = modalTrigger.getAttribute('data-player-modal');
    if (!raw) return;

    try {
      const playerData: PlayerModalData = JSON.parse(raw);
      if (typeof (window as any).openPlayerDetailsModal === 'function') {
        (window as any).openPlayerDetailsModal(playerData);
      }
    } catch {
      // Silently ignore malformed JSON
    }
  });
}
