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
import type { TeamBand } from './team-band';
import { clockZonesFromCookie, formatMomentOrDevice } from './viewer-clock';
import type { LeagueClock } from './viewer-preferences';

export interface WaiverPriorityRenderTeam {
  franchiseId: string;
  name: string;
  /** Site-relative icon path (`/assets/...`), never an MFL-hosted absolute URL —
   *  the dark-variant stylesheet keys on the exact relative src. */
  icon?: string;
  /**
   * The franchise's band, resolved server-side by `withTeamBands`
   * (src/utils/team-band.ts) and carried in whichever config blob this
   * surface already ships.
   *
   * It rides on the TEAM rather than arriving as a second map keyed by
   * franchise id, so the colour and the club it belongs to cannot drift apart
   * — and so this module needs nothing from the league configs, which the
   * browser does not have. The import above is TYPE-ONLY for that reason: a
   * value import would pull all three configs into the client bundle.
   *
   * Optional because a caller that has not adopted the band yet still renders
   * — it simply gets the pre-band row.
   */
  band?: TeamBand;
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
      // The band's two themes both ride in as custom properties; the
      // stylesheet picks under `html.dark`. Resolving a theme here is not an
      // option — this runs in the browser, but it runs ONCE per open, while
      // the theme can change under it without a re-render.
      const band = team?.band
        ? ` style="--band-fill:${esc(team.band.fill)};--band-ink:${esc(team.band.ink)};` +
          `--band-fill-dark:${esc(team.band.fillDark)};--band-ink-dark:${esc(team.band.inkDark)}"`
        : '';
      const banded = team?.band ? ` ${prefix}--band` : '';
      return (
        `<li class="${prefix}${banded}${isMe ? ` ${prefix}--me` : ''}"${band}>` +
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

/**
 * `cookies` is the raw `document.cookie` string — this runs in the browser, and
 * taking it as an argument is what keeps the function testable and keeps the
 * read PER CALL rather than captured at module load (the ClientRouter keeps
 * this module alive across navigations, so a capture would go stale).
 */
export function waiverPriorityFootnote(asOf: string, live: boolean, cookies = '', league?: LeagueClock): string {
  const when = new Date(asOf);
  // The viewer's chosen clock (`/preferences`) when they have one, else this
  // device's — which is what the stamp used before the preference existed.
  const stamp = Number.isNaN(when.getTime())
    ? ''
    : formatMomentOrDevice(when, clockZonesFromCookie(cookies, league), {
        date: true,
        deviceFormat: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
      });
  const note = WAIVER_PRIORITY_NOTE;
  return live
    ? `${note} Live from MyFantasyLeague${stamp ? `, ${stamp}` : ''}.`
    : `${note} MyFantasyLeague is not answering — showing the last order we read${stamp ? `, ${stamp}` : ''}.`;
}
