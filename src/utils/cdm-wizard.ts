/**
 * Contract Declaration Modal — the wizard's step transitions.
 *
 * Slice 3 of Phase 6.1 in docs/plans/rosters-page-split.md. The seven
 * `goTo*` functions were ~550 lines in the middle of `rosters.astro`'s
 * `initRosterPage`, separated from the rest of the modal by the (deferred)
 * ~1,300-line autocut section. Each one paints one screen of the wizard:
 * which stepper dots are lit, which `cdm-*-section` is visible, what the
 * submit button says, and what the review panel shows.
 *
 * They move as a FACTORY rather than as free functions because they are not
 * pure — they read and write the page's `cdmState`, drive DOM handles the
 * page owns (`cdm-submit`, `cdm-back-btn`), and call back into the parts of
 * the modal that have not moved yet. `createCdmSteps` takes those as one
 * explicit context object, which is the point of the exercise: the twenty-one
 * things this region actually depends on are now a declared list instead of
 * an implicit reach into a 12,000-line closure.
 *
 * One entry is shaped the way it is for a reason:
 * - `setSelectedPlayer` is the only assignment that crosses as a setter, for
 *   the same reason: the six places that reassign the page's `selectedPlayer`
 *   cannot do it through a plain reference.
 *
 * Render identity is proven by `scripts/cdm-parity-check.mjs`, which walks all
 * 25 eligible players, steps into every safe flow, and fingerprints the
 * stepper, the sections, the metrics and the submit button — 4,409 values,
 * and any diff in what these functions paint is a diff in that output.
 *
 * NOTE ON THE DUPLICATION: the stepper block ("Step 2 of 2" — six
 * getElementById calls and the same eight class toggles) is repeated almost
 * verbatim in five of these seven, and `goToCutStep2`'s copy deliberately
 * differs: it never hides dot 3 or line 2. That is preserved exactly as it
 * was. Unifying it is a real cleanup, but it is a BEHAVIOR question, not a
 * move, so it does not belong in the same commit as the move.
 */

import { createActionOption, createYearButton, formatDraftLine, cdmAge } from './cdm-ui';
import { submitDeclaration } from './contract-actions-client';
import { applyPlayerModalBand } from './player-modal-band';
import { NFL_TEAM_CITIES, normalizeTeamCode } from './nfl';
import { isWatched, getWatchListAuth } from './watch-list-client';
import {
  getCdmActionDescriptors,
  type CdmActionContext,
  type CdmActionDescriptor,
  type CdmActionId,
} from './cdm-action-descriptors';

/** Everything the step functions reach for that lives outside this module. */
export interface CdmWizardContext {
  /** The wizard's mutable state object, owned by the page. */
  cdmState: Record<string, any>;
  cdmSubmitBtn: HTMLButtonElement;
  cdmBackBtn: HTMLElement | null;
  /** The page's parsed `roster-config` payload. */
  config: Record<string, any>;
  DECLARATION_TYPE_LABELS: Record<string, string>;
  formatSalaryCompact: (val: any) => string;
  formatCurrency: (val: any) => string;
  calculateAge: (birthdate: any) => number | null;
  calculateFranchiseTag: (salary: any, position: any, season: any) => { newSalary: number };
  calculateTeamOption: (salary: any, position: any, season: any) => { newSalary: number };
  getReferenceSalary: (position: any, type: string, season: any) => number;
  calculateCutPenalty: (
    salary: any,
    contractYears: any,
  ) => { currentPenalty: number; futurePenalty: number };
  applyContractAction: (actionType: string, extensionYears?: number) => void;
  /** The modal root; the region bails when it is absent. */
  cdmModal: HTMLElement | null;
  cdmError: HTMLElement;
  /** The formula disclosure's two nodes; the page owns their toggle binding. */
  formulaToggleEl: HTMLElement | null;
  formulaBodyEl: HTMLElement | null;
  cdmSuccess: HTMLElement;
  ESCALATION_RATE: number;
  /** Both destructured off `config` in the page, defaults already applied. */
  capLimit: number;
  salaryYears: number[];
  /** The team currently being viewed — a page `let`, so it crosses as a getter. */
  getCurrentTeam: () => string;
  /** The last rendered view's cap context — also a page `let`. */
  getLastViewContext: () => any;
  /** Still in the page: the trade sub-sheet and the IR/taxi mover. */
  showTradeSubOptions: () => void;
  goToRosterMoveStep: (target: string, direction: string) => void;
  toggleCdmWatch: (
    playerId: string,
    watched: boolean,
    signedOut: boolean,
    elig: unknown,
  ) => void;
  /**
   * The autocut seam. Phase 5 of the split plan is deferred until the cut
   * window reopens (June 2027) because it cannot be verified before then, so
   * the wizard reaches into it through injected callbacks rather than
   * dragging 1,300 unverifiable lines across with it.
   */
  isAutocutOwnView: () => boolean;
  getMarkedOnRoster: () => string[];
  computeAutocutSlate: () => { cuts: unknown[] };
  toggleAutocutMark: (playerId: string, isMarked: boolean) => void;
  /** Assigns the page's `selectedPlayer` — see the note above. */
  setSelectedPlayer: (player: any) => void;
  /** The two remaining modal chrome handles; both close the wizard. */
  cdmOverlay: HTMLElement | null;
  cdmCloseBtn: HTMLElement | null;
  /**
   * The page's two optimistic declaration stores. Mutated IN PLACE on a
   * successful submit, so they cross as the objects themselves — replacing
   * either with a copy would strand the page's own reads.
   */
  localDeclarations: Record<string, any>;
  declarationsByPlayer: Record<string, any>;
  /** The Contract Demo's flag — a page `let` that startDemo/exitDemo move. */
  isDemoActive: () => boolean;
  /** Re-render hooks the submit path calls after a write lands. */
  updateView: () => void;
  applyEligibilityStyling: () => void;
}

/**
 * A node from the modal's own markup (`ContractDeclarationModal.astro`).
 *
 * Every id reached for below is static markup that ships with the modal, so
 * the page's inline script indexed straight into `.style` / `.textContent`
 * without a guard. That is preserved exactly: `?.` here would turn a missing
 * node into a silently half-painted wizard screen, which is a far worse thing
 * to debug than the TypeError it throws today. This narrows the type and
 * leaves the failure mode alone. Where the original DID guard — the stepper
 * dots, the type badge, the review panel — the `if (…)` is still there.
 */
/**
 * The Escape-to-close handler, held at MODULE scope so each init can REPLACE
 * it. With the ClientRouter one module instance outlives a navigation, so a
 * handler that is only ever added accumulates one copy per page visit.
 */
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

