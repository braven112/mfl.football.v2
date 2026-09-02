/**
 * BroadcastFace — one player's face, in the site's shared player-cell chip, at
 * TV scale.
 *
 * Lives in its own module because THREE broadcast surfaces need it now: the
 * idle board's "Just off the board" rail, the screensaver's roster panels and
 * its position board. The 404 walk below is subtle enough (a pre-hydration
 * failure the event never replays; a defense whose one entry must hide rather
 * than fall back) that a second hand-copied version of it would be a second
 * source of the same bugs — this file exists so there is exactly one.
 *
 * Only the SIZE varies between call sites, through `className` and the size
 * custom properties player-cell.css documents as the extension point.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  getCollegeHeadshot,
  getPlayerHeadshot,
  getPlayerImageUrl,
} from '../../../constants/roster-constants';
import { normalizeTeamCode } from '../../../utils/nfl-logo';
import { resolveNflDarkLogoUrl } from '../../../utils/nfl-logo-dark-css';
import {
  NO_HEADSHOT_PLACEHOLDER,
  buildNoHeadshotPlaceholder,
  getPlayerAvatarBackground,
  getPlayerAvatarBorder,
  getPlayerAvatarRingDark,
} from '../../../utils/nfl-team-colors';
// The chip is the site's shared player cell (circle, team-color radial
// backdrop, the 1.18 fill scale, the DEF opt-out) rather than a broadcast-only
// copy of it — see player-cell.css for the properties each caller retunes.
import '../../../styles/player-cell.css';

/**
 * The fields the chip actually reads — a structural subset, not
 * `BroadcastPlayer`.
 *
 * The roster panels draw `RosterHolding`s, which are deliberately thin (see the
 * type) and carry no `headshot`: the cascade below builds one from `espnId` and
 * the MFL id, which is the same hop it already takes for anyone the server
 * could not resolve a cutout for. Typing this as `BroadcastPlayer` would have
 * forced the panels to fabricate the fields it never touches.
 */
export interface FacePlayer {
  id: string;
  mflId?: string;
  position?: string;
  nflTeam?: string;
  headshot?: string;
  espnId?: string;
}

interface Props {
  player?: FacePlayer;
  /** The caller's own class — carries the size for this surface. */
  className: string;
}

/**
 * Every image the rail avatar is willing to try, best first.
 *
 * The site-wide headshot cascade (see `buildHeadshotOnerror`, the inline-JS
 * twin of this chain): ESPN NFL cutout → ESPN college cutout → MFL's own photo
 * → the silhouette. A pre-draft rookie's `espnId` is a COLLEGE id, so the
 * second hop is the one that resolves him and the first is the 404 — which is
 * why the chain is walked rather than branched on.
 *
 * A team defense is a crest, not a person, so it opts out into its NFL logo.
 * The DARK cut, unconditionally: this board is dark in BOTH themes (see the
 * header of draft-broadcast.css), and the global `html.dark` logo swap only
 * fires for a viewer whose site theme is dark — a light-theme owner driving
 * the TV would otherwise get the dark-outlined marks (Raiders, Jets, Jaguars)
 * that swap exists to fix, invisible on a dark rail.
 *
 * That leaves a defense with ONE entry and no light-SVG fallback under it, on
 * purpose. `/assets/nfl-logos/<code>.svg` is one of the exact light srcs
 * `buildNflLogoDarkCss` keys its swap rules on, and those rules ship on this
 * page (`NflLogoDarkStyles`, in TheLeagueLayout's head) — so for a dark-theme
 * viewer, falling back to it hands the browser
 * `content: url(<the dark URL that just failed>)`. `content` has no error
 * fallback and fires no `onError`, so that "fallback" renders a broken-image
 * glyph nothing can walk past or hide. A single entry that hides itself is
 * strictly better than a second one that can't fail safely.
 */
