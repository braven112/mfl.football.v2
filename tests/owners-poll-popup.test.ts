import { describe, expect, it } from 'vitest';
import { POPUP_INTERVAL_DAYS, popupReason, popupStorageKey } from '../src/utils/owners-poll-popup';

const now = new Date('2026-10-11T12:00:00Z');
const base = { status: 'open', hasBallot: false, stale: false, lastShownAt: null, now };

describe('owners poll homepage pop-up', () => {
  it('asks an owner with no ballot', () => {
    expect(popupReason(base)).toBe('no-ballot');
  });

  it('asks an owner whose ballot has gone stale', () => {
    expect(popupReason({ ...base, hasBallot: true, stale: true })).toBe('stale');
  });

  it('never asks an owner with a current ballot', () => {
    expect(popupReason({ ...base, hasBallot: true, stale: false })).toBeNull();
  });

  it('never asks while the poll is paused', () => {
    expect(popupReason({ ...base, status: 'paused' })).toBeNull();
    expect(popupReason({ ...base, status: undefined })).toBeNull();
  });

  it('shows at most once per interval on a device', () => {
    const day = 86400 * 1000;
    const recent = new Date(now.getTime() - (POPUP_INTERVAL_DAYS * day - 1)).toISOString();
    const old = new Date(now.getTime() - POPUP_INTERVAL_DAYS * day).toISOString();
    expect(popupReason({ ...base, lastShownAt: recent })).toBeNull();
    expect(popupReason({ ...base, lastShownAt: old })).toBe('no-ballot');
  });

  it('treats an unreadable stamp as never shown', () => {
    expect(popupReason({ ...base, lastShownAt: 'garbage' })).toBe('no-ballot');
  });

  it('keeps each league on its own schedule', () => {
    expect(popupStorageKey('theleague')).not.toBe(popupStorageKey('afl-fantasy'));
  });
});
