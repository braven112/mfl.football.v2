/**
 * MFL Live — standings for every league you watch, under ONE switch.
 *
 * Each table is the league board's own `LvStandings`, so Live / Projected /
 * Final mean exactly what they mean on `/live/league/<id>`. The difference is
 * the switch: it sits above ALL the tables and drives them together
 * (`LvStandings`' controlled `mode`), because the point of this page is to
 * scan every league in the same view — a per-table toggle would let them
 * disagree.
 *
 * ── POLLING ──────────────────────────────────────────────────────────────
 * Same posture as `LiveBoard`: polling is UNCONDITIONAL and `isLive` only sets
 * the cadence; a failed poll keeps the last good tables; and a poll that
 * SUCCEEDS carrying a league we could not read holds that league's last good
 * table rather than replacing it with an error card mid-game. The hold is
 * keyed `(week, league)` — both leagues this site runs have a franchise
 * `0001`, so the league is part of every identity here.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import type { LiveStandingsLeague, MflLiveStandings } from '../../../utils/live/mfl-live-standings';
import { initialStandingsMode, type StandingsMode } from '../../../utils/live/standings-projection';
import type { FeedSnapshot } from '../../../utils/live-scoring-view';
import LvStandings from './LvStandings';
import LvFeedStatus from './LvFeedStatus';
import LvStandingsModeTabs from './LvStandingsModeTabs';

const POLL_LIVE_MS = 25_000;
const POLL_IDLE_MS = 90_000;

export interface LiveStandingsBoardProps {
  initial: MflLiveStandings;
  /** Omit for a static render (a story): no poller runs. */
  pollUrl?: string;
  /** A game-day hint. May RAISE the cadence; never decides whether to poll. */
  isLive?: boolean;
  /** Where each league's heading links — its full board. A string, since island props are JSON. */
  panelHrefBase?: string;
  /** No Owner Suite Pro: Live and Projected are locked and every table shows Final. */
  proLocked?: boolean;
}

interface HeldTable {
  table: LiveStandingsLeague;
  /** When this league's rows were last CONFIRMED, or 0 when they are current. */
  heldSince: number;
}

/**
 * Carry a league's last readable table across a poll that could not read it.
 * Exported for the test; the island is the only caller.
 */
export function holdLastGood(
  next: MflLiveStandings,
  memory: Map<string, { table: LiveStandingsLeague; at: number }>,
  now: number,
): HeldTable[] {
  return next.leagues.map((table) => {
    const key = `${next.week}:${table.leagueId}`;
    if (table.standings !== null) {
      memory.set(key, { table, at: now });
      return { table, heldSince: 0 };
    }
    const prior = memory.get(key);
    return prior ? { table: prior.table, heldSince: prior.at } : { table, heldSince: 0 };
  });
}

export default function LiveStandingsBoard({
  initial,
  pollUrl,
  isLive = false,
  panelHrefBase,
  proLocked = false,
}: LiveStandingsBoardProps): JSX.Element {
  const [mode, setMode] = useState<StandingsMode>(() => initialStandingsMode(proLocked));
  const memory = useRef(new Map<string, { table: LiveStandingsLeague; at: number }>());
  const [tables, setTables] = useState<HeldTable[]>(() => holdLastGood(initial, memory.current, Date.now()));
  const [feed, setFeed] = useState<FeedSnapshot>({ status: 'idle', fetchedAt: 0 });

  useEffect(() => {
    if (!pollUrl) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const cadence = isLive ? POLL_LIVE_MS : POLL_IDLE_MS;

    const tick = async () => {
      try {
        const res = await fetch(`${pollUrl}${pollUrl.includes('?') ? '&' : '?'}week=${initial.week}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        const data = await res.json();
        if (cancelled) return;
        // Gate on the FLAG — `res.ok` and a truthy `{}` are both worthless.
        if (data && data.ok === true && Array.isArray(data.leagues)) {
          setTables(holdLastGood(data as MflLiveStandings, memory.current, Date.now()));
          setFeed({ status: 'ok', fetchedAt: Date.now() });
        } else {
          setFeed((prev) => ({ status: 'error', fetchedAt: prev.fetchedAt }));
        }
      } catch {
        if (!cancelled) setFeed((prev) => ({ status: 'error', fetchedAt: prev.fetchedAt }));
      } finally {
        if (!cancelled) timer = setTimeout(tick, cadence);
      }
    };

    timer = setTimeout(tick, cadence);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pollUrl, initial.week, isLive]);

  if (tables.length === 0) {
    return (
      <div className="lv-empty" role="status">
        <p className="lv-empty__title">No leagues switched on</p>
        <p className="lv-empty__body">
          Pick the leagues you want to follow in{' '}
          <a href="/live/settings">Leagues &amp; settings</a> and their standings will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="lv-live-standings">
      <div className="lv-live-standings__bar">
        <h1 className="lv-live-standings__title">Standings · Week {initial.week}</h1>
        {pollUrl && <LvFeedStatus feeds={[feed]} anyLive={isLive} gamesLive={0} />}
      </div>
      <LvStandingsModeTabs
        mode={mode}
        onChange={setMode}
        ariaLabel="Standings view, all leagues"
        proLocked={proLocked}
      />

      <div className="lv-live-standings__grid">
        {tables.map(({ table, heldSince }) => (
          <section key={table.leagueId} className="lv-panel">
            <h2 className="lv-panel__name">
              {panelHrefBase ? (
                <a className="lv-panel__link" href={`${panelHrefBase}${encodeURIComponent(table.leagueId)}`}>
                  {table.leagueName}
                </a>
              ) : (
                table.leagueName
              )}
            </h2>
            {heldSince > 0 && (
              <p className="lv-live-standings__held" role="status">
                Couldn’t refresh this league — showing the table from{' '}
                {new Date(heldSince).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
              </p>
            )}
            <LvStandings
              rows={table.standings}
              leagueName={table.leagueName}
              matchups={table.matchups}
              mode={mode}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
