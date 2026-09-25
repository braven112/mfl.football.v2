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
  /** Free-agent tables only: the snap columns a phone row hides. */
  snapGames?: number | null;
  snapPct?: number | null;
  /** Which season the snap figures cover, as the table labels it (e.g. "'26"). */
  snapSeason?: string | null;
  /** Dynasty ADP (the AFL table's ADP column). */
  adp?: number | null;
  /**
   * Off-site acquisition link (MFL's own bid/add page) for a viewer who cannot
   * claim in place. The free-agent tables carry it on the row's ⋮ button; on a
   * phone that column is hidden and the row itself opens the modal, so the
   * trigger lifts it from the row into the payload rather than losing it.
   */
  acqUrl?: string | null;
  acqLabel?: string | null;
  /**
   * The row's own free-agent verdict (the ⋮ button's `data-pa-claimable`).
   * Lets the sheet offer a signed-out visitor "Sign in to claim", the ⋮
   * sheet's other acquisition path, which a phone would otherwise lose.
   */
  claimable?: boolean;

  // ── Tabbed sheet (opt-in) ────────────────────────────────────────────────
  // Everything below is OPTIONAL and sent only by the roster pages. An opener
  // that sends none of it gets the sheet exactly as it has always rendered:
  // no tablist, the same stacked sections in the same order. See
  // docs/plans/rosters-mobile-layout.md § 4, and `resolveSheetTabs` in
  // src/utils/player-sheet.ts for the one rule that decides the tab set.
  //
  // `salarySheet`, not the plan's `salary`: `salary` above is already the
  // current-year number every opener sends and the Contract tile reads.

  /**
   * Opt into tabs with no salary data: Summary + Game log. The AFL's roster
   * sheet is the intended user (it has no contracts, so no Salary tab).
   * `salarySheet` implies it.
   */
  tabbed?: boolean;
  /** The Salary tab. Present → the sheet is tabbed and offers Salary. */
  salarySheet?: SalarySheetData | null;
  /** Which tab opens. Chosen per open by the opener; never remembered. */
  sheetTab?: SheetTabId;
  /** Summary › This week — the matchup columns a phone row hides. */
  thisWeek?: ThisWeekData | null;
  /** The action row at the top of the sheet (with the built-in Watch / Trade). */
  quickActions?: SheetAction[] | null;
  /** Summary › More actions. */
  moreActions?: SheetAction[] | null;
  /** The viewer's own ranking for this player ("QB 3"), as a metric tile. */
  myRank?: string | null;
  /**
   * Called with a SheetAction id (or a Salary-tab option / year-pill id) when
   * the viewer picks one. Travels IN THE PAYLOAD — never a window global, which
   * outlives a ClientRouter swap (the Sept 2026 lineup outage). JSON cannot
   * carry a function, so only a JS opener (`enrich`, below) can supply it.
   */
  onAction?: (id: string, sheet: SheetActionApi) => void | Promise<void>;
}

/** The sheet's tabs, in display order. */
export type SheetTabId = 'summary' | 'salary' | 'gamelog';

/**
 * One action the sheet can offer. `icon` is a sprite symbol id
 * (`/assets/icons/sprite.svg#<icon>`).
 */
export interface SheetAction {
  id: string;
  label: string;
  desc?: string;
  icon: string;
  tone?: 'danger';
  disabled?: boolean;
  /** A toggle that is currently ON (trade block, an active simulation). */
  state?: 'on';
}

/** What `onAction` may ask the open sheet to do. */
export interface SheetActionApi {
  /**
   * Repaint the sheet's opener-driven parts (quick actions, Salary, This week,
   * More actions) from a fresh payload, keeping the open tab. Used after a
   * local simulation, so the sheet stays open and says "Simulated · Undo".
   */
  rerender: (next: PlayerModalData) => void;
  /** Close the sheet, e.g. before handing off to another dialog. */
  close: () => void;
  /** Put a message in the sheet's polite live region. */
  announce: (message: string) => void;
}

