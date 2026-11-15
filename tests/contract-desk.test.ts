import { describe, expect, it } from 'vitest';
import {
  deskButtonsFor,
  filterDeskDescriptors,
  groupDeskSections,
  isDeskRequest,
  plannedLabel,
  type DeskPlayer,
} from '../src/utils/rosters/contract-desk';
import { getCdmActionDescriptors, type CdmActionEligibility } from '../src/utils/cdm-action-descriptors';

const ctx = {
  isOwnTeam: true,
  autocut: () => ({ priority: 0, belowLine: false, targetActiveCount: 22 }),
  watch: { signedOut: false, watched: false },
};
const describe_ = (elig: CdmActionEligibility) => getCdmActionDescriptors({ displayTag: 'active', ...elig }, ctx);

describe('contract desk actions', () => {
  it('keeps only extend, rookie extension, tag and cut, in that order', () => {
    const vet = deskButtonsFor(describe_({ currentYears: 3 }));
    expect(vet.map((b) => b.id)).toEqual(['extension', 'cut']);
    expect(vet.map((b) => b.label)).toEqual(['Extend', 'Cut']);

    const expiring = deskButtonsFor(describe_({ currentYears: 1 }));
    expect(expiring.map((b) => b.id)).toEqual(['franchise', 'cut']);

    const rookie = deskButtonsFor(describe_({ currentYears: 3, isRookieContract: true, contractInfo: 'RC' }));
    expect(rookie.map((b) => b.id)).toEqual(['rookie-extension', 'cut']);
  });

  it('never offers the roster-only actions (IR, practice squad, watch, trade, team option, auto-cut)', () => {
    for (const elig of [
      { currentYears: 3 },
      { currentYears: 1 },
      { currentYears: 3, contractInfo: 'TO', isRookieContract: true },
      { currentYears: 2, contractInfo: 'RC', isRookieContract: true, displayTag: 'practice' },
    ]) {
      const ids = filterDeskDescriptors(describe_(elig)).map((d) => d.id);
      for (const banned of ['move-to-ir', 'move-to-practice', 'watch', 'trade', 'team-option', 'autocut-toggle', 'declare-contract']) {
        expect(ids).not.toContain(banned);
      }
    }
  });

  it('only offers a rookie extension once the contract is eligible (2+ years left)', () => {
    const lastYear = deskButtonsFor(describe_({ currentYears: 1, isRookieContract: true, contractInfo: 'RC' }));
    expect(lastYear.map((b) => b.id)).not.toContain('rookie-extension');
  });

  it('drops a disabled descriptor', () => {
    const ds = [{ id: 'extension' as const, label: 'Veteran Extension', desc: '', icon: '', disabled: true }];
    expect(filterDeskDescriptors(ds)).toEqual([]);
  });

  it('reads the desk flag from the URL', () => {
    expect(isDeskRequest(new URL('https://x.test/theleague/rosters?desk=1'))).toBe(true);
    expect(isDeskRequest(new URL('https://x.test/theleague/rosters'))).toBe(false);
    expect(isDeskRequest(null)).toBe(false);
  });

  it('names a planned action', () => {
    expect(plannedLabel('extension')).toBe('Extending');
    expect(plannedLabel('franchise')).toBe('Tagged');
    expect(plannedLabel('cut')).toBe('Cutting');
    expect(plannedLabel(null)).toBeNull();
  });
});

describe('phone sections', () => {
  const p = (id: string, salary: number, elig: CdmActionEligibility, plannedType: string | null = null): DeskPlayer => ({
    id, name: id, position: 'RB', salary, years: elig.currentYears ?? 1, descriptors: describe_(elig), plannedType,
  });

  it('sorts extensions cheapest first, tags and cuts biggest first', () => {
    const players = [
      p('vetBig', 5_000_000, { currentYears: 3 }),
      p('vetSmall', 1_200_000, { currentYears: 3 }),
      p('rookie', 475_000, { currentYears: 4, isRookieContract: true, contractInfo: 'RC' }),
      p('expA', 600_000, { currentYears: 1 }),
      p('expB', 900_000, { currentYears: 1 }),
    ];
    const s = groupDeskSections(players);
    expect(s.extend.map((x) => x.id)).toEqual(['rookie', 'vetSmall', 'vetBig']);
    expect(s.tag.map((x) => x.id)).toEqual(['expB', 'expA']);
    expect(s.cut.map((x) => x.id)).toEqual(['vetBig', 'vetSmall', 'expB', 'expA', 'rookie']);
  });

  it('keeps a planned player in his section so he can be undone', () => {
    // A tagged player's simulated contract is no longer 1 year.
    const tagged = { ...p('tagged', 600_000, { currentYears: 2 }), descriptors: [] };
    const s = groupDeskSections([{ ...tagged, plannedType: 'franchise' }]);
    expect(s.tag.map((x) => x.id)).toEqual(['tagged']);
  });
});
