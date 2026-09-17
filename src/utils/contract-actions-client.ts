/**
 * The client-side core of a contract action: price it, then file it.
 *
 * Three surfaces declare contracts — `rosters.astro`'s Contract Decision
 * Modal, the homepage's Unsigned FA card, and (from Phase D) the Front
 * Office hub. Before this module each carried its own copy of the pricing
 * formulas and its own `fetch` to `/api/contracts/declare`. Two copies of a
 * cap formula is two answers to "what does extending him cost".
 *
 * WHAT IS HERE, AND WHAT DELIBERATELY IS NOT
 *
 * Here: the arithmetic and the submit. Both are pure of any one page's DOM,
 * which is what lets three very different UIs share them.
 *
 * NOT here: the modal's open/populate/step flow. That code closes over the
 * roster page's own state — `contractActions`, `recalculateRoster`,
 * `currentTeam`, the rendered row it was launched from — and lifting it
 * would mean inventing an abstraction over a 7k-line imperative script to
 * serve one other caller. The hub drives the same modal shell with its own
 * small trigger and calls THIS module for the parts that must not diverge.
 *
 * THE ARITHMETIC IS NOT REDEFINED HERE EITHER. It delegates to
 * `salary-calculations.ts`, the same module the Trade Builder and every
 * server-side cap figure read. Only the LOOKUP differs: the client config
 * ships pre-flattened per-season maps (`franchiseSalaries[pos]`) while the
 * shared functions take MFL's nested shape (`positions[pos].top3Average`),
 * so `toSalaryAverages` adapts one to the other and the formula stays in
 * one place. `tests/contract-actions-client.test.ts` pins that the two
 * agree.
 */
import {
  calculateFranchiseTag as calcFranchiseTagShared,
  calculateVeteranExtension as calcVeteranExtensionShared,
  type Declaration,
} from './salary-calculations';

/** The per-season averages block the client config ships. */
export interface ClientSalaryAverages {
  franchiseSalaries?: Record<string, number>;
  extensionSalaries?: Record<string, number>;
  teamOptionSalaries?: Record<string, number>;
}

export type ContractActionType = 'franchise' | 'extension' | 'team-option' | 'rookie-extension';

export const DECLARATION_TYPE_LABELS: Record<string, string> = {
  'new-acquisition': 'New Acquisition',
  'rookie-override': 'Rookie Override',
  'team-option': '1st Round Option',
  'franchise-tag': 'Franchise Tag',
  'veteran-extension': 'Veteran Extension',
  'rookie-extension': 'Rookie Extension',
};

/**
 * Adapt the client config's flattened per-position maps into the nested
 * shape `salary-calculations.ts` reads, so one formula serves both.
 *
 * Only the requested position is filled in — the shared helpers index by
 * position and never iterate, so building the whole table would be waste.
 */
export function toSalaryAverages(averages: ClientSalaryAverages | undefined, position: string) {
  return {
    positions: {
      [position]: {
        top3Average: averages?.franchiseSalaries?.[position] ?? 0,
        top5Average: averages?.extensionSalaries?.[position] ?? 0,
        top10Average: averages?.teamOptionSalaries?.[position] ?? 0,
      },
    },
  };
}

/** The reference salary a given action prices against. */
export function getReferenceSalary(
  averages: ClientSalaryAverages | undefined,
  position: string,
  type: 'franchise' | 'extension' | 'team-option',
): number {
  if (type === 'franchise') return averages?.franchiseSalaries?.[position] ?? 0;
  if (type === 'team-option') return averages?.teamOptionSalaries?.[position] ?? 0;
  return averages?.extensionSalaries?.[position] ?? 0;
}

export function calculateFranchiseTag(
  currentSalary: number,
  position: string,
  averages: ClientSalaryAverages | undefined,
): { newSalary: number; newYears: number } {
  const { newSalary, newYears } = calcFranchiseTagShared(
    currentSalary,
    position,
    toSalaryAverages(averages, position),
  );
  return { newSalary, newYears };
}

/**
 * A team option is a flat one-year buy at the position's top-10 average —
 * no escalation, no max against the current salary. Simple enough that
 * salary-calculations.ts has no helper for it; the rate it reads
 * (`top10Average`) still comes from there via `getReferenceSalary`.
 */
