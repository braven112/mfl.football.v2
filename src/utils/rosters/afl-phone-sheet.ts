/**
 * AFL Rosters → the player sheet's opt-in payload (docs/plans/rosters-mobile-layout.md § 8).
 *
 * The AFL twin of `phone-sheet.ts`, and much smaller: the AFL has no salaries,
 * so the sheet is tabbed WITHOUT a Salary tab (Summary + Game log, via
 * `tabbed: true`), and every action it offers is one `AFLActionModal` already
 * owns. The sheet never writes: `onAction` closes it and hands the action to
 * that modal, which keeps its confirmation step and the MFL write.
 *
 * The action ids ARE the modal's own (`ModalAction` in AFLActionModal.astro),
 * so routing is a pass-through rather than a second list to keep in step.
 */

import type { PlayerModalData, SheetAction, SheetActionApi } from '../player-modal-trigger';
import { liftMyRank, liftThisWeek } from './phone-sheet';

/** The AFLActionModal actions the sheet can hand off to. Watch is the sheet's own. */
export type AflSheetActionId = 'trade-bait-add' | 'trade-bait-remove' | 'ir-to' | 'ir-from' | 'trade' | 'cut';

export const AFL_SHEET_ACTION_IDS: readonly AflSheetActionId[] = [
  'trade-bait-add',
  'trade-bait-remove',
  'ir-to',
  'ir-from',
  'trade',
  'cut',
];

export interface AflSheetFacts {
  /** The viewer owns this roster: the write actions appear. */
  isOwner: boolean;
  /** ROSTER | INJURED_RESERVE, from the row. */
  status: string;
  onTradeBait: boolean;
}

/** The owner's roster moves, in AFLActionModal's order. */
function rosterMoves(facts: AflSheetFacts): SheetAction[] {
  const onIr = facts.status === 'INJURED_RESERVE';
  return [
    onIr
      ? { id: 'ir-from', label: 'Activate from IR', desc: 'Move him back to your active roster', icon: 'icon-ambulance' }
      : { id: 'ir-to', label: 'Move to IR', desc: 'Free an active roster slot', icon: 'icon-ambulance' },
    { id: 'trade', label: 'Trade Player', desc: 'Open the Trade Builder with him pre-loaded', icon: 'icon-transactions-2' },
    { id: 'cut', label: 'Cut Player', desc: 'Release him to the free-agent pool', icon: 'icon-user-times', tone: 'danger' },
  ];
}

/**
 * The hero row. For the owner: the trade-block toggle and a ⋮ menu with the
 * roster moves (TheLeague's "Contract options" kebab; the AFL has no
 * contracts, so it is "Player options"). Everyone gets the sheet's built-in
 * Watch; a non-owner has nothing else to do here.
 */
export function buildAflQuickActions(facts: AflSheetFacts): SheetAction[] {
  if (!facts.isOwner) return [];
  return [
    {
      id: facts.onTradeBait ? 'trade-bait-remove' : 'trade-bait-add',
      label: facts.onTradeBait ? 'On trade block' : 'Trade block',
      icon: 'icon-bookmark',
      state: facts.onTradeBait ? 'on' : undefined,
      desc: facts.onTradeBait ? 'Take him off your trade block' : 'Tell other owners he is available',
    },
    { id: 'player-menu', label: 'Player options', icon: 'icon-menu', menu: rosterMoves(facts) },
  ];
}

/** Summary › More actions: the same roster moves, as TheLeague's sheet lists its own. */
export function buildAflMoreActions(facts: AflSheetFacts): SheetAction[] {
  return facts.isOwner ? rosterMoves(facts) : [];
}

export function buildAflSheetFields(
  row: ParentNode,
  facts: AflSheetFacts,
): Pick<PlayerModalData, 'tabbed' | 'sheetTab' | 'thisWeek' | 'quickActions' | 'moreActions' | 'myRank' | 'hideOwnerStrip'> {
  return {
    tabbed: true,
    // The AFL's rows are matchup rows, so the sheet opens on the matchup.
    sheetTab: 'summary',
    thisWeek: liftThisWeek(row),
    quickActions: buildAflQuickActions(facts),
    moreActions: buildAflMoreActions(facts),
    myRank: liftMyRank(row),
    // The header above the rows already names the club and wears its crest.
    hideOwnerStrip: true,
  };
}

/**
 * `onAction`: close the sheet, then hand the action to AFLActionModal. An id
 * the modal does not know (the ⋮ menu's own id, say) is ignored.
 */
export function createAflSheetActionHandler(
  openModal: (action: AflSheetActionId) => void,
): (id: string, sheet: SheetActionApi) => void {
  return (id, sheet) => {
    if (!(AFL_SHEET_ACTION_IDS as readonly string[]).includes(id)) return;
    sheet.close();
    openModal(id as AflSheetActionId);
  };
}
