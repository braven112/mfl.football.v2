/**
 * The before → after record of a filed contract (Brandon, 2026-11-15): every
 * declaration keeps the contract it replaced (`current*`) beside the one it
 * asked for (`requested*`), so a mistake can be traced and the change can be
 * reported. This turns the pair into the two lines the Front Office
 * Contracts page prints.
 *
 * Salary is shown only when the declaration recorded it: a "Contract Years"
 * declaration on a new pickup changes years alone.
 */
import { formatSalaryCompact } from './contract-actions-client';

export interface ContractTermsInput {
  currentYears?: number | null;
  currentSalary?: number | null;
  currentContractInfo?: string | null;
  requestedYears?: number | null;
  requestedSalary?: number | null;
  requestedContractInfo?: string | null;
}

const yearsLabel = (n: number | null | undefined) => `${Number(n) || 0} ${Number(n) === 1 ? 'yr' : 'yrs'}`;

function terms(salary: number | null | undefined, years: number | null | undefined, info: string | null | undefined): string {
  const parts: string[] = [];
  if (salary != null && Number(salary) > 0) parts.push(formatSalaryCompact(salary));
  parts.push(yearsLabel(years));
  const tag = String(info ?? '').trim();
  if (tag) parts.push(tag);
  return parts.join(' · ');
}

/**
 * `{ before, after }` for one declaration. The requested salary falls back to
 * the current one, as the MFL write does (`requestedSalary ?? currentSalary`);
 * a requested designation of '' is a real answer (an RC or TO removed), so
 * only a missing one falls back.
 */
export function contractTermsChange(d: ContractTermsInput): { before: string; after: string } {
  const afterSalary = d.requestedSalary ?? d.currentSalary;
  const afterInfo = d.requestedContractInfo !== undefined && d.requestedContractInfo !== null
    ? d.requestedContractInfo
    : d.currentContractInfo;
  return {
    before: terms(d.currentSalary, d.currentYears, d.currentContractInfo),
    after: terms(afterSalary, d.requestedYears, afterInfo),
  };
}

/**
 * A queued franchise tag is a secret until Feb 15 (Brandon, 2026-11-15): only
 * the team that filed it and the commissioner may see it before MFL makes it
 * official. Every other declaration is public. `viewerFranchiseId` must come
 * from `franchiseIdForLeague` for THIS league (both leagues have a 0001).
 */
export function isDeclarationVisible(
  d: { type?: string; status?: string; franchiseId?: string },
  viewer: { franchiseId: string | null; isCommissioner: boolean },
): boolean {
  if (d.type !== 'franchise-tag' || d.status !== 'pending') return true;
  if (viewer.isCommissioner) return true;
  return !!viewer.franchiseId && viewer.franchiseId === d.franchiseId;
}
