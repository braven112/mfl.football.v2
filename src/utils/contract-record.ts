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
import { contractTermsChange as termsChange } from './contract-terms.mjs';

export interface ContractTermsInput {
  currentYears?: number | null;
  currentSalary?: number | null;
  currentContractInfo?: string | null;
  requestedYears?: number | null;
  requestedSalary?: number | null;
  requestedContractInfo?: string | null;
}

/**
 * `{ before, after }` for one declaration. The one implementation lives in
 * contract-terms.mjs so the Schefter scanner (plain node) prints the same
 * terms the Contracts page does.
 */
export function contractTermsChange(
  d: ContractTermsInput,
  opts?: { designation?: boolean },
): { before: string; after: string } {
  return termsChange(d, opts);
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
