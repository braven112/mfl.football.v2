import { describe, it, expect } from 'vitest';
import {
  getConferenceName,
  getConferenceShort,
  getConferenceIdByName,
  isValidConferenceId,
  getFranchiseConference,
  getConferenceTeams,
  getAllTeams,
  sameConference,
  getTeamsGroupedByConference,
  filterByConference,
} from '../src/utils/afl-conference';

describe('afl-conference', () => {
  it('maps 00 to American League and 01 to National League', () => {
    expect(getConferenceName('00')).toBe('American League');
    expect(getConferenceName('01')).toBe('National League');
    expect(getConferenceShort('00')).toBe('AL');
    expect(getConferenceShort('01')).toBe('NL');
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