export function calculateTeamOption(
  position: string,
  averages: ClientSalaryAverages | undefined,
): { newSalary: number; newYears: number } {
  return { newSalary: Math.round(getReferenceSalary(averages, position, 'team-option')), newYears: 1 };
}

export function calculateVeteranExtension(
  contractYears: number,
  position: string,
  extensionYears: number,
  currentSalary: number,
  averages: ClientSalaryAverages | undefined,
): { newSalary: number; newYears: number; salaryBreakdown: Record<string, number> } {
  return calcVeteranExtensionShared(
    contractYears,
    position,
    extensionYears,
    currentSalary,
    toSalaryAverages(averages, position),
  );
}

/** Compact currency, for a chip or a modal line. */
export function formatSalaryCompact(val: unknown): string {
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Filing
// ─────────────────────────────────────────────────────────────────────────

export interface DeclarationRequest {
  leagueId: string;
  playerId: string;
  playerName: string;
  franchiseId: string;
  franchiseName: string;
  type: string;
  currentYears: number;
  currentSalary: number;
  currentContractInfo: string;
  requestedYears: number;
  requestedSalary?: number;
  requestedContractInfo?: string;
  deadlineAt?: string;
  acquisitionTimestamp?: number;
}

export const DECLARE_ENDPOINT = '/api/contracts/declare';

/** What the API answers with. `cancelled` comes back when a re-declaration
 *  withdraws a pending one rather than filing a new one, which the wizard
 *  has to distinguish to clear its optimistic state instead of setting it. */
export interface DeclarationResult {
  cancelled?: boolean;
  [key: string]: unknown;
}

/**
 * File one declaration. Throws on a non-2xx so every caller surfaces the
 * server's own message rather than inventing one — the API's validation
 * text ("already has a pending franchise tag", "not eligible") is the most
 * useful thing an owner can be told.
 */
export async function submitDeclaration(body: DeclarationRequest): Promise<DeclarationResult> {
  const res = await fetch(DECLARE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = (await res.json().catch(() => ({}))) as DeclarationResult;
  if (!res.ok) throw new Error((result as any)?.error || 'Submission failed');
  return result;
}

/** A staged tag/extension, as the roster page and the hub both hold them. */
export interface StagedContractAction {
  playerId: string;
  playerName: string;
  type: ContractActionType;
  originalYears: number;
  originalSalary: number;
  newYears: number;
  newSalary: number;
}

/**
 * Turn a staged action into the request body the API expects.
 *
 * `requestedContractInfo` is the single letter MFL shows on the roster —
 * 'F' for a franchise tag, 'E' for an extension — and the commissioner's
 * apply step writes it through verbatim, so it is not decoration.
 */
export function toDeclarationRequest(
  action: StagedContractAction,
  ctx: { leagueId: string; franchiseId: string; franchiseName: string },
): DeclarationRequest {
  const isFranchise = action.type === 'franchise';
  return {
    leagueId: ctx.leagueId,
    playerId: action.playerId,
    playerName: action.playerName,
    franchiseId: ctx.franchiseId,
    franchiseName: ctx.franchiseName,
    type: isFranchise ? 'franchise-tag' : 'veteran-extension',
    currentYears: action.originalYears,
    currentSalary: action.originalSalary,
    currentContractInfo: '',
    requestedYears: isFranchise ? 1 : action.newYears,
    requestedSalary: action.newSalary,
    requestedContractInfo: isFranchise ? 'F' : 'E',
  };
}

/**
 * File every staged tag/extension, in order, stopping at the first failure.
 *
 * Sequential rather than parallel on purpose: the API rejects a second
 * franchise tag for the same team, and that check reads the store, so
 * firing them at once would let two race past it. `onFiled` runs after each
 * success so a caller can update its own optimistic state as it goes and
 * keep whatever already landed if a later one throws.
 */
export async function submitStagedActions(
  actions: StagedContractAction[],
  ctx: { leagueId: string; franchiseId: string; franchiseName: string },
  onFiled?: (action: StagedContractAction) => void,
): Promise<void> {
  for (const action of actions) {
    await submitDeclaration(toDeclarationRequest(action, ctx));
    onFiled?.(action);
  }
}

export type { Declaration };
