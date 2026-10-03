/**
 * The Projected / Live / Final switch — one component for both places it
 * appears: a league table's own toggle (`LvStandings`) and the single switch
 * over every table on `/live/standings` (`LiveStandingsBoard`).
 *
 * With `proLocked`, every view but Final is drawn LOCKED: still visible, so
 * the free tier can see what Pro adds, but disabled and badged "Pro", with one
 * line saying why. Only MFL Live passes it; the league sites never do.
 */
import type { JSX } from 'react';
import {
  STANDINGS_MODES,
  STANDINGS_MODE_LABEL,
  isStandingsModeLocked,
  type StandingsMode,
} from '../../../utils/live/standings-projection';

export interface LvStandingsModeTabsProps {
  mode: StandingsMode;
  onChange: (mode: StandingsMode) => void;
  ariaLabel: string;
  proLocked?: boolean;
}

export default function LvStandingsModeTabs({
  mode,
  onChange,
  ariaLabel,
  proLocked = false,
}: LvStandingsModeTabsProps): JSX.Element {
  return (
    <>
      <div className="lv-tabs lv-tabs--mode" role="group" aria-label={ariaLabel}>
        {STANDINGS_MODES.map((m) => {
          const locked = isStandingsModeLocked(m, proLocked);
          return (
            <button
              key={m}
              type="button"
              className={`lv-tabs__btn${mode === m ? ' lv-tabs__btn--on' : ''}${locked ? ' lv-tabs__btn--locked' : ''}`}
              aria-pressed={mode === m}
              disabled={locked}
              onClick={() => onChange(m)}
            >
              {STANDINGS_MODE_LABEL[m]}
              {locked && <span className="lv-pro-badge">Pro</span>}
            </button>
          );
        })}
      </div>
      {proLocked && (
        <p className="lv-pro-note">
          Live and Projected standings, updating as the games play, are part of Owner Suite Pro.
        </p>
      )}
    </>
  );
}
