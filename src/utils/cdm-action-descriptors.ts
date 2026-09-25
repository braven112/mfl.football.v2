/**
 * The Contract Declaration Modal's step-1 action list, as DATA.
 *
 * `populateCdmActionOptions` (src/utils/cdm-wizard.ts) used to decide which
 * actions exist AND build their buttons in one pass. The roster's player sheet
 * (docs/plans/rosters-mobile-layout.md § 5) needs the same answer — "which
 * actions does this player have?" — without the modal. Two copies of that
 * eligibility logic would drift, so it lives here once and both read it:
 *
 *   - the CDM renders it into `.cdm-action-option--<id>` buttons
 *     (`renderCdmActionOptions` in cdm-wizard.ts), unchanged;
 *   - the sheet's opener (src/utils/rosters/phone-sheet.ts) turns it into the
 *     Salary tab's Extend-or-tag rows and Summary › More actions.
 *
 * Pure: no DOM, no module state. The caller supplies the facts that live in
 * the page (who is viewing, the watch list, the auto-cut slate) through
 * `CdmActionContext`. Order, ids, labels, descriptions and icons are the CDM's
 * exactly — `scripts/cdm-parity-check.mjs` fingerprints every one of them
 * across the owner's roster, and tests/cdm-action-descriptors.test.ts pins them
 * per contract state.
 */

/** One step-1 option. `id` is the `cdm-action-option--<id>` modifier. */
export interface CdmActionDescriptor {
  id: CdmActionId;
  label: string;
  desc: string;
  icon: string;
  disabled?: boolean;
  /** A toggle that is currently ON: marked for auto-cut, on the watch list. */
  state?: 'on';
}

export type CdmActionId =
  | 'declare-contract'
  | 'franchise'
  | 'team-option'
  | 'extension'
  | 'rookie-extension'
  | 'move-to-ir'
  | 'move-to-practice'
  | 'activate-from-ir'
  | 'promote-from-practice'
  | 'autocut-toggle'
  | 'watch'
  | 'cut'
  | 'trade';

/** The contract ids — what the Salary tab's "Extend or tag" is made of. */
export const CDM_CONTRACT_ACTION_IDS: ReadonlyArray<CdmActionId> = [
  'declare-contract',
  'franchise',
  'team-option',
  'extension',
  'rookie-extension',
];

/**
 * The slice of the action-select `eligibility` object the list reads. The CDM
 * builds it from the row's ⋮ button (rosters.astro); every field is optional
 * because a mock / demo row may omit any of them.
 */
export interface CdmActionEligibility {
  playerId?: string | number | null;
  currentYears?: number | null;
  contractInfo?: string | null;
  isRookieContract?: boolean | null;
  displayTag?: string | null;
  declareType?: string | null;
  declareYearOptions?: number[] | null;
}

/** The auto-cut facts for one player, computed only when the option can show. */
export interface CdmAutocutFacts {
  /** 1-based position in the owner's cut order; 0 = not marked. */
  priority: number;
  /** Marked, but below the line today's roster count would cut. */
  belowLine: boolean;
  targetActiveCount: number;
}

export interface CdmActionContext {
  /** The signed-in owner is looking at their own team. */
  isOwnTeam: boolean;
  /**
   * Asked only for an ACTIVE player on the owner's own team — the same point
   * the CDM used to evaluate `isAutocutOwnView()`. Return null when the option
   * must not show (not the owner's real view, demo mode, a DEMO_ id).
   */
  autocut: () => CdmAutocutFacts | null;
  watch: { signedOut: boolean; watched: boolean };
}

const yearsText = (n: number) => `${n} year${n === 1 ? '' : 's'}`;

/** The Declare Contract description for this eligibility (null = not offered). */
function declareDesc(elig: CdmActionEligibility): string | null {
  if (elig.declareType !== 'new-acquisition' && elig.declareType !== 'rookie-override') return null;
  const opts = Array.isArray(elig.declareYearOptions) && elig.declareYearOptions.length
    ? elig.declareYearOptions
    : (elig.declareType === 'rookie-override' ? [1, 2, 3, 4] : [1, 2, 3, 4, 5]);
  const min = opts[0];
  const max = opts[opts.length - 1];
  const range = min === max ? yearsText(min) : `${min}–${max} years`;
  return elig.declareType === 'rookie-override'
    ? `Set rookie contract length (${range})`
    : `Set initial contract length (${range})`;
}

/**
 * Every step-1 action this player has, in the CDM's order.
 */
