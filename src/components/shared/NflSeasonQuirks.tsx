/**
 * "This NFL season's quirks" — the note on the Schedule Release page.
 *
 * The opener, every Christmas Day game and every Tuesday, Wednesday or Friday
 * game of the season being released, in Pacific time (owner's list,
 * 2026-11-23). It renders in BOTH states of the page: the NFL publishes in
 * mid-May, before either league's fantasy reveal, so owners see the odd weeks
 * coming before they see their own schedule.
 *
 * `showWaivers` (commissioners only) marks the Tuesday and Wednesday games,
 * which land before the leagues' Wednesday-evening waiver run. Owners do not
 * see that chip: once the run is moved on MFL it would be wrong.
 *
 * Data: src/data/nfl/season-quirks.mjs, generated daily by
 * scripts/fetch-nfl-season-quirks.mjs.
 */
import { NFL_SEASON_QUIRKS } from '../../data/nfl/season-quirks.mjs';

type Quirk = (typeof NFL_SEASON_QUIRKS)[number][number];

const TAG_LABEL: Record<string, string> = {
  opener: 'Season opener',
  christmas: 'Christmas Day',
  tuesday: 'Tuesday game',
  wednesday: 'Wednesday game',
  friday: 'Friday game',
};

interface Props {
  year: number;
  showWaivers?: boolean;
}

export default function NflSeasonQuirks({ year, showWaivers = false }: Props) {
  const quirks: Quirk[] | undefined = (NFL_SEASON_QUIRKS as Record<number, Quirk[]>)[year];

  return (
    <section className="rel__quirks" aria-labelledby="rel-quirks-title">
      <h3 className="rel__h3" id="rel-quirks-title">
        Quirks of the {year} NFL season
      </h3>
      {!quirks ? (
        <p className="rel__quirksEmpty">
          The NFL hasn't released its {year} schedule yet. The opener, Christmas games and any Tuesday, Wednesday or
          Friday games will show here once it does.
        </p>
      ) : quirks.length === 0 ? (
        <p className="rel__quirksEmpty">A by-the-book season: no Christmas, Tuesday, Wednesday or Friday games.</p>
      ) : (
        <ul className="rel__quirkList">
          {quirks.map((q) => (
            <li key={`${q.kickoff}-${q.home}`} className="rel__quirk">
              <div className="rel__quirkWhen">
                <span className="rel__quirkDate">{q.label}</span>
                <span className="rel__quirkTime">{q.time} PT</span>
              </div>
              <div className="rel__quirkWhat">
                <span className="rel__quirkGame">
                  {q.awayName} at {q.homeName}
                  <span className="rel__quirkWeek"> · Week {q.week}</span>
                </span>
                <span className="rel__quirkTags">
                  {q.tags.map((t) => (
                    <span key={t} className={`rel__quirkTag rel__quirkTag--${t}`}>
                      {TAG_LABEL[t] ?? t}
                    </span>
                  ))}
                  {showWaivers && q.affectsWaivers && (
                    <span className="rel__quirkTag rel__quirkTag--waivers">Kicks off before waivers</span>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
