/**
 * Contract Declaration Modal — the presentation primitives.
 *
 * First slice of Phase 6.1 in docs/plans/rosters-page-split.md: the wizard is
 * ~2,100 lines living in THREE non-contiguous regions inside
 * `rosters.astro`'s `initRosterPage`, with the (deferred) autocut section
 * sandwiched between two of them. This module is where it comes out, a piece
 * at a time, starting with the parts that reference nothing from that closure.
 *
 * The seam is deliberate: what a control LOOKS like moves here, what happens
 * when you click it stays with the state it mutates. So `createActionOption`
 * takes an `onClick` rather than knowing any of the flows, and
 * `createYearButton` builds the button but never touches `cdmSelectedYears`.
 *
 * Everything here is covered by `scripts/cdm-parity-check.mjs`, which
 * fingerprints the rendered `actionOptions` and `yearOptions` across all 25
 * eligible players — so a change in what these produce is a diff, not a
 * surprise.
 */

import { calculateAge } from './age-utils';

const SPRITE = '/assets/icons/sprite.svg';
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A step-1 action option ("Veteran Extension", "Cut Player", …).
 *
 * `id` becomes the `cdm-action-option--<id>` modifier the page's own CSS and
 * two querySelectors key on (`.cdm-action-option--cut-real` is read back by
 * the inline cut confirmation), so it is part of the contract, not decoration.
 */
export function createActionOption({
  id,
  label,
  desc,
  onClick,
  disabled = false,
  iconId,
}: {
  id: string;
  label: string;
  desc: string;
  onClick?: (event: MouseEvent) => void;
  disabled?: boolean;
  iconId?: string;
}): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'cdm-action-option cdm-action-option--' + id;
  if (disabled) {
    btn.disabled = true;
    btn.classList.add('cdm-action-option--disabled');
  }

  const iconEl = document.createElement('span');
  iconEl.className = 'cdm-action-option__icon';
  if (iconId) {
    const svgEl = document.createElementNS(SVG_NS, 'svg');
    svgEl.setAttribute('aria-hidden', 'true');
    const useEl = document.createElementNS(SVG_NS, 'use');
    useEl.setAttribute('href', SPRITE + '#' + iconId);
    svgEl.appendChild(useEl);
    iconEl.appendChild(svgEl);
  }

  const textEl = document.createElement('span');
  textEl.className = 'cdm-action-option__text';
  const labelEl = document.createElement('span');
  labelEl.className = 'cdm-action-option__label';
  labelEl.textContent = label;
  const descEl = document.createElement('span');
  descEl.className = 'cdm-action-option__desc';
  descEl.textContent = desc;
  textEl.appendChild(labelEl);
  textEl.appendChild(descEl);

  btn.appendChild(iconEl);
  btn.appendChild(textEl);
  // Guarded so a disabled option cannot fire even if something re-enables it
  // later without re-binding — the original did the same.
  if (onClick && !disabled) btn.addEventListener('click', onClick);
  return btn;
}

/**
 * One year choice on the extension / declaration step.
 *
 * Returns the button unbound: selecting a term mutates the wizard's state and
 * drives the stepper, which stays in the page until the state moves with it.
 */
export function createYearButton(years: number): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'cdm-year-btn';
  btn.dataset.years = String(years);
  const numEl = document.createElement('span');
  numEl.className = 'cdm-year-btn__number';
  numEl.textContent = String(years);
  const labelEl = document.createElement('span');
  labelEl.className = 'cdm-year-btn__label';
  labelEl.textContent = years === 1 ? 'YEAR' : 'YEARS';
  btn.appendChild(numEl);
  btn.appendChild(labelEl);
  return btn;
}

/**
 * The band's draft line — "2023 Round 2, Pick 07" / "Undrafted".
 *
 * MFL reports an undrafted player as FA or UFA rather than as a missing year,
 * so both spellings have to read as undrafted; picks are zero-padded because
 * an unpadded single digit reads as a round.
 */
export function formatDraftLine(
  year?: number | string | null,
  round?: number | string | null,
  pick?: number | string | null,
  teamCode?: string | null,
): string {
  const rawTeam = (teamCode || '').toUpperCase();
  const isUndrafted = !year || rawTeam === 'FA' || rawTeam === 'UFA';
  if (isUndrafted) return 'Undrafted';
  const fmtPick = (v: number | string | null | undefined) => {
    if (v == null) return '??';
    const n = Number(v);
    return Number.isFinite(n) ? String(n).padStart(2, '0') : '??';
  };
  if (year && round) return year + ' Round ' + round + ', Pick ' + fmtPick(pick);
  if (year && pick) return year + ' Pick ' + fmtPick(pick);
  return 'Undrafted';
}

/**
 * The band's age pill.
 *
 * Delegates the arithmetic to the canonical `calculateAge` rather than
 * carrying a third copy of it — the page had one inline, and Phases 3 and 4 of
 * the split plan are a record of how often that goes unnoticed. The two guards
 * the CDM's copy added on top are real and kept: an unparseable birthdate and
 * a date in the future both have to read as "no age" so the pill hides,
 * instead of rendering `NaN yrs` or `-1 yrs`.
 */
export function cdmAge(birthdate?: number | string | null, now: Date = new Date()): number | null {
  if (!birthdate) return null;
  if (Number.isNaN(new Date(Number(birthdate) * 1000).getTime())) return null;
  const age = calculateAge(birthdate, now);
  if (age == null || Number.isNaN(age)) return null;
  return age >= 0 ? age : null;
}