function cdmNode(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

export function createCdmWizard(deps: CdmWizardContext) {
  const {
    cdmState,
    cdmSubmitBtn,
    cdmBackBtn,
    config,
    DECLARATION_TYPE_LABELS,
    formatSalaryCompact,
    formatCurrency,
    calculateAge,
    calculateFranchiseTag,
    calculateTeamOption,
    getReferenceSalary,
    calculateCutPenalty,
    applyContractAction,
    setSelectedPlayer,
    cdmModal,
    cdmError,
    formulaToggleEl,
    formulaBodyEl,
    cdmSuccess,
    ESCALATION_RATE,
    capLimit,
    salaryYears,
    getCurrentTeam,
    getLastViewContext,
    showTradeSubOptions,
    goToRosterMoveStep,
    toggleCdmWatch,
    isAutocutOwnView,
    getMarkedOnRoster,
    computeAutocutSlate,
    toggleAutocutMark,
    cdmOverlay,
    cdmCloseBtn,
    localDeclarations,
    declarationsByPlayer,
    isDemoActive,
    updateView,
    applyEligibilityStyling,
  } = deps;

  /**
   * The deadline countdown's timer handle. It was a page `let`; every read and
   * write of it is inside this region, so it came along and is module-local.
   */
  let cdmDeadlineInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Where focus goes when the modal closes: the control that opened it. The
   * player sheet routes a write action here after closing itself, so focus
   * was on nothing; that opener names the row's control via setCdmReturnFocus.
   */
  let cdmReturnFocus: HTMLElement | null = null;
  const setCdmReturnFocus = (el: HTMLElement | null) => { cdmReturnFocus = el; };

  const openDeclarationModal = (data: any, preSelectedYears: number | null = null) => {
    if (!cdmModal) return;
    const active = document.activeElement;
    cdmReturnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
    cdmState.playerData = data;
    cdmState.selectedYears = null;
    cdmState.selectedSalary = null;
    cdmState.submitType = null;
    cdmError.style.display = 'none';
    cdmSuccess.style.display = 'none';
    cdmSubmitBtn.disabled = true;
    cdmSubmitBtn.classList.remove('is-loading');
    cdmSubmitBtn.removeAttribute('aria-busy');
    cdmSubmitBtn.style.display = '';

    // Hero — the SAME composite band PlayerDetailsModal wears: franchise
    // gradient + crest watermark + transparent ESPN cutout. `data.headshot`
    // is the roster row's already-resolved avatar src, so a player whose
    // ESPN cutout 404'd earlier arrives here as an MFL JPG and the band
    // correctly stays gradient-only rather than re-fetching a known-bad URL.
    applyPlayerModalBand(document.getElementById('cdm-band'), {
      name: data.name,
      position: data.position,
      nflTeam: data.nflTeam,
      espnId: data.espnId,
      headshot: data.headshot,
      // Every player reachable from this modal is rostered, so the band
      // brands by the owning franchise; currentTeam is the fallback for the
      // openers that don't carry the id on their row.
      franchiseId: data.franchiseId || getCurrentTeam(),
    });
    cdmNode('cdm-player-name').textContent = data.name;
    (cdmNode('cdm-nfl-logo') as HTMLImageElement).src = data.nflLogo || '/assets/nfl-logos/NFL.svg';

    // Meta line: "{City} · {Position}". Falls back to bare team code when the
    // city lookup misses, and "Free Agent" when there's no team at all.
    const cdmNflTeamCode = data.nflTeam ? normalizeTeamCode(data.nflTeam) : '';
    const cdmTeamCity = cdmNflTeamCode
      ? (NFL_TEAM_CITIES[cdmNflTeamCode] || data.nflTeam || cdmNflTeamCode)
      : 'Free Agent';
    const cdmPosLabel = data.position || '';
    const cdmMetaParts = [cdmTeamCity, cdmPosLabel].filter(Boolean);
    cdmNode('cdm-meta-text').textContent = cdmMetaParts.join(' · ');

    // Age pill — only shown when we have a usable birthdate.
    const cdmAgeEl = document.getElementById('cdm-age-pill');
    if (cdmAgeEl) {
      const playerAgeYears = cdmAge(data.birthdate);
      if (playerAgeYears != null) {
        cdmAgeEl.textContent = `${playerAgeYears} yrs`;
        cdmAgeEl.hidden = false;
      } else {
        cdmAgeEl.textContent = '';
        cdmAgeEl.hidden = true;
      }
    }

    // Sub line: "{College} · {Draft}". DEFs / players without info collapse
    // the row entirely instead of showing an empty " · ".
    const cdmSubEl = document.getElementById('cdm-sub-text');
    if (cdmSubEl) {
      const cdmIsDef = (data.position || '').toUpperCase() === 'DEF';
      const cdmSubParts = [];
      if (data.college) cdmSubParts.push(data.college);
      if (!cdmIsDef) {
        const cdmDraftStr = formatDraftLine(data.draftYear, data.draftRound, data.draftPick, data.draftTeam);
        if (cdmDraftStr !== 'Undrafted' || !data.college) cdmSubParts.push(cdmDraftStr);
      }
      if (cdmSubParts.length > 0) {
        cdmSubEl.textContent = cdmSubParts.join(' · ');
        cdmSubEl.hidden = false;
      } else {
        cdmSubEl.textContent = '';
        cdmSubEl.hidden = true;
      }
    }

    // Type badge
    const elig = data.eligibility;
    const type = elig.type;
    const typeBadge = cdmNode('cdm-type-badge');
    typeBadge.dataset.type = type;
    cdmNode('cdm-type-label').textContent = DECLARATION_TYPE_LABELS[type] || type;

    // Contract metrics
    cdmNode('cdm-current-salary').textContent = formatSalaryCompact(elig.currentSalary);
    cdmNode('cdm-current-years').textContent = String(elig.currentYears);
    const designation = elig.contractInfo || (elig.isRookieContract ? 'RC' : 'Standard');
    cdmNode('cdm-current-designation').textContent = designation;

    // Deadline countdown
    const deadlineEl = cdmNode('cdm-deadline');
    if (cdmDeadlineInterval) clearInterval(cdmDeadlineInterval);
    if (elig.deadlineTimestamp) {
      deadlineEl.style.display = 'flex';
      const updateDeadline = () => {
        const remaining = elig.deadlineTimestamp * 1000 - Date.now();
        if (remaining <= 0) {
          cdmNode('cdm-deadline-text').textContent = 'Deadline passed';
          deadlineEl.className = 'cdm-deadline cdm-deadline--critical';
          const submitBtn = document.getElementById('cdm-submit') as HTMLButtonElement | null;
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Deadline Passed';
          }
          // `?? undefined` only to satisfy the signature — the page passed the
          // bare `let`, and clearInterval(null) and clearInterval(undefined) are
          // both no-ops, so this is the same call.
          clearInterval(cdmDeadlineInterval ?? undefined);
          return;
        }
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        let deadlineText;
        if (days > 0) {
          deadlineText = 'Deadline in ' + days + 'd ' + remainingHours + 'h';
        } else {
          deadlineText = 'Deadline in ' + hours + 'h ' + minutes + 'm';
        }
        cdmNode('cdm-deadline-text').textContent = deadlineText;
        deadlineEl.className = 'cdm-deadline' + (hours < 4 ? ' cdm-deadline--critical' : hours < 12 ? ' cdm-deadline--urgent' : '');
      };
      updateDeadline();
      cdmDeadlineInterval = setInterval(updateDeadline, 60000);
    } else {
      deadlineEl.style.display = 'none';
    }

    // Reset stepper to step 1
    const cdmStepper = document.getElementById('cdm-stepper');
    const cdmStepDot1 = document.getElementById('cdm-step-dot-1');
    const cdmStepDot2 = document.getElementById('cdm-step-dot-2');
    const cdmStepDot3 = document.getElementById('cdm-step-dot-3');
    const cdmStepLine1 = document.getElementById('cdm-step-line-1');
    const cdmStepLine2 = document.getElementById('cdm-step-line-2');
    const cdmStepperLabel = document.getElementById('cdm-stepper-label');
    if (cdmStepper) {
      cdmStepper.style.display = 'none';
      cdmStepDot1?.classList.remove('completed');
      cdmStepDot1?.classList.add('active');
      cdmStepDot2?.classList.remove('active', 'completed');
      cdmStepDot3?.classList.remove('active', 'completed');
      if (cdmStepDot3) cdmStepDot3.style.display = 'none';
      cdmStepLine1?.classList.remove('completed');
      if (cdmStepLine2) { cdmStepLine2.classList.remove('completed'); cdmStepLine2.style.display = 'none'; }
      if (cdmStepperLabel) cdmStepperLabel.textContent = 'Step 1 of ?';
    }

    // Reset review panel animation class
    const reviewPanel = document.getElementById('cdm-review-panel');
    if (reviewPanel) reviewPanel.classList.remove('panel-enter');

    // Reset ALL type-specific panels so no state leaks between modal opens for different players
    const yearSection = cdmNode('cdm-year-section');
    const tagSection = cdmNode('cdm-tag-section');
    const extSection = cdmNode('cdm-extension-section');
    const projSection = cdmNode('cdm-projection-section');
    const actionSectionReset = document.getElementById('cdm-action-section');
    const cutSectionReset = document.getElementById('cdm-cut-section');
    const metricsReset = document.getElementById('cdm-metrics');
    yearSection.style.display = 'none';
    tagSection.style.display = 'none';
    extSection.style.display = 'none';
    projSection.style.display = 'none';
    if (actionSectionReset) actionSectionReset.style.display = 'none';
    if (cutSectionReset) cutSectionReset.style.display = 'none';
    // Metrics are visible on step 1 of every flow (a later step may hide them)
    if (metricsReset) metricsReset.style.display = '';

    // Always reset formula section — only shown on vet-ext step 3
    const formulaSectionReset = document.getElementById('cdm-formula-section');
    if (formulaSectionReset) formulaSectionReset.style.display = 'none';
    if (formulaToggleEl) formulaToggleEl.setAttribute('aria-expanded', 'false');
    if (formulaBodyEl) formulaBodyEl.classList.remove('expanded');

    // Back button: hidden initially
    if (cdmBackBtn) cdmBackBtn.style.display = 'none';

    if (type === 'action-select') {
      // Step 1: Action selection (salary-tool flow via ufa-action-btn)
      cdmState.flowType = 'action-select';
      cdmState.currentStep = 1;
      cdmState.viaActionSelect = true;
      if (cdmModal) cdmModal.dataset.cdmMode = 'action-select';

      // Show stepper at step 1 of ? — hide dot-2/line-1 until action is chosen
      if (cdmStepper) cdmStepper.style.display = 'flex';
      if (cdmStepDot2) cdmStepDot2.style.display = 'none';
      if (cdmStepLine1) cdmStepLine1.style.display = 'none';

      // Hide type badge — no action chosen yet
      const typeBadgeEl = document.getElementById('cdm-type-badge');
      if (typeBadgeEl) typeBadgeEl.style.display = 'none';

      // Key metrics stay VISIBLE on step 1. They used to be hidden here,
      // which left the action sheet with nothing between the header and the
      // buttons — you were asked to pick "Cut Player" or "Veteran Extension"
      // without the salary, years and designation those choices turn on.

      // Show action section, hide submit (action buttons are the "submit")
      const actionSection = document.getElementById('cdm-action-section');
      if (actionSection) actionSection.style.display = '';
      cdmSubmitBtn.style.display = 'none';

      // Populate action options
      populateCdmActionOptions(elig);

    } else if (type === 'franchise-tag') {
      // Franchise tag (direct from yrs-chip): fixed 1 year, show salary comparison
      cdmState.flowType = 'franchise-tag';
      cdmState.currentStep = 1;
      cdmState.viaActionSelect = false;
      tagSection.style.display = '';
      cdmNode('cdm-tag-current').textContent = formatSalaryCompact(elig.currentSalary);
      cdmNode('cdm-tag-new').textContent = formatSalaryCompact(elig.tagSalary);
      const basisText = elig.tagBasis === 'top 3 average'
        ? 'Based on the top 3 salaries at position'
        : 'Based on 120% of current salary';
      cdmNode('cdm-tag-basis-text').textContent = basisText;
      cdmState.selectedYears = 1;
      cdmState.selectedSalary = elig.tagSalary ?? null;
      cdmSubmitBtn.disabled = false;
      cdmSubmitBtn.textContent = 'Apply Franchise Tag';

    } else if (type === 'veteran-extension') {
      // Veteran extension (direct from yrs-chip or contract-modal): step 1 = year selection, step 2 = review
      cdmState.flowType = 'veteran-extension';
      cdmState.currentStep = 1;
      cdmState.viaActionSelect = false;
      if (cdmModal) cdmModal.dataset.cdmMode = 'direct-vet-ext';

      yearSection.style.display = '';
      cdmSubmitBtn.textContent = 'Add Extension';

      // Show stepper at step 1 of 2
      if (cdmStepper) {
        cdmStepper.style.display = 'flex';
        if (cdmStepperLabel) cdmStepperLabel.textContent = 'Step 1 of 2';
      }

      if (formulaSectionReset) formulaSectionReset.style.display = 'none';
      if (formulaToggleEl) formulaToggleEl.setAttribute('aria-expanded', 'false');
      if (formulaBodyEl) formulaBodyEl.classList.remove('expanded');

      buildVetExtYearButtons(elig, data);

    } else if (type === 'rookie-extension') {
      // Rookie extension: fixed calculation
      extSection.style.display = '';
      const extYears = elig.extensionYears ?? (elig.currentYears + 2);
      const extSalary = elig.extensionSalary ?? elig.currentSalary;
      cdmNode('cdm-ext-current').textContent = formatSalaryCompact(elig.currentSalary);
      cdmNode('cdm-ext-new').textContent = formatSalaryCompact(extSalary);
      updateProjectionTable(extSalary, extYears, null, config.salaryYears?.[0]);
      updateCapImpact(extSalary, extYears, config.salaryYears?.[0]);
      cdmState.selectedYears = extYears;
      cdmState.selectedSalary = extSalary;
      cdmSubmitBtn.disabled = false;
      cdmSubmitBtn.textContent = 'Extend Contract';

    } else if (type === 'team-option') {
      // Team option (direct from yrs-chip): go straight to step 2 review
      cdmState.flowType = 'team-option';
      cdmState.currentStep = 1;
      cdmState.viaActionSelect = false;
      goToTeamOptionStep2();

    } else {
      // new-acquisition / rookie-override: year selector
      yearSection.style.display = '';
      cdmSubmitBtn.textContent = preSelectedYears ? 'Update Declaration' : 'Declare Contract';

      const yearOptions = elig.yearOptions || [];
      const yearContainer = cdmNode('cdm-year-options');
      yearContainer.replaceChildren();
      yearOptions.forEach((yr: number) => {
        const btn = createYearButton(yr);
        btn.addEventListener('click', () => {
          yearContainer.querySelectorAll('.cdm-year-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          cdmState.selectedYears = yr;
          cdmSubmitBtn.disabled = false;
          updateProjectionTable(elig.currentSalary, yr, null, config.salaryYears?.[0]);
          updateCapImpact(elig.currentSalary, yr, config.salaryYears?.[0]);
        });
        yearContainer.appendChild(btn);
      });

      // Pre-select years if editing a pending declaration
      if (preSelectedYears) {
        const matchBtn = yearContainer.querySelector('[data-years="' + preSelectedYears + '"]');
        if (matchBtn) {
          matchBtn.classList.add('selected');
          cdmState.selectedYears = preSelectedYears;
          cdmSubmitBtn.disabled = false;
          updateProjectionTable(elig.currentSalary, preSelectedYears, null, config.salaryYears?.[0]);
          updateCapImpact(elig.currentSalary, preSelectedYears, config.salaryYears?.[0]);
        }
      }
    }

    cdmModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  };

  // Reset veteran-extension back to step 1 — legacy path (direct vet-ext, not via action-select)
  const goToVetExtStep1 = () => {
    cdmState.currentStep = 1;
    const cdmStepDot1 = document.getElementById('cdm-step-dot-1');
    const cdmStepDot2 = document.getElementById('cdm-step-dot-2');
    const cdmStepLine1 = document.getElementById('cdm-step-line-1');
    const cdmStepperLabel = document.getElementById('cdm-stepper-label');

    // Reset stepper to step 1 of 2
    if (cdmStepDot1) { cdmStepDot1.classList.remove('completed'); cdmStepDot1.classList.add('active'); }
    if (cdmStepDot2) { cdmStepDot2.classList.remove('active', 'completed'); }
    if (cdmStepLine1) { cdmStepLine1.classList.remove('completed'); }
    if (cdmStepperLabel) cdmStepperLabel.textContent = 'Step 1 of 2';

    // Re-show year selection + key metrics, hide review panel sections
    const yearSection = document.getElementById('cdm-year-section');
    if (yearSection) yearSection.style.display = '';
    const cdmMetricsEl = document.getElementById('cdm-metrics');
    if (cdmMetricsEl) cdmMetricsEl.style.display = '';
    cdmNode('cdm-extension-section').style.display = 'none';
    cdmNode('cdm-formula-section').style.display = 'none';
    cdmNode('cdm-projection-section').style.display = 'none';
    cdmNode('cdm-cap-impact-section').style.display = 'none';

    // Clear year selection and disable submit
    document.querySelectorAll('.cdm-year-btn').forEach(b => b.classList.remove('selected'));
    cdmState.selectedYears = null;
    cdmState.selectedSalary = null;
    cdmSubmitBtn.disabled = true;

    // Hide back button — step 1 doesn't have a Back action
    if (cdmBackBtn) cdmBackBtn.style.display = 'none';
  };

  const closeDeclarationModal = () => {
    if (!cdmModal) return;
    cdmModal.classList.remove('active');
    document.body.style.overflow = '';
    if (cdmDeadlineInterval) clearInterval(cdmDeadlineInterval);
    cdmState.playerData = null;
    const target = cdmReturnFocus;
    cdmReturnFocus = null;
    // A re-rendered table or a control hidden at this width has no box to focus.
    if (target?.isConnected && target.getClientRects().length > 0) target.focus();
  };

  const updateProjectionTable = (
    baseSalary: any,
    years: any,
    currentAge: number | null = null,
    startYear: number | null = null,
  ) => {
    const section = document.getElementById('cdm-projection-section');
    const tbody = document.getElementById('cdm-projection-body');
    const table = section?.querySelector('.cdm-projection-table');
    if (!section || !tbody) return;

    // Show/hide age column
    if (table) {
      table.classList.toggle('no-age', currentAge === null);
    }

    const salary = Number(baseSalary) || 0;
    tbody.replaceChildren();
    for (let i = 0; i < years; i++) {
      const projected = Math.round(salary * Math.pow(ESCALATION_RATE, i));
      const tr = document.createElement('tr');
      const tdYear = document.createElement('td');
      tdYear.textContent = startYear ? String(startYear + i) : 'Year ' + (i + 1);
      const tdAge = document.createElement('td');
      tdAge.textContent = currentAge !== null ? String(currentAge + i) : '';
      const tdSalary = document.createElement('td');
      tdSalary.textContent = formatSalaryCompact(projected);
      tr.appendChild(tdYear);
      tr.appendChild(tdAge);
      tr.appendChild(tdSalary);
      tbody.appendChild(tr);
    }
    section.style.display = '';
  };

  /**
   * Show team cap impact for each year of the proposed contract.
   * Uses lastViewContext (current team's cap charges) to show
   * committed salary and available cap space per season.
   */
  const updateCapImpact = (
    playerBaseSalary: any,
    years: any,
    startYear: number | null = null,
  ) => {
    const section = document.getElementById('cdm-cap-impact-section');
    const tbody = document.getElementById('cdm-cap-impact-body');
    if (!section || !tbody) return;

    const ctx = getLastViewContext();
    if (!ctx || !ctx.capChargesWithDead) {
      section.style.display = 'none';
      return;
    }

    const teamCapCharges = ctx.capChargesWithDead;
    const capLimitForSeason = ctx.capLimitForSeason ?? capLimit ?? 45_000_000;
    const salary = Number(playerBaseSalary) || 0;
    const yr0 = startYear ?? (salaryYears[0] || 2026);

    tbody.replaceChildren();
    for (let i = 0; i < years; i++) {
      const playerSalaryThisYear = Math.round(salary * Math.pow(ESCALATION_RATE, i));
      const existingCharge = teamCapCharges[i] ?? 0;
      const newCommitted = existingCharge + playerSalaryThisYear;
      const available = capLimitForSeason - newCommitted;

      const tr = document.createElement('tr');

      const tdYear = document.createElement('td');
      tdYear.textContent = String(yr0 + i);

      const tdContract = document.createElement('td');
      tdContract.textContent = formatSalaryCompact(playerSalaryThisYear);

      const tdCommitted = document.createElement('td');
      tdCommitted.textContent = formatSalaryCompact(newCommitted);

      const tdAvailable = document.createElement('td');
      tdAvailable.textContent = formatSalaryCompact(Math.abs(available));
      if (available < 0) {
        tdAvailable.classList.add('cap-over');
        tdAvailable.textContent = '-' + tdAvailable.textContent;
      }

      tr.appendChild(tdYear);
      tr.appendChild(tdContract);
      tr.appendChild(tdCommitted);
      tr.appendChild(tdAvailable);
      tbody.appendChild(tr);
    }
    section.style.display = '';
  };

  // ----------------------------------------------------------------
  // buildVetExtYearButtons — creates year option buttons for vet-ext
  // Works for both direct (step 1→2 of 2) and action-select (step 2→3 of 3)
  // cdmState.currentStep must be set before calling
  // ----------------------------------------------------------------
  const buildVetExtYearButtons = (elig: any, data: any) => {
    const yearContainer = document.getElementById('cdm-year-options');
    if (!yearContainer) return;
    yearContainer.replaceChildren();

    const yearOptions = elig.yearOptions || [1, 2];
    yearOptions.forEach((yr: number) => {
      // Shape from src/utils/cdm-ui.ts; the handler stays here with the
      // wizard state it mutates (Phase 6.1's seam).
      const btn = createYearButton(yr);

      btn.addEventListener('click', () => {
        yearContainer.querySelectorAll('.cdm-year-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        cdmState.selectedYears = yr;

        const extSection = document.getElementById('cdm-extension-section');
        const yearSection = document.getElementById('cdm-year-section');
        const reviewPanel = document.getElementById('cdm-review-panel');
        const formulaSection = document.getElementById('cdm-formula-section');
        const fToggle = document.getElementById('cdm-formula-toggle');
        const fBody = document.getElementById('cdm-formula-body');

        const isFirstReveal = !extSection?.style.display || extSection?.style.display === 'none';
        if (isFirstReveal && reviewPanel) {
          reviewPanel.classList.remove('panel-enter');
          void reviewPanel.offsetWidth;
          reviewPanel.classList.add('panel-enter');
          if (yearSection) yearSection.style.display = 'none';
          const metricsEl = document.getElementById('cdm-metrics');
          if (metricsEl) metricsEl.style.display = 'none';
        }

        const dot1 = document.getElementById('cdm-step-dot-1');
        const dot2 = document.getElementById('cdm-step-dot-2');
        const dot3 = document.getElementById('cdm-step-dot-3');
        const line1 = document.getElementById('cdm-step-line-1');
        const line2 = document.getElementById('cdm-step-line-2');
        const stepLabel = document.getElementById('cdm-stepper-label');

        if (cdmState.currentStep === 2) {
          if (dot2) { dot2.classList.remove('active'); dot2.classList.add('completed'); dot2.removeAttribute('disabled'); }
          if (dot3) { dot3.classList.remove('completed'); dot3.classList.add('active'); }
          if (line2) line2.classList.add('completed');
          if (stepLabel) stepLabel.textContent = 'Step 3 of 3';
          cdmState.currentStep = 3;
        } else {
          if (dot1) { dot1.classList.remove('active'); dot1.classList.add('completed'); }
          if (dot2) { dot2.classList.remove('completed'); dot2.classList.add('active'); }
          if (line1) line1.classList.add('completed');
          if (stepLabel) stepLabel.textContent = 'Step 2 of 2';
          cdmState.currentStep = 2;
        }
        if (cdmBackBtn) cdmBackBtn.style.display = '';

        const existingYears = Number(elig.currentYears) || 0;
        const baseSalary = Number(elig.currentSalary) || 0;
        const avgSalary = getReferenceSalary(data.position, 'extension', config.extensionSeason);
        const denominator = existingYears + yr;
        const proratedPortion = denominator > 0 ? (avgSalary * yr) / denominator : 0;
        const newSalary = Math.round(proratedPortion + baseSalary);
        cdmState.selectedSalary = newSalary;

        if (extSection) extSection.style.display = '';
        cdmNode('cdm-ext-current').textContent = formatSalaryCompact(baseSalary);
        cdmNode('cdm-ext-new').textContent = formatSalaryCompact(newSalary);
        const yrsCurrentEl = document.getElementById('cdm-ext-years-current');
        const yrsNewEl = document.getElementById('cdm-ext-years-new');
        if (yrsCurrentEl) yrsCurrentEl.textContent = existingYears + (existingYears === 1 ? ' yr' : ' yrs');
        if (yrsNewEl) yrsNewEl.textContent = denominator + (denominator === 1 ? ' yr' : ' yrs');

        const playerAge = data.birthdate ? calculateAge(data.birthdate) : null;
        updateProjectionTable(newSalary, existingYears + yr, playerAge, config.salaryYears?.[0]);
        updateCapImpact(newSalary, existingYears + yr, config.salaryYears?.[0]);

        if (formulaSection) {
          formulaSection.style.display = '';
          if (fToggle) fToggle.setAttribute('aria-expanded', 'false');
          if (fBody) fBody.classList.remove('expanded');
          const eqEl = document.getElementById('cdm-formula-equation');
          const stepsEl = document.getElementById('cdm-formula-steps');
          const resultEl = document.getElementById('cdm-formula-result');
          if (eqEl) {
            eqEl.replaceChildren();
            eqEl.appendChild(document.createTextNode('(Top 5 Avg \u00D7 Ext Yrs / (Existing + Ext)) + Salary'));
            eqEl.appendChild(document.createElement('br'));
            eqEl.appendChild(document.createTextNode(
              '(' + formatSalaryCompact(avgSalary) + ' \u00D7 ' + yr +
              ' / (' + existingYears + ' + ' + yr + ')) + ' + formatSalaryCompact(baseSalary)
            ));
          }
          const makeStep = (l: string, v: string) => {
            const s = document.createElement('div'); s.className = 'cdm-formula__step';
            const sl = document.createElement('span'); sl.className = 'cdm-formula__step-label'; sl.textContent = l;
            const sv = document.createElement('span'); sv.className = 'cdm-formula__step-value'; sv.textContent = v;
            s.appendChild(sl); s.appendChild(sv); return s;
          };
          if (stepsEl) {
            stepsEl.replaceChildren();
            stepsEl.appendChild(makeStep('Top 5 Avg', formatCurrency(avgSalary)));
            stepsEl.appendChild(makeStep('Ext Years', String(yr)));
            stepsEl.appendChild(makeStep('Total Years', existingYears + ' + ' + yr + ' = ' + denominator));
            stepsEl.appendChild(makeStep('Prorated', formatCurrency(Math.round(proratedPortion))));
            stepsEl.appendChild(makeStep('Existing Salary', formatCurrency(baseSalary)));
          }
          if (resultEl) {
            resultEl.replaceChildren();
            const lbl = document.createElement('span'); lbl.className = 'cdm-formula__result-label'; lbl.textContent = 'New Base Salary';
            const val = document.createElement('span'); val.className = 'cdm-formula__result-value'; val.textContent = formatCurrency(newSalary);
            resultEl.appendChild(lbl); resultEl.appendChild(val);
          }
        }

        cdmSubmitBtn.disabled = false;
      });

      yearContainer.appendChild(btn);
    });
  };

  // Helper: build a CDM action option button using safe DOM methods
  // Positional shim over src/utils/cdm-ui.ts's named-options builder —
  // ~20 call sites below still pass these six in order.
  const makeCdmActionBtn = (
    id: string,
    label: string,
    desc: string,
    onClick?: (event: MouseEvent) => void,
    disabled?: boolean,
    iconId?: string,
  ) =>
    createActionOption({ id, label, desc, onClick, disabled, iconId });

  // ----------------------------------------------------------------
  // describeCdmActions — which step-1 actions this player has, as data.
  //
  // The decision table lives in getCdmActionDescriptors
  // (src/utils/cdm-action-descriptors.ts); this supplies the page facts it
  // needs. The roster's player sheet calls it too, so the ⋮ menu and the
  // sheet list the same actions from one implementation.
  //
  // `autocutPlayerId` defaults to the player the modal holds, which is what
  // the auto-cut option always keyed on; the sheet passes its own player.
  // ----------------------------------------------------------------
  const describeCdmActions = (elig: any, autocutPlayerId?: string): CdmActionDescriptor[] => {
    const autocutPid = autocutPlayerId
      ?? String(cdmState.playerData?._rawPlayer?.id || cdmState.playerData?.id || '');
    // Watch — per-VIEWER, not per-roster; a signed-out visitor is handed to
    // sign-in (same trigger as PlayerDetailsModal).
    const watchSignedOut = !config.authUser?.franchiseId || getWatchListAuth() === 'signed-out';
    const context: CdmActionContext = {
      isOwnTeam: !!config.authUser?.franchiseId && config.authUser.franchiseId === getCurrentTeam(),
      // isOwnTeam above trusts config.authUser, which demo mode spoofs — so
      // the auto-cut option is gated on isAutocutOwnView() (real fid + not
      // demo), never isAutocutEnabled(), and never for a DEMO_ id.
      autocut: () => {
        if (!(isAutocutOwnView() && autocutPid && !autocutPid.startsWith('DEMO_'))) return null;
        const priority = getMarkedOnRoster().indexOf(autocutPid) + 1;
        return {
          priority,
          // Badge-honesty mirror: a mark below the current cut line won't
          // execute at today's roster count — don't imply it will.
          belowLine: priority > 0 && priority > computeAutocutSlate().cuts.length,
          targetActiveCount: config.targetActiveCount ?? 22,
        };
      },
      watch: {
        signedOut: watchSignedOut,
        watched: !watchSignedOut && isWatched(String(elig.playerId || '')),
      },
    };
    return getCdmActionDescriptors(elig, context);
  };

  // ----------------------------------------------------------------
  // renderCdmActionOptions — descriptors → step-1 option buttons.
  // `handlers` maps a descriptor id to its click; the buttons themselves are
  // the same `cdm-action-option--<id>` nodes they have always been.
  // ----------------------------------------------------------------
  const renderCdmActionOptions = (
    container: HTMLElement,
    descriptors: CdmActionDescriptor[],
    handlers: Partial<Record<CdmActionId, () => void>>,
  ) => {
    for (const d of descriptors) {
      container.appendChild(makeCdmActionBtn(d.id, d.label, d.desc, handlers[d.id], d.disabled ?? false, d.icon));
    }
  };

  // ----------------------------------------------------------------
  // populateCdmActionOptions — fills step-1 action buttons in CDM
  // ----------------------------------------------------------------
  const populateCdmActionOptions = (elig: any) => {
    const actionOptions = document.getElementById('cdm-action-options');
    if (!actionOptions) return;
    actionOptions.replaceChildren();

    const descriptors = describeCdmActions(elig);
    const autocutPid = String(cdmState.playerData?._rawPlayer?.id || cdmState.playerData?.id || '');
    const isOn = (id: CdmActionId) => descriptors.some((d) => d.id === id && d.state === 'on');
    const watchId = String(elig.playerId || '');
    const watchSignedOut = !config.authUser?.franchiseId || getWatchListAuth() === 'signed-out';

    renderCdmActionOptions(actionOptions, descriptors, {
      'declare-contract': () => goToDeclareContractStep(),
      franchise: () => goToFranchiseTagStep2(),
      'team-option': () => goToTeamOptionStep2(),
      extension: () => goToVetExtYearStep(),
      'rookie-extension': () => goToRookieExtReview(),
      'move-to-ir': () => goToRosterMoveStep('ir', 'to'),
      'move-to-practice': () => goToRosterMoveStep('practice', 'to'),
      'activate-from-ir': () => goToRosterMoveStep('ir', 'from'),
      'promote-from-practice': () => goToRosterMoveStep('practice', 'from'),
      // One click is an IMMEDIATE save of the full list (append-to-end
      // priority) through the same step-up-auth path as the panel's Save.
      'autocut-toggle': () => toggleAutocutMark(autocutPid, isOn('autocut-toggle')),
      watch: () => toggleCdmWatch(watchId, isOn('watch'), watchSignedOut, elig),
      cut: () => goToCutStep2(),
      trade: () => showTradeSubOptions(),
    });
  };

  // ----------------------------------------------------------------
  // goToActionSelectStep — returns to step 1 action selection
  // ----------------------------------------------------------------
  const goToActionSelectStep = () => {
    cdmState.currentStep = 1;
    cdmState.flowType = 'action-select';
    cdmState.viaActionSelect = true;
    cdmState.cutConfirmed = false;
    const cdmEl = document.getElementById('contract-declaration-modal');
    if (cdmEl) cdmEl.dataset.cdmMode = 'action-select';

    const dot1 = document.getElementById('cdm-step-dot-1');
    const dot2 = document.getElementById('cdm-step-dot-2');
    const dot3 = document.getElementById('cdm-step-dot-3');
    const line1 = document.getElementById('cdm-step-line-1');
    const line2 = document.getElementById('cdm-step-line-2');
    const stepLabel = document.getElementById('cdm-stepper-label');

    if (dot1) { dot1.classList.remove('completed'); dot1.classList.add('active'); }
    if (dot2) { dot2.classList.remove('active', 'completed'); dot2.style.display = 'none'; }
    if (dot3) { dot3.classList.remove('active', 'completed'); dot3.style.display = 'none'; }
    if (line1) { line1.classList.remove('completed'); line1.style.display = 'none'; }
    if (line2) { line2.classList.remove('completed'); line2.style.display = 'none'; }
    if (stepLabel) stepLabel.textContent = 'Step 1 of ?';

    const typeBadge = document.getElementById('cdm-type-badge');
    if (typeBadge) typeBadge.style.display = 'none';

    const actionSection = document.getElementById('cdm-action-section');
    if (actionSection) actionSection.style.display = '';
    cdmNode('cdm-year-section').style.display = 'none';
    cdmNode('cdm-tag-section').style.display = 'none';
    cdmNode('cdm-cut-section').style.display = 'none';
    cdmNode('cdm-extension-section').style.display = 'none';
    cdmNode('cdm-formula-section').style.display = 'none';
    cdmNode('cdm-projection-section').style.display = 'none';
    cdmNode('cdm-cap-impact-section').style.display = 'none';

    // Back to the action sheet — metrics come back with it (same reason
    // they are shown on the first paint of this step).
    const metricsEl = document.getElementById('cdm-metrics');
    if (metricsEl) metricsEl.style.display = '';

    if (cdmBackBtn) cdmBackBtn.style.display = 'none';
    cdmState.selectedYears = null;
    cdmState.selectedSalary = null;
    cdmSubmitBtn.disabled = true;
    cdmSubmitBtn.style.display = 'none';

    if (cdmState.playerData) populateCdmActionOptions(cdmState.playerData.eligibility);
  };

  // ----------------------------------------------------------------
  // goToDeclareContractStep — year selection for new-acquisition /
  // rookie-override players entered via the action sheet. This is a
  // real declaration (submits to the API), so cdmState.viaActionSelect is
  // cleared after entry. Mirrors the yrs-chip flow.
  // ----------------------------------------------------------------
  const goToDeclareContractStep = () => {
    const elig = cdmState.playerData?.eligibility;
    if (!elig?.declareType) return;
    const declareType = elig.declareType;

    // Switch out of sandbox/action-select mode so submit hits the API
    cdmState.viaActionSelect = false;
    cdmState.currentStep = 2;
    cdmState.flowType = declareType;
    const cdmEl = document.getElementById('contract-declaration-modal');
    if (cdmEl) cdmEl.dataset.cdmMode = 'declare-contract';

    const typeBadge = document.getElementById('cdm-type-badge');
    if (typeBadge) {
      typeBadge.style.display = '';
      typeBadge.dataset.type = declareType;
      cdmNode('cdm-type-label').textContent = DECLARATION_TYPE_LABELS[declareType] || 'Declare Contract';
    }

    const dot1 = document.getElementById('cdm-step-dot-1');
    const dot2 = document.getElementById('cdm-step-dot-2');
    const dot3 = document.getElementById('cdm-step-dot-3');
    const line1 = document.getElementById('cdm-step-line-1');
    const line2 = document.getElementById('cdm-step-line-2');
    const stepLabel = document.getElementById('cdm-stepper-label');

    if (dot2) dot2.style.display = '';
    if (line1) line1.style.display = '';
    if (dot1) { dot1.classList.remove('active'); dot1.classList.add('completed'); }
    if (dot2) { dot2.classList.remove('completed'); dot2.classList.add('active'); }
    if (dot3) dot3.style.display = 'none';
    if (line1) line1.classList.add('completed');
    if (line2) line2.style.display = 'none';
    if (stepLabel) stepLabel.textContent = 'Step 2 of 2';

    if (cdmBackBtn) cdmBackBtn.style.display = '';

    const metricsEl = document.getElementById('cdm-metrics');
    if (metricsEl) metricsEl.style.display = '';

    const actionSection = document.getElementById('cdm-action-section');
    if (actionSection) actionSection.style.display = 'none';
    cdmNode('cdm-extension-section').style.display = 'none';
    cdmNode('cdm-formula-section').style.display = 'none';
    cdmNode('cdm-tag-section').style.display = 'none';

    const yearSection = document.getElementById('cdm-year-section');
    if (yearSection) yearSection.style.display = '';

    const yearOptions = (Array.isArray(elig.declareYearOptions) && elig.declareYearOptions.length)
      ? elig.declareYearOptions
      : (declareType === 'rookie-override' ? [1, 2, 3, 4] : [1, 2, 3, 4, 5]);
    const yearContainer = cdmNode('cdm-year-options');
    yearContainer.replaceChildren();
    yearOptions.forEach((yr: number) => {
      const btn = createYearButton(yr);
      btn.addEventListener('click', () => {
        yearContainer.querySelectorAll('.cdm-year-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        cdmState.selectedYears = yr;
        cdmState.selectedSalary = elig.currentSalary;
        cdmSubmitBtn.disabled = false;
        updateProjectionTable(elig.currentSalary, yr, null, config.salaryYears?.[0]);
        updateCapImpact(elig.currentSalary, yr, config.salaryYears?.[0]);
      });
      yearContainer.appendChild(btn);
    });

    // Make sure the underlying eligibility surface used by the API submit path
    // carries the real type/timestamps from the eligibility engine.
    cdmState.playerData.eligibility.type = declareType;
    cdmState.playerData.eligibility.yearOptions = yearOptions;

    cdmState.selectedYears = null;
    cdmState.selectedSalary = null;
    cdmSubmitBtn.disabled = true;
    cdmSubmitBtn.style.display = '';
    cdmSubmitBtn.textContent = 'Declare Contract';
  };

  // ----------------------------------------------------------------
  // goToFranchiseTagStep2 — franchise tag review (step 2 of 2)
  // ----------------------------------------------------------------
  const goToFranchiseTagStep2 = () => {
    cdmState.currentStep = 2;
    cdmState.flowType = 'franchise-tag';

    const typeBadge = document.getElementById('cdm-type-badge');
    if (typeBadge) {
      typeBadge.style.display = '';
      typeBadge.dataset.type = 'franchise-tag';
      cdmNode('cdm-type-label').textContent = DECLARATION_TYPE_LABELS['franchise-tag'] || 'Franchise Tag';
    }

    const dot1 = document.getElementById('cdm-step-dot-1');
    const dot2 = document.getElementById('cdm-step-dot-2');
    const dot3 = document.getElementById('cdm-step-dot-3');
    const line1 = document.getElementById('cdm-step-line-1');
    const line2 = document.getElementById('cdm-step-line-2');
    const stepLabel = document.getElementById('cdm-stepper-label');

    if (dot2) dot2.style.display = '';
    if (line1) line1.style.display = '';
    if (dot1) { dot1.classList.remove('active'); dot1.classList.add('completed'); }
    if (dot2) { dot2.classList.remove('completed'); dot2.classList.add('active'); }
    if (dot3) dot3.style.display = 'none';
    if (line1) line1.classList.add('completed');
    if (line2) line2.style.display = 'none';
    if (stepLabel) stepLabel.textContent = 'Step 2 of 2';

    if (cdmBackBtn) cdmBackBtn.style.display = '';

    const actionSection = document.getElementById('cdm-action-section');
    if (actionSection) actionSection.style.display = 'none';

    const elig = cdmState.playerData.eligibility;
    const tagResult = calculateFranchiseTag(elig.currentSalary, cdmState.playerData.position, config.extensionSeason);
    const tagSalary = tagResult.newSalary;
    const tagBasis = tagSalary > Math.round(elig.currentSalary * 1.2) ? 'top 3 average' : '120% of current salary';

    const tagSection = document.getElementById('cdm-tag-section');
    if (tagSection) tagSection.style.display = '';
    cdmNode('cdm-tag-current').textContent = formatSalaryCompact(elig.currentSalary);
    cdmNode('cdm-tag-new').textContent = formatSalaryCompact(tagSalary);
    cdmNode('cdm-tag-basis-text').textContent =
      tagBasis === 'top 3 average' ? 'Based on the top 3 salaries at position' : 'Based on 120% of current salary';

    const playerAge = cdmState.playerData.birthdate ? calculateAge(cdmState.playerData.birthdate) : null;
    updateProjectionTable(tagSalary, 1, playerAge, config.salaryYears?.[0]);
    updateCapImpact(tagSalary, 1, config.salaryYears?.[0]);

    const reviewPanel = document.getElementById('cdm-review-panel');
    if (reviewPanel) {
      reviewPanel.classList.remove('panel-enter');
      void reviewPanel.offsetWidth;
      reviewPanel.classList.add('panel-enter');
    }

    cdmState.selectedYears = 1;
    cdmState.selectedSalary = tagSalary;
    cdmSubmitBtn.style.display = '';
    cdmSubmitBtn.disabled = false;
    cdmSubmitBtn.textContent = 'Apply Franchise Tag';
  };

  // ----------------------------------------------------------------
  // goToTeamOptionStep2 — team option review (step 2 of 2)
  // ----------------------------------------------------------------
  const goToTeamOptionStep2 = () => {
    cdmState.currentStep = 2;
    cdmState.flowType = 'team-option';

    const typeBadge = document.getElementById('cdm-type-badge');
    if (typeBadge) {
      typeBadge.style.display = '';
      typeBadge.dataset.type = 'team-option';
      cdmNode('cdm-type-label').textContent = DECLARATION_TYPE_LABELS['team-option'] || 'Team Option';
    }

    const dot1 = document.getElementById('cdm-step-dot-1');
    const dot2 = document.getElementById('cdm-step-dot-2');
    const dot3 = document.getElementById('cdm-step-dot-3');
    const line1 = document.getElementById('cdm-step-line-1');
    const line2 = document.getElementById('cdm-step-line-2');
    const stepLabel = document.getElementById('cdm-stepper-label');

    if (dot2) dot2.style.display = '';
    if (line1) line1.style.display = '';
    if (dot1) { dot1.classList.remove('active'); dot1.classList.add('completed'); }
    if (dot2) { dot2.classList.remove('completed'); dot2.classList.add('active'); }
    if (dot3) dot3.style.display = 'none';
    if (line1) line1.classList.add('completed');
    if (line2) line2.style.display = 'none';
    if (stepLabel) stepLabel.textContent = 'Step 2 of 2';

    if (cdmBackBtn) cdmBackBtn.style.display = '';

    const actionSection = document.getElementById('cdm-action-section');
    if (actionSection) actionSection.style.display = 'none';

    const elig = cdmState.playerData.eligibility;
    const teamOptionResult = calculateTeamOption(elig.currentSalary, cdmState.playerData.position, config.extensionSeason);
    const optionSalary = teamOptionResult.newSalary;

    const tagSection = document.getElementById('cdm-tag-section');
    if (tagSection) tagSection.style.display = '';
    cdmNode('cdm-tag-current').textContent = formatSalaryCompact(elig.currentSalary);
    cdmNode('cdm-tag-new').textContent = formatSalaryCompact(optionSalary);
    const teamOptionYear = (config.salaryYears?.[0] ?? 2026) + elig.currentYears;
    cdmNode('cdm-tag-basis-text').textContent = `Estimate based on the top 10 salaries in ${config.extensionSeason}`;

    const playerAge = cdmState.playerData.birthdate ? calculateAge(cdmState.playerData.birthdate) : null;
    const ageAtOption = playerAge !== null ? playerAge + elig.currentYears : null;
    updateProjectionTable(optionSalary, 1, ageAtOption, teamOptionYear);
    updateCapImpact(optionSalary, 1, teamOptionYear);

    const reviewPanel = document.getElementById('cdm-review-panel');
    if (reviewPanel) {
      reviewPanel.classList.remove('panel-enter');
      void reviewPanel.offsetWidth;
      reviewPanel.classList.add('panel-enter');
    }

    cdmState.selectedYears = 1;
    cdmState.selectedSalary = optionSalary;
    cdmState.submitType = 'team-option';
    cdmSubmitBtn.style.display = '';
    cdmSubmitBtn.disabled = false;
    cdmSubmitBtn.textContent = 'Exercise Team Option';
  };

  // ----------------------------------------------------------------
  // goToRookieExtReview — rookie extension review (step 2 of 2)
  // Rookie extensions are always +2 years per league rules; no year
  // picker, just a confirmation/review step.
  // ----------------------------------------------------------------
  const goToRookieExtReview = () => {
    cdmState.currentStep = 2;
    cdmState.flowType = 'rookie-extension';

    const typeBadge = document.getElementById('cdm-type-badge');
    if (typeBadge) {
      typeBadge.style.display = '';
      typeBadge.dataset.type = 'rookie-extension';
      cdmNode('cdm-type-label').textContent = DECLARATION_TYPE_LABELS['rookie-extension'] || 'Rookie Extension';
    }

    const dot1 = document.getElementById('cdm-step-dot-1');
    const dot2 = document.getElementById('cdm-step-dot-2');
    const dot3 = document.getElementById('cdm-step-dot-3');
    const line1 = document.getElementById('cdm-step-line-1');
    const line2 = document.getElementById('cdm-step-line-2');
    const stepLabel = document.getElementById('cdm-stepper-label');

    if (dot2) dot2.style.display = '';
    if (line1) line1.style.display = '';
    if (dot1) { dot1.classList.remove('active'); dot1.classList.add('completed'); }
    if (dot2) { dot2.classList.remove('completed'); dot2.classList.add('active'); }
    if (dot3) dot3.style.display = 'none';
    if (line1) line1.classList.add('completed');
    if (line2) line2.style.display = 'none';
    if (stepLabel) stepLabel.textContent = 'Step 2 of 2';

    if (cdmBackBtn) cdmBackBtn.style.display = '';

    const actionSection = document.getElementById('cdm-action-section');
    if (actionSection) actionSection.style.display = 'none';

    const elig = cdmState.playerData.eligibility;
    const existingYears = Number(elig.currentYears) || 0;
    const baseSalary = Number(elig.currentSalary) || 0;
    const extYears = 2; // Always 2 for rookie extension
    const avgSalary = getReferenceSalary(cdmState.playerData.position, 'extension', config.extensionSeason);
    const denominator = existingYears + extYears;
    const proratedPortion = denominator > 0 ? (avgSalary * extYears) / denominator : 0;
    const newSalary = Math.round(proratedPortion + baseSalary);

    // Show extension terms section (reuse vet-ext section)
    const extSection = document.getElementById('cdm-extension-section');
    if (extSection) extSection.style.display = '';
    cdmNode('cdm-ext-current').textContent = formatSalaryCompact(baseSalary);
    cdmNode('cdm-ext-new').textContent = formatSalaryCompact(newSalary);

    const yrsCurrentEl = document.getElementById('cdm-ext-years-current');
    const yrsNewEl = document.getElementById('cdm-ext-years-new');
    if (yrsCurrentEl) yrsCurrentEl.textContent = existingYears + (existingYears === 1 ? ' yr' : ' yrs');
    if (yrsNewEl) yrsNewEl.textContent = denominator + ' yrs';

    // Show formula section using DOM methods
    const formulaSection = document.getElementById('cdm-formula-section');
    const fToggle = document.getElementById('cdm-formula-toggle');
    const fBody = document.getElementById('cdm-formula-body');
    if (formulaSection) {
      formulaSection.style.display = '';
      if (fToggle) fToggle.setAttribute('aria-expanded', 'false');
      if (fBody) fBody.classList.remove('expanded');

      const eqEl = document.getElementById('cdm-formula-equation');
      if (eqEl) {
        eqEl.replaceChildren();
        eqEl.appendChild(document.createTextNode('(Top 5 Avg × Ext Yrs / (Existing + Ext)) + Salary'));
        eqEl.appendChild(document.createElement('br'));
        eqEl.appendChild(document.createTextNode(
          '(' + formatSalaryCompact(avgSalary) + ' × ' + extYears +
          ' / (' + existingYears + ' + ' + extYears + ')) + ' + formatSalaryCompact(baseSalary)
        ));
      }

      const makeStep = (l: string, v: string) => {
        const s = document.createElement('div'); s.className = 'cdm-formula__step';
        const sl = document.createElement('span'); sl.className = 'cdm-formula__step-label'; sl.textContent = l;
        const sv = document.createElement('span'); sv.className = 'cdm-formula__step-value'; sv.textContent = v;
        s.appendChild(sl); s.appendChild(sv); return s;
      };
      const stepsEl = document.getElementById('cdm-formula-steps');
      if (stepsEl) {
        stepsEl.replaceChildren();
        stepsEl.appendChild(makeStep('Top 5 Avg', formatCurrency(avgSalary)));
        stepsEl.appendChild(makeStep('Ext Years', String(extYears)));
        stepsEl.appendChild(makeStep('Total Years', existingYears + ' + ' + extYears + ' = ' + denominator));
        stepsEl.appendChild(makeStep('Prorated', formatCurrency(Math.round(proratedPortion))));
        stepsEl.appendChild(makeStep('Existing Salary', formatCurrency(baseSalary)));
      }
      const resultEl = document.getElementById('cdm-formula-result');
      if (resultEl) {
        resultEl.replaceChildren();
        const lbl = document.createElement('span'); lbl.className = 'cdm-formula__result-label'; lbl.textContent = 'New Base Salary';
        const val = document.createElement('span'); val.className = 'cdm-formula__result-value'; val.textContent = formatCurrency(newSalary);
        resultEl.appendChild(lbl); resultEl.appendChild(val);
      }
    }

    const playerAge = cdmState.playerData.birthdate ? calculateAge(cdmState.playerData.birthdate) : null;
    updateProjectionTable(newSalary, denominator, playerAge, config.salaryYears?.[0]);
    updateCapImpact(newSalary, denominator, config.salaryYears?.[0]);

    const reviewPanel = document.getElementById('cdm-review-panel');
    if (reviewPanel) {
      reviewPanel.classList.remove('panel-enter');
      void reviewPanel.offsetWidth;
      reviewPanel.classList.add('panel-enter');
    }

    cdmState.selectedYears = extYears;
    cdmState.selectedSalary = newSalary;
    cdmState.submitType = 'rookie-extension';
    cdmSubmitBtn.style.display = '';
    cdmSubmitBtn.disabled = false;
    cdmSubmitBtn.textContent = 'Add Extension';
  };

  // ----------------------------------------------------------------
  // goToVetExtYearStep — vet-ext year selection (step 2 of 3)
  // ----------------------------------------------------------------
  const goToVetExtYearStep = () => {
    cdmState.currentStep = 2;
    cdmState.flowType = 'veteran-extension';

    const typeBadge = document.getElementById('cdm-type-badge');
    if (typeBadge) {
      typeBadge.style.display = '';
      typeBadge.dataset.type = 'veteran-extension';
      cdmNode('cdm-type-label').textContent = DECLARATION_TYPE_LABELS['veteran-extension'] || 'Veteran Extension';
    }

    const dot3 = document.getElementById('cdm-step-dot-3');
    const line2 = document.getElementById('cdm-step-line-2');
    if (dot3) dot3.style.display = '';
    if (line2) line2.style.display = '';

    const dot1 = document.getElementById('cdm-step-dot-1');
    const dot2 = document.getElementById('cdm-step-dot-2');
    const line1 = document.getElementById('cdm-step-line-1');
    const stepLabel = document.getElementById('cdm-stepper-label');

    if (dot2) dot2.style.display = '';
    if (line1) line1.style.display = '';
    if (dot1) { dot1.classList.remove('active'); dot1.classList.add('completed'); }
    if (dot2) { dot2.classList.remove('completed', 'active'); dot2.classList.add('active'); }
    if (dot3) dot3.classList.remove('active', 'completed');
    if (line1) line1.classList.add('completed');
    if (line2) line2.classList.remove('completed');
    if (stepLabel) stepLabel.textContent = 'Step 2 of 3';

    if (cdmBackBtn) cdmBackBtn.style.display = '';

    const metricsEl = document.getElementById('cdm-metrics');
    if (metricsEl) metricsEl.style.display = '';
    const actionSection = document.getElementById('cdm-action-section');
    if (actionSection) actionSection.style.display = 'none';
    cdmNode('cdm-extension-section').style.display = 'none';
    cdmNode('cdm-formula-section').style.display = 'none';
    cdmNode('cdm-projection-section').style.display = 'none';
    cdmNode('cdm-cap-impact-section').style.display = 'none';

    const yearSection = document.getElementById('cdm-year-section');
    if (yearSection) yearSection.style.display = '';

    const fToggle = document.getElementById('cdm-formula-toggle');
    const fBody = document.getElementById('cdm-formula-body');
    if (fToggle) fToggle.setAttribute('aria-expanded', 'false');
    if (fBody) fBody.classList.remove('expanded');

    const elig = cdmState.playerData.eligibility;
    buildVetExtYearButtons(elig, cdmState.playerData);

    cdmState.selectedYears = null;
    cdmState.selectedSalary = null;
    cdmSubmitBtn.disabled = true;
    cdmSubmitBtn.style.display = '';
    cdmSubmitBtn.textContent = 'Add Extension';
  };

  // ----------------------------------------------------------------
  // goToCutStep2 — cut financial review (step 2 of 2)
  // ----------------------------------------------------------------
  const goToCutStep2 = () => {
    cdmState.currentStep = 2;
    cdmState.flowType = 'cut';

    // Reveal and advance stepper to Step 2 of 2
    const dot1 = document.getElementById('cdm-step-dot-1');
    const dot2 = document.getElementById('cdm-step-dot-2');
    const line1 = document.getElementById('cdm-step-line-1');
    const stepLabel = document.getElementById('cdm-stepper-label');
    if (dot2) dot2.style.display = '';
    if (line1) line1.style.display = '';
    if (dot1) { dot1.classList.remove('active'); dot1.classList.add('completed'); }
    if (dot2) { dot2.classList.remove('completed'); dot2.classList.add('active'); }
    if (line1) line1.classList.add('completed');
    if (stepLabel) stepLabel.textContent = 'Step 2 of 2';

    // Show CUT type badge
    const typeBadge = document.getElementById('cdm-type-badge');
    if (typeBadge) {
      typeBadge.style.display = '';
      typeBadge.dataset.type = 'cut';
      cdmNode('cdm-type-label').textContent = 'Cut Player';
    }

    // Show key metrics
    const metricsEl = document.getElementById('cdm-metrics');
    if (metricsEl) metricsEl.style.display = '';

    if (cdmBackBtn) cdmBackBtn.style.display = '';

    // Hide action section, then rebuild with cut options
    const elig = cdmState.playerData.eligibility;
    const salary = elig.currentSalary;
    const years = elig.currentYears;
    const penalty = calculateCutPenalty(salary, years);
    const capSaved = salary - penalty.currentPenalty;

    // Populate cut breakdown section
    const cutSection = document.getElementById('cdm-cut-section');
    if (cutSection) cutSection.style.display = '';
    cdmNode('cdm-cut-current-hit').textContent = formatSalaryCompact(penalty.currentPenalty);
    cdmNode('cdm-cut-future-hit').textContent = penalty.futurePenalty > 0
      ? formatSalaryCompact(penalty.futurePenalty) : 'None';
    cdmNode('cdm-cut-savings').textContent = formatSalaryCompact(capSaved);

    const pctNote = years === 1 ? '50% dead money, no future penalty' :
      years === 2 ? '50% dead money + 15% spread to next season' :
      years === 3 ? '50% dead money + 25% spread to next season' :
      years === 4 ? '50% dead money + 35% spread to next season' :
      '50% dead money + 45% spread to next season';
    const noteEl = document.getElementById('cdm-cut-note');
    if (noteEl) noteEl.textContent = pctNote;

    // Populate action options with Simulate + Real Cut
    const actionSection = document.getElementById('cdm-action-section');
    if (actionSection) actionSection.style.display = '';
    const actionOptions = document.getElementById('cdm-action-options');
    if (actionOptions) {
      actionOptions.replaceChildren();
      const backBtn = document.createElement('button');
      backBtn.className = 'cdm-action-back';
      backBtn.textContent = '\u2190 Back to Actions';
      backBtn.addEventListener('click', () => {
        goToActionSelectStep();
        populateCdmActionOptions(cdmState.playerData.eligibility);
      });
      actionOptions.appendChild(backBtn);

      actionOptions.appendChild(makeCdmActionBtn(
        'cut-simulate', 'Simulate Cut', 'Track cap impact locally — no roster changes',
        () => {
          setSelectedPlayer({ ...cdmState.playerData._rawPlayer });
          applyContractAction('cut');
          closeDeclarationModal();
        },
        false, 'icon-bar-chart'
      ));

      actionOptions.appendChild(makeCdmActionBtn(
        'cut-real', 'Cut Player', 'Permanently release — cannot be undone',
        () => executeCutPlayer(),
        false, 'icon-user-times'
      ));
    }

    cdmSubmitBtn.style.display = 'none';

    const reviewPanel = document.getElementById('cdm-review-panel');
    if (reviewPanel) {
      reviewPanel.classList.remove('panel-enter');
      void reviewPanel.offsetWidth;
      reviewPanel.classList.add('panel-enter');
    }
  };
  // ----------------------------------------------------------------
  // executeCutPlayer — inline confirm → API call to actually cut
  // ----------------------------------------------------------------
  const executeCutPlayer = async () => {
    const cutBtn = document.querySelector<HTMLButtonElement>('.cdm-action-option--cut-real');
    if (!cutBtn) return;

    // First click: transform to danger confirmation state
    if (!cdmState.cutConfirmed) {
      cdmState.cutConfirmed = true;
      cutBtn.classList.add('cdm-action-option--danger');
      const label = cutBtn.querySelector('.cdm-action-option__label');
      const desc = cutBtn.querySelector('.cdm-action-option__desc');
      if (label) label.textContent = 'Confirm Cut';
      if (desc) desc.textContent = 'This cannot be undone — click again to confirm';
      return;
    }

    // Second click: execute the cut
    const playerId = cdmState.playerData?.id;
    if (!playerId) return;

    // Loading state
    cutBtn.disabled = true;
    cutBtn.classList.add('loading');
    const label = cutBtn.querySelector('.cdm-action-option__label');
    const desc = cutBtn.querySelector('.cdm-action-option__desc');
    if (label) label.textContent = 'Cutting...';
    if (desc) desc.textContent = '';
    cdmError.style.display = 'none';

    // Disable the simulate button too
    const simBtn = document.querySelector<HTMLButtonElement>('.cdm-action-option--cut-simulate');
    if (simBtn) simBtn.disabled = true;

    try {
      const res = await fetch('/api/cut-player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: String(playerId) }),
      });

      const data = await res.json();

      if (data.success) {
        // Show success
        const playerName = cdmState.playerData?._rawPlayer?.name || 'Player';
        cutBtn.style.display = 'none';
        if (simBtn) simBtn.style.display = 'none';
        cdmSuccess.style.display = 'flex';
        const successSpan = cdmSuccess.querySelector('span');
        if (successSpan) successSpan.textContent = `${playerName} has been released.`;
        setTimeout(() => window.location.reload(), 1500);
      } else {
        cdmError.textContent = data.message || 'Failed to cut player. Please try again.';
        cdmError.style.display = 'flex';
        // Re-enable
        cutBtn.disabled = false;
        cutBtn.classList.remove('loading');
        if (label) label.textContent = 'Confirm Cut';
        if (desc) desc.textContent = 'This cannot be undone — click again to confirm';
        if (simBtn) simBtn.disabled = false;
      }
    } catch (err) {
      cdmError.textContent = 'Network error. Please check your connection and try again.';
      cdmError.style.display = 'flex';
      cutBtn.disabled = false;
      cutBtn.classList.remove('loading');
      if (label) label.textContent = 'Confirm Cut';
      if (desc) desc.textContent = 'This cannot be undone — click again to confirm';
      if (simBtn) simBtn.disabled = false;
    }
  };

  const submitDeclaration = async () => {
    if (!cdmState.playerData || cdmState.selectedYears === null) return;

    const origBtnText = cdmSubmitBtn.textContent;
    cdmSubmitBtn.classList.add('is-loading');
    cdmSubmitBtn.disabled = true;
    cdmSubmitBtn.setAttribute('aria-busy', 'true');
    cdmSubmitBtn.textContent = 'Submitting...';
    cdmError.style.display = 'none';

    const elig = cdmState.playerData.eligibility;
    const isCancelling = cdmState.selectedYears === elig?.currentYears;

    // Demo mode: skip API call, show success immediately
    const isDemoPlayer = isDemoActive() && String(cdmState.playerData.id).startsWith('DEMO_');
    if (isDemoPlayer) {
      if (isCancelling) {
        delete localDeclarations[cdmState.playerData.id];
        delete declarationsByPlayer[cdmState.playerData.id];
      } else {
        localDeclarations[cdmState.playerData.id] = {
          status: 'pending',
          years: cdmState.selectedYears,
        };
      }
      cdmSubmitBtn.classList.remove('is-loading');
      cdmSubmitBtn.removeAttribute('aria-busy');
      cdmSubmitBtn.style.display = 'none';
      cdmSuccess.style.display = 'flex';
      updateView();
      applyEligibilityStyling();
      setTimeout(closeDeclarationModal, 1500);
      return;
    }
    const franchiseId = config.authUser?.franchiseId ?? getCurrentTeam();
    const franchiseName = config.teams?.[franchiseId]?.name ?? franchiseId;
    const leagueId = config.authUser?.leagueId ?? config.defaultLeagueId;

    // cdmState.flowType tracks the current step flow; cdmState.submitType overrides for specific sub-choices.
    // For action-select flows, use cdmState.flowType; otherwise fall back to cdmState.submitType then elig.type
    const effectiveType = (cdmState.flowType && cdmState.flowType !== 'action-select') ? cdmState.flowType : (cdmState.submitType ?? elig.type);

    // Determine requestedContractInfo based on declaration type
    let requestedContractInfo;
    if (effectiveType === 'franchise-tag') requestedContractInfo = 'F';
    else if (effectiveType === 'rookie-extension') requestedContractInfo = ''; // graduating from RC
    else if (effectiveType === 'team-option') requestedContractInfo = ''; // TO designation removed

    try {
      // Shared with rosters.astro's bulk submit and the homepage's Unsigned
      // FA card — one place files contract paperwork. It throws the API's
      // own validation message, which is the useful one.
      const result = await submitDeclaration({
        leagueId,
        playerId: cdmState.playerData.id,
        playerName: cdmState.playerData.name,
        franchiseId,
        franchiseName,
        type: effectiveType,
        currentYears: elig.currentYears,
        currentSalary: elig.currentSalary,
        currentContractInfo: elig.contractInfo ?? '',
        requestedYears: cdmState.selectedYears,
        requestedSalary: cdmState.selectedSalary ?? undefined,
        requestedContractInfo,
        deadlineAt: elig.deadlineTimestamp
          ? new Date(elig.deadlineTimestamp * 1000).toISOString()
          : undefined,
        acquisitionTimestamp: elig.acquisitionTimestamp,
      });

      if (result.cancelled) {
        delete localDeclarations[cdmState.playerData.id];
        delete declarationsByPlayer[cdmState.playerData.id];
      } else {
        // Optimistic update
        localDeclarations[cdmState.playerData.id] = {
          status: 'pending',
          years: cdmState.selectedYears,
        };
      }

      cdmSubmitBtn.classList.remove('is-loading');
      cdmSubmitBtn.removeAttribute('aria-busy');
      cdmSubmitBtn.style.display = 'none';
      cdmSuccess.style.display = 'flex';

      // Refresh the years cells
      updateView();
      applyEligibilityStyling();

      // Auto-close after short delay
      setTimeout(closeDeclarationModal, 1500);
    } catch (err) {
      // `(err as Error)` only to satisfy the checker — the page read
      // `err.message` off an untyped catch and every throw on this path is an
      // Error, including the one the !res.ok branch above constructs.
      cdmError.textContent = (err as Error).message;
      cdmError.style.display = '';
      cdmSubmitBtn.classList.remove('is-loading');
      cdmSubmitBtn.disabled = false;
      cdmSubmitBtn.removeAttribute('aria-busy');
      cdmSubmitBtn.textContent = origBtnText;
    }
  };

  // Wire up modal close/submit
  cdmOverlay?.addEventListener('click', closeDeclarationModal);
  cdmCloseBtn?.addEventListener('click', closeDeclarationModal);
  cdmSubmitBtn?.addEventListener('click', () => {
    // Via action-select flow: apply locally (sandbox, no API call)
    if (cdmState.viaActionSelect) {
      if (cdmState.flowType === 'franchise-tag') {
        if (!cdmState.playerData) return;
        setSelectedPlayer(cdmState.playerData._rawPlayer);
        applyContractAction('franchise');
        closeDeclarationModal();
        return;
      }
      if (cdmState.flowType === 'veteran-extension') {
        if (!cdmState.selectedYears || !cdmState.playerData) return;
        setSelectedPlayer(cdmState.playerData._rawPlayer);
        applyContractAction('extension', cdmState.selectedYears);
        closeDeclarationModal();
        return;
      }
      if (cdmState.flowType === 'team-option') {
        if (!cdmState.playerData) return;
        setSelectedPlayer(cdmState.playerData._rawPlayer);
        applyContractAction('team-option');
        closeDeclarationModal();
        return;
      }
      if (cdmState.flowType === 'rookie-extension') {
        if (!cdmState.playerData) return;
        setSelectedPlayer(cdmState.playerData._rawPlayer);
        applyContractAction('rookie-extension', 2);
        closeDeclarationModal();
        return;
      }
    }
    // Team option from direct TO cell click — apply locally for cap impact simulation
    if (cdmState.flowType === 'team-option' && cdmState.playerData) {
      const elig = cdmState.playerData.eligibility;
      setSelectedPlayer(cdmState.playerData._rawPlayer || {
        id: cdmState.playerData.id,
        name: cdmState.playerData.name,
        position: cdmState.playerData.position,
        salary: elig?.currentSalary ?? 0,
        years: elig?.currentYears ?? 1,
      });
      applyContractAction('team-option');
      closeDeclarationModal();
      return;
    }
    // Veteran extension via yrs-chip: staged (batch-submitted later via Submit Tags/Extensions)
    if (cdmState.playerData?.eligibility?.type === 'veteran-extension') {
      if (!cdmState.selectedYears || !cdmState.playerData) return;
      setSelectedPlayer(cdmState.playerData._rawPlayer);
      applyContractAction('extension', cdmState.selectedYears);
      closeDeclarationModal();
      return;
    }
    submitDeclaration();
  });
  // Document-level, so it is REPLACED per init rather than added again. The
  // page added it fresh on every initRosterPage, which stacks one handler per
  // navigation under the ClientRouter — see CLAUDE.md's lifecycle rule. The
  // effect was benign (closing a closed modal is a no-op); the shape is not.
  if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
  escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && cdmModal?.classList.contains('active')) {
      closeDeclarationModal();
    }
  };
  document.addEventListener('keydown', escapeHandler);

  return {
    openDeclarationModal,
    closeDeclarationModal,
    setCdmReturnFocus,
    populateCdmActionOptions,
    describeCdmActions,
    makeCdmActionBtn,
    goToActionSelectStep,
    goToDeclareContractStep,
    goToFranchiseTagStep2,
    goToTeamOptionStep2,
    goToRookieExtReview,
    goToVetExtYearStep,
    goToCutStep2,
  };
}