/**
 * The NFL team code a team defense should render as its crest — empty for
 * anyone who is not a defense, AND for a defense we cannot resolve a team for
 * (no `nflTeam`, or one that normalizes to the generic shield).
 *
 * One function because two callers have to agree: the chain picks the LOGO off
 * it and the chip picks the `--def` STYLING off it. Tested separately they can
 * disagree — a defense with no team code took the person-headshot chain while
 * still wearing the defense's transparent, backdrop-less chip, so the
 * silhouette rendered square on nothing. Unreachable in today's feeds (every
 * team-unit pseudo-player carries a code), which is exactly the kind of
 * "unreachable" that stops being true quietly.
 */
function defenseLogoCode(player?: FacePlayer): string {
  if (player?.position?.toUpperCase() !== 'DEF') return '';
  const code = player.nflTeam ? normalizeTeamCode(player.nflTeam) : '';
  return code && code !== 'NFL' ? code : '';
}

function avatarChain(player?: FacePlayer): string[] {
  if (!player) return [NO_HEADSHOT_PLACEHOLDER];

  const defCode = defenseLogoCode(player);
  const mflId = player.mflId ?? player.id;
  const candidates =
    defCode
      ? // Exactly one entry, and deliberately NOTHING under it — see the header.
        // `resolveNflDarkLogoUrl` returns null only for a code with no dark cut
        // upstream (none today); the chain is then empty, `atEnd` is true at
        // once, and the chip hides itself. That is the right degradation, and
        // the reason not to reach for the light SVG to fill the gap: it is a
        // swap KEY, so it would come back as the dark URL that just failed.
        [resolveNflDarkLogoUrl(defCode)]
      : [
          // Server-resolved already (`build-draft-players`), so this is
          // normally the only entry that gets requested.
          player.headshot || getPlayerHeadshot(mflId, player.espnId),
          player.espnId ? getCollegeHeadshot(player.espnId) : '',
          mflId ? getPlayerImageUrl(mflId) : '',
          buildNoHeadshotPlaceholder(player.nflTeam ?? ''),
        ];

  const seen = new Set<string>();
  return candidates.filter((url): url is string => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

/**
 * The drafted player's face on a "Just off the board" row, in the site's
 * shared player-cell chip — the same lockup a roster table, the trade builder
 * and the custom-rankings board all use, so a player looks like himself
 * everywhere. Only the size is retuned (in vh, like the rest of this surface).
 *
 * The 404 walk is React state rather than reassigning `img.onerror`, matching
 * `BroadcastRevealCard`'s cutout cascade: the row is remounted per pick, so
 * state is the shorter-lived thing, and it can't race the synthetic handler.
 *
 * Ring colour is the DARK-mode one on every viewer, for the same reason the
 * DEF logo is: the board is dark whatever the site theme says. Both halves of
 * player-cell.css's theme-split ring pair are set to it — the stylesheet reads
 * `--player-avatar-ring` for a light-theme viewer and `--player-avatar-ring-dark`
 * under `html.dark`, and this surface wants the light-on-dark echo in either
 * case. Setting only one is the silent-gray-ring failure
 * `tests/team-color-backdrop-guard.test.ts` exists to catch.
 */
export function BroadcastFace({ player, className }: Props) {
  const chain = useMemo(() => avatarChain(player), [player]);

  /**
   * How far down the chain we have walked, and the chain we walked it on.
   *
   * The pair, rather than a bare `step`, because the chain can change UNDER a
   * mounted chip. Every call site keys its chip by player id, so a different
   * player is a different element — but the same player can arrive with a
   * better chain than the one he arrived with a moment ago: the roster panels
   * show a man as a holding (no server-resolved cutout) until the board agrees
   * he is tonight's pick, at which point the pool's own URL becomes the head of
   * his chain. A `step` carried across that swap starts him partway down a
   * chain he has never tried (Copilot, #668).
   *
   * Reset during render rather than in an effect: an effect resets it AFTER a
   * commit that already pointed the <img> at the wrong entry, which is a
   * request the browser has by then made.
   */
  const [walk, setWalk] = useState({ head: chain[0], step: 0 });
  if (walk.head !== chain[0]) setWalk({ head: chain[0], step: 0 });
  const step = walk.head === chain[0] ? walk.step : 0;
  // The SAME test the chain branches on, not a second one that agrees by
  // coincidence — see `defenseLogoCode`.
  const isDef = defenseLogoCode(player) !== '';

  // Clamped rather than indexed raw: a 404 on the LAST entry must not walk past
  // it and leave the chip pointed at nothing. An empty chain (a defense with no
  // dark cut) lands at -1, where `atEnd` is already true and the img — src-less,
  // so `complete && naturalWidth === 0` — hides on the ref below.
  const index = Math.min(step, chain.length - 1);
  const atEnd = index >= chain.length - 1;

  // Everything in the chain is remote — the ESPN cutouts, MFL's own photo and
  // the silhouette alike — so the end of the walk is a real state, not a
  // theoretical one, and an unhandled 404 there paints the browser's
  // broken-image glyph inside a team-coloured circle. Hide it, for the reason
  // `hideOnError` gives above: a broken stub in an image slot reads as a broken
  // BOARD from ten feet, and the name beside it already identifies the row.
  const hideImg = useCallback((img: HTMLImageElement) => {
    img.style.display = 'none';
  }, []);

  const advance = useCallback(
    () => setWalk((w) => ({ head: w.head, step: w.step + 1 })),
    []
  );

  /**
   * Close the hydration gap, or none of the above ever runs.
   *
   * This rail is in the SERVER-rendered HTML — the board is `prerender = false`
   * and the island is `client:load` — so the browser starts every headshot on
   * first paint and can finish failing it before React attaches a single
   * handler. React does not replay an error event it wasn't mounted for, which
   * left the cascade and the hide above as dead code on the ordinary path: a
   * 404'd chip sat on a broken-image glyph forever and never walked to the
   * college cutout. Measured, not theorised — stubbing the CDN to 404 left all
   * three chips at `complete && naturalWidth === 0` with `onError` never fired.
   *
   * A ref runs at mount, after the browser has had its go, so it can see the
   * failure the event dropped. Same fix, same test, as `nflLogoRefCallback`
   * (`roster-constants.ts`) makes for the site's NFL logos.
   *
   * `BroadcastRevealCard`'s cutout cascade next door needs none of this: that
   * card only ever mounts AFTER a pick lands client-side, so its images have no
   * pre-hydration life to fail in.
   */
  const imgRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !img.complete || img.naturalWidth !== 0) return;
      // Terminates: each call either advances one step or, at the last entry,
      // hides. `atEnd` is recomputed from the clamped index on every render.
      if (atEnd) hideImg(img);
      else advance();
    },
    [atEnd, advance, hideImg]
  );

  return (
    <span
      // `player-cell__avatar` FIRST, and not for style — class order is inert
      // to CSS. `tests/team-color-backdrop-guard.test.ts` finds chip call sites
      // by matching the literal "className={`player-cell__avatar", so leading
      // with the local class hides this one from the guard that exists to catch
      // exactly the omission below (a chip rendered without a team backdrop).
      className={`player-cell__avatar ${className}${
        isDef ? ' player-cell__avatar--def' : ''
      }`}
      // A DEF chip opts out (it is a transparent, borderless logo). Everything
      // else sets the pair, INCLUDING the no-player case: without a player the
      // class list still carries no `--def`, so player-cell.css's
      // `:not(.player-cell__avatar--def):not(.player-cell__avatar--eligible)`
      // rule applies and an unstyled chip falls
      // back to `--content-bg-muted` — a near-white disc with an invisible ring,
      // on a board that is dark for every viewer. An empty team code resolves to
      // league blue through the same helpers, which is the right neutral here.
      style={
        isDef
          ? undefined
          : ({
              '--player-avatar-bg': getPlayerAvatarBackground(player?.nflTeam ?? ''),
              '--player-avatar-border': getPlayerAvatarBorder(player?.nflTeam ?? ''),
              '--player-avatar-ring': getPlayerAvatarRingDark(player?.nflTeam ?? ''),
              '--player-avatar-ring-dark': getPlayerAvatarRingDark(player?.nflTeam ?? ''),
            } as React.CSSProperties)
      }
    >
      <img
        ref={imgRef}
        src={chain[index]}
        alt=""
        decoding="async"
        onError={atEnd ? (e) => hideImg(e.currentTarget) : advance}
      />
    </span>
  );
}
