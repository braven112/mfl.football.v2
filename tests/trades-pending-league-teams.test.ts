/**
 * Regression: /api/trades/pending must resolve franchise names against the
 * league the authenticated session belongs to. Franchise IDs overlap between
 * leagues (AFL 0003 = Team Minty Fresh, TheLeague 0003 = Maverick), so a
 * league-blind lookup shows the wrong team name/icon on the other site —
 * an AFL owner's offer to Minty Fresh rendered as "Maverick" in the trade
 * alert modal (July 2026).
 */
import { describe, it, expect } from 'vitest';
import { getTeamMaps } from '../src/pages/api/trades/pending';
import { LEAGUES } from '../src/config/leagues';

describe('trades/pending per-league team maps', () => {
  it('resolves AFL franchise IDs to AFL team names', () => {
    const { teamLookup } = getTeamMaps(LEAGUES['afl-fantasy'].id);
    expect(teamLookup.get('0003')?.name).toBe('Team Minty Fresh');
    expect(teamLookup.get('0001')?.name).toBe('Smokane FC');
  });

  it('resolves TheLeague franchise IDs to TheLeague team names', () => {
    const { teamLookup } = getTeamMaps(LEAGUES.theleague.id);
    expect(teamLookup.get('0003')?.name).toBe('Maverick');
    expect(teamLookup.get('0001')?.name).toBe('Pacific Pigskins');
  });

  it('falls back to TheLeague maps for unknown league ids', () => {
    const { teamLookup } = getTeamMaps('99999');
    expect(teamLookup.get('0001')?.name).toBe('Pacific Pigskins');
  });

  it('builds name → franchiseId maps for proposer description parsing', () => {
    const afl = getTeamMaps(LEAGUES['afl-fantasy'].id);
    expect(afl.teamNameMap.get('team minty fresh')).toBe('0003');
    const theleague = getTeamMaps(LEAGUES.theleague.id);
    expect(theleague.teamNameMap.get('pacific pigskins')).toBe('0001');
  });
});
