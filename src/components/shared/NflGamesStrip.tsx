/**
 * NflGamesStrip — a self-contained, reusable rail of live NFL games.
 *
 * Shows every NFL game for a week with score, quarter/clock, possession, and
 * the live drive situation (red zone / down & distance), from
 * /api/nfl-scoreboard (ESPN) via the SHARED useNflScoreboard poller — so
 * dropping this alongside another island that wants the scoreboard costs no
 * extra fetch. Fully namespaced (.nfl-strip__*) with its own stylesheet
 * (src/styles/nfl-games-strip.css) so it can be dropped on any page — just
 * render the island and import the stylesheet.
 *
 * @example
 *   import NflGamesStrip from '../../components/shared/NflGamesStrip';
 *   import '../../styles/nfl-games-strip.css';
 *   <NflGamesStrip client:visible week={week} year={year} isLive={isLive} />
 */

import type { NflGame } from '../../types/live-scoring';
import { normalizeTeamCode } from '../../utils/nfl-logo';
import { nflLogoErrorHandler, nflLogoLoadHandler, nflLogoRefCallback } from '../../constants/roster-constants';
import { useNflScoreboard } from '../../hooks/useNflScoreboard';

const nflLogoUrl = (code: string) => (code ? `/assets/nfl-logos/${normalizeTeamCode(code)}.svg` : '');

export interface NflGamesStripProps {
  week: number;
  year: number;
  /** Poll for updates while true (games in progress). */
  isLive?: boolean;
  /** Optional heading; pass null to hide it. */
  label?: string | null;
  /** Demo mode: render initialGames and skip the live fetch. */
  demo?: boolean;
  initialGames?: NflGame[];
}

function GameCard({ game }: { game: NflGame }) {
  const live = game.state === 'in';
  const pre = game.state === 'pre';
  // The red zone belongs to whoever HAS THE BALL, so the flag is drawn on the
  // possessing team's line and nowhere else.
  const redZoneTeam = live && game.situation?.isRedZone ? game.situation.possession : '';

  const teamLine = (side: 'away' | 'home') => {
    const t = game[side];
    const hasPoss = live && game.possession && game.possession === t.code;
    const inRedZone = !!redZoneTeam && redZoneTeam === t.code;
    return (
      <div className={`nfl-game__team${inRedZone ? ' redzone' : ''}`}>
        {t.code && <img className="nfl-game__logo" src={nflLogoUrl(t.code)} alt="" loading="lazy" onError={nflLogoErrorHandler} onLoad={nflLogoLoadHandler} ref={nflLogoRefCallback} />}
        <span className="nfl-game__code">{t.code || 'TBD'}</span>
        {hasPoss && <span className="nfl-game__poss" aria-label="has possession">●</span>}
        {inRedZone && <span className="nfl-game__rz" title="In the red zone">RZ</span>}
        <span className="nfl-game__score">{pre ? '' : t.score}</span>
      </div>
    );
  };

  const downDistance = live ? game.situation?.shortDownDistanceText ?? '' : '';

  return (
    <article className={`nfl-game ${game.state}`}>
      {teamLine('away')}
      {teamLine('home')}
      <footer className="nfl-game__foot">
        {live ? (
          <span className="nfl-game__live"><span className="nfl-dot" />{game.shortDetail || `Q${game.period} ${game.clock}`}</span>
        ) : (
          <span className="nfl-game__pre">{game.state === 'post' ? 'Final' : game.shortDetail}</span>
        )}
        {downDistance && <span className="nfl-game__dd">{downDistance}</span>}
      </footer>
    </article>
  );
}

export default function NflGamesStrip({ week, year, isLive, label = 'NFL Games', demo, initialGames }: NflGamesStripProps) {
  // Demo mode renders the bundled sample and does no network at all, so the
  // live feed can't overwrite it.
  const { games } = useNflScoreboard(week, year, {
    enabled: !demo,
    live: !!isLive,
    fallbackGames: initialGames,
  });

  // Nothing to show and nothing to explain — this is a decorative rail, and a
  // failed scoreboard fetch is reported by the page's own status, not here.
  if (games.length === 0) return null;

  // Live games first, then upcoming, then finals.
  const order = { in: 0, pre: 1, post: 2 } as const;
  const sorted = [...games].sort((a, b) => order[a.state] - order[b.state]);

  return (
    <section className="nfl-strip" aria-label={label ?? 'NFL games'}>
      {label && <span className="nfl-strip__label">{label}</span>}
      <div className="nfl-strip__rail">
        {sorted.map((g) => <GameCard key={g.id} game={g} />)}
      </div>
    </section>
  );
}
