/**
 * Files one owner's veteran extension: check it on the server, store it, and
 * (when enabled) write it to MFL in the same request.
 *
 * Called from POST /api/contracts/declare for `type: 'veteran-extension'`,
 * after that endpoint has authenticated the owner and confirmed the franchise
 * is theirs in the contract league.
 */
import type { AuthUser } from './auth';
import type { ContractDeclaration } from '../types/contracts';
import { getCurrentLeagueYear } from './league-year';
import { checkVeteranExtensionOnServer } from './veteran-extension-server';
import {
  addDeclaration,
  generateDeclarationId,
  getPendingDeclarationForPlayer,
  updateDeclaration,
} from './contract-storage';
import { writeContractToMFL, leagueCommissionerCredentials } from './mfl-contract-writer';
import { invalidateRosterCache } from './mfl-roster-cache';

/**
 * Write straight to MFL instead of waiting for the commissioner (Brandon,
 * 2026-11-14). MFL takes a salary import only from a commissioner login, so
 * this writes with the league commissioner account
 * (`leagueCommissionerCredentials`), after a backup, and records who filed
 * it. Flip to false to fall back to the commissioner's one-tap apply on
 * /front-office/contracts.
 */
export const WRITE_VETERAN_EXTENSIONS_TO_MFL = true;

export interface FilingOutcome {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export async function fileVeteranExtension(input: {
  user: AuthUser;
  leagueId: string;
  franchiseId: string;
  franchiseName: string;
  playerId: string;
  playerName: string;
  addedYears: number;
}): Promise<FilingOutcome> {
  const { user, leagueId, franchiseId, franchiseName, playerId, playerName, addedYears } = input;
  const leagueYear = getCurrentLeagueYear();

  const { result, player } = await checkVeteranExtensionOnServer({
    leagueId,
    leagueYear,
    franchiseId,
    playerId,
    addedYears,
  });
  if (!result.ok || !player) {
    return { ok: false, status: 400, body: { error: result.ok ? 'Not eligible' : result.error } };
  }
  const { price } = result;

  const terms = {
    currentYears: player.contractYears,
    currentSalary: player.salary,
    currentContractInfo: player.contractInfo,
    requestedYears: price.newYears,
    requestedSalary: price.newSalary,
    requestedContractInfo: player.contractInfo,
    submittedAt: new Date().toISOString(),
  };

  const existing = await getPendingDeclarationForPlayer(playerId, franchiseId);
  let declarationId: string;
  if (existing && existing.status === 'pending' && existing.type === 'veteran-extension') {
    const updated = await updateDeclaration(existing.id, terms);
    if (!updated) return { ok: false, status: 500, body: { error: 'Failed to update the extension' } };
    declarationId = existing.id;
  } else {
    const declaration: ContractDeclaration = {
      id: generateDeclarationId(),
      type: 'veteran-extension',
      playerId,
      playerName,
      franchiseId,
      franchiseName,
      leagueId,
      ...terms,
      status: 'pending',
      submittedBy: user.name || user.id,
      mflSynced: false,
    };
    await addDeclaration(declaration);
    declarationId = declaration.id;
  }

  const priced = {
    declarationId,
    addedYears: price.addedYears,
    newYears: price.newYears,
    newSalary: price.newSalary,
    salaryByYear: price.salaryByYear,
  };
  const pending = (message: string, extra: Record<string, unknown> = {}): FilingOutcome => ({
    ok: true,
    status: 200,
    body: { success: true, status: 'pending', ...priced, message, ...extra },
  });

  if (!WRITE_VETERAN_EXTENSIONS_TO_MFL) {
    return pending('Extension filed. The commissioner applies it to MFL.');
  }

  const credentials = leagueCommissionerCredentials();
  if (!credentials) {
    return pending('Extension filed. The commissioner will apply it to MFL.', { mflSynced: false });
  }

  const write = await writeContractToMFL(
    {
      playerId,
      salary: String(price.newSalary),
      contractYear: String(price.newYears),
      contractInfo: player.contractInfo,
    },
    credentials,
  );
  console.log('[veteran-extension] MFL write', {
    declarationId,
    franchiseId,
    playerId,
    filedBy: user.name || user.id,
    success: write.success,
    error: write.error,
  });

  if (!write.success) {
    // Stays pending with the error on it, so the commissioner can apply it
    // from /front-office/contracts; the owner is told plainly.
    await updateDeclaration(declarationId, { mflError: write.error });
    return pending(
      write.blocked
        ? write.error ?? 'This site cannot write to MFL. The commissioner will apply it.'
        : 'Filed, but MFL did not take it yet. The commissioner will apply it.',
      { mflSynced: false },
    );
  }

  const now = new Date().toISOString();
  await updateDeclaration(declarationId, {
    status: 'applied',
    mflSynced: true,
    mflSyncedAt: now,
    reviewedBy: 'auto (veteran extension)',
    reviewedAt: now,
  });
  invalidateRosterCache(String(leagueYear), leagueId).catch(() => undefined);

  return {
    ok: true,
    status: 200,
    body: { success: true, status: 'applied', mflSynced: true, ...priced, message: 'Done. Your new contract is on MFL.' },
  };
}
