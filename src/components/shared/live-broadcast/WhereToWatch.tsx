/**
 * Where to watch — the NFL games the owner's starters are in, grouped by day,
 * each with its channel and the TV app that opens it.
 *
 * The rows are the overlay's Watch list (`overlayWatchList`, uncapped) over
 * the board's own poll, turned into channels and apps by `watchRows`. OK on a
 * row goes to the TV app through `window.MflTvHost`: `open` launches an app,
 * `search` asks the TV's own search for the game. Without the bridge (a
 * browser, an app build before it) the rows still say where each game is on,
 * and say once where the button works.
 *
 * Up/Down moves between rows on a remote; the browser's own focus does the
 * rest, so every row is a real button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BroadcastPollResponse, LiveBroadcastPageData } from '../../../types/live-broadcast';
import type { PlayerMeta } from '../../../types/live-scoring';
import { overlayGames, overlayWatchList } from '../../../utils/broadcast-overlay';
import type { CountryCode } from '../../../utils/broadcast-channels';
import { parseInstalledApps, watchRows, type InstalledApp, type WatchRow } from '../../../utils/where-to-watch';

/** Kickoffs and channels move slowly; the live clock is a nicety here, not the point. */
const POLL_MS = 60_000;
const POLL_TIMEOUT_MS = 12_000;

declare global {
  interface Window {
    /** The Google TV app's bridge for this screen. Absent in a browser and on app builds before it. */
    MflTvHost?: {
      /** JSON `[{ pkg, label }]` of the apps the TV can launch. */
      apps: () => string;
      /** Launch an installed app by package; false when the TV can't. */
      open: (pkg: string) => boolean;
      /** The TV's own search for a game, else `fallback` opened; false when neither worked. */
      search: (query: string, fallback: string) => boolean;
    };
  }
}

interface Props {
  pageData: string;
  country: CountryCode;
  sundayTicket: boolean;
  /** A paired TV: take the remote's first focus. */
  tv: boolean;
}

function dayLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'This week';
  const key = (d: Date) => d.toDateString();
  if (key(at) === key(now)) return 'Today';
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (key(at) === key(tomorrow)) return 'Tomorrow';
  return at.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** The TV's own clock: it is the device the owner is sitting in front of. */
function kickoffTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function WhereToWatch({ pageData, country, sundayTicket, tv }: Props) {
  const data = useMemo(() => JSON.parse(pageData) as LiveBroadcastPageData, [pageData]);
  const [poll, setPoll] = useState<BroadcastPollResponse | null>(data.initial ?? null);
  const [meta, setMeta] = useState<Record<string, PlayerMeta>>(data.playerMeta ?? {});
  const [installed, setInstalled] = useState<InstalledApp[] | null>(null);
  const [hasHost, setHasHost] = useState(false);
  const [notice, setNotice] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = window.MflTvHost;
    setHasHost(Boolean(host));
    if (!host) return;
    try {
      setInstalled(parseInstalledApps(host.apps()));
    } catch {
      setInstalled(null);
    }
  }, []);

  useEffect(() => {
    if (data.demo) return;
    let cancelled = false;
    let timer: number | undefined;
    const run = async () => {
      try {
        const params = new URLSearchParams({ leagues: data.enabled.join(','), week: String(data.week) });
        const testDate = new URLSearchParams(window.location.search).get('testDate');
        if (testDate) params.set('testDate', testDate);
        const res = await fetch(`/api/broadcast-live?${params}`, {
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
          headers: { accept: 'application/json' },
        });
        const body = (await res.json()) as BroadcastPollResponse;
        if (res.ok && body?.ok !== false && !cancelled) {
          setPoll(body);
          if (body.playerMeta) setMeta((prev) => ({ ...prev, ...body.playerMeta }));
        }
      } catch {
        // Keep the last good rows; a kickoff time does not go stale in a minute.
      }
      if (!cancelled) timer = window.setTimeout(run, POLL_MS);
    };
    timer = window.setTimeout(run, POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [data]);

  const rows = useMemo<WatchRow[]>(() => {
    if (!poll) return [];
    const games = overlayGames(data.panels, poll, meta);
    return watchRows(overlayWatchList(games, poll.games ?? [], Infinity), { country, sundayTicket, installed });
  }, [data, poll, meta, country, sundayTicket, installed]);

  const groups = useMemo(() => {
    const now = new Date();
    const out: { day: string; rows: WatchRow[] }[] = [];
    for (const row of rows) {
      const day = row.live ? 'On now' : dayLabel(row.kickoff, now);
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(row);
      else out.push({ day, rows: [row] });
    }
    return out;
  }, [rows]);

  // A paired TV starts on the first game, so OK does something straight away.
  useEffect(() => {
    if (!tv) return;
    listRef.current?.querySelector<HTMLButtonElement>('.wtw__row')?.focus();
  }, [tv, rows.length > 0]);

  const onKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('.wtw__row') ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      e.preventDefault();
      next.focus();
      next.scrollIntoView({ block: 'nearest' });
    }
  }, []);

  const watch = useCallback((row: WatchRow) => {
    const host = window.MflTvHost;
    if (!host) {
      setNotice('Open this screen in the MFL Football app on your TV to start a game from here.');
      return;
    }
    const ok =
      row.action.kind === 'app' ? host.open(row.action.pkg) : host.search(row.action.query, row.action.fallback ?? '');
    if (!ok) setNotice(`This TV couldn’t open that. Search for “${row.query}” on your TV.`);
  }, []);

  return (
    <section className="wtw">
      <header className="wtw__head">
        <h1 className="wtw__title">Where to watch</h1>
        <p className="wtw__sub">
          Week {data.week} · the NFL games your starters are in
          {country !== 'US' ? ` · channels for ${country === 'CA' ? 'Canada' : country}` : ''}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="wtw__none">None of your starters have a game left to watch this week.</p>
      ) : (
        <div className="wtw__list" ref={listRef} onKeyDown={onKey}>
          {groups.map((group) => (
            <div className="wtw__day" key={group.day}>
              <h2 className="wtw__day-label">{group.day}</h2>
              {group.rows.map((row) => (
                <button type="button" className="wtw__row" key={row.id} onClick={() => watch(row)}>
                  <span className={row.live ? 'wtw__when wtw__when--live' : 'wtw__when'}>
                    {row.live ? row.detail || 'Live' : kickoffTime(row.kickoff)}
                  </span>
                  <span className="wtw__game">
                    <b>{row.label}</b>
                    <span className="wtw__players">{row.players.join(' · ')}</span>
                  </span>
                  <span className="wtw__how">
                    {row.channel ? (
                      row.channel.logo ? (
                        <img className="wtw__logo" src={row.channel.logo} alt={row.channel.name} />
                      ) : (
                        <span className="wtw__net">{row.channel.name}</span>
                      )
                    ) : null}
                    <span className={row.maybe ? 'wtw__app wtw__app--maybe' : 'wtw__app'}>{row.how}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <p className="wtw__foot" role="status">
        {notice ||
          (hasHost
            ? 'Press OK on a game to open it.'
            : 'On the MFL Football TV app, pick a game to open it in YouTube TV, Prime Video, Netflix or DAZN.')}
      </p>
    </section>
  );
}
