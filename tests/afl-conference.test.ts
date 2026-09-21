import { describe, it, expect } from 'vitest';
import {
  getConferenceName,
  getConferenceShort,
  getConferenceLogo,
  getConferenceIdByName,
  isValidConferenceId,
  getFranchiseConference,
  getConferenceTeams,
  getAllTeams,
  sameConference,
  getTeamsGroupedByConference,
  conferenceOrder,
  filterByConference,
} from '../src/utils/afl-conference';

describe('afl-conference', () => {
  it('maps 00 to American League and 01 to National League', () => {
    expect(getConferenceName('00')).toBe('American League');
    expect(getConferenceName('01')).toBe('National League');
    expect(getConferenceShort('00')).toBe('AL');
    expect(getConferenceShort('01')).toBe('NL');
  });

  it('resolves the branded conference logo path (lowercase short code)', () => {
    expect(getConferenceLogo('00')).toBe('/assets/afl/conferences/al.svg');
    expect(getConferenceLogo('01')).toBe('/assets/afl/conferences/nl.svg');
  });

  it('round-trips conference name <-> id', () => {
    expect(getConferenceIdByName('American League')).toBe('00');
    expect(getConferenceIdByName('National League')).toBe('01');
  });

  it('isValidConferenceId only accepts 00 / 01', () => {
    expect(isValidConferenceId('00')).toBe(true);
    expect(isValidConferenceId('01')).toBe(true);
    expect(isValidConferenceId('02')).toBe(false);
    expect(isValidConferenceId('')).toBe(false);
    expect(isValidConferenceId('AL')).toBe(false);
  });

  it('returns conference for a known franchise', () => {
    // Smokane FC (0001) is in the American League per afl.config.json
    expect(getFranchiseConference('0001')).toBe('00');
    // Muck Juggling Micks (0013) is in the National League
    expect(getFranchiseConference('0013')).toBe('01');
  });

  it('returns null for unknown franchise', () => {
    expect(getFranchiseConference('9999')).toBeNull();
  });

  it('splits the league exactly 12/12', () => {
    expect(getConferenceTeams('00')).toHaveLength(12);
    expect(getConferenceTeams('01')).toHaveLength(12);
    expect(getAllTeams()).toHaveLength(24);
  });

  it('sameConference is true within and false across leagues', () => {
    expect(sameConference('0001', '0002')).toBe(true); // both AL
    expect(sameConference('0013', '0014')).toBe(true); // both NL
    expect(sameConference('0001', '0013')).toBe(false); // AL vs NL
  });

  it('sameConference returns false when either franchise is unknown', () => {
    expect(sameConference('0001', '9999')).toBe(false);
    expect(sameConference('9999', '9998')).toBe(false);
  });

  it('groups teams AL first then NL', () => {
    const groups = getTeamsGroupedByConference();
    expect(groups).toHaveLength(2);
    expect(groups[0].conferenceId).toBe('00');
    expect(groups[0].conferenceName).toBe('American League');
    expect(groups[1].conferenceId).toBe('01');
    expect(groups[1].conferenceName).toBe('National League');
  });

  it('filterByConference filters items keyed by franchiseId or id', () => {
    const items = [
      { franchiseId: '0001', n: 'a' },
      { franchiseId: '0013', n: 'b' },
      { franchiseId: '0014', n: 'c' },
    ];
    expect(filterByConference(items, '00')).toEqual([{ franchiseId: '0001', n: 'a' }]);
    expect(filterByConference(items, '01')).toHaveLength(2);

    const itemsById = [{ id: '0001' }, { id: '0014' }];
    expect(filterByConference(itemsById, '00')).toEqual([{ id: '0001' }]);
  });
});

/**
 * The roster header's team switcher leads with the VIEWER's own conference.
 * Two things are load-bearing and neither is visible from the call site:
 * a viewer who has chosen nothing must see the historical AL-then-NL order,
 * and the argument is the viewer's conference rather than the conference of
 * the club being viewed — otherwise the row reshuffles on every team switch.
 */
describe('conference order leads with the viewer’s own', () => {
  it('puts the National League first for an NL viewer', () => {
    expect(conferenceOrder('01')).toEqual(['01', '00']);
    expect(getTeamsGroupedByConference('01').map((g) => g.conferenceId)).toEqual(['01', '00']);
  });

  it('puts the American League first for an AL viewer', () => {
    expect(conferenceOrder('00')).toEqual(['00', '01']);
    expect(getTeamsGroupedByConference('00').map((g) => g.conferenceId)).toEqual(['00', '01']);
  });

  it('keeps the historical AL-first order for a viewer with no conference', () => {
    // Signed out, or signed into the other league: franchiseIdForLeague
    // returns null and the caller passes it straight through.
    for (const none of [undefined, null]) {
      expect(conferenceOrder(none)).toEqual(['00', '01']);
      expect(getTeamsGroupedByConference(none).map((g) => g.conferenceId)).toEqual(['00', '01']);
    }
  });

  it('never drops or duplicates a club, whichever order it returns', () => {
    for (const viewer of ['00', '01', null] as const) {
      const ids = getTeamsGroupedByConference(viewer).flatMap((g) => g.teams.map((t) => t.franchiseId));
      expect(ids).toHaveLength(getAllTeams().length);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
