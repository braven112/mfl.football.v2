/**
 * The CDM's step-1 action list, per contract state.
 *
 * `getCdmActionDescriptors` is the ONE list of which actions a player has: the
 * Contract Declaration Modal renders it (cdm-wizard.ts) and the roster's player
 * sheet reads it (src/utils/rosters/phone-sheet.ts). The rendered buttons are
 * fingerprinted end to end by scripts/cdm-parity-check.mjs; this pins the
 * decision table itself, fast, on every edit.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  getCdmActionDescriptors,
  CDM_CONTRACT_ACTION_IDS,
  type CdmActionContext,
  type CdmActionEligibility,
} from '../src/utils/cdm-action-descriptors';

const ctx = (over: Partial<CdmActionContext> = {}): CdmActionContext => ({
  isOwnTeam: false,
  autocut: () => null,
  watch: { signedOut: false, watched: false },
  ...over,
});
const ids = (elig: CdmActionEligibility, c = ctx()) => getCdmActionDescriptors(elig, c).map((d) => d.id);

describe('contract actions by contract state', () => {
  it('a standard 1-year contract gets the Franchise Tag only', () => {
    expect(ids({ currentYears: 1, contractInfo: '' })).toEqual(['franchise', 'watch', 'cut', 'trade']);
  });

  it('a standard multi-year contract gets the Veteran Extension', () => {
    expect(ids({ currentYears: 3, contractInfo: '' })).toEqual(['extension', 'watch', 'cut', 'trade']);
  });

  it('a rookie contract (RC) gets the Rookie Extension, never the veteran one', () => {
    expect(ids({ currentYears: 3, contractInfo: 'RC', isRookieContract: true }))
      .toEqual(['rookie-extension', 'watch', 'cut', 'trade']);
  });

  it('a team-option contract with 2+ years gets Team Option and Rookie Extension', () => {
    expect(ids({ currentYears: 2, contractInfo: 'TO' }))
      .toEqual(['team-option', 'rookie-extension', 'watch', 'cut', 'trade']);
  });

  it('a TO in its final year gets no tag at all (the option window has closed)', () => {
    expect(ids({ currentYears: 1, contractInfo: 'TO' })).toEqual(['watch', 'cut', 'trade']);
  });

  it('declare-contract leads when a declaration window is open, with the year range', () => {
    const [first] = getCdmActionDescriptors(
      { currentYears: 1, declareType: 'new-acquisition', declareYearOptions: [1, 2, 3] },
      ctx(),
    );
    expect(first).toMatchObject({ id: 'declare-contract', desc: 'Set initial contract length (1–3 years)' });
    const [rookie] = getCdmActionDescriptors({ currentYears: 3, declareType: 'rookie-override' }, ctx());
    expect(rookie.desc).toBe('Set rookie contract length (1–4 years)');
    const [single] = getCdmActionDescriptors({ currentYears: 1, declareType: 'new-acquisition', declareYearOptions: [2] }, ctx());
    expect(single.desc).toBe('Set initial contract length (2 years)');
  });
});

describe('roster moves are the owner’s alone', () => {
  const own = ctx({ isOwnTeam: true });

  it('none on another team', () => {
    expect(ids({ currentYears: 2, contractInfo: 'RC', isRookieContract: true, displayTag: 'active' }))
      .not.toContain('move-to-ir');
  });

  it('active rookie: IR and practice squad', () => {
    expect(ids({ currentYears: 3, contractInfo: 'RC', isRookieContract: true, displayTag: 'active' }, own))
      .toEqual(['rookie-extension', 'move-to-ir', 'move-to-practice', 'watch', 'cut', 'trade']);
  });

  it('injured: activate', () => {
    expect(ids({ currentYears: 3, contractInfo: '', displayTag: 'injured' }, own))
      .toEqual(['extension', 'activate-from-ir', 'watch', 'cut', 'trade']);
  });

  it('practice-squad rookie: promote, and still IR', () => {
    expect(ids({ currentYears: 3, contractInfo: 'TO', displayTag: 'practice' }, own))
      .toEqual(['team-option', 'rookie-extension', 'promote-from-practice', 'move-to-ir', 'watch', 'cut', 'trade']);
  });
});

describe('August auto-cut', () => {
  it('is asked only for an active player on the owner’s team', () => {
    let asked = 0;
    const autocut = () => { asked += 1; return null; };
    getCdmActionDescriptors({ currentYears: 2, displayTag: 'active' }, ctx({ autocut }));
    getCdmActionDescriptors({ currentYears: 2, displayTag: 'injured' }, ctx({ isOwnTeam: true, autocut }));
    expect(asked).toBe(0);
    getCdmActionDescriptors({ currentYears: 2, displayTag: 'active' }, ctx({ isOwnTeam: true, autocut }));
    expect(asked).toBe(1);
  });

  it('offers to mark, then to unmark with the priority and the cut-line caveat', () => {
    const mark = getCdmActionDescriptors(
      { currentYears: 2, displayTag: 'active' },
      ctx({ isOwnTeam: true, autocut: () => ({ priority: 0, belowLine: false, targetActiveCount: 22 }) }),
    ).find((d) => d.id === 'autocut-toggle');
    expect(mark).toMatchObject({ label: 'Mark for August auto-cut', desc: "Cut automatically at the deadline if you're over 22" });

    const unmark = getCdmActionDescriptors(
      { currentYears: 2, displayTag: 'active' },
      ctx({ isOwnTeam: true, autocut: () => ({ priority: 3, belowLine: true, targetActiveCount: 22 }) }),
    ).find((d) => d.id === 'autocut-toggle');
    expect(unmark?.label).toBe('Unmark auto-cut');
    expect(unmark?.desc).toBe('Priority #3 in your cut order — below the cut line, safe unless your roster grows — click to remove');
  });
});

describe('watch follows the viewer', () => {
  it('signed out, watched and unwatched copy', () => {
    const w = (watch: CdmActionContext['watch']) =>
      getCdmActionDescriptors({ currentYears: 2 }, ctx({ watch })).find((d) => d.id === 'watch');
    expect(w({ signedOut: true, watched: false })).toMatchObject({ label: 'Watch player', desc: 'Sign in to build your watch list', icon: 'icon-eye' });
    expect(w({ signedOut: false, watched: true })).toMatchObject({ label: 'Stop watching', icon: 'icon-eye-slash' });
  });
});

describe('the contract ids', () => {
  it('are exactly the descriptor ids the Salary tab lists under Extend or tag', () => {
    expect([...CDM_CONTRACT_ACTION_IDS]).toEqual(['declare-contract', 'franchise', 'team-option', 'extension', 'rookie-extension']);
  });
});

describe('one list, not two', () => {
  const wizard = readFileSync('src/utils/cdm-wizard.ts', 'utf8');
  it('the CDM renders from the descriptor function', () => {
    expect(wizard).toContain('getCdmActionDescriptors(');
  });
  it('the CDM no longer builds a step-1 option by hand', () => {
    // A hand-built step-1 button back in the wizard is a second copy of the
    // list, and the sheet would stop agreeing with the ⋮ menu.
    expect(wizard).not.toMatch(
      /makeCdmActionBtn\(\s*'(declare-contract|franchise|team-option|extension|rookie-extension|move-to-ir|move-to-practice|activate-from-ir|promote-from-practice|autocut-toggle|watch|cut|trade)',/,
    );
  });
});
