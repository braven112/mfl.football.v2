/**
 * The full-screen reveal: one of the owner's OWN players just did something.
 *
 * A FIELD OF COLOUR is what makes this readable from ten feet with the real
 * game on the other television. It is the primary mine-vs-theirs channel and
 * it is spent here — nothing else on the board gets a colour fill. An owner
 * who learns nothing else about this page learns "big colour = mine" in one
 * Sunday.
 *
 * It deliberately does NOT cover the fixed header: the header is what makes
 * the reveal mean something ("he scored, and here is what it did to me").
 */

import { memo } from 'react';
import type { BroadcastMoment } from '../../../utils/broadcast-moments';
import type { BroadcastTeam } from '../../../types/live-broadcast';
import { BroadcastFace } from '../draft-broadcast/BroadcastFace';

interface Props {
  moment: BroadcastMoment;
  team: BroadcastTeam | null;
  /** Where the matchup stands AFTER the play — the "what did it do to me" line. */
  scoreLine: string;
  position: string;
  nflTeam: string;
  headshot: string;
}

/** The kicker's headline word. Says WHAT happened, in one glance. */
function kickerFor(moment: BroadcastMoment): string {
  switch (moment.kind) {
    case 'touchdown':
      return 'Touchdown';
    case 'two-point':
      return 'Two-point conversion';
    case 'field-goal':
      return 'Field goal';
    case 'safety':
      return 'Safety';
    case 'turnover':
      return 'Takeaway';
    default:
      return moment.yards > 0 ? `${moment.yards}-yard play` : 'Big play';
  }
}

function MomentTakeover({ moment, team, scoreLine, position, nflTeam, headshot }: Props) {
  const style: Record<string, string> = {};
  if (team) {
    style['--lbc-primary'] = team.primary;
    style['--lbc-secondary'] = team.secondary;
    // Only set when the franchise actually declares one — an empty value would
    // resolve `background-image` to nothing rather than to the derived pair.
    if (team.gradient) style['--lbc-gradient'] = team.gradient;
  }

  return (
    <div className="lbc-reveal" style={style}>
      <div className="lbc-reveal__wash" aria-hidden="true" />
      {team?.icon && <img className="lbc-reveal__crest" src={team.icon} alt="" aria-hidden="true" />}

      {moment.scoreValue > 0 && (
        <span className="lbc-reveal__delta" aria-hidden="true">
          +{moment.scoreValue}
        </span>
      )}

      <div className="lbc-reveal__body">
        <p className="lbc-reveal__kicker">{kickerFor(moment)}</p>
        <p className="lbc-reveal__team">
          Your {position || 'starter'} · {moment.leagueName}
          {team ? ` · ${team.name}` : ''}
        </p>
        <h2 className="lbc-reveal__name">
          <BroadcastFace
            player={{ id: moment.playerId, mflId: moment.playerId, position, nflTeam, headshot }}
            className="lbc__face"
          />
          {moment.playerName}
        </h2>
        {/* ESPN's own summary, never rewritten. */}
        <p className="lbc-reveal__play">{moment.text}</p>
        <p className="lbc-reveal__line">
          {/* The real play clock or nothing at all — never a fabricated one. */}
          {moment.clock && <span>{moment.clock}</span>}
          <span>{scoreLine}</span>
        </p>
      </div>
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
export default memo(MomentTakeover);
