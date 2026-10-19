/**
 * The moving parts of the Halloween header's haunted house: the blue glow
 * behind it swells and fades, and its windows flicker, each time the scores
 * on the board change.
 *
 * The scene itself is a CSS background (haunted-house.svg, seasonal-themes.css)
 * so it paints before the island hydrates. This draws the glow, the windows,
 * and the hill, house and tree the glow sits behind, in the same 2400×430
 * coordinates, height-fitted and anchored
 * bottom-right exactly as the background is (`right bottom / auto 100%`), so
 * each shape lands on top of its twin in the picture. It sits in the header's
 * scene box (`.lv-haunt-scene`), which the CSS places wherever that surface
 * draws the background.
 *
 * `pulse` is any value that changes when the scores do. The first value plays
 * once too, so the house stirs when the board arrives, not only on the first
 * score change after it. Remounting the animated shapes by a counter is what
 * restarts the CSS animations; there are no timers to clean up.
 */
import { useEffect, useRef, useState, type JSX } from 'react';

export interface LvHauntedSceneProps {
  /** Changes whenever any score on the board changes. */
  pulse: string;
}

/** The lit windows in haunted-house.svg (each 10×14), at their resting opacity. */
const WINDOWS: { x: number; y: number; rest: number }[] = [
  { x: 2174, y: 244, rest: 1 },
  { x: 2200, y: 244, rest: 0.35 },
  { x: 2232, y: 258, rest: 1 },
  { x: 2254, y: 258, rest: 0.5 },
  { x: 2276, y: 258, rest: 1 },
];

export default function LvHauntedScene({ pulse }: LvHauntedSceneProps): JSX.Element {
  const [plays, setPlays] = useState(0);
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (last.current === pulse) return;
    last.current = pulse;
    setPlays((n) => n + 1);
  }, [pulse]);

  return (
    <div className="lv-haunt-scene" aria-hidden="true">
      <svg className="lv-haunt-scene__svg" viewBox="0 0 2400 430" preserveAspectRatio="xMaxYMax meet">
        <defs>
          <radialGradient id="lvHauntSurge" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#3355c4" stopOpacity="0.9" />
            <stop offset="0.55" stopColor="#1d3170" stopOpacity="0.45" />
            <stop offset="1" stopColor="#0d1430" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lvHauntFog" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0a0a0c" stopOpacity="0" />
            <stop offset="1" stopColor="#0a0a0c" stopOpacity="1" />
          </linearGradient>
        </defs>
        {plays > 0 && (
          <ellipse
            key={`glow-${plays}`}
            className="lv-haunt-scene__glow"
            cx="2232"
            cy="236"
            rx="150"
            ry="115"
            fill="url(#lvHauntSurge)"
          />
        )}
        {/* The glow belongs BEHIND the house, but this layer sits over the
            background picture, so the hill, the house and its lit windows are
            redrawn here on top of it, copied from haunted-house.svg. They are
            pixel-for-pixel the background's own, so at rest nothing shows. */}
        <path
          d="M2010 300 C 2070 290 2130 300 2180 285 C 2240 268 2310 290 2400 270 L2400 430 L2010 430 Z"
          fill="#141018"
        />
        <g fill="#060508">
          <rect x="2206" y="190" width="12" height="40" />
          <path d="M2160 300 L2160 230 L2192 200 L2224 230 L2224 300 Z" />
          <path d="M2216 300 L2216 248 L2260 214 L2304 248 L2304 300 Z" />
          <path d="M2250 214 L2260 160 L2270 214 Z" />
          <rect x="2256" y="150" width="8" height="14" />
        </g>
        <g fill="#ff8a2a">
          {WINDOWS.map((w) => (
            <rect key={`${w.x}-${w.y}`} x={w.x} y={w.y} width="10" height="14" opacity={w.rest} />
          ))}
          <circle cx="2260" cy="196" r="5" />
        </g>
        <path
          d="M2010 360 C 2090 330 2170 320 2240 312 C 2310 305 2350 310 2400 300 L2400 430 L2010 430 Z"
          fill="#060508"
        />
        <g stroke="#060508" strokeWidth="5" fill="none" strokeLinecap="round">
          <path d="M2070 340 C 2068 300 2072 270 2066 230" />
          <path d="M2068 280 C 2050 268 2040 262 2028 250" />
          <path d="M2067 260 C 2084 246 2094 238 2108 236" />
          <path d="M2066 236 C 2056 222 2054 212 2046 204" />
        </g>
        <rect x="2010" y="300" width="390" height="130" fill="url(#lvHauntFog)" />
        {plays > 0 && (
          <g key={`windows-${plays}`}>
            {WINDOWS.map((w, i) => (
              <rect
                key={`${w.x}-${w.y}`}
                className={`lv-haunt-scene__window lv-haunt-scene__window--${i % 3}`}
                x={w.x}
                y={w.y}
                width="10"
                height="14"
              />
            ))}
            <circle className="lv-haunt-scene__window lv-haunt-scene__window--1" cx="2260" cy="196" r="5" />
          </g>
        )}
      </svg>
    </div>
  );
}
