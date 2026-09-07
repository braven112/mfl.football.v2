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
 * The network badge borrows the site-wide `.net-badge` primitive rather than
 * growing its own, so a card here and a lineup slot name a channel the same
 * way — hence the SECOND stylesheet import below.
 *
 * @example
 *   import NflGamesStrip from '../../components/shared/NflGamesStrip';
 *   import '../../styles/nfl-games-strip.css';
 *   import '../../styles/network-badge.css';
 *   <NflGamesStrip client:visible week={week} year={year} isLive={isLive} country={country} />
 */

import type { NflGame } from '../../types/live-scoring';
import { normalizeTeamCode } from '../../utils/nfl-logo';
import { nflLogoErrorHandler, nflLogoLoadHandler, nflLogoRefCallback } from '../../constants/roster-constants';
import { useNflScoreboard } from '../../hooks/useNflScoreboard';
import { resolveChannel, type CountryCode } from '../../utils/broadcast-channels';

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
  /**
   * Whose channel lineup to name — CBS at home, DAZN in Canada, Kayo in
   * Australia. Comes from the ROUTE (`readViewerClock`), because resolving a
   * viewer preference writes cookies and an island cannot.
   */
  country?: CountryCode;
}

function GameCard({ game, country }: { game: NflGame; country: CountryCode }) {
  const live = game.state === 'in';
  const pre = game.state === 'pre';
  // ESPN publishes the US network on the scoreboard payload; `resolveChannel`
  // turns it into what THIS viewer's country actually carries. null when ESPN
  // has not named one yet — normal for a game more than a week out — and the
  // badge is then simply absent rather than empty.
  const channel = resolveChannel(game.broadcast, country);
  const channelTitle = channel
    ? [channel.name, channel.note, channel.subscription].filter(Boolean).join(' · ')
    : '';
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
        <span className="nfl-game__status">
          {live ? (
            <span className="nfl-game__live"><span className="nfl-dot" />{game.shortDetail || `Q${game.period} ${game.clock}`}</span>
          ) : (
            <span className="nfl-game__pre">{game.state === 'post' ? 'Final' : game.shortDetail}</span>
          )}
          {downDistance && <span className="nfl-game__dd">{downDistance}</span>}
        </span>
        {channel && (
          channel.logo ? (
            <span className="net-badge net-badge--mark nfl-game__net" title={channelTitle}>
              <img className="net-badge__logo" src={channel.logo} alt={channel.name} decoding="async" />
            </span>
          ) : (
            <span className="net-badge nfl-game__net" title={channelTitle}>{channel.name}</span>
          )
        )}
      </footer>
    </article>
  );
}

export default function NflGamesStrip({ week, year, isLive, label = 'NFL Games', demo, initialGames, country = 'US' }: NflGamesStripProps) {
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
        {sorted.map((g) => <GameCard key={g.id} game={g} country={country} />)}
      </div>
    </section>
  );
}
