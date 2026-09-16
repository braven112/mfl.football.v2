import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isApprovalQueueRow,
  isLockoutImpersonationError,
} from '../scripts/lib/pending-trade-rows.mjs';

/**
 * The pending-trade lane announces an ACCEPTED trade awaiting commish approval
 * as nearly done. It read nothing for months: FRANCHISE_ID=0000 is an
 * impersonation, and both leagues run with commissioner lockout on. And once it
 * could read, it would have posted an AFL trade through TheLeague's bot.
 */

const scanner = readFileSync('scripts/schefter-scan.mjs', 'utf8');
const lane = scanner.slice(
  scanner.indexOf('async function scanPendingTrades('),
  scanner.indexOf('// ── Schefter Rumor Mill: Trade-Bait Detector'),
);

describe('isApprovalQueueRow', () => {
  it('accepts the commissioner-view shape', () => {
    expect(isApprovalQueueRow({
      id: '123', franchise: '0003', franchise2: '0017',
      franchise1_gave_up: '13604,', franchise2_gave_up: 'FP_0017_2027_1,',
    })).toBe(true);
  });

  it('rejects an owner-view open proposal, however its fields are filled', () => {
    expect(isApprovalQueueRow({
      trade_id: '124', offeredto: '0017', will_give_up: '13604,', will_receive: '15001,',
      description: 'Team A proposed a trade to Team B',
    })).toBe(false);
    expect(isApprovalQueueRow({
      trade_id: '125', franchise: '0003', franchise2: '0017', offeredto: '0017',
      franchise1_gave_up: '13604,', will_give_up: '13604,',
    })).toBe(false);
  });

  it('rejects rows missing a side', () => {
    expect(isApprovalQueueRow({ id: '1', franchise: '0003', franchise1_gave_up: 'x' })).toBe(false);
    expect(isApprovalQueueRow(null)).toBe(false);
  });
});

describe('isLockoutImpersonationError', () => {
  it('matches the error MFL actually returned on every scan', () => {
    expect(isLockoutImpersonationError({ $t: 'Commissioner can not impersonate another franchise with lockout on.' })).toBe(true);
    expect(isLockoutImpersonationError({ $t: 'Invalid league' })).toBe(false);
  });
});

describe('scanPendingTrades is scoped to the scanned league', () => {
  it('posts through the league\'s own Schefter bot', () => {
    expect(lane).toContain('league.groupMeSchefterBotId');
    expect(lane).not.toMatch(/process\.env\.GROUPME_SCHEFTER_BOT_ID/);
  });

  it('tags posts with the scanned league, never a literal', () => {
    expect(lane).not.toMatch(/leagueSlug\s*=\s*['"]theleague['"]/);
  });

  it('uses the league\'s own MFL year clock', () => {
    expect(lane).toContain('leagueYearFor(league');
    expect(lane).not.toMatch(/getMonth\(\)\s*>=\s*1/);
  });

  it('filters every row through isApprovalQueueRow and retries without impersonation on lockout', () => {
    const fetcher = scanner.slice(
      scanner.indexOf('async function fetchPendingCommishTrades('),
      scanner.indexOf('/** Build the natural-language asset phrase'),
    );
    expect(fetcher).toContain('filter(isApprovalQueueRow)');
    expect(fetcher).toMatch(/if \(result\.lockout\)[\s\S]*readPendingTradesExport\([^)]*null\)/);
  });
});
