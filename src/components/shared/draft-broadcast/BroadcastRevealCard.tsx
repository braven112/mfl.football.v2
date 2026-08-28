/**
 * BroadcastRevealCard — the moment a pick lands, at TV scale.
 *
 * The TV-sized sibling of `PickRevealSplash.tsx`. It reuses that surface's
 * composite rules verbatim (`resolveSplashColors`, `isSplashCutoutEligible`,
 * the espncdn-only 404 cascade) because those rules are binding across the
 * whole site — see docs/claude/insights/features/player-composites.md. What
 * differs is everything about presentation and what it says:
 *
 *   - Full viewport, not an overlay on a board panel.
 *   - No dismissal. Nobody is holding a mouse; the queue owns the timing.
 *   - The franchise's identity is carried by its COLORS and its CREST, and
 *     nothing else. Franchise banners were tried here and cut (Brandon,
 *     2026-08-27): a banner is mostly its own wordmark, so behind a player's
 *     name it reads as two competing pieces of type at the exact moment the
 *     room is trying to read one of them. Blurring it back far enough to stop
 *     competing left it contributing nothing.
 *   - It carries stats — board rank, projection, bye, injury — but NOT the
 *     league's ranking sources (Brandon, 2026-08-27: not for this screen) —
 *     because a reveal that owns a 65" screen for 18 seconds and says only a
 *     name is wasting the best real estate of the night.
 *   - A TEAM DEFENSE gets real faces, not an empty figure column. `DEF` is
 *     excluded from the site-wide cutout rule (a DEF "player" is a crest), so
 *     the card opts back in with TWO of the unit's marquee defenders from the
 *     shared `def-spotlight-players` pool (shipped with the page, keyed by NFL
 *     team) — drawn at random from the top five and then held for the reveal
 *     (Brandon, 2026-08-28). Two rather than one
 *     because a defense is a unit and one man reads as a player card; they
 *     stand shoulder-over-shoulder at FULL cutout scale — the same size a lone
 *     player gets — offset so both heads clear.
 *     Not rotated: the Free Agents hero cycles faces because it is ambient
 *     furniture an owner scrolls past, but this card IS the moment, and a face
 *     that changes underneath the room mid-reveal reads as a second pick
 *     landing. See docs/claude/insights/features/player-composites.md.
 */

import { useCallback, useMemo, useState } from 'react';
import type { DraftRoomPick } from '../../../types/draft-room';
import type { DraftRoomTeam } from '../../../types/draft-room';
import type { BroadcastDefenseFace, BroadcastPlayer } from '../../../types/draft-broadcast';
import { isSplashCutoutEligible, resolveSplashColors } from '../../../utils/pick-reveal';
import {
  bestAvailableAt,
  toBroadcastPair,
  formatBestAvailable,
  positionRunCount,
  resolveBroadcastGradient,
} from '../../../utils/draft-broadcast';
import { getCollegeHeadshot, getPlayerHeadshot } from '../../../constants/roster-constants';

interface Props {
  pick: DraftRoomPick;
  team?: DraftRoomTeam;
  player?: BroadcastPlayer;
  picks: DraftRoomPick[];
  players: ReadonlyMap<string, BroadcastPlayer>;
  /** True when this is a replay of a finished season, not the live draft. */
  rehearsing?: boolean;
  /** The season being replayed — only meaningful while `rehearsing`. */
  leagueYear?: number;
  /** NFL team code → that defense's marquee defenders. See `defenseFaces`. */
  defenseFaces?: Record<string, BroadcastDefenseFace[]>;
}

/** How many defenders stand in for a team defense. */
const DEFENSE_FACE_COUNT = 2;

/** "1.03" — the way a draft room says a pick out loud. */
function pickLabel(pick: DraftRoomPick): string {
  return `${pick.round}.${String(pick.pickInRound).padStart(2, '0')}`;
}

