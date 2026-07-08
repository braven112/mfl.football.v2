/**
 * NflGamesStrip — a self-contained, reusable rail of live NFL games.
 *
 * Shows every NFL game for a week with score, quarter/clock, and possession,
 * from /api/nfl-scoreboard (ESPN). Fetches on mount and polls while games are
 * live. Fully namespaced (.nfl-strip__*) with its own stylesheet
 * (src/styles/nfl-games-strip.css) so it can be dropped on any page — just
 * render the island and import the stylesheet.
 *
 * @example
 *   import NflGamesStrip from '../../components/shared/NflGamesStrip';
 *   import '../../styles/nfl-games-strip.css';
 *   <NflGamesStrip client:visible week={week} year={year} isLive={isLive} />
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NflGame, NflScoreboardResponse } from '../../types/live-scoring';
import { normalizeTeamCode } from '../../utils/nfl-logo';

const POLL_LIVE = 60_000;

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

  const teamLine = (side: 'away' | 'home') => {
    const t = game[side];
    const hasPoss = live && game.possession && game.possession === t.code;
    return (
      <div className="nfl-game__team">
        {t.code && <img className="nfl-game__logo" src={nflLogoUrl(t.code)} alt="" loading="lazy" />}
        <span className="nfl-game__code">{t.code || 'TBD'}</span>
        {hasPoss && <span className="nfl-game__poss" aria-label="has possession">●</span>}
        <span className="nfl-game__score">{pre ? '' : t.score}</span>
      </div>
    );
  };

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
      </footer>
    </article>
  );
}

export default function NflGamesStrip({ week, year, isLive, label = 'NFL Games', demo, initialGames }: NflGamesStripProps) {
  const [games, setGames] = useState<NflGame[]>(initialGames ?? []);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const url = new URL('/api/nfl-scoreboard', window.location.origin);
      url.searchParams.set('week', String(week));
      url.searchParams.set('year', String(year));
      const res = await fetch(url.toString());
      if (!res.ok) return;
      const data: NflScoreboardResponse = await res.json();
      setGames(data.games ?? []);
    } catch {
      /* best-effort rail */
    }
  }, [week, year]);

  useEffect(() => {
    if (demo) return; // sample data provided; don't hit the live feed
    load();
    if (!isLive) return;
    intervalRef.current = setInterval(load, POLL_LIVE);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load, isLive, demo]);

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
