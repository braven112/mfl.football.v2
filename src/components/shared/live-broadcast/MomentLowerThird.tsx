/**
 * The lower third: one of the owner's OPPONENTS just scored.
 *
 * Deliberately smaller and shorter than the takeover, and deliberately NOT a
 * field of the opponent's colour. Their brand appears as the top rule and the
 * crest only — that asymmetry is what keeps "big colour = mine" learnable.
 *
 * It occludes nothing: the scoreboard stays up and the strip stays visible
 * behind it, because bad news is not worth taking the board away for.
 */

import { memo } from 'react';
import type { BroadcastMoment } from '../../../utils/broadcast-moments';
import type { BroadcastTeam } from '../../../types/live-broadcast';
import { crestStrokeProps } from '../../../utils/draft-broadcast';

interface Props {
  moment: BroadcastMoment;
  team: BroadcastTeam | null;
  scoreLine: string;
  position: string;
}

function MomentLowerThird({ moment, team, scoreLine, position }: Props) {
  return (
    <div
      className="lbc-third"
      style={team ? ({ ['--lbc-primary' as string]: team.primary } as Record<string, string>) : undefined}
    >
      {team?.iconSmall && (
        <img
          {...crestStrokeProps('lbc-third__crest', team.iconSmallStroke, 'lbc')}
          src={team.iconSmall}
          alt=""
        />
      )}
      <div className="lbc-third__who">
        <p className="lbc-third__kicker">Against you · {moment.leagueName}</p>
        <p className="lbc-third__name">{moment.playerName}</p>
        <p className="lbc-third__meta">
          {[position, moment.team, team?.nameShort || team?.name].filter(Boolean).join(' · ')}
        </p>
      </div>
      <p className="lbc-third__play">{moment.text}</p>
      {moment.scoreValue > 0 && <span className="lbc-third__pts">+{moment.scoreValue}</span>}
      <span className="lbc-third__clock">
        {moment.clock}
        {moment.clock && scoreLine ? ' · ' : ''}
        {scoreLine}
      </span>
    </div>
  );
}

/**
 * Memoised because the island ticks once a SECOND to age the freshness pill
 * and drive the screensaver clock, and this component depends on none of that.
 * Unmemoised, a 1 Hz heartbeat re-renders the whole visible board ~28,800
 * times over an eight-hour Sunday — on set-top hardware, and concurrently
 * with the reveal transitions that are the one thing on this screen allowed
 * to cost a frame budget. Props here are already memoised upstream, so the
 * bailout is free and changes no behaviour.
 */
export default memo(MomentLowerThird);
