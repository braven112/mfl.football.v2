/**
 * Brings the roster header's ACTIVE crest into view inside the team switcher
 * (components/shared/roster-header/TeamDivisionRow.astro).
 *
 * On a phone the switcher is wider than the screen and scrolls sideways, so a
 * club near the far end of the row — an NL East club in the AFL, a late
 * division in TheLeague — rendered off-screen and the reader could not see
 * which team they were on. Which CONFERENCE opens is settled on the server
 * (the one holding the active club); this only scrolls.
 *
 * Lives here rather than in the component because the switcher ships no
 * client script (tests/rosters-team-nav-clientrouter.test.ts): each roster
 * page calls it from its own per-page-load init.
 *
 * Horizontal only, and only when the crest is not already fully visible: a
 * crest the reader just tapped is on screen by definition, so switching team
 * never slides the row out from under their thumb, and `scrollIntoView` is
 * not used because it would also scroll the PAGE vertically.
 */

/** Room kept between the crest and the scroller's edge when it is already visible. */
const EDGE_PAD = 8;

interface Span {
  left: number;
  right: number;
}

/**
 * How far to move `scrollLeft` so `crest` sits centered in `scroller`, or 0
 * when it is already fully visible (with `EDGE_PAD` to spare).
 */
export function revealScrollDelta(crest: Span, scroller: Span): number {
  if (crest.left >= scroller.left + EDGE_PAD && crest.right <= scroller.right - EDGE_PAD) return 0;
  const crestCentre = (crest.left + crest.right) / 2;
  const scrollerCentre = (scroller.left + scroller.right) / 2;
  return Math.round(crestCentre - scrollerCentre);
}

export function revealActiveTeamCrest(root: ParentNode | null | undefined): void {
  const crest = root?.querySelector<HTMLElement>('.rhdr-teams__crest[aria-current="page"]');
  if (!crest) return;
  // Many-conference rows scroll the open conference's divisions on their own
  // line; every other row scrolls the nav itself.
  const scroller =
    crest.closest<HTMLElement>('.rhdr-teams--many .rhdr-teams__divisions') ??
    crest.closest<HTMLElement>('.rhdr-teams');
  if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
  const delta = revealScrollDelta(crest.getBoundingClientRect(), scroller.getBoundingClientRect());
  if (delta !== 0) scroller.scrollLeft += delta;
}
