/**
 * A Standings tab cut into several tables under ONE Live / Projected / Final
 * switch — today the AFL's: its Premier League and D-League, then its
 * divisions (`utils/live/afl-live-standings.ts` decides what the sections
 * are; this component only draws them).
 *
 * One switch for every table, like `/live/standings`, so a tier and a
 * division can never be showing different moments.
 *
 * Nothing here knows about tiers, promotion or relegation. A section arrives
 * with its franchises in official order and, for any position that carries
 * one, a marker; the maths for each view lives in
 * `utils/live/standings-sections.ts`.
 */
import { useMemo, useState, type JSX } from 'react';
import type { LiveMatchup, LiveStandingsRow, LiveStandingsSections } from '../../../types/live';
import { initialStandingsMode, type StandingsMode } from '../../../utils/live/standings-projection';
import {
  projectAllPlaySection,
  projectRecordSection,
  type SectionView,
} from '../../../utils/live/standings-sections';
import { LvStandingsTable } from './LvStandings';
import LvStandingsModeTabs from './LvStandingsModeTabs';

export interface LvStandingsSectionsProps {
  /** MFL's rows, or null when the read failed. */
  rows: LiveStandingsRow[] | null;
  sections: LiveStandingsSections;
  leagueName: string;
  matchups?: readonly LiveMatchup[];
  initialMode?: StandingsMode;
}

function intro(mode: StandingsMode, addsWeek: boolean, allPlayInPlay: boolean): string {
  if (mode !== 'final' && !addsWeek) {
    return 'Nothing from this week to add yet, so these are the standings as of the last completed week.';
  }
  const tiers = allPlayInPlay
    ? ' The Premier League and D-League add this week’s score against all the other teams (all-play); the divisions add this week’s head-to-head results.'
    : '';
  switch (mode) {
    case 'live':
      return `If every game ended right now.${tiers} Re-ranked by record, then points; MFL’s tiebreakers apply only to Final.`;
    case 'projected':
      return `If every game ends as projected.${tiers} Re-ranked by record, then points; MFL’s tiebreakers apply only to Final.`;
    case 'final':
      return 'As of the last completed week. Records update when games go final, not with the live scores.';
  }
}

export default function LvStandingsSections({
  rows,
  sections,
  leagueName,
  matchups = [],
  initialMode,
}: LvStandingsSectionsProps): JSX.Element {
  const [mode, setMode] = useState<StandingsMode>(() => initialStandingsMode(false, initialMode));
  const rowsById = useMemo(
    () => new Map((rows ?? []).map((row) => [row.franchiseId, row])),
    [rows],
  );

  const views = useMemo(() => {
    const out = new Map<string, SectionView | null>();
    for (const group of sections.groups) {
      for (const section of group.sections) {
        if (section.basis === 'all-play') {
          out.set(
            section.id,
            sections.allPlay
              ? projectAllPlaySection(rowsById, section, sections.allPlay, matchups, mode)
              : null,
          );
        } else {
          out.set(section.id, projectRecordSection(rowsById, section, matchups, mode));
        }
      }
    }
    return out;
  }, [sections, rowsById, matchups, mode]);

  if (rows === null) {
    return (
      <div className="lv-empty lv-empty--unavailable" role="status">
        <p className="lv-empty__title">Couldn’t read the standings</p>
        <p className="lv-empty__body">
          We reached MyFantasyLeague for {leagueName}’s standings and didn’t get them. These
          are missing, not zeros. Refreshing usually sorts it.
        </p>
      </div>
    );
  }

  const addsWeek = [...views.values()].some((v) => v?.addsWeek);
  const allPlayInPlay = sections.allPlay?.weekInCompetition === true && !sections.allPlay.weekCounted;

  return (
    <div className="lv-standings-wrap lv-sections">
      <LvStandingsModeTabs mode={mode} onChange={setMode} ariaLabel="Standings view" />
      <p className="lv-sections__intro">{intro(mode, addsWeek, allPlayInPlay)}</p>
      {sections.groups.map((group) => (
        <section key={group.id} className="lv-sections__group" aria-label={group.title}>
          <h2 className="lv-sections__title">{group.title}</h2>
          <div className="lv-sections__grid">
            {group.sections.map((section) => {
              const view = views.get(section.id);
              const heading = (
                <span className="lv-sections__heading">
                  {section.logo && (
                    <>
                      <img
                        className="theme-img theme-img--light lv-sections__logo"
                        src={section.logo.src}
                        alt=""
                        loading="lazy"
                      />
                      <img
                        className="theme-img theme-img--dark lv-sections__logo"
                        src={section.logo.darkSrc}
                        alt=""
                        loading="lazy"
                      />
                    </>
                  )}
                  <span className="lv-sections__name">{section.title}</span>
                </span>
              );
              if (!view) {
                return (
                  <div key={section.id} className="lv-standings lv-sections__missing" role="status">
                    <p className="lv-standings__caption">
                      {heading}
                      <span className="lv-sections__note">
                        Couldn’t read the all-play records, so this table is missing rather than zero.
                      </span>
                    </p>
                  </div>
                );
              }
              const allPlay = section.basis === 'all-play';
              return (
                <LvStandingsTable
                  key={section.id}
                  rows={view.rows}
                  caption={heading}
                  recordLabel={allPlay ? 'All-Play' : 'W-L'}
                  recordTitle={allPlay ? 'All-play record: every week against every other team' : undefined}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
