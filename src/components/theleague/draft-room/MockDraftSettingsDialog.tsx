/**
 * MockDraftSettingsDialog — creator-only mid-draft controls for a mock
 * draft session. Two knobs, both applied instantly via the PartyKit socket:
 *
 *   - Pick clock: changes session.timerSeconds mid-draft (a running clock
 *     restarts at the new duration), so a slow mock can be sped up without
 *     abandoning the session.
 *   - Auto-draft per team: teams on Auto are CPU-picked instantly from
 *     their board; flipping a team to Manual puts its picks on the clock
 *     and lets the creator pick for it.
 *
 * State shown here comes straight from the synced session — the server
 * broadcasts after each change, so toggles reflect what actually applied.
 */

import React, { useEffect, useRef } from 'react';
import type { MockDraftSession, DraftRoomTeam } from '../../../types/draft-room';
import { isFranchiseAutoDrafted } from '../../../types/draft-room';
import { chooseTeamName } from '../../../utils/team-names';

const TIMER_OPTIONS: Array<{ seconds: number; label: string }> = [
  { seconds: 1, label: '1s' },
  { seconds: 3, label: '3s' },
  { seconds: 5, label: '5s' },
  { seconds: 10, label: '10s' },
  { seconds: 15, label: '15s' },
  { seconds: 30, label: '30s' },
  { seconds: 60, label: '1m' },
  { seconds: 120, label: '2m' },
  { seconds: 300, label: '5m' },
];

interface MockDraftSettingsDialogProps {
  session: MockDraftSession;
  teams: Map<string, DraftRoomTeam>;
  /** Franchise currently on the clock (highlights its row), null when idle */
  onClockFranchiseId: string | null;
  onSetTimer: (seconds: number) => void;
  onSetAutoDraft: (franchiseId: string, autoDraft: boolean) => void;
  onClose: () => void;
}

export function MockDraftSettingsDialog({
  session,
  teams,
  onClockFranchiseId,
  onSetTimer,
  onSetAutoDraft,
  onClose,
}: MockDraftSettingsDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // First-round order = one entry per franchise, in draft-slot order
  const franchiseIds = session.draftOrder.slice(0, session.picksPerRound);

  return (
    <div
      className="dr-confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dr-settings-title"
      onClick={onClose}
    >
      <div
        className="dr-confirm-dialog dr-settings-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dr-settings-dialog__header">
          <h2 id="dr-settings-title" className="dr-confirm-dialog__title">Draft Settings</h2>
          <button
            ref={closeRef}
            type="button"
            className="dr-settings-dialog__close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <section className="dr-settings-section">
          <h3 className="dr-settings-section__title">Pick clock</h3>
          <p className="dr-settings-section__hint">
            Applies immediately — a running clock restarts at the new time.
          </p>
          <div className="dr-settings-timer-chips" role="group" aria-label="Seconds per pick">
            {TIMER_OPTIONS.map((opt) => (
              <button
                key={opt.seconds}
                type="button"
                className="dr-settings-chip"
                aria-pressed={session.timerSeconds === opt.seconds}
                onClick={() => onSetTimer(opt.seconds)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </section>

        <section className="dr-settings-section">
          <h3 className="dr-settings-section__title">Team control</h3>
          <p className="dr-settings-section__hint">
            Auto teams pick instantly from their board. Switch a team to
            Manual to put its picks on the clock and make them yourself.
          </p>
          <ul className="dr-settings-teams">
            {franchiseIds.map((fid) => {
              const team = teams.get(fid);
              const label = team
                ? chooseTeamName({
                    fullName: team.name,
                    nameMedium: team.nameMedium,
                    nameShort: team.nameShort,
                    abbrev: team.abbrev,
                  })
                : fid;
              const isAuto = isFranchiseAutoDrafted(session, fid);
              const isOnClock = fid === onClockFranchiseId;
              return (
                <li key={fid} className="dr-settings-team-row">
                  <span className="dr-settings-team-row__identity">
                    {team?.icon ? (
                      <img className="dr-settings-team-row__icon" src={team.icon} alt="" />
                    ) : null}
                    <span className="dr-settings-team-row__name">
                      {label}
                      {fid === session.createdBy ? ' (you)' : ''}
                    </span>
                    {isOnClock ? (
                      <span className="dr-settings-team-row__on-clock">On the clock</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isAuto}
                    aria-label={`Auto-draft for ${label}`}
                    className="dr-settings-toggle"
                    data-auto={isAuto ? 'true' : 'false'}
                    onClick={() => onSetAutoDraft(fid, !isAuto)}
                  >
                    <span className="dr-settings-toggle__option">Manual</span>
                    <span className="dr-settings-toggle__option">Auto</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
