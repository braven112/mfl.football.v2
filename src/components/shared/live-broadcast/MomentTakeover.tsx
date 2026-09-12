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
 *
 * ── The figure ────────────────────────────────────────────────────────────
 *
 * The scorer is a LARGE CUTOUT on the right, outside any cell, with the
 * franchise crest centred behind him — the draft board's treatment, on the same
 * hardware. He was an 18vh circular chip inside the copy until Sep 2026, which
 * read as a row of the player strip blown up rather than as a moment.
 *
 * Four things here deliberately differ from `BroadcastRevealCard`, its
 * equivalent on the draft board:
 *
 *  - **No `espnId` reaches this component.** `src/types/live-broadcast.ts`
 *    forbids an ESPN athlete id crossing to the client at all, because a
 *    college id and an NFL one are both plain digits. The draft board ships
 *    `espnId` on `BroadcastDefenseFace` and builds the URL here; we take a
 *    resolved URL instead, the way `PlayerMeta.headshot` already does. That
 *    also rules out its college-headshot 404 hop, which needs the id — and
 *    which would be the wrong cascade anyway, since this board's population is
 *    rostered NFL players rather than pre-draft rookies.
 *  - **The copy comes FIRST in the DOM.** The draft board's own stylesheet
 *    admits its `order` swap is a bug; the defenders' names are real text and a
 *    screen reader should reach the play before them. Paint order is held by
 *    `z-index` instead, so a defender's shoulder can never cover the play text.
 *  - **No shuffle.** The draft board randomises which defenders show because
 *    the AFL can draft the same defense twice in one night. Here, seeing the
 *    same man every time the Chiefs defense scores is a feature.
 *  - **ONE defender, not the draft board's pair.** Tried on the real
 *    television, two men at full cutout scale filled the layer and left the
 *    club unidentifiable without reading the caption. The unit's NAME carries
 *    the club's mark instead, and one face stands beside it. Three faces still
 *    ship: the spares are the 404 backfill.
 */

import { memo, useMemo, useState } from 'react';
import type { BroadcastMoment } from '../../../utils/broadcast-moments';
import type { BroadcastDefenderFace, BroadcastTeam } from '../../../types/live-broadcast';
import { isEspnCdnUrl } from '../../../utils/espn-cdn';
import { crestStrokeProps } from '../../../utils/draft-broadcast';
import { getNFLTeamLogo as nflLogo } from '../../../utils/nfl-logo';

