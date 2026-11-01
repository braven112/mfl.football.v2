/**
 * The "if he scores" card — what a red-zone drive is worth, league by league.
 *
 * It hangs under the red-zone banner, on the right, for as long as the drive
 * lasts. One row per player per league: the viewer's win chance now (grey) and
 * the change if he scores (green for the viewer's own player, amber striped
 * for an opponent's). The numbers come priced from the server
 * (`attachDriveStakes`); this only draws them.
 *
 * Like the banner it is a persistent STATE with one entrance and no further
 * motion, and it is not a live region: the island's announcer already speaks
 * the drive's start and end once each.
 */

import { memo } from 'react';
import type { RedZoneAlert } from '../../../utils/broadcast-moments';
import { rankedStakes, stakeSwing } from '../../../utils/broadcast-drive-stakes';

interface Props {
  alerts: readonly RedZoneAlert[];
}

/** More rows than this cannot be read from the sofa; the rest are counted. */
const MAX_ROWS = 4;

const pct = (x: number) => `${Math.round(x * 100)}%`;

function DriveStakesCard({ alerts }: Props) {
  const rows = rankedStakes(alerts);
  if (rows.length === 0) return null;

  const shown = rows.slice(0, MAX_ROWS);
  const helps = new Set(rows.filter((r) => stakeSwing(r.stake) > 0).map((r) => r.leagueId)).size;
  const hurts = new Set(rows.filter((r) => stakeSwing(r.stake) < 0).map((r) => r.leagueId)).size;
  const players = new Set(rows.map((r) => r.playerId));
  const pronoun = players.size === 1 ? 'he scores' : 'they score';

  return (
    <aside className="lbc__stakes" aria-hidden="true">
      <p className="lbc__stakes-kick">If {pronoun}</p>
      {players.size === 1 && <p className="lbc__stakes-who">{rows[0].playerName}</p>}
      <p className="lbc__stakes-sum">{summary(helps, hurts)}</p>
      <ul className="lbc__stakes-rows">
        {shown.map((r) => {
          const swing = stakeSwing(r.stake);
          const up = swing > 0;
          const lo = Math.min(r.stake.before, r.stake.after);
          return (
            <li key={`${r.leagueId}:${r.playerId}`} className="lbc__stakes-row" data-dir={up ? 'up' : 'down'}>
              <span className="lbc__stakes-label">
                <span className="lbc__stakes-league">{r.leagueName}</span>
                {(players.size > 1 || r.side === 'opponent') && (
                  <span className="lbc__stakes-note">
                    {players.size > 1 ? ` · ${r.playerName}` : ''}
                    {r.side === 'opponent' ? ', against you' : ''}
                  </span>
                )}
              </span>
              <span className="lbc__stakes-swing">
                {up ? '▲' : '▼'} {Math.abs(swing)} · {pct(r.stake.after)}
              </span>
              <span className="lbc__stakes-bar">
                <span className="lbc__stakes-now" style={{ width: pct(lo) }} />
                <span className="lbc__stakes-delta" style={{ width: pct(Math.abs(r.stake.after - r.stake.before)) }} />
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > MAX_ROWS && <p className="lbc__stakes-more">+{rows.length - MAX_ROWS} more</p>}
    </aside>
  );
}

function summary(helps: number, hurts: number): string {
  const league = (n: number) => `${n} league${n === 1 ? '' : 's'}`;
  if (helps && hurts) return `Helps you in ${league(helps)}, hurts you in ${league(hurts)}`;
  if (helps) return `Helps you in ${league(helps)}`;
  return `Hurts you in ${league(hurts)}`;
}

/** Memoised for the same 1 Hz heartbeat reason as `RedZoneBanner`. */
export default memo(DriveStakesCard);
