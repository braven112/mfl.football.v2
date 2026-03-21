/**
 * POST /api/contracts/declare
 *
 * Submit a contract declaration for commissioner approval.
 * Requires authentication as the franchise owner.
 */

import type { APIRoute } from 'astro';
import { getAuthUser, isFranchiseOwner } from '../../../utils/auth';
import { validateContractSubmission } from '../../../utils/contract-validation';
import {
  generateDeclarationId,
  addDeclaration,
  updateDeclaration,
  getPendingDeclarationForPlayer,
  getTeamFranchiseTag,
  getTeamExtension,
} from '../../../utils/contract-storage';
import type { ContractDeclaration } from '../../../types/contracts';
import type { DeclarationType } from '../../../types/contract-eligibility';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

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

    // 3. Verify franchise ownership
    if (!isFranchiseOwner(user, franchiseId)) {
      return new Response(
        JSON.stringify({ error: 'You can only submit declarations for your own team' }),
        { status: 403, headers: JSON_HEADERS },
      );
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

    // 5. Check for existing pending declaration — update it if found
    const existing = await getPendingDeclarationForPlayer(playerId, franchiseId);
    if (existing && existing.status === 'pending') {
      await updateDeclaration(existing.id, {
        requestedYears,
        requestedSalary,
        requestedContractInfo,
        submittedAt: new Date().toISOString(),
      });

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

    // 6. Type-specific validations
    if (type === 'franchise-tag') {
      const existingTag = await getTeamFranchiseTag(franchiseId, new Date().getFullYear());
      if (existingTag) {
        return new Response(
          JSON.stringify({ error: 'Your team has already used its franchise tag this year' }),
          { status: 400, headers: JSON_HEADERS },
        );
      }
    }

    // team-option counts as an extension (exercise or rookie extension both use the same limit)
    if (type === 'veteran-extension' || type === 'rookie-extension' || type === 'team-option') {
      const existingExt = await getTeamExtension(franchiseId, new Date().getFullYear());
      if (existingExt) {
        return new Response(
          JSON.stringify({ error: 'Your team has already used its extension this season' }),
          { status: 400, headers: JSON_HEADERS },
        );
      }
    }

    // 7. Create declaration
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

    return new Response(
      JSON.stringify({
        success: true,
        declarationId: declaration.id,
        status: 'pending',
        message: 'Declaration submitted — pending commissioner apply',
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