export function getCdmActionDescriptors(
  elig: CdmActionEligibility,
  ctx: CdmActionContext,
): CdmActionDescriptor[] {
  const out: CdmActionDescriptor[] = [];
  const contractYears = elig.currentYears || 0;
  const isTO = (elig.contractInfo ?? '') === 'TO';
  const isRC = elig.isRookieContract;

  // Declare Contract — fresh acquisition (auction/BBID/free-agent) or rookie override window
  const declare = declareDesc(elig);
  if (declare) {
    out.push({ id: 'declare-contract', label: 'Declare Contract', desc: declare, icon: 'icon-coin' });
  }

  // Tag-like actions (1 year remaining) — Franchise Tag, non-TO players only
  if (contractYears === 1 && !isTO) {
    out.push({ id: 'franchise', label: 'Franchise Tag', desc: '1 year at higher of 120% or position average', icon: 'icon-franchise-tag' });
  }
  // Team Option — TO players only (option window is years 1–3 of contract)
  if (contractYears >= 2 && isTO) {
    out.push({ id: 'team-option', label: 'Team Option', desc: '5th-year option at top 10 position average', icon: 'icon-franchise-tag' });
  }
  // Veteran Extension — standard contracts only (2+ years remaining)
  if (contractYears >= 2 && !isRC && !isTO) {
    out.push({ id: 'extension', label: 'Veteran Extension', desc: 'Extend contract 1–2 years', icon: 'icon-coin' });
  }
  // Rookie Extension — RC or TO contracts only (+2 years, fixed)
  if (contractYears >= 2 && (isRC || isTO)) {
    out.push({ id: 'rookie-extension', label: 'Rookie Extension', desc: 'Extend rookie contract 2 years', icon: 'icon-coin-r' });
  }

  // Roster moves (IR / Practice Squad) — owner-only, on the user's own team.
  // Rookie gate uses contractInfo (RC | TO): TheLeague's auto-stamp script
  // writes one of these on every drafted rookie, a reliable proxy for MFL's own
  // status === 'R' (which /api/move-to-practice enforces as the real gate).
  // Practice-squad rookies keep the IR option.
  if (ctx.isOwnTeam) {
    const tag = (elig.displayTag || 'active').toString();
    const isRookie = elig.contractInfo === 'RC' || elig.contractInfo === 'TO';
    const toIr: CdmActionDescriptor = { id: 'move-to-ir', label: 'Move to IR', desc: 'Pause participation — cap charge unchanged', icon: 'icon-ambulance' };

    if (tag === 'active') {
      out.push(toIr);
      if (isRookie) {
        out.push({ id: 'move-to-practice', label: 'Move to Practice Squad', desc: 'Stash a rookie — reduced cap charge', icon: 'icon-bookmark' });
      }
    } else if (tag === 'injured') {
      out.push({ id: 'activate-from-ir', label: 'Activate from IR', desc: 'Restore to active roster', icon: 'icon-ambulance' });
    } else if (tag === 'practice') {
      if (isRookie) {
        out.push({ id: 'promote-from-practice', label: 'Promote from Practice', desc: 'Move rookie to active roster', icon: 'icon-bookmark' });
      }
      out.push({ ...toIr });
    }

    // August auto-cut toggle — cut window only, active-roster players only
    // (taxi/IR are automation-exempt). Reversible marking reads lighter than
    // the irreversible cut, so it sits between the roster moves and Cut.
    if (tag === 'active') {
      const autocut = ctx.autocut();
      if (autocut) {
        const marked = autocut.priority > 0;
        out.push({
          id: 'autocut-toggle',
          label: marked ? 'Unmark auto-cut' : 'Mark for August auto-cut',
          desc: marked
            ? `Priority #${autocut.priority} in your cut order${autocut.belowLine ? ' — below the cut line, safe unless your roster grows' : ''} — click to remove`
            : `Cut automatically at the deadline if you're over ${autocut.targetActiveCount}`,
          icon: 'icon-clipboard',
          ...(marked ? { state: 'on' as const } : {}),
        });
      }
    }
  }

  // Watch — per-VIEWER, not per-roster: anyone on any roster. A signed-out
  // visitor sees it too and is handed to sign-in.
  {
    const { signedOut, watched } = ctx.watch;
    out.push({
      id: 'watch',
      label: watched ? 'Stop watching' : 'Watch player',
      desc: signedOut
        ? 'Sign in to build your watch list'
        : (watched ? 'Remove him from your watch list' : 'His news lights up in the Schefter Report'),
      icon: watched ? 'icon-eye-slash' : 'icon-eye',
      ...(watched ? { state: 'on' as const } : {}),
    });
  }

  out.push({ id: 'cut', label: 'Cut Player', desc: '50% cap hit + future penalties', icon: 'icon-user-times' });
  // Handshake, not the swap arrows: trades and waivers wear the mark the Trade
  // Builder does. Twin of the AFL modal's trade action.
  out.push({ id: 'trade', label: 'Trade Player', desc: 'Simulate, add to trade block, or open trade builder', icon: 'icon-transactions-2' });

  return out;
}
