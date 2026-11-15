/**
 * Contract Desk — the Rosters page with only extend, franchise tag and cut.
 *
 * `/theleague/front-office/contract-desk` rewrites to the Rosters page with
 * `?desk=1`. In that mode the page keeps its team header, player cells and
 * salary table, hides every control that is not about those three actions,
 * swaps the ⋮ menu for inline buttons, and (on a phone) lists the players in
 * three sections — Extend, Franchise tag, Cut — above the cap strip.
 *
 * Which actions a player HAS still comes from one place,
 * `getCdmActionDescriptors` (src/utils/cdm-action-descriptors.ts). This file
 * only narrows that list to the desk's three actions and decides how the
 * desk shows them, so the desk can never offer an action the ⋮ menu would not.
 *
 * Pure: no DOM, no page state.
 */
import type { CdmActionDescriptor, CdmActionId } from '../cdm-action-descriptors';

/** The descriptor ids the desk keeps, in the order its buttons read. */
export const DESK_ACTION_IDS: ReadonlyArray<CdmActionId> = [
  'extension',
  'rookie-extension',
  'franchise',
  'cut',
];

/** The query flag the desk route rewrites to. */
export const DESK_QUERY_PARAM = 'desk';

/** Short button labels: the table's action column is narrow. */
const SHORT_LABELS: Partial<Record<CdmActionId, string>> = {
  extension: 'Extend',
  'rookie-extension': 'Rookie ext',
  franchise: 'Tag',
  cut: 'Cut',
};

/** Whether this request is the desk (the rewritten Rosters URL). */
export function isDeskRequest(url: URL | null | undefined): boolean {
  return url?.searchParams?.get(DESK_QUERY_PARAM) === '1';
}

/** True for an id the desk shows. */
export function isDeskActionId(id: string): id is CdmActionId {
  return (DESK_ACTION_IDS as ReadonlyArray<string>).includes(id);
}

/** The ⋮ menu's list narrowed to the desk's actions, in the desk's order. */
export function filterDeskDescriptors(descriptors: ReadonlyArray<CdmActionDescriptor>): CdmActionDescriptor[] {
  return DESK_ACTION_IDS
    .map((id) => descriptors.find((d) => d.id === id))
    .filter((d): d is CdmActionDescriptor => !!d && !d.disabled);
}

export interface DeskButton {
  id: CdmActionId;
  label: string;
  /** The ⋮ menu's own label, for the button's accessible name. */
  title: string;
}

/** The inline buttons for one row. */
export function deskButtonsFor(descriptors: ReadonlyArray<CdmActionDescriptor>): DeskButton[] {
  return filterDeskDescriptors(descriptors).map((d) => ({
    id: d.id,
    label: SHORT_LABELS[d.id] ?? d.label,
    title: d.label,
  }));
}

/**
 * The page's simulated action types (`contractActions[id].type`) as the desk
 * names them once they are planned. `team-option` and `trade` are not desk
 * actions, but a plan made on the full Rosters page still shows here.
 */
const PLANNED_LABELS: Record<string, string> = {
  extension: 'Extending',
  'rookie-extension': 'Extending',
  franchise: 'Tagged',
  cut: 'Cutting',
  'team-option': 'Option',
  trade: 'Trading',
};

export function plannedLabel(actionType: string | null | undefined): string | null {
  if (!actionType) return null;
  return PLANNED_LABELS[actionType] ?? 'Planned';
}

/** One player as the phone sections need him. */
export interface DeskPlayer {
  id: string;
  name: string;
  position: string;
  salary: number;
  years: number;
  descriptors: ReadonlyArray<CdmActionDescriptor>;
  /** The simulated action already planned on him, if any. */
  plannedType?: string | null;
}

export interface DeskSections {
  /** Veteran and rookie extensions, lowest salary first. */
  extend: DeskPlayer[];
  /** Expiring contracts that can be tagged, highest salary first. */
  tag: DeskPlayer[];
  /** Everyone who can be cut, biggest saving (highest salary) first. */
  cut: DeskPlayer[];
}

const has = (p: DeskPlayer, ...ids: CdmActionId[]) =>
  p.descriptors.some((d) => ids.includes(d.id) && !d.disabled);

const byName = (a: DeskPlayer, b: DeskPlayer) => a.name.localeCompare(b.name);

/**
 * Splits a roster into the phone's three sections. A player planned for an
 * action stays in that action's section even though the plan has changed his
 * contract, so the owner can find it again to undo.
 */
export function groupDeskSections(players: ReadonlyArray<DeskPlayer>): DeskSections {
  const extend = players
    .filter((p) => has(p, 'extension', 'rookie-extension')
      || p.plannedType === 'extension' || p.plannedType === 'rookie-extension')
    .sort((a, b) => a.salary - b.salary || byName(a, b));
  const tag = players
    .filter((p) => has(p, 'franchise') || p.plannedType === 'franchise')
    .sort((a, b) => b.salary - a.salary || byName(a, b));
  const cut = players
    .filter((p) => has(p, 'cut') || p.plannedType === 'cut')
    .sort((a, b) => b.salary - a.salary || byName(a, b));
  return { extend, tag, cut };
}

/** How many of a section show before "Show all". */
export const DESK_SECTION_PREVIEW = 3;
