/**
 * Owner trade-report normalization.
 *
 * MFL's owner-view `pendingTrades` payload omits the `franchise` (originator)
 * field. The rumor scanner reads `raw.franchise` and pads to 4 digits; if
 * we don't infer the originator before we hand the row off, the scanner
 * stamps the offer with `'0000'` and the admin archive surfaces it as
 * "Team 0000 → <real partner>". Pin the resolver so that bug can't come
 * back.
 */
import { describe, it, expect } from 'vitest';
import { resolveOriginatorFid } from '../src/utils/owner-trade-reports';

describe('resolveOriginatorFid (owner-view pendingTrades)', () => {
  it('uses raw.franchise when present', () => {
    const raw = { franchise: '0007', offeredto: '0001' };
    expect(resolveOriginatorFid(raw, '0001')).toBe('0007');
  });

  it('zero-pads a present-but-short franchise id', () => {
    const raw = { franchise: '7', offeredto: '0001' };
    expect(resolveOriginatorFid(raw, '0001')).toBe('0007');
  });

  it('returns the reporter id when the reporter is the originator (offeredto != reporter)', () => {
    // Reporter (0001) sent the offer to 0003. MFL omits `franchise` in owner view.
    const raw = { offeredto: '0003', will_give_up: 'A', will_receive: 'B' };
    expect(resolveOriginatorFid(raw, '0001')).toBe('0001');
  });

  it('parses the description when the reporter is the recipient', () => {
    // Reporter (0001) is the recipient; description names the proposer.
    const raw = {
      offeredto: '0001',
      description: 'Maverick proposed a trade to Pacific Pigskins',
    };
    // Maverick is franchiseId 0003 in theleague.config.json.
    expect(resolveOriginatorFid(raw, '0001')).toBe('0003');
  });

  it('falls back to empty string when description name does not match a team', () => {
    const raw = {
      offeredto: '0001',
      description: 'Phantom Squad proposed a trade to Pacific Pigskins',
    };
    expect(resolveOriginatorFid(raw, '0001')).toBe('');
  });

  it('does NOT collapse to 0000 when raw.franchise is empty', () => {
    // The historical bug: scanner reads '' and pads to '0000'. The resolver
    // must produce a real fid (or empty) so `'0000'` never leaks downstream.
    const raw = { offeredto: '0003', will_give_up: 'A', will_receive: 'B' };
    expect(resolveOriginatorFid(raw, '0001')).not.toBe('0000');
  });

  it('handles short reporter id by padding before comparison', () => {
    const raw = { offeredto: '0003' };
    expect(resolveOriginatorFid(raw, '1')).toBe('0001');
  });
});
