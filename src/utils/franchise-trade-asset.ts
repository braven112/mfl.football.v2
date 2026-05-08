/**
 * Format an MFL asset code (player ID, DP_*, FP_*, CASH, BBID*) into a
 * human-readable label for franchise-history trade ledgers.
 *
 * Used by the rivalries page and the franchise detail page. The shapes here
 * are intentionally narrower than the trade-builder's parsing utilities:
 * the franchise-history pages only need a one-shot text label, no asset
 * type discrimination or reverse lookup.
 */

export type PlayerNameLookup = Record<
  string,
  { name: string; position?: string; team?: string }
>;

export type FranchiseShortNameLookup = (franchiseId: string) => string;

export function formatTradeAsset(
  code: string,
  playerNames: PlayerNameLookup,
  franchiseShortName: FranchiseShortNameLookup
): string {
  const fp = code.match(/^FP_(\d{4})_(\d{4})_(\d+)$/);
  if (fp) {
    const [, fid, yr, rnd] = fp;
    return `${yr} R${rnd} pick (via ${franchiseShortName(fid)})`;
  }
  const dp = code.match(/^DP_(\d+)_(\d+)$/);
  if (dp) {
    const [, rnd, pick] = dp;
    return `Draft pick R${Number(rnd) + 1}.${Number(pick) + 1}`;
  }
  if (code === 'CASH') return 'Salary cap cash';
  if (code.startsWith('BBID')) return 'BBID balance';
  if (/^\d+$/.test(code)) {
    const meta = playerNames[code];
    if (meta) return `${meta.name}${meta.position ? ` (${meta.position})` : ''}`;
    return `Player #${code}`;
  }
  return code;
}
