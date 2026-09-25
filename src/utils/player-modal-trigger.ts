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
  /**
   * Best-guess ESPN id — may be a COLLEGE athlete id for rookies (see
   * `resolveEspnId`). Safe for headshots, which pick the matching URL. NOT safe
   * for ESPN's NFL athlete endpoints: consumers that need a guaranteed-NFL id
   * send `id` to /api/player-news and let it resolve `espn_id` from the feed.
   */
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
  /**
   * Off-site acquisition link (MFL's own bid/add page) for a viewer who cannot
   * claim in place. The free-agent tables carry it on the row's ⋮ button; on a
   * phone that column is hidden and the row itself opens the modal, so the
   * trigger lifts it from the row into the payload rather than losing it.
   */
  acqUrl?: string | null;
  acqLabel?: string | null;
}

export interface PlayerModalTriggerOptions {
  /**
   * Media query under which a tap ANYWHERE in the row opens that row's
   * player, not just a tap on the name. The free-agent tables pass their
   * phone breakpoint: there the name is a small target in a compact row, and
   * the row's other controls live in the modal.
   */
  rowTapMedia?: string;
}

/**
 * Attach a delegated click listener that opens PlayerDetailsModal
 * when a `[data-player-modal]` element is clicked.
 *
 * @param container - The parent element to listen on (e.g. a table body)
 */
export function initPlayerModalTrigger(
  container: HTMLElement,
  options: PlayerModalTriggerOptions = {},
): void {
  container.addEventListener('click', (e) => {
    const clicked = e.target as HTMLElement;
    let modalTrigger = clicked.closest<HTMLElement>('[data-player-modal]');
    if (!modalTrigger && options.rowTapMedia && window.matchMedia(options.rowTapMedia).matches) {
      // A control elsewhere in the row keeps its own click.
      if (clicked.closest('a, button, input, select, textarea, label')) return;
      const row = clicked.closest('tr');
      if (row && container.contains(row)) {
        modalTrigger = row.querySelector<HTMLElement>('[data-player-modal]');
      }
    }
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
      const acq = modalTrigger.closest('tr')?.querySelector<HTMLElement>('[data-pa-acq-url]');
      if (acq && !playerData.acqUrl) {
        playerData.acqUrl = acq.dataset.paAcqUrl || null;
        playerData.acqLabel = acq.dataset.paAcqLabel || null;
      }
      if (typeof (window as any).openPlayerDetailsModal === 'function') {
        (window as any).openPlayerDetailsModal(playerData);
      }
    } catch {
      // Silently ignore malformed JSON
    }
  });
}
