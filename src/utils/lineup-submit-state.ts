/**
 * Submit-button state for the lineup pages — the decision, not the DOM.
 *
 * This lives apart from `lineup-sources.ts` on purpose: that module reads the
 * committed feeds and imports `node:fs`, so it can never enter a browser
 * bundle. This one is pure and is imported by BOTH the client script and its
 * tests, which is the point — the guard that stops a submit from overwriting
 * a lineup we could not read is a branch in this function, and a test that
 * greps the page for it stays green when the branch is deleted
 * (docs/claude/rules/league-urls.md, "test the behavior, not the source text"
 * — learned the hard way twice).
 */

export interface SubmitButtonState {
  /** Full class attribute for the button. */
  className: string;
  disabled: boolean;
  text: string;
  /** Should the "N changes" counter be visible? */
  showChanges: boolean;
}

export interface SubmitButtonInput {
  /** How many slots differ from what loaded. */
  changes: number;
  /** Do all nine slots hold a player? */
  allFilled: boolean;
  /** Does MFL hold a lineup for this week? */
  lineupOnFile: boolean;
  /** May an EDITED lineup be submitted? False on a failed read / dead week. */
  canSubmitEdits: boolean;
  /** May the untouched auto-fill be offered for one-tap submission? */
  canSubmitUnsaved: boolean;
  /** Was the lineup rebuilt from the daily feed rather than read from MFL? */
  fromCache?: boolean;
}

export function resolveSubmitButtonState(input: SubmitButtonInput): SubmitButtonState {
  const { changes, allFilled, lineupOnFile, canSubmitEdits, canSubmitUnsaved, fromCache } = input;
  const hasChanges = changes > 0;

  // A deliberate edit is submittable only where submitting is safe at all.
  // Without the canSubmitEdits conjunct, one swap re-enables the button on a
  // week whose lineup we failed to read — and sends eight slots the owner
  // never chose.
  if (hasChanges && allFilled && canSubmitEdits) {
    return { className: 'lineup-submit lineup-submit--ready', disabled: false, text: 'Submit Lineup', showChanges: true };
  }

  // Nothing on file and nothing touched: the slots are this page's own fill,
  // so offer to save it rather than claiming it already is saved.
  if (!hasChanges && canSubmitUnsaved && allFilled) {
    return { className: 'lineup-submit lineup-submit--ready', disabled: false, text: 'Submit Lineup', showChanges: false };
  }

  if (!hasChanges && lineupOnFile) {
    // A cached lineup is a real one, but up to a day old — saying a flat
    // "Lineup Saved" over it overstates what we actually know.
    return {
      className: 'lineup-submit lineup-submit--clean',
      disabled: true,
      text: fromCache ? 'Saved (last sync)' : 'Lineup Saved',
      showChanges: false,
    };
  }

  return {
    className: 'lineup-submit lineup-submit--disabled',
    disabled: true,
    text: 'Submit Lineup',
    showChanges: hasChanges,
  };
}
