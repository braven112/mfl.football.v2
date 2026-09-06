/**
 * Waiver-priority list rendering — ONE implementation, two call sites.
 *
 * The Free Agents page has its own `WaiverPriorityModal`, and the global
 * Transaction Hub shows the same order as a drill-in screen. Both need the
 * identical row markup, the identical "you" badge, and the identical footnote
 * about what priority actually decides — so it lives here rather than in
 * either of them. Forking it is how this repo grew 24 near-identical siblings
 * (see tests/page-fork-ratchet.test.ts); the two consumers differ only in the
 * CSS prefix they hand in.
 *
 * WHY THE RANK IS RECOMPUTED AND NOT MFL'S OWN NUMBER: `rankWithinConference`
 * renumbers from 1 within the teams passed in, because MFL's flat league-wide
 * `waiverSortOrder` is a lie about a National owner's odds — see
 * src/utils/waiver-order.ts for the full reasoning.
 */

import { rankWithinConference } from './waiver-order';
import type { WaiverOrderEntry } from './waiver-order';

export interface WaiverPriorityRenderTeam {
  franchiseId: string;
  name: string;
  /** Site-relative icon path (`/assets/...`), never an MFL-hosted absolute URL —
   *  the dark-variant stylesheet keys on the exact relative src. */
  icon?: string;
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * `<li>` rows for an `<ol>`, ranked 1..N within the teams given.
 *
 * @param prefix BEM block the caller's stylesheet owns (`wpm-row`, `thm-worow`).
 */
export function renderWaiverPriorityRows(
  order: WaiverOrderEntry[],
  teams: WaiverPriorityRenderTeam[],
  myFranchiseId: string | null,
  prefix: string,
): string {
  const byId = new Map(teams.map((t) => [t.franchiseId, t]));
  const ranked = rankWithinConference(
    order,
    teams.map((t) => t.franchiseId),
  );

  return ranked
    .map(({ franchiseId, rank }) => {
      const team = byId.get(franchiseId);
      const isMe = franchiseId === myFranchiseId;
      const icon = team?.icon
        ? `<img class="${prefix}__icon" src="${esc(team.icon)}" alt="" loading="lazy" decoding="async" />`
        : `<span class="${prefix}__icon ${prefix}__icon--blank" aria-hidden="true"></span>`;
      return (
        `<li class="${prefix}${isMe ? ` ${prefix}--me` : ''}">` +
        `<span class="${prefix}__rank">${rank}</span>` +
        icon +
        `<span class="${prefix}__name">${esc(team?.name ?? franchiseId)}</span>` +
        (isMe ? `<span class="${prefix}__you">You</span>` : '') +
        `</li>`
      );
    })
    .join('');
}

/**
 * The line under the list: what priority decides, and how fresh the number is.
 * `live: false` means MFL did not answer and the route served its last
 * known-good order — say so, rather than presenting stale as live.
 *
 * NO BLIND-BID BRANCH, deliberately. This used to read "Priority breaks ties
 * between equal bids" for a bbid league, which is false for TheLeague:
 * BBID_FCFS breaks ties FIRST COME FIRST SERVED and consults no order at all.
 * A league that does not run priority now has no priority screen to footnote
 * (src/utils/waiver-system.ts), so the honest fix is to delete the claim
 * rather than reword it — every caller of this is, by construction, a
 * rolling-priority league.
 */
export const WAIVER_PRIORITY_NOTE =
  'Priority is rolling — win a claim and you drop to the back of the line.';

export function waiverPriorityFootnote(asOf: string, live: boolean): string {
  const when = new Date(asOf);
  const stamp = Number.isNaN(when.getTime())
    ? ''
    : when.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
  const note = WAIVER_PRIORITY_NOTE;
  return live
    ? `${note} Live from MyFantasyLeague${stamp ? `, ${stamp}` : ''}.`
    : `${note} MyFantasyLeague is not answering — showing the last order we read${stamp ? `, ${stamp}` : ''}.`;
}
