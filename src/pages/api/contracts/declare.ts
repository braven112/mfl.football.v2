/**
 * POST /api/contracts/declare
 *
 * Submit a contract declaration for commissioner approval.
 * Requires authentication as the franchise owner.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isAuthorizedForLeague, isFranchiseOwner } from '../../../utils/auth';
import { CONTRACT_LEAGUE_ID } from '../../../utils/mfl-contract-writer';
import { recordInsightAction } from '../../../utils/site-insights';
import { validateContractSubmission } from '../../../utils/contract-validation';
import {
  generateDeclarationId,
  addDeclaration,
  updateDeclaration,
  deleteDeclaration,
  getPendingDeclarationForPlayer,
} from '../../../utils/contract-storage';
import type { ContractDeclaration } from '../../../types/contracts';
import type { DeclarationType } from '../../../types/contract-eligibility';
import { JSON_HEADERS } from '../../../utils/api-response';
import { getCachedRosters } from '../../../utils/mfl-roster-cache';
import { getCurrentLeagueYear } from '../../../utils/league-year';
import { fileVeteranExtension } from '../../../utils/veteran-extension-filing';
import { checkFranchiseTagOnServer, FRANCHISE_TAG_CONTRACT_INFO } from '../../../utils/franchise-tag-server';

interface DeclareRequestBody {
  leagueId: string;
  playerId: string;
  playerName: string;
  franchiseId: string;
  franchiseName: string;
  type: DeclarationType;
  currentYears: number;
  currentSalary: number;
  currentContractInfo: string;
  requestedYears: number;
  requestedSalary?: number;
  requestedContractInfo?: string;
  deadlineAt?: string;
  acquisitionTimestamp?: number;
  /** Veteran extension only: years to add (1 or 2). Falls back to
   *  requestedYears - currentYears for callers that send the new total. */
  addedYears?: number;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    // 1. Authenticate
    const user = getAuthUser(request);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: JSON_HEADERS },
      );
    }

    // 2. Parse request body
    const body: DeclareRequestBody = await request.json();
    const {
      leagueId,
      playerId,
      playerName,
      franchiseId,
      franchiseName,
      type,
      currentYears,
      currentSalary,
      currentContractInfo,
      requestedYears,
      requestedSalary,
      requestedContractInfo,
      deadlineAt,
      acquisitionTimestamp,
    } = body;

    // 3. Verify franchise ownership — IN the contract league. Both leagues
    // have a franchise 0001, and declarations live in one unscoped store, so
    // a bare franchiseId match let an AFL owner declare on a TheLeague roster.
    if (!isAuthorizedForLeague(user, CONTRACT_LEAGUE_ID) || !isFranchiseOwner(user, franchiseId)) {
      return new Response(
        JSON.stringify({ error: 'You can only submit declarations for your own team' }),
        { status: 403, headers: JSON_HEADERS },
      );
    }

    // 3, continued. The player must be on THAT roster. Owning `franchiseId` is not
    // enough: the Rosters page lets any viewer SIMULATE a tag or extension on
    // another club's player, and its Submit posts every simulated declaration
    // under the viewer's own franchise — so without this, one owner could file
    // a declaration on a rival's player. Checked against the live roster (the
    // 2-minute Redis cache); when that is unavailable the check is skipped
    // rather than blocking every declaration, and the commissioner's review
    // still stands behind it.
    const rosters = await getCachedRosters(String(getCurrentLeagueYear()), CONTRACT_LEAGUE_ID);
    const onRoster = rosters?.[String(playerId)];
    if (onRoster && onRoster.franchiseId !== franchiseId) {
      return new Response(
        JSON.stringify({ error: 'That player is not on your roster' }),
        { status: 403, headers: JSON_HEADERS },
      );
    }

    // 3. Franchise tags are QUEUED, Feb 1 to Feb 14 at 8:45pm PT only
    // (Constitution § PLAYER TAGS), and written to MFL on Feb 15 by
    // scripts/apply-pending-contracts.mjs. That job writes what the
    // declaration says, so the terms are the server's own
    // (franchise-tag-server.ts), never the request body's.
    if (type === 'franchise-tag') {
      const check = await checkFranchiseTagOnServer({
        leagueId: CONTRACT_LEAGUE_ID,
        franchiseId,
        playerId: String(playerId),
      });
      if (!check.ok) {
        return new Response(JSON.stringify({ error: check.error }), { status: check.status, headers: JSON_HEADERS });
      }
      const terms = {
        currentYears: check.currentYears,
        currentSalary: check.currentSalary,
        currentContractInfo: check.currentContractInfo,
        requestedYears: check.newYears,
        requestedSalary: check.newSalary,
        requestedContractInfo: FRANCHISE_TAG_CONTRACT_INFO,
        submittedAt: new Date().toISOString(),
      };
      const pendingTag = await getPendingDeclarationForPlayer(String(playerId), franchiseId);
      let tagId: string;
      if (pendingTag && pendingTag.status === 'pending' && pendingTag.type === 'franchise-tag') {
        if (!(await updateDeclaration(pendingTag.id, terms))) {
          return new Response(JSON.stringify({ error: 'Failed to update the tag' }), { status: 500, headers: JSON_HEADERS });
        }
        tagId = pendingTag.id;
      } else {
        const declaration: ContractDeclaration = {
          id: generateDeclarationId(),
          type,
          playerId: String(playerId),
          playerName,
          franchiseId,
          franchiseName,
          leagueId: CONTRACT_LEAGUE_ID,
          ...terms,
          status: 'pending',
          submittedBy: user.name || user.id,
          mflSynced: false,
        };
        await addDeclaration(declaration);
        tagId = declaration.id;
      }
      await recordInsightAction(user, 'contract_declare');
      return new Response(
        JSON.stringify({
          success: true,
          declarationId: tagId,
          status: 'pending',
          newSalary: check.newSalary,
          newYears: check.newYears,
          message: 'Tag queued. It is written to MFL on Feb 15 as a 1-year contract.',
        }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    // 3a. Cancel-pending shortcut: selecting the same years as the current
    // contract means "revert any pending change for this player". Validation
    // would reject equal years, so handle this before validation runs.
    if (requestedYears === currentYears) {
      const existing = await getPendingDeclarationForPlayer(playerId, franchiseId);
      if (existing && existing.status === 'pending') {
        const deleted = await deleteDeclaration(existing.id);
        if (!deleted) {
          return new Response(
            JSON.stringify({ error: 'Failed to cancel pending declaration' }),
            { status: 500, headers: JSON_HEADERS },
          );
        }
      }
      return new Response(
        JSON.stringify({
          success: true,
          cancelled: true,
          message: 'Pending declaration cancelled',
        }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    // 3b. Veteran extensions have their own path: the server re-reads the
    // contract from live MFL, re-prices it from the Constitution's formula and
    // enforces one per team per league year (src/utils/veteran-extension-rules.ts).
    // Nothing from the body but the player and the years to add is used.
    if (type === 'veteran-extension') {
      const addedYears = Number(body.addedYears ?? requestedYears - currentYears);
      const outcome = await fileVeteranExtension({
        user,
        leagueId: CONTRACT_LEAGUE_ID,
        franchiseId,
        franchiseName,
        playerId: String(playerId),
        playerName,
        addedYears,
      });
      if (outcome.ok) await recordInsightAction(user, 'contract_declare');
      return new Response(JSON.stringify(outcome.body), { status: outcome.status, headers: JSON_HEADERS });
    }

    // 4. Validate basic contract rules
    const validation = validateContractSubmission(
      leagueId,
      currentYears,
      requestedYears,
      playerId,
      franchiseId,
      {
        type,
        currentContractInfo,
      },
    );

    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: 'Validation failed', details: validation.errors }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    // 5. Enforce deadline for time-limited declaration types
    if (deadlineAt) {
      const deadlineMs = new Date(deadlineAt).getTime();
      if (!isNaN(deadlineMs) && Date.now() > deadlineMs) {
        return new Response(
          JSON.stringify({ error: 'Declaration deadline has passed' }),
          { status: 400, headers: JSON_HEADERS },
        );
      }
    }

    // 6. Check for existing pending declaration — update it if found
    const existing = await getPendingDeclarationForPlayer(playerId, franchiseId);
    if (existing && existing.status === 'pending') {
      const updated = await updateDeclaration(existing.id, {
        requestedYears,
        requestedSalary,
        requestedContractInfo,
        submittedAt: new Date().toISOString(),
      });

      if (!updated) {
        return new Response(
          JSON.stringify({ error: 'Failed to update declaration' }),
          { status: 500, headers: JSON_HEADERS },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          declarationId: existing.id,
          status: 'pending',
          updated: true,
          message: 'Declaration updated',
        }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    // 7. Type-specific validations
    // Franchise tags never reach here: step 3 handles them whole.

    // Rookie extensions and 1st-round options have NO per-team limit: any
    // eligible player may take one (Brandon, 2026-11-14). Veteran extensions
    // never reach here (3b) and keep their own one-per-league-year limit.

    // 8. Create declaration
    const declaration: ContractDeclaration = {
      id: generateDeclarationId(),
      type,
      playerId,
      playerName,
      franchiseId,
      franchiseName,
      leagueId,
      currentYears,
      currentSalary,
      currentContractInfo,
      requestedYears,
      requestedSalary,
      requestedContractInfo,
      status: 'pending',
      submittedBy: user.name || user.id,
      submittedAt: new Date().toISOString(),
      mflSynced: false,
      deadlineAt,
      acquisitionTimestamp,
    };

    await addDeclaration(declaration);
    await recordInsightAction(user, 'contract_declare');

    return new Response(
      JSON.stringify({
        success: true,
        declarationId: declaration.id,
        status: 'pending',
        message: 'Declaration submitted for commissioner approval',
      }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (error) {
    console.error('Contract declaration error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
};
