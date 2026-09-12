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

import type { BroadcastMoment } from '../../../utils/broadcast-moments';
import type { BroadcastTeam } from '../../../types/live-broadcast';

interface Props {
  moment: BroadcastMoment;
  team: BroadcastTeam | null;
  scoreLine: string;
  position: string;
}

export default function MomentLowerThird({ moment, team, scoreLine, position }: Props) {
  return (
    <div
      className="lbc-third"
      style={team ? ({ ['--lbc-primary' as string]: team.primary } as Record<string, string>) : undefined}
    >
      {team?.iconSmall && <img className="lbc-third__crest" src={team.iconSmall} alt="" />}
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