/** One label/value pair — a Salary tile or a This-week row. */
export interface SheetFact {
  label: string;
  value: string;
}

/**
 * One contract year in the Salary tab. Lifted from the roster row's own
 * `year1`-`year5` cell (text and state class), so the sheet cannot disagree
 * with the row, simulation included.
 */
export interface SalarySheetYear {
  year: string;
  /** Exactly what the row's cell shows ("$5,000,000", "UFA", "—", "TO"). */
  text: string;
  kind: 'salary' | 'ufa' | 'future-ufa' | 'to-eligible' | 'to-expired';
  declared?: boolean;
  simulated?: boolean;
  /** Carries the league's +10% escalation over the year before. */
  escalated?: boolean;
  /** Cap charge that year if he were cut now; null when nothing is owed. */
  ifCut?: string | null;
}

/** One Salary-tab button: an extend/tag option or a simulation. */
export interface SalarySheetOption {
  id: string;
  label: string;
  /** The price, already formatted ("$6,240,000 for 2029"). */
  cost?: string;
  /** Secondary line: the basis, the preview, or why it is unavailable. */
  detail?: string;
  icon: string;
  disabled?: boolean;
  /** A simulation that is active for this player (renders as Undo). */
  state?: 'on';
}

export interface SalarySheetData {
  tiles: SheetFact[];
  years: SalarySheetYear[];
  /** Label for the If-cut column; omitted → the column is not drawn. */
  ifCutLabel?: string | null;
  /** Extend or tag. */
  options: SalarySheetOption[];
  /** Simulate. */
  simulations: SalarySheetOption[];
  /** "Simulated cut" — set while a simulation is active for this player. */
  simulated?: string | null;
}

export interface ThisWeekData {
  rows: SheetFact[];
  /** Shown instead of rows when there is nothing this week (a bye). */
  empty?: string | null;
}

export interface PlayerModalTriggerOptions {
  /**
   * Media query under which a tap ANYWHERE in the row opens that row's
   * player, not just a tap on the name. The free-agent tables pass their
   * phone breakpoint: there the name is a small target in a compact row, and
   * the row's other controls live in the modal.
   */
  rowTapMedia?: string;
  /**
   * Last word on the payload before the sheet opens: the roster pages add the
   * opt-in sheet fields here (Salary tab, quick actions, `onAction`), which a
   * JSON attribute cannot carry. Called at CLICK time with the row the
   * trigger sits in, so it reads the row as it is now — the roster tbody is
   * re-rendered after every simulation, and a node captured earlier is gone.
   */
  enrich?: (data: PlayerModalData, context: { row: HTMLTableRowElement | null }) => PlayerModalData;
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
      const row = modalTrigger.closest('tr');
      const acq = row?.querySelector<HTMLElement>('[data-pa-acq-url]');
      if (acq && !playerData.acqUrl) {
        playerData.acqUrl = acq.dataset.paAcqUrl || null;
        playerData.acqLabel = acq.dataset.paAcqLabel || null;
      }
      const verdict = row?.querySelector<HTMLElement>('[data-pa-claimable]');
      if (verdict && playerData.claimable === undefined) {
        playerData.claimable = verdict.dataset.paClaimable === 'true';
      }
      const payload = options.enrich ? enrichSafely(options.enrich, playerData, row ?? null) : playerData;
      if (typeof (window as any).openPlayerDetailsModal === 'function') {
        (window as any).openPlayerDetailsModal(payload);
      }
    } catch {
      // Silently ignore malformed JSON
    }
  });
}

/**
 * A throwing `enrich` must not cost the viewer the sheet itself: fall back to
 * the plain payload every other page opens with.
 */
function enrichSafely(
  enrich: NonNullable<PlayerModalTriggerOptions['enrich']>,
  data: PlayerModalData,
  row: HTMLTableRowElement | null,
): PlayerModalData {
  try {
    return enrich({ ...data }, { row }) ?? data;
  } catch (err) {
    console.error('[player-modal-trigger] enrich failed; opening the plain sheet', err);
    return data;
  }
}