interface Props {
  moment: BroadcastMoment;
  team: BroadcastTeam | null;
  /** Where the matchup stands AFTER the play — the "what did it do to me" line. */
  scoreLine: string;
  position: string;
  nflTeam: string;
  headshot: string;
  /**
   * Marquee defenders, when the scorer is a team defense. Passed BY REFERENCE
   * off the page data — slicing in the parent would defeat this component's
   * `memo()` on every one-second tick.
   */
  defenders?: BroadcastDefenderFace[];
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

function MomentTakeover({
  moment,
  team,
  scoreLine,
  position,
  nflTeam,
  headshot,
  defenders,
}: Props) {
  const isDef = position.toUpperCase() === 'DEF';

  /**
   * The solo cutout, or null.
   *
   * `!isDef && isEspnCdnUrl(headshot)` is `heroModelHasCutout`'s rule restated
   * on a `PlayerMeta`. Don't import that helper — it takes a `HeroModel` and
   * would drag `hero-casting.ts` into the browser bundle. `isEspnCdnUrl` is the
   * leaf, and the leaf is the island-safe one.
   *
   * MFL's fallback JPG has a baked-in background that ruins the layering, so a
   * player without a real cutout shows NO figure rather than a bad one — the
   * grid collapses and the copy owns the layer.
   */
  const [cutout, setCutout] = useState<string | null>(() =>
    !isDef && isEspnCdnUrl(headshot) ? headshot : null,
  );

  /**
   * Cutouts that 404'd this reveal.
   *
   * Both initialisers only run on mount, which is exactly right and not an
   * accident: `LiveBroadcast` keys the stage on the moment, so every reveal
   * remounts this subtree.
   */
  const [dead, setDead] = useState<ReadonlySet<string>>(() => new Set());

  /**
   * ONE defender, not two.
   *
   * The pair was the draft board's answer and it was tried here first; on the
   * real television two men at full cutout scale filled the layer and left the
   * club unidentifiable without reading the caption. A single face beside the
   * unit's name, with the NFL mark on the name itself, says the same thing
   * more quietly. The spare entries the server ships are the 404 backfill.
   */
  const shown = useMemo(
    () => (isDef ? (defenders ?? []).filter((d) => !dead.has(d.headshot)).slice(0, 1) : []),
    [isDef, defenders, dead],
  );

  const style: Record<string, string> = {};
  if (team) {
    style['--lbc-primary'] = team.primary;
    style['--lbc-secondary'] = team.secondary;
    // Only set when the franchise actually declares one — an empty value would
    // resolve `background-image` to nothing rather than to the derived pair.
    if (team.gradient) style['--lbc-gradient'] = team.gradient;
  }

  const hasFigure = cutout !== null || shown.length > 0;

  return (
    <div className="lbc-reveal" style={style}>
      <div className="lbc-reveal__wash" aria-hidden="true" />
      {/* The biggest crest the board draws — 68vh, ~734px on a 1080p TV — so it
          takes `resolveBroadcastCrest`'s RESOLUTION-first art (400x400 GroupMe
          over the 100x100 hand cut) and buys dark-board legibility back with a
          ring. Both crest fields were the same 100px icon until Sep 2026, which
          is what made this one visibly pixelated.
          CENTRED on the layer, with the scorer seated to its right — it used to
          be anchored bottom-right, which put it entirely underneath the figure
          once the cutout moved there and wasted the club's own mark. */}
      {team?.icon && (
        <img
          {...crestStrokeProps('lbc-reveal__crest', team.iconStroke, 'lbc')}
          src={team.icon}
          alt=""
          aria-hidden="true"
        />
      )}

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
          {/* A team defense's name IS a club, so it takes the club's mark —
              the same pairing the player strip's meta line uses. A person's
              name does not: his own face is already the identification. */}
          {isDef && nflTeam && (
            <img className="lbc-reveal__name-logo" src={nflLogo(nflTeam)} alt="" aria-hidden="true" />
          )}
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

      {hasFigure && (
        <div className="lbc-reveal__figure">
          {/* One cutout's box, full height, at the art's own aspect ratio — so
              every seat percentage below is a percentage of ONE MAN. See the
              stylesheet for why this layer cannot use the draft board's
              column percentages directly. */}
          <div className="lbc-reveal__stand">
            {cutout && (
              <img
                className="lbc-reveal__model"
                src={cutout}
                alt=""
                aria-hidden="true"
                // REMOVE the node, never `display: none` it — the empty-figure
                // collapse is a `:has()` rule and a hidden element is still
                // there as far as `:has()` is concerned.
                onError={() => setCutout(null)}
              />
            )}
            {shown.map((face) => (
              <img
                key={face.headshot}
                className="lbc-reveal__model"
                src={face.headshot}
                alt=""
                aria-hidden="true"
                onError={() =>
                  setDead((prev) => {
                    const next = new Set(prev);
                    next.add(face.headshot);
                    return next;
                  })
                }
              />
            ))}
            {shown.length > 0 && (
              /* A DEF's headline is the UNIT ("Bills, Buffalo"), so these two
                 are faces the reveal would otherwise never name. */
              <p className="lbc-reveal__face">
                {shown.map((face) => (
                  <span className="lbc-reveal__face-row" key={face.headshot}>
                    <span className="lbc-reveal__face-chip">
                      <span className="lbc-reveal__face-name">{face.name}</span>
                      {face.position && (
                        <span className="lbc-reveal__face-pos">{face.position}</span>
                      )}
                    </span>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      )}
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
