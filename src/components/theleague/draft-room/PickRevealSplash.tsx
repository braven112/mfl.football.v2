import React, { useCallback, useEffect, useState } from 'react';
import { getCollegeHeadshot } from '../../../constants/roster-constants';
import {
  isSplashCutoutEligible,
  resolveSplashColors,
  type PickSplashItem,
} from '../../../utils/pick-reveal';

interface PickRevealSplashProps {
  /** Pending splashes, oldest first. The head is on screen. */
  queue: PickSplashItem[];
  /** Called when a splash finishes (timer or tap) — remove it from the queue. */
  onConsume: (id: string) => void;
}

/** How long a splash holds before settling into the board. */
const DISPLAY_MS = 3600;
/** Exit-animation runway before the next splash (matches the CSS transition). */
const EXIT_MS = 240;

/**
 * Pick Reveal Splash — the broadcast moment when a pick lands.
 *
 * "With the 1.03, the {franchise} select {player}" over a franchise-color
 * gradient with the player's transparent ESPN cutout. Composite hard rules
 * (espncdn-only, no DEF) live in pick-reveal.ts; a 404'd cutout retries the
 * college headshot (rookies often only have one) and then hides — the text
 * treatment always carries the card.
 *
 * Overlays only the board area (absolute within .dr-main) so the clock and
 * timer-banner controls stay visible. The backdrop is pointer-transparent —
 * only the CARD takes pointer events — so the side panel (the pick-submit
 * path in mock mode) stays clickable under the dim. Tap the card or press
 * Escape to dismiss. The card is aria-hidden: DraftRoom's live region
 * already announces picks, so screen readers aren't told twice.
 */
export function PickRevealSplash({ queue, onConsume }: PickRevealSplashProps) {
  const item = queue.length > 0 ? queue[0] : null;
  if (!item) return null;
  // Keyed remount resets the per-splash timer + cutout cascade state.
  return <SplashCard key={item.id} item={item} onDone={onConsume} />;
}

function SplashCard({ item, onDone }: { item: PickSplashItem; onDone: (id: string) => void }) {
  const { team, player } = item;
  const [exiting, setExiting] = useState(false);
  const [cutoutSrc, setCutoutSrc] = useState<string | null>(() =>
    isSplashCutoutEligible(player) ? player!.headshot : null
  );

  const dismiss = useCallback(() => setExiting(true), []);

  // Hold, then settle into the board. Escape dismisses early.
  useEffect(() => {
    const holdId = setTimeout(dismiss, DISPLAY_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(holdId);
      window.removeEventListener('keydown', onKey);
    };
  }, [dismiss]);

  useEffect(() => {
    if (!exiting) return;
    const exitId = setTimeout(() => onDone(item.id), EXIT_MS);
    return () => clearTimeout(exitId);
  }, [exiting, onDone, item.id]);

  // 404 cascade stays inside espncdn: NFL cutout → college cutout → no cutout.
  // Never falls to the MFL JPG — baked backgrounds break the composite.
  const handleCutoutError = useCallback(() => {
    setCutoutSrc((current) => {
      const college = player?.espnId ? getCollegeHeadshot(player.espnId) : null;
      return college && college !== current ? college : null;
    });
  }, [player]);

  const hideCrest = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none';
  }, []);

  const colors = resolveSplashColors(team, player);
  // Rookies read best with their college as the origin line; vets get NFL team.
  const origin = player?.isRookie && player.college ? player.college : player?.nflTeam || '';

  return (
    <div
      className={`dr-splash-overlay${exiting ? ' dr-splash-overlay--exit' : ''}`}
      aria-hidden="true"
    >
      <div
        className="dr-splash"
        onClick={dismiss}
        style={
          {
            '--dr-splash-primary': colors.primary,
            '--dr-splash-secondary': colors.secondary,
          } as React.CSSProperties
        }
      >
        <span className="dr-splash__ghost">{item.pickLabel}</span>
        {team?.icon ? (
          <img className="dr-splash__crest" src={team.icon} alt="" onError={hideCrest} />
        ) : null}
        {cutoutSrc ? (
          <img
            className="dr-splash__model"
            src={cutoutSrc}
            alt=""
            decoding="async"
            onError={handleCutoutError}
          />
        ) : null}
        <div className="dr-splash__text">
          <span className="dr-splash__kicker">With the {item.pickLabel}</span>
          <span className="dr-splash__team">the {team?.name || 'next team up'} select</span>
          <span className="dr-splash__player">
            {player?.name || `Player ${item.id.split('-')[1] || ''}`}
          </span>
          {player ? (
            <span className="dr-splash__meta">
              {player.position}
              {origin ? ` · ${origin}` : ''}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
