/**
 * Live Scoring Broadcast — the island.
 *
 * The ONE hydrated component on the page. It owns four clocks and nothing
 * else decides anything:
 *
 *   1. the poll loop (`/api/broadcast-live`),
 *   2. the reveal queue → the single active `Stage`,
 *   3. the strip's page rotation,
 *   4. the burn-in drift.
 *
 * Everything it renders is a props-only component, and every colour, crest and
 * name it passes down was resolved server-side. This file is timing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveBroadcastPageData, BroadcastLeagueScore, BroadcastTeam } from '../../../types/live-broadcast';
import type { BroadcastPollResponse } from '../../../types/live-broadcast';
import type { BroadcastMoment } from '../../../utils/broadcast-moments';
import { revealDuration, selectRevealQueue } from '../../../utils/broadcast-moments';
import {
  buildStripPages,
  countCells,
  densityTier,
  type StripPage,
} from '../../../utils/broadcast-layout';
import BroadcastScoreHeader from './BroadcastScoreHeader';
import BroadcastPlayerStrip from './BroadcastPlayerStrip';
import BroadcastScreensaver, { type SaverScene } from './BroadcastScreensaver';
import MomentTakeover from './MomentTakeover';
import MomentLowerThird from './MomentLowerThird';
import RedZoneBanner from './RedZoneBanner';

/**
 * Poll cadence. Slower than the draft board's 4s: this payload is N leagues
 * wide and a fantasy score moves more slowly than a draft pick.
 */
const POLL_MS = 8_000;
const POLL_BACKOFF_MS = 20_000;
const ERRORS_BEFORE_BACKOFF = 3;
/**
 * Two independent failsafes, neither optional on a screen that runs unattended
 * for eight hours. The loop is a SELF-CHAINING timeout, so a fetch that hangs
 * forever does not merely delay the next poll — it BREAKS the chain, and the
 * board freezes on whatever it last drew with no indication anything is wrong.
 * That exact failure froze the 2026 draft rehearsal board at pick 7.
 */
const POLL_TIMEOUT_MS = 15_000;
const POLL_WATCHDOG_MS = 40_000;

/** Past this, the board says so from ten feet rather than looking current. */
const STALE_MS = 5 * 60_000;
/** All games final this long → the screensaver takes over. */
const QUIET_MS = 10 * 60_000;

const STRIP_PAGE_MS = 12_000;
const SAVER_SCENE_MS = 30_000;
const SAVER_SCENES: SaverScene[] = ['slate', 'finals', 'clock'];

/** Burn-in orbit. The two periods are co-prime so the paths never coincide. */
const DRIFT_ROOT_MS = 90_000;
const DRIFT_GLYPH_MS = 97_000;
const DRIFT_POINTS = 12;

/**
 * One screen at a time. `occludes` is the load-bearing field: the draft board
 * hides its idle layer whenever any stage exists, which would be wrong here
 * because the lower-third must COEXIST with the scoreboard and strip.
 */
type Stage =
  | { key: string; kind: 'takeover'; moment: BroadcastMoment; occludes: 'strip' }
  | { key: string; kind: 'lower-third'; moment: BroadcastMoment; occludes: 'none' }
  | { key: string; kind: 'saver'; scene: SaverScene; occludes: 'all' };

