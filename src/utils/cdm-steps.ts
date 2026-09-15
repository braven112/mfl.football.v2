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
 * Two of the twenty-one are shaped the way they are for a reason:
 *
 * - `setSelectedPlayer` is a setter, not a value. The cut flow's "Simulate
 *   Cut" option ASSIGNS the page's `selectedPlayer`, and an assignment cannot
 *   cross a module boundary as a plain reference.
 * - `executeCutPlayer` is called through `ctx` rather than destructured. It
 *   is declared BELOW this region in the page, so destructuring it when the
 *   factory runs would capture `undefined`; going through `ctx` at click time
 *   resolves it the same way the page's own forward reference used to.
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

import { createYearButton } from './cdm-ui';

/** Everything the step functions reach for that lives outside this module. */
export interface CdmStepsContext {
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
  updateProjectionTable: (
    baseSalary: any,
    years: any,
    currentAge?: number | null,
    startYear?: number | null,
  ) => void;
  updateCapImpact: (playerBaseSalary: any, years: any, startYear?: number | null) => void;
  populateCdmActionOptions: (elig: any) => void;
  makeCdmActionBtn: (
    id: string,
    label: string,
    desc: string,
    onClick: () => void,
    disabled?: boolean,
    iconId?: string,
  ) => HTMLButtonElement;
  buildVetExtYearButtons: (elig: any, data: any) => void;
  closeDeclarationModal: () => void;
  applyContractAction: (actionType: string, extensionYears?: number) => void;
  /** Assigns the page's `selectedPlayer` — see the note above. */
  setSelectedPlayer: (player: any) => void;
  /** Late-bound; called through `ctx` — see the note above. */
  executeCutPlayer: () => void;
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
function cdmNode(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

export function createCdmSteps(ctx: CdmStepsContext) {
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
    updateProjectionTable,
    updateCapImpact,
    populateCdmActionOptions,
    makeCdmActionBtn,
    buildVetExtYearButtons,
    closeDeclarationModal,
    applyContractAction,
    setSelectedPlayer,
  } = ctx;

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
        () => ctx.executeCutPlayer(),
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
  return {
    goToActionSelectStep,
    goToDeclareContractStep,
    goToFranchiseTagStep2,
    goToTeamOptionStep2,
    goToRookieExtReview,
    goToVetExtYearStep,
    goToCutStep2,
  };
}
