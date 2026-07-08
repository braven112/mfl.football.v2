/**
 * NflGamesStrip — the real-world context rail above the fantasy scoreboard.
 *
 * Shows every NFL game this week with score, quarter/clock, and possession,
 * from /api/nfl-scoreboard (ESPN). Fetches on mount and polls on the same
 * cadence as the fantasy scores while games are live.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NflGame, NflScoreboardResponse } from '../../types/live-scoring';
import { normalizeTeamCode } from '../../utils/nfl-logo';

const POLL_LIVE = 60_000;

const nflLogoUrl = (code: string) => (code ? `/assets/nfl-logos/${normalizeTeamCode(code)}.svg` : '');

function GameCard({ game }: { game: NflGame }) {
  const live = game.state === 'in';
  const pre = game.state === 'pre';

  const teamLine = (side: 'away' | 'home') => {
    const t = game[side];
    const hasPoss = live && game.possession && game.possession === t.code;
    return (
      <div className="ls-gteam">
        {t.code && <img className="ls-glogo" src={nflLogoUrl(t.code)} alt="" loading="lazy" />}
        <span className="ls-gcode">{t.code || 'TBD'}</span>
        {hasPoss && <span className="ls-gposs" aria-label="has possession">●</span>}
        <span className="ls-gscore">{pre ? '' : t.score}</span>
      </div>
    );
  };

  return (
    <article className={`ls-gcard ${game.state}`}>
      {teamLine('away')}
      {teamLine('home')}
      <footer className="ls-gfoot">
        {live ? (
          <span className="ls-glive"><span className="ls-dot live" />{game.shortDetail || `Q${game.period} ${game.clock}`}</span>
        ) : (
          <span className="ls-gpre">{game.state === 'post' ? 'Final' : game.shortDetail}</span>
        )}
      </footer>
    </article>
  );
}

export default function NflGamesStrip({ week, year, isLive }: { week: number; year: number; isLive: boolean }) {
  const [games, setGames] = useState<NflGame[]>([]);
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
    load();
    if (!isLive) return;
    intervalRef.current = setInterval(load, POLL_LIVE);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load, isLive]);

  if (games.length === 0) return null;

  // Live games first, then upcoming, then finals.
  const order = { in: 0, pre: 1, post: 2 } as const;
  const sorted = [...games].sort((a, b) => order[a.state] - order[b.state]);

  return (
    <section className="ls-nfl-strip" aria-label="NFL games">
      <span className="ls-strip-label">NFL Games</span>
      <div className="ls-strip-rail">
        {sorted.map((g) => <GameCard key={g.id} game={g} />)}
      </div>
    </section>
  );
}