interface Props {
  pageData: string;
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0.0');

export default function LiveBroadcast({ pageData }: Props) {
  const data = useMemo(() => JSON.parse(pageData) as LiveBroadcastPageData, [pageData]);

  const [poll, setPoll] = useState<BroadcastPollResponse>(data.initial);
  const [status, setStatus] = useState<'ok' | 'error' | 'pending'>('ok');
  const [fetchedAt, setFetchedAt] = useState<number>(() =>
    data.initial.ok ? Date.parse(data.initial.fetchedAt) || Date.now() : 0,
  );
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Keys that have already had their moment. A set of KEYS, not a queue of
  // payloads: the queue itself is derived from the current poll every time
  // (idempotent, nothing to drift), and the only thing worth remembering is
  // what has already been shown.
  const shownRef = useRef<Set<string>>(new Set());
  const [shownVersion, setShownVersion] = useState(0);

  const [pageIndex, setPageIndex] = useState(0);
  const [saverScene, setSaverScene] = useState(0);
  const [drift, setDrift] = useState({ x: 0, y: 0, y2: 0 });

  // ── the poll loop ────────────────────────────────────────────────────────
  const pollRef = useRef<{ timer: number | null; lastDone: number; errors: number }>({
    timer: null,
    lastDone: Date.now(),
    errors: 0,
  });

  const runPoll = useCallback(async () => {
    try {
      const params = new URLSearchParams({ leagues: data.enabled.join(','), week: String(data.week) });
      const res = await fetch(`/api/broadcast-live?${params}`, {
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
      const body = (await res.json()) as BroadcastPollResponse;

      // `res.ok` is not "the data is good", and `{}` is truthy. The route
      // answers 200 with ok:false and empty collections when MFL fails, so
      // gating on the presence of a field would wipe every score off a live
      // board while the freshness pill still reported the poll healthy.
      if (!res.ok || body?.ok === false) throw new Error('poll not ok');

      setPoll(body);
      setFetchedAt(Date.parse(body.fetchedAt) || Date.now());
      setStatus('ok');
      pollRef.current.errors = 0;
    } catch {
      // A failed poll KEEPS the last good data and only changes the STATUS.
      // "The feed says nothing" and "we could not reach the feed" are
      // different facts all the way to the pixels.
      pollRef.current.errors += 1;
      setStatus('error');
    } finally {
      pollRef.current.lastDone = Date.now();
    }
  }, [data.enabled, data.week]);

  useEffect(() => {
    let cancelled = false;

    const schedule = (ms: number) => {
      if (cancelled) return;
      pollRef.current.timer = window.setTimeout(tick, ms);
    };

    const tick = async () => {
      await runPoll();
      if (cancelled) return;
      schedule(pollRef.current.errors >= ERRORS_BEFORE_BACKOFF ? POLL_BACKOFF_MS : POLL_MS);
    };

    schedule(POLL_MS);

    // The watchdog exists because the chain above can be broken, not merely
    // delayed — a suspended machine, a throttled background tab, or a fetch
    // that never settles all leave `timer` pointing at a callback that will
    // not run. This is an independent interval that forces a poll when one
    // has not COMPLETED in too long.
    const watchdog = window.setInterval(() => {
      if (Date.now() - pollRef.current.lastDone > POLL_WATCHDOG_MS) {
        if (pollRef.current.timer) window.clearTimeout(pollRef.current.timer);
        void tick();
      }
    }, POLL_WATCHDOG_MS / 2);

    return () => {
      cancelled = true;
      if (pollRef.current.timer) window.clearTimeout(pollRef.current.timer);
      window.clearInterval(watchdog);
    };
  }, [runPoll]);

  /** A 1s heartbeat so the freshness age counts up and the saver clock ticks. */
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // ── burn-in drift ────────────────────────────────────────────────────────
  useEffect(() => {
    let step = 0;
    const root = window.setInterval(() => {
      step += 1;
      // A Lissajous walk rather than a circle, so the path does not close and
      // retrace itself every twelve steps.
      const a = (step / DRIFT_POINTS) * Math.PI * 2;
      setDrift((d) => ({ ...d, x: Math.cos(a) * 0.6, y: Math.sin(a * 1.5) * 0.6 }));
    }, DRIFT_ROOT_MS);

    let glyphStep = 0;
    const glyph = window.setInterval(() => {
      glyphStep += 1;
      setDrift((d) => ({ ...d, y2: (glyphStep % 2 === 0 ? 1 : -1) * 0.15 }));
    }, DRIFT_GLYPH_MS);

    return () => {
      window.clearInterval(root);
      window.clearInterval(glyph);
    };
  }, []);

  // ── derived board state ──────────────────────────────────────────────────
  const scoresByLeague = useMemo(() => {
    const out: Record<string, BroadcastLeagueScore> = {};
    for (const l of poll.leagues) out[l.leagueId] = l;
    return out;
  }, [poll.leagues]);

  const teamScores = useMemo(() => {
    const out: Record<string, Record<string, (typeof poll.leagues)[number]['teams'][string]>> = {};
    for (const l of poll.leagues) out[l.leagueId] = l.teams;
    return out;
  }, [poll.leagues]);

  const meta = useMemo(
    () => ({ ...data.playerMeta, ...(poll.playerMeta ?? {}) }),
    [data.playerMeta, poll.playerMeta],
  );

  const tier = useMemo(() => densityTier(countCells(data.panels)), [data.panels]);

  // Rows per page is derived from the tier rather than measured: a measured
  // value changes on every resize and would reshuffle the strip under the room.
  const rowsPerPage = tier <= 2 ? 6 : tier <= 4 ? 5 : 4;

  const pages = useMemo<StripPage[]>(
    () =>
      buildStripPages({
        panels: data.panels,
        scores: teamScores,
        meta,
        games: poll.games,
        rowsPerPage,
      }),
    [data.panels, teamScores, meta, poll.games, rowsPerPage],
  );

  const anyLive = useMemo(
    () => poll.games.some((g) => g.state === 'in') || poll.leagues.some((l) => l.live),
    [poll.games, poll.leagues],
  );

  /** How long the board has had nothing to say. Drives the screensaver. */
  const quietSinceRef = useRef<number>(anyLive ? 0 : Date.now());
  useEffect(() => {
    quietSinceRef.current = anyLive ? 0 : quietSinceRef.current || Date.now();
  }, [anyLive]);

  const isQuiet = !anyLive && quietSinceRef.current > 0 && nowTick - quietSinceRef.current > QUIET_MS;

  // ── the reveal queue ─────────────────────────────────────────────────────
  const queue = useMemo(
    () => selectRevealQueue(poll.moments, { now: nowTick, shown: shownRef.current }),
    // `shownVersion` is what re-derives this after a reveal completes; the ref
    // itself is deliberately not a dependency (mutating it must not re-render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [poll.moments, nowTick, shownVersion],
  );

  const current = queue[0] ?? null;

  /**
   * Retire the active moment after its hold.
   *
   * Keyed on the moment, never on `queue.length` — an effect that also
   * depended on depth would tear down and restart the timer every time a new
   * moment arrived, so a busy minute would hold the first reveal forever.
   */
  const queueDepthRef = useRef(queue.length);
  queueDepthRef.current = queue.length;

  useEffect(() => {
    if (!current) return;
    const hold = revealDuration(current, queueDepthRef.current);
    const id = window.setTimeout(() => {
      shownRef.current.add(current.key);
      setShownVersion((v) => v + 1);
    }, hold);
    return () => window.clearTimeout(id);
  }, [current?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the strip's rotation ─────────────────────────────────────────────────
  // Pauses while a stage occludes the strip, and resumes on the page it was on
  // with a FULL fresh dwell — the room's attention was on the reveal, so the
  // page they come back to has effectively not been read yet.
  const stripPaused = !!current || isQuiet;

  useEffect(() => {
    if (stripPaused || pages.length <= 1) return;
    const id = window.setTimeout(() => setPageIndex((i) => (i + 1) % pages.length), STRIP_PAGE_MS);
    return () => window.clearTimeout(id);
  }, [stripPaused, pageIndex, pages.length]);

  useEffect(() => {
    if (!isQuiet) return;
    const id = window.setInterval(
      () => setSaverScene((s) => (s + 1) % SAVER_SCENES.length),
      SAVER_SCENE_MS,
    );
    return () => window.clearInterval(id);
  }, [isQuiet]);

  // ── the single active stage ──────────────────────────────────────────────
  const stage: Stage | null = current
    ? current.side === 'mine'
      ? { key: current.key, kind: 'takeover', moment: current, occludes: 'strip' }
      : { key: current.key, kind: 'lower-third', moment: current, occludes: 'none' }
    : isQuiet
      ? { key: `saver:${SAVER_SCENES[saverScene]}`, kind: 'saver', scene: SAVER_SCENES[saverScene], occludes: 'all' }
      : null;

  const occludes = stage?.occludes ?? 'none';

  // ── the announcer ────────────────────────────────────────────────────────
  // Fires on stage OPEN only, never per poll. The queue already serializes, so
  // one sentence per reveal is the whole rate limit it needs.
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (!current) return;
    const who = current.side === 'mine' ? 'Your' : 'Your opponent’s';
    setAnnouncement(
      `${who} ${current.playerName} — ${current.text} in ${current.leagueName}.`,
    );
    const id = window.setTimeout(() => setAnnouncement(''), 1000);
    return () => window.clearTimeout(id);
  }, [current?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── sound (opt-in) ───────────────────────────────────────────────────────
  const [sound, setSound] = useState(data.sound);
  useEffect(() => {
    if (!sound || !current || current.side !== 'mine') return;
    // A short synthesized sting rather than an asset: there is no audio file
    // in the repo to ship, autoplay policy is satisfied by the user having
    // turned sound on, and a failure here must never break the board.
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.52);
      osc.onended = () => void ctx.close().catch(() => {});
    } catch {
      /* a board that cannot make a noise is still a board */
    }
  }, [current?.key, sound]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── presentation helpers ─────────────────────────────────────────────────
  const teamFor = useCallback(
    (m: BroadcastMoment): BroadcastTeam | null => {
      const panel = data.panels.find((p) => p.leagueId === m.leagueId);
      if (!panel) return null;
      for (const matchup of panel.matchups) {
        if (matchup.mine.franchiseId === m.franchiseId) return matchup.mine;
        if (matchup.opponent?.franchiseId === m.franchiseId) return matchup.opponent;
      }
      return null;
    },
    [data.panels],
  );

  /** "84.2 – 79.8 · TheLeague" — what the play did to the matchup. */
  const scoreLineFor = useCallback(
    (m: BroadcastMoment): string => {
      const panel = data.panels.find((p) => p.leagueId === m.leagueId);
      const league = scoresByLeague[m.leagueId];
      if (!panel || !league) return '';
      const matchup = panel.matchups[0];
      if (!matchup) return '';
      const mine = league.teams[matchup.mine.franchiseId];
      const theirs = matchup.opponent ? league.teams[matchup.opponent.franchiseId] : undefined;
      if (!mine) return '';
      return `${fmt(mine.live)} – ${fmt(theirs?.live ?? 0)}`;
    },
    [data.panels, scoresByLeague],
  );

  const ageMs = fetchedAt > 0 ? nowTick - fetchedAt : -1;
  const isStale = ageMs > STALE_MS;

  const rootStyle: Record<string, string> = {
    '--lbc-drift-x': `${drift.x}vw`,
    '--lbc-drift-y': `${drift.y}vh`,
    '--lbc-drift-y2': `${drift.y2}vh`,
    '--lbc-dim': isQuiet ? '0.72' : anyLive ? '1' : '0.86',
  };

  const page = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))] ?? null;

  return (
    <main className={`lbc${isStale ? ' is-stale' : ''}`} style={rootStyle} aria-label="Live scoring broadcast">
      <BroadcastScoreHeader
        panels={data.panels}
        scores={scoresByLeague}
        tier={tier}
        hidden={occludes === 'all'}
      />

      <BroadcastPlayerStrip
        page={page}
        rowsPerPage={rowsPerPage}
        hidden={occludes !== 'none'}
        // The lower third covers the bottom of the strip; those rows dim rather
        // than disappear, so the page does not appear to lose content.
        dimTail={stage?.kind === 'lower-third' ? 2 : 0}
      />

      {stage && (
        <div className={`lbc__stage lbc__stage--${stage.kind === 'saver' ? 'saver' : stage.kind}`} key={stage.key}>
          {stage.kind === 'takeover' && (
            <MomentTakeover
              moment={stage.moment}
              team={teamFor(stage.moment)}
              scoreLine={scoreLineFor(stage.moment)}
              position={meta[stage.moment.playerId]?.position ?? ''}
              nflTeam={meta[stage.moment.playerId]?.nflTeam ?? stage.moment.team}
              headshot={meta[stage.moment.playerId]?.headshot ?? ''}
            />
          )}
          {stage.kind === 'lower-third' && (
            <MomentLowerThird
              moment={stage.moment}
              team={teamFor(stage.moment)}
              scoreLine={scoreLineFor(stage.moment)}
              position={meta[stage.moment.playerId]?.position ?? ''}
            />
          )}
          {stage.kind === 'saver' && (
            <BroadcastScreensaver
              scene={stage.scene}
              panels={data.panels}
              scores={scoresByLeague}
              games={poll.games}
              now={new Date(nowTick).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              today={new Date(nowTick).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            />
          )}
        </div>
      )}

      <RedZoneBanner alerts={poll.redZone} />

      <div className="lbc__chrome">
        <button type="button" onClick={() => setSound((s) => !s)} aria-pressed={sound}>
          {sound ? 'Sound on' : 'Sound off'}
        </button>
        <button
          type="button"
          onClick={() => {
            const el = document.querySelector('.lbc');
            if (!document.fullscreenElement) void el?.requestFullscreen?.().catch(() => {});
            else void document.exitFullscreen().catch(() => {});
          }}
        >
          Fullscreen
        </button>
      </div>

      {(status === 'error' || isStale || fetchedAt === 0) && (
        <p className={`lbc__status${status === 'error' ? ' is-error' : ''}`}>
          {fetchedAt === 0
            ? 'Connecting…'
            : `Reconnecting — scores from ${Math.max(1, Math.round(ageMs / 60000))}m ago`}
        </p>
      )}

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </main>
  );
}
