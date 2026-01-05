import type { TeamCapSituation } from '../types/auction-predictor';

/**
 * Compute league-wide free agent spending envelope.
 *
 * @param teams Team cap situations (must include projectedCapSpace2026 and rosterSize)
 * @param targetActive Target active roster size (defaults to 22)
 * @param reservePerTeam Amount to hold back per team for draft/in-season moves (defaults to $5M)
 */
export function computeLeagueFAEnvelope(
  teams: (TeamCapSituation & { rosterSize?: number })[],
  targetActive: number = 22,
  reservePerTeam: number = 5_000_000
) {
  const totalTeams = teams.length || 1;
  const totalReserve = reservePerTeam * totalTeams;

  const availableCap = teams.reduce((sum, team) => {
    const afterReserve = (team.projectedCapSpace2026 ?? 0) - reservePerTeam;
    return sum + Math.max(0, afterReserve);
  }, 0);

  const openSlots = teams.reduce((sum, team) => {
    const size = team.rosterSize ?? 0;
    return sum + Math.max(0, targetActive - size);
  }, 0);

  return {
    totalTeams,
    reservePerTeam,
    totalReserve,
    availableCap,
    openSlots,
    capPerOpenSlot: openSlots > 0 ? availableCap / openSlots : 0,
  };
}
