/**
 * The moving parts of the Christmas Week header's snowed-in cabin: the warm
 * glow around it swells, its windows flicker and the chimney puffs, each time
 * the scores on the board change. Snow falls all the time (CSS).
 *
 * The Halloween haunted house's twin (LvHauntedScene), same contract: the
 * scene itself is a CSS background (snowed-in-cabin.svg, seasonal-themes.css)
 * so it paints before the island hydrates, and this draws only what moves, in
 * the same 2400×430 coordinates, height-fitted and anchored bottom-right the
 * way the background is, so each shape lands on its twin in the picture. It
 * reuses the haunted scene's box (`.lv-haunt-scene`) so it sits wherever that
 * surface draws the background.
 *
 * `pulse` is any value that changes when the scores do. The first value plays
 * once too, so the cabin stirs when the board arrives. Remounting the animated
 * shapes by a counter restarts the CSS animations; no timers to clean up.
 */
import { useEffect, useRef, useState, type JSX } from 'react';

export interface LvCabinSceneProps {
  /** Changes whenever any score on the board changes. */
  pulse: string;
}

/** The cabin's two windows in snowed-in-cabin.svg (each 32×26). */
const WINDOWS = [
  { x: 2168, y: 276 },
  { x: 2292, y: 276 },
];

export default function LvCabinScene({ pulse }: LvCabinSceneProps): JSX.Element {
  const [plays, setPlays] = useState(0);
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (last.current === pulse) return;
    last.current = pulse;
    setPlays((n) => n + 1);
  }, [pulse]);

  return (
    <div className="lv-haunt-scene lv-cabin-scene" aria-hidden="true">
      <div className="lv-cabin-scene__snow" />
      <svg className="lv-haunt-scene__svg" viewBox="0 0 2400 430" preserveAspectRatio="xMaxYMax meet">
        <defs>
          <radialGradient id="lvCabinGlow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffd27a" stopOpacity="0.85" />
            <stop offset="0.5" stopColor="#ff9a3c" stopOpacity="0.35" />
            <stop offset="1" stopColor="#ff7a1a" stopOpacity="0" />
          </radialGradient>
        </defs>
        {plays > 0 && (
          <g key={`stir-${plays}`}>
            <ellipse className="lv-cabin-scene__glow" cx="2245" cy="290" rx="190" ry="105" fill="url(#lvCabinGlow)" />
            {WINDOWS.map((w, i) => (
              <rect
                key={`${w.x}-${w.y}`}
                className={`lv-cabin-scene__window lv-cabin-scene__window--${i}`}
                x={w.x}
                y={w.y}
                width="32"
                height="26"
              />
            ))}
            {[0, 1, 2].map((i) => (
              <circle
                key={i}
                className={`lv-cabin-scene__smoke lv-cabin-scene__smoke--${i}`}
                cx="2302"
                cy="190"
                r={10 + i * 3}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}
