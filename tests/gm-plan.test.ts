/**
 * The GM office plan (src/utils/rosters/gm-plan.ts): which simulated moves an
 * owner can submit, the order they are filed in, what each says it does, and
 * how a saved plan is cleaned and checked on the way back.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  declarationTypeFor,
  gmPlanKey,
  MAX_PLAN_MOVES,
  planToSave,
  restorablePlan,
  sanitizeSavedPlan,
  submitOutcome,
  submittableMoves,
} from '../src/utils/rosters/gm-plan';
import { toDeclarationRequest } from '../src/utils/contract-actions-client';

const OWN = '0001';
const move = (playerId: string, type: string, franchiseId = OWN, extra: Record<string, unknown> = {}) => ({
  playerId,
  type,
  franchiseId,
  playerName: `Player ${playerId}`,
  originalSalary: 1_000_000,
  originalYears: 2,
  newSalary: 2_000_000,
  newYears: 3,
  ...extra,
});

describe('submittableMoves', () => {
  // Inside the Feb 1-14 tagging period, so tags are submittable.
  const FEB = new Date('2027-02-10T20:00:00Z');
  it('files only the owner’s own tags, extensions, options and cuts', () => {
    const actions = {
      a: move('1', 'franchise'),
      b: move('2', 'extension'),
      c: move('3', 'rookie-extension'),
      d: move('4', 'team-option'),
      e: move('5', 'cut'),
      f: move('6', 'trade'),
      g: move('7', 'franchise', '0002'),
    };
    const ids = submittableMoves(actions, OWN, FEB).map((m) => m.playerId);
    expect(ids.sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('files contract paperwork, then the veteran extension, cuts LAST', () => {
    const actions = {
      a: move('1', 'cut'),
      b: move('2', 'extension'),
      c: move('3', 'cut'),
      d: move('4', 'franchise'),
      e: move('5', 'team-option'),
    };
    const types = submittableMoves(actions, OWN, FEB).map((m) => m.type);
    expect(types).toEqual(['franchise', 'team-option', 'extension', 'cut', 'cut']);
  });

  it('files nothing without a signed-in owner', () => {
    expect(submittableMoves({ a: move('1', 'cut') }, null)).toEqual([]);
  });
});

describe('what each move says it does', () => {
  it('marks a cut and a veteran extension as final and the rest as pending approval', () => {
    expect(submitOutcome('cut').tone).toBe('final');
    expect(submitOutcome('cut').text).toMatch(/can’t be undone/);
    expect(submitOutcome('extension').tone).toBe('final');
    expect(submitOutcome('extension').text).toMatch(/MFL/);
    for (const t of ['rookie-extension', 'team-option']) {
      expect(submitOutcome(t).tone).toBe('pending');
      expect(submitOutcome(t).text).toMatch(/MFL within 30 minutes/);
    }
    expect(submitOutcome('trade').tone).toBe('none');
  });

  // Constitution: tags are declared Feb 1 to Feb 14 at 8:45pm PT, written Feb 15.
  const TAG_PERIOD = new Date('2027-02-10T20:00:00Z');
  const NOVEMBER = new Date('2026-11-15T20:00:00Z');

  it('says a tag is queued in Feb 1-14 and written on Feb 15', () => {
    expect(submitOutcome('franchise', TAG_PERIOD).tone).toBe('pending');
    expect(submitOutcome('franchise', TAG_PERIOD).text).toMatch(/Feb 15/);
  });

  it('keeps a tag in the plan, unfiled, outside Feb 1-14', () => {
    expect(submitOutcome('franchise', NOVEMBER).tone).toBe('none');
    expect(submitOutcome('franchise', NOVEMBER).text).toMatch(/Feb 1 to Feb 14/);
    const actions = { a: move('1', 'franchise'), b: move('2', 'cut') };
    expect(submittableMoves(actions, OWN, NOVEMBER).map((m) => m.type)).toEqual(['cut']);
    expect(submittableMoves(actions, OWN, TAG_PERIOD).map((m) => m.type)).toEqual(['franchise', 'cut']);
  });

  it('maps every paperwork move to the declaration type the API files', () => {
    expect(declarationTypeFor('franchise')).toBe('franchise-tag');
    expect(declarationTypeFor('extension')).toBe('veteran-extension');
    expect(declarationTypeFor('rookie-extension')).toBe('rookie-extension');
    expect(declarationTypeFor('team-option')).toBe('team-option');
    expect(declarationTypeFor('cut')).toBeNull();
  });
});

describe('toDeclarationRequest files rookie extensions and 1st-round options', () => {
  const ctx = { leagueId: 'L', franchiseId: OWN, franchiseName: 'Club' };
  it('a rookie extension clears the RC designation', () => {
    const body = toDeclarationRequest(
      { ...move('9', 'rookie-extension'), originalContractInfo: 'RC' } as any,
      ctx,
    );
    expect(body.type).toBe('rookie-extension');
    expect(body.requestedContractInfo).toBe('');
    expect(body.requestedYears).toBe(3);
    expect(body.currentContractInfo).toBe('RC');
  });
  it('a 1st-round option carries the TO designation the API checks', () => {
    const body = toDeclarationRequest({ ...move('9', 'team-option'), originalContractInfo: 'TO' } as any, ctx);
    expect(body.type).toBe('team-option');
    expect(body.currentContractInfo).toBe('TO');
    expect(body.requestedContractInfo).toBe('');
  });
});

describe('saving a plan', () => {
  it('keeps only the owner’s own plan moves', () => {
    const actions = { a: move('1', 'cut'), b: move('2', 'trade'), c: move('3', 'franchise', '0002') };
    expect(planToSave(actions, OWN).map((m) => m.playerId)).toEqual(['1', '2']);
  });

  it('cleans what the store receives: the session’s franchise, known types, numeric fields only', () => {
    const cleaned = sanitizeSavedPlan(
      [
        { ...move('1', 'cut'), franchiseId: '0009', evil: '<script>' },
        { ...move('1', 'cut') }, // duplicate player
        { ...move('abc', 'cut') }, // not a player id
        { ...move('2', 'delete-everything') },
        { ...move('3', 'extension'), newSalary: 'NaN' },
      ],
      OWN,
    );
    expect(cleaned.map((m) => m.playerId)).toEqual(['1', '3']);
    expect(cleaned[0].franchiseId).toBe(OWN);
    expect(cleaned[0]).not.toHaveProperty('evil');
    expect(cleaned[1]).not.toHaveProperty('newSalary');
  });

  it('caps a plan’s size', () => {
    const many = Array.from({ length: MAX_PLAN_MOVES + 10 }, (_, i) => move(String(i + 1), 'cut'));
    expect(sanitizeSavedPlan(many, OWN)).toHaveLength(MAX_PLAN_MOVES);
  });

  it('scopes the key by league, because both leagues have a franchise 0001', () => {
    expect(gmPlanKey('theleague', OWN)).not.toBe(gmPlanKey('afl-fantasy', OWN));
  });
});

describe('restoring a plan', () => {
  it('keeps a move only while the contract it was priced against is unchanged', () => {
    const saved = [move('1', 'cut'), move('2', 'extension'), move('3', 'franchise')];
    const roster = [
      { id: '1', salary: 1_000_000, contractYears: 2 }, // unchanged
      { id: '2', salary: 1_100_000, contractYears: 2 }, // salary moved
      // '3' is no longer on the roster
    ];
    const { moves, dropped } = restorablePlan(saved, roster);
    expect(moves.map((m) => m.playerId)).toEqual(['1']);
    expect(dropped).toBe(2);
  });
});

describe('the API is owner-only', () => {
  const route = fs.readFileSync('src/pages/api/gm-plan.ts', 'utf8');
  it('takes the franchise and league from the session, never the request', () => {
    expect(route).toMatch(/getAuthUser\(request\)/);
    expect(route).toMatch(/gmPlanKey\(league\.slug, user\.franchiseId\)/);
    expect(route).not.toMatch(/searchParams\.get\('franchise/);
  });
});

describe('rookie extensions and 1st-round options have no team limit', () => {
  it('the declare route caps only the tag and the veteran extension (Brandon, 2026-11-14)', () => {
    const route = fs.readFileSync('src/pages/api/contracts/declare.ts', 'utf8');
    expect(route).not.toMatch(/getTeamExtension\(/);
    expect(route).not.toMatch(/already used its extension this season/);
  });
});