export function BroadcastRevealCard({
  pick,
  team,
  player,
  picks,
  players,
  rehearsing,
  leagueYear,
  defenseFaces,
}: Props) {
  const [cutoutSrc, setCutoutSrc] = useState<string | null>(() =>
    isSplashCutoutEligible(player) ? player!.headshot : null
  );

  // 404 cascade stays inside espncdn: NFL cutout → college cutout → no cutout.
  // Never the MFL JPG — its baked-in background ruins the composite.
  const handleCutoutError = useCallback(() => {
    setCutoutSrc((current) => {
      const college = player?.espnId ? getCollegeHeadshot(player.espnId) : null;
      return college && college !== current ? college : null;
    });
  }, [player]);

  const hideOnError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none';
  }, []);

  // ── Team-defense faces ──
  // Two defenders out of the unit's top five, drawn once and then held for the
  // whole reveal. The pool ships with the page keyed by NFL team code, so this
  // is a plain lookup — nothing to fetch, and no team-code normalizer on the
  // client (the key is the same raw string the player carries).
  const facePool = player?.position?.toUpperCase() === 'DEF'
    ? defenseFaces?.[player.nflTeam || '']
    : undefined;
  const [deadFaces, setDeadFaces] = useState<ReadonlySet<string>>(() => new Set());

  // The draw is a stable SHUFFLE of the whole pool, taken once, and the pair is
  // the first two entries still alive in it.
  //
  // That shape is the point, and it replaced seeded indices that re-derived
  // themselves against the shrinking live list. Those indices moved when the
  // list did: brute-forced over 200k seed pairs on a five-man pool, 15.04% of
  // 404 events evicted the SURVIVING defender along with the missing one —
  // unmounting a face that had already decoded and was on screen, which is
  // exactly the "a face that changes underneath the room mid-reveal" failure
  // the header forbids. Filtering a fixed order cannot do that: a survivor is
  // still among the first two live entries by construction, so only the dead
  // slot is backfilled.
  //
  // Random sort KEYS rather than a seeded PRNG because they survive the same
  // way a seed would (drawn once, in state) while being a real uniform shuffle
  // — and taking two off the front of a shuffle can never draw one man twice,
  // which the index arithmetic had to hand-prove.
  const [shuffleKeys] = useState<number[]>(() =>
    Array.from({ length: 16 }, () => Math.random())
  );

  // Re-drawn per reveal for free: `DraftBroadcast` keys this card by pick, so
  // every selection remounts it. That matters in the AFL specifically —
  // `duplicatePlayers` lets both conferences draft the same defense, and a
  // fixed pair would show the room the identical card twice.
  const drawOrder = useMemo(
    () =>
      (facePool ?? [])
        .map((face, rank) => ({ face, rank, key: shuffleKeys[rank] ?? rank }))
        .sort((a, b) => a.key - b.key),
    [facePool, shuffleKeys]
  );

  // Displayed in POOL order so the better defender is the one in front (see the
  // `:first-of-type` z-index rule in draft-broadcast.css) and so the caption's
  // two lines read left-to-right against the two cutouts. A 404 can therefore
  // move the survivor from one side to the other — but it never replaces him,
  // and his <img> is keyed by espnId so the node is not remounted.
  const shownFaces = useMemo(
    () =>
      drawOrder
        .filter((entry) => !deadFaces.has(entry.face.espnId))
        .slice(0, DEFENSE_FACE_COUNT)
        .sort((a, b) => a.rank - b.rank)
        .map((entry) => entry.face),
    [drawOrder, deadFaces]
  );

  const handleFaceError = useCallback((espnId: string) => {
    setDeadFaces((prev) => {
      if (prev.has(espnId)) return prev;
      const next = new Set(prev);
      next.add(espnId);
      return next;
    });
  }, []);

  // Franchise brand first (resolveSplashColors), then floored for legibility.
  // Nine of 24 AFL franchises have a gradient stop white text cannot be read
  // against — six of them a near-white #e9e9e9. Applied HERE rather than inside
  // resolveSplashColors because that helper is shared with TheLeague's draft
  // room, whose splash is a 3.6s overlay on a laptop, not a TV read from ten
  // feet; this is the broadcast screen's requirement, not a global one.
  const brand = resolveSplashColors(team, player);
  const colors = toBroadcastPair(brand.primary, brand.secondary);

  // A franchise that declares its own `broadcastGradient` paints THAT instead —
  // verbatim, contrast floor and all. Left unset when there is none (or it fails
  // validation), which hands the card back to the stylesheet's derived fallback
  // rather than painting a second, subtly different version of it here.
  const gradient = resolveBroadcastGradient(team);
  const label = pickLabel(pick);

  // Where he stood among what was actually left on the board. A fact, not a
  // verdict — see the keeper-league reasoning on `bestAvailableAt`.
  const availRank = player
    ? bestAvailableAt(picks, players, pick.overallPickNumber, player.id)
    : undefined;
  const availText = formatBestAvailable(availRank);

  // Rookies read best with their college as the origin line; vets get NFL team.
  const origin = player?.isRookie && player.college ? player.college : player?.nflTeam || '';

  // "4th RB in 8 picks" — the run callout. Only shown once it's actually a run;
  // announcing the 1st or 2nd of a position is just noise.
  const runCount = player
    ? positionRunCount(picks, players, pick.overallPickNumber, player.position)
    : 0;
  const showRun = runCount >= 3;

  return (
    <div
      className="dbc-reveal"
      style={
        {
          '--dbc-primary': colors.primary,
          '--dbc-secondary': colors.secondary,
          ...(gradient ? { '--dbc-gradient': gradient } : {}),
        } as React.CSSProperties
      }
    >
      <div className="dbc-reveal__wash" aria-hidden="true" />
      {/* The idle screen carries this too, but the reveal card is what is
          actually on the TV for ~18 of every 20 seconds of a replay — flagging
          only the idle screen would leave the room looking at last year's picks
          with nothing on screen to say so. */}
      {rehearsing ? (
        <span className="dbc-reveal__rehearsal-flag">
          Rehearsal · replaying {leagueYear}
        </span>
      ) : null}
      <span className="dbc-reveal__ghost" aria-hidden="true">{label}</span>
      {team?.icon ? (
        <img className="dbc-reveal__crest" src={team.icon} alt="" onError={hideOnError} />
      ) : null}

      <div className="dbc-reveal__body">
        <div className="dbc-reveal__figure">
          {cutoutSrc ? (
            <img
              className="dbc-reveal__model"
              src={cutoutSrc}
              alt=""
              decoding="async"
              onError={handleCutoutError}
            />
          ) : null}
          {/* Keyed by espnId so a 404 swap replaces the NODE: reusing one <img>
              would leave the missing defender's broken frame on screen until
              the replacement decoded, and would not replay the entrance
              animation the rest of the card gets. */}
          {shownFaces.map((face) => (
            <img
              key={face.espnId}
              className="dbc-reveal__model dbc-reveal__model--def"
              src={getPlayerHeadshot(undefined, face.espnId)}
              alt=""
              decoding="async"
              onError={() => handleFaceError(face.espnId)}
            />
          ))}
          {/* The headline is the DEFENSE ("Kansas City Chiefs"); without this
              the room is looking at two faces the card never names. Real text,
              not alt on decorative cutouts, so it is legible from ten feet.
              One pill, one line per man, in the same order as the cutouts. */}
          {shownFaces.length > 0 ? (
            <p className="dbc-reveal__face">
              {shownFaces.map((face) => (
                <span className="dbc-reveal__face-row" key={face.espnId}>
                  <span className="dbc-reveal__face-name">{face.name}</span>
                  {face.position ? (
                    <span className="dbc-reveal__face-pos">{face.position}</span>
                  ) : null}
                </span>
              ))}
            </p>
          ) : null}
        </div>

        <div className="dbc-reveal__text">
          <p className="dbc-reveal__kicker">
            With the {label}, {team?.name || 'the next team up'} select
          </p>
          <h1 className="dbc-reveal__player">{player?.name || 'Pick in'}</h1>

          <p className="dbc-reveal__meta">
            {player?.position ? <span className="dbc-reveal__pos">{player.position}</span> : null}
            {origin ? <span>{origin}</span> : null}
            {player?.byeWeek ? <span>BYE {player.byeWeek}</span> : null}
            {player?.injuryStatus ? (
              <span className="dbc-reveal__injury">{player.injuryStatus}</span>
            ) : null}
          </p>

          {availText ? (
            <p
              className={`dbc-reveal__value${
                availRank === 1 ? ' dbc-reveal__value--top' : ''
              }`}
            >
              {availText}
            </p>
          ) : null}

          <dl className="dbc-reveal__stats">
            {player?.boardRank ? (
              <div className="dbc-reveal__stat">
                {/* Board rank, not raw ADP. An AFL 1.02 sitting beside "ADP
                    24.1" reads as a blunder when it is nothing of the sort —
                    the 24 counts 84 keepers who were never draftable here. */}
                <dt>Board rank</dt>
                <dd>#{player.boardRank}</dd>
              </div>
            ) : null}
            {player?.projectedPoints ? (
              <div className="dbc-reveal__stat">
                <dt>Proj / wk</dt>
                <dd>{player.projectedPoints.toFixed(1)}</dd>
              </div>
            ) : null}
            {player?.age ? (
              <div className="dbc-reveal__stat">
                <dt>Age</dt>
                <dd>{player.age}</dd>
              </div>
            ) : null}
          </dl>

          {showRun && player ? (
            <p className="dbc-reveal__run">
              {runCount} {player.position}s off the board in the last 8 picks
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
