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
  splitPanels,
  type StripPage,
} from '../../../utils/broadcast-layout';
import BroadcastScoreHeader from './BroadcastScoreHeader';
import BroadcastPlayerStrip from './BroadcastPlayerStrip';
import BroadcastScreensaver, { type SaverScene } from './BroadcastScreensaver';
import MomentTakeover from './MomentTakeover';
import MomentLowerThird from './MomentLowerThird';
import RedZoneBanner from './RedZoneBanner';
import { DEMO_PERIOD_MS, demoElapsed, demoLoopIndex, demoPollAt } from '../../../utils/broadcast-demo';
import { carryLeagueScores, seedCarry, type CarriedLeagueScore } from '../../../utils/broadcast-carry';
import {
  POLL_TIMEOUT_MS,
  POLL_WATCHDOG_MS,
  QUIET_MS,
  RELOAD_CHECK_MS,
  STALE_MS,
  pollDelay,
  shouldReload,
  tickInterval,
  watchdogLimit,
} from '../../../utils/broadcast-cadence';



const STRIP_PAGE_MS = 12_000;
/** Must equal `--lbc-fade` in live-broadcast.css — the handoff's one duration. */
const FADE_MS = 930;
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

  /**
   * Is the overflow row expanded into full panels?
   *
   * Starts COLLAPSED every time and is deliberately not remembered in a
   * cookie. The board's default shape is the one an owner set up once and
   * walked away from; a television that came back from a power cut showing
   * six squeezed panels because of a click three Sundays ago is the failure
   * this whole split is fixing.
   */
  const [extrasOpen, setExtrasOpen] = useState(false);

  const [pageIndex, setPageIndex] = useState(0);
  /**
   * The page the strip is fading OUT of, cleared once the fade has run.
   * Without it only one page is ever mounted and the "cross-fade" is a cut.
   */
  const [outgoingKey, setOutgoingKey] = useState<string | null>(null);
  const [saverScene, setSaverScene] = useState(0);
  const [drift, setDrift] = useState({ x: 0, y: 0, x2: 0, y2: 0 });

  // ── the poll loop ────────────────────────────────────────────────────────
  const pollRef = useRef<{ timer: number | null; lastDone: number; errors: number }>({
    timer: null,
    lastDone: Date.now(),
    errors: 0,
  });

  /**
   * The board's current cadence tier, for the two loops that must not depend
   * on it.
   *
   * A REF, not a dependency. `isQuiet` flips as an afternoon winds down and
   * again when the night games start; making the poll effect depend on it
   * would tear down and rebuild the whole self-chaining loop — watchdog
   * included — on every crossing, which is exactly the shape that froze the
   * draft board. The next `schedule()` reads it, and that is soon enough for a
   * tier measured in minutes.
   */
  const idleRef = useRef(false);

  /**
   * Each league's last good numbers.
   *
   * A poll in which ONE league's MFL read failed is a successful poll — the
   * server says so on purpose ("one dead feed is not an outage") — so it
   * sails past the `body.ok === false` guard below carrying `teams: {}` for
   * that league, which renders as 0.0 / Proj 0.0 / 0 to play / an empty
   * strip. That is how a live 87.0 reset itself to zero every few polls on a
   * real Sunday. Seeded from the first paint so the very first poll can
   * already carry.
   */
  const carryRef = useRef<Map<string, CarriedLeagueScore>>(
    seedCarry(data.initial.leagues, Date.parse(data.initial.fetchedAt) || Date.now()),
  );

  /**
   * The rehearsal's origin, fixed at mount. Everything else about the demo is
   * a pure function of (now - this), so the loop is reproducible: the same
   * second of the loop always renders the same way, which is what makes it
   * usable for checking a fix rather than just watching something move.
   */
  const demoStartRef = useRef(Date.now());
  const demoLoopRef = useRef(0);

  const runPoll = useCallback(async () => {
    // The demo never touches the network, and the real poller never runs while
    // it is on — a rehearsal that could be confused with live scores would be
    // worse than no rehearsal.
    if (data.demo) return;
    try {
      const params = new URLSearchParams({ leagues: data.enabled.join(','), week: String(data.week) });
      // Forward `?testDate=` so the poll resolves the same SEASON the page
      // rendered. The server reads it off this request, not off the page's,
      // so leaving it out makes the two halves of one screen disagree across
      // the Labor Day boundary — the one date anybody passes a test date for.
      const testDate = new URLSearchParams(window.location.search).get('testDate');
      if (testDate) params.set('testDate', testDate);
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

      // Per-league retention, same rule as the whole-response one above and
      // for the same reason. Bounded by STALE_MS: past the age at which this
      // board stops claiming to be current, a frozen score is worse than an
      // honest empty one.
      const now = Date.now();
      const { leagues, carried } = carryLeagueScores(body.leagues, carryRef.current, now, STALE_MS);
      carryRef.current = carried;

      setPoll({ ...body, leagues });
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

  /**
   * Drive the board from the script instead of the network.
   *
   * One second, not the poll's eight: the rehearsal is being watched
   * deliberately, and a reveal landing up to eight seconds after its scripted
   * moment makes the timing impossible to judge.
   */
  useEffect(() => {
    if (!data.demo) return;
    const tick = () => {
      const now = Date.now();
      const loop = demoLoopIndex(now, demoStartRef.current);
      // A new loop replays the same moments, so the shown-set has to let them
      // through again — otherwise the rehearsal plays once and then sits idle.
      if (loop !== demoLoopRef.current) {
        demoLoopRef.current = loop;
        shownRef.current.clear();
        setShownVersion((v) => v + 1);
      }
      setPoll(
        demoPollAt({
          panels: data.panels,
          base: data.initial,
          playerMeta: data.playerMeta,
          now,
          startedAt: demoStartRef.current,
        }),
      );
      setFetchedAt(now);
      setStatus('ok');
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [data.demo, data.panels, data.initial, data.playerMeta]);

  useEffect(() => {
    if (data.demo) return;
    let cancelled = false;

    const schedule = (ms: number) => {
      if (cancelled) return;
      pollRef.current.timer = window.setTimeout(tick, ms);
    };

    const nextDelay = () =>
      pollDelay({ errors: pollRef.current.errors, idle: idleRef.current });

    const tick = async () => {
      await runPoll();
      if (cancelled) return;
      schedule(nextDelay());
    };

    schedule(nextDelay());

    // The watchdog exists because the chain above can be broken, not merely
    // delayed — a suspended machine, a throttled background tab, or a fetch
    // that never settles all leave `timer` pointing at a callback that will
    // not run. This is an independent interval that forces a poll when one
    // has not COMPLETED in too long.
    //
    // Its threshold TRACKS the cadence. Left at a flat 40s it would treat
    // every idle poll as a broken chain — 60s apart is longer than 40s — and
    // force a poll on its own 20s interval, which would quietly restore the
    // afternoon cadence overnight and negate the throttle entirely.
    const watchdog = window.setInterval(() => {
      if (Date.now() - pollRef.current.lastDone > watchdogLimit(idleRef.current)) {
        if (pollRef.current.timer) window.clearTimeout(pollRef.current.timer);
        void tick();
      }
    }, POLL_WATCHDOG_MS / 2);

    return () => {
      cancelled = true;
      if (pollRef.current.timer) window.clearTimeout(pollRef.current.timer);
      window.clearInterval(watchdog);
    };
  }, [runPoll, data.demo]);

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

    // A ring of its own, not a two-position flip.
    //
    // This was `(step % 2 ? 1 : -1) * 0.15` — a vertical square wave with a
    // total excursion of 0.3vh, about 3px at 1080p. An 11vh score numeral has
    // ~20px strokes, so the brightest, longest-lived pixels on the panel never
    // left their own stroke cores: sub-perceptual, and sub-PROTECTIVE, which is
    // the wrong side of that trade. Sized to roughly 1.5 stroke widths, still
    // well under the motion threshold at ~0.5 px/s.
    let glyphStep = 0;
    const glyph = window.setInterval(() => {
      glyphStep += 1;
      const a = (glyphStep / DRIFT_POINTS) * Math.PI * 2;
      setDrift((d) => ({ ...d, x2: Math.sin(a) * 0.3, y2: Math.cos(a * 1.5) * 0.3 }));
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

  /**
   * Which leagues get a full-size panel, and which get the thin row.
   *
   * `base` is the collapsed answer and it is computed EITHER WAY, because it
   * is the only thing that knows whether there are overflow leagues at all —
   * the expanded split has an empty `compact` by construction, so asking it
   * would make the control that collapses the row vanish the moment it was
   * used.
   */
  const base = useMemo(() => splitPanels(data.panels), [data.panels]);
  const hasExtras = base.compact.length > 0;
  /**
   * Expanded is still a SPLIT, not "every panel in the grid".
   *
   * `splitPanels` lifts the four-cell legibility cap here but keeps
   * `MAX_GRID_PANELS`, because that one is not a judgement — the stylesheet
   * declares columns and rows for eight panels and a ninth lands in an
   * implicit row inside a fixed-height, `overflow: hidden` header, where it is
   * not drawn at all. So an owner in nine leagues expands to eight panels and
   * the ninth stays on the compact row, legible, rather than vanishing.
   */
  const expanded = useMemo(
    () => splitPanels(data.panels, Number.POSITIVE_INFINITY),
    [data.panels],
  );
  const { featured, compact } = extrasOpen ? expanded : base;

  // `useCallback`, so the memoised header is not re-rendered by the 1 Hz
  // heartbeat handing it a new function identity every second.
  const toggleExtras = useCallback(() => setExtrasOpen((prev) => !prev), []);

  /**
   * Tier follows the FEATURED cells. The compact row is a fixed 4.6vh
   * whatever is in it, so an overflow league costs the panels above it no
   * type scale — which is the entire point of demoting it.
   */
  const tier = useMemo(() => densityTier(countCells(featured)), [featured]);

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

  /**
   * The marquee defenders for a team-defense moment, or undefined.
   *
   * Returned BY REFERENCE off the page data — no `.slice()`, no `.map()` here.
   * Either would mint a new array every render and defeat `MomentTakeover`'s
   * `memo()` on every one-second heartbeat, which is ~28,800 re-renders of the
   * reveal over a Sunday. The component does its own slicing.
   *
   * Gated on position HERE rather than inside the component: without it a
   * Kansas City wide receiver would resolve the Chiefs' defenders.
   *
   * Declared after `meta`, deliberately — it closes over it.
   */
  const defendersFor = useCallback(
    (m: BroadcastMoment) => {
      const who = meta[m.playerId];
      if ((who?.position ?? '').toUpperCase() !== 'DEF') return undefined;
      return data.defenseFaces[who?.nflTeam ?? ''];
    },
    [meta, data.defenseFaces],
  );

  /** How long the board has had nothing to say. Drives the screensaver. */
  const quietSinceRef = useRef<number>(anyLive ? 0 : Date.now());
  useEffect(() => {
    quietSinceRef.current = anyLive ? 0 : quietSinceRef.current || Date.now();
  }, [anyLive]);

  /**
   * Has anything happened this session at all?
   *
   * `QUIET_MS` is the right grace period for "the games just went final" — it
   * keeps the final scores up for a while. It is the WRONG answer for a board
   * opened when nothing has kicked off, where it means ten minutes of an
   * all-zero scoreboard: exactly the "screen of zeros, indistinguishable from
   * a broken board" the screensaver exists to prevent.
   */
  const everLive = poll.games.some((g) => g.state !== 'pre') || poll.leagues.some((l) => l.live);
  const isQuiet =
    !anyLive &&
    (!everLive || (quietSinceRef.current > 0 && nowTick - quietSinceRef.current > QUIET_MS));

  // Published on every render so the poll loop and the reload watchdog can
  // read the board's mood without either of them depending on it.
  idleRef.current = isQuiet;

  /**
   * The heartbeat that ages the freshness pill and drives the saver clock.
   *
   * Declared down HERE rather than beside the other timers, because it is the
   * one hook whose period depends on `isQuiet`. Quiet drops it from 1 Hz to a
   * tick every fifteen seconds: while the screensaver is up the only readers
   * of `nowTick` are an h:mm clock and an age printed in whole minutes,
   * neither of which can show the difference — and it is the POLL, not the
   * tick, that ends an idle, so the board still wakes on the first live score.
   */
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), tickInterval(isQuiet));
    return () => window.clearInterval(id);
  }, [isQuiet]);

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
   * Reboot the board rather than run one renderer for a whole weekend.
   *
   * Gated on `isQuiet` so it cannot fire during play, and re-checked against
   * the live stage inside the tick: `isQuiet` can be true with a moment still
   * revealing, because a reveal outranks the screensaver and a final play can
   * land after the last game has gone quiet. Uptime is measured from MOUNT, so
   * a board that reloads starts a fresh six hours rather than looping.
   */
  const mountedAtRef = useRef(Date.now());
  const currentRef = useRef<BroadcastMoment | null>(current);
  currentRef.current = current;

  useEffect(() => {
    // The rehearsal is watched deliberately and runs in minutes, not hours.
    if (data.demo || !isQuiet) return;
    const id = window.setInterval(() => {
      const go = shouldReload({
        demo: data.demo,
        idle: true,
        // Re-read per tick: `isQuiet` gates the effect, but a reveal outranks
        // the screensaver and can still be on screen while it holds.
        hasStage: !!currentRef.current,
        uptimeMs: Date.now() - mountedAtRef.current,
      });
      if (go) window.location.reload();
    }, RELOAD_CHECK_MS);
    return () => window.clearInterval(id);
  }, [isQuiet, data.demo]);

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
    const id = window.setTimeout(() => {
      setOutgoingKey(pages[pageIndex]?.key ?? null);
      setPageIndex((i) => (i + 1) % pages.length);
    }, STRIP_PAGE_MS);
    return () => window.clearTimeout(id);
  }, [stripPaused, pageIndex, pages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Unmount the outgoing page once its fade has finished. */
  useEffect(() => {
    if (!outgoingKey) return;
    const id = window.setTimeout(() => setOutgoingKey(null), FADE_MS);
    return () => window.clearTimeout(id);
  }, [outgoingKey]);

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

  /**
   * Red zone, announced once on ENTRY and once on EXIT — never re-read while
   * the drive runs. The banner itself is `aria-hidden`, because its text
   * carries down & distance and a live region would re-announce the whole
   * thing every play, competing with the reveal announcer.
   */
  const redZoneKey = poll.redZone.map((a) => a.team).sort().join(',');
  const lastRedZone = useRef('');
  useEffect(() => {
    if (redZoneKey === lastRedZone.current) return;
    const entering = redZoneKey !== '';
    const names = poll.redZone.flatMap((a) => a.players.map((p) => p.playerName));
    lastRedZone.current = redZoneKey;
    setAnnouncement(
      entering ? `Red zone: ${names.join(', ')}.` : 'Red-zone drive over.',
    );
    const id = window.setTimeout(() => setAnnouncement(''), 1000);
    return () => window.clearTimeout(id);
  }, [redZoneKey]); // eslint-disable-line react-hooks/exhaustive-deps
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

  /**
   * Whether the viewer has touched anything lately.
   *
   * This drives the CURSOR and nothing else now — the board carries no
   * controls at all (see the stylesheet's "No chrome on the board"). A cursor
   * parked over a television is a bright dot burning into a dark panel for
   * eight hours, so it goes away with everything else and comes back on a real
   * input EVENT. Never on `:hover`, which a resting cursor holds true all
   * afternoon — that was one of the three reasons the chrome kept shipping
   * visible.
   */
  const [awake, setAwake] = useState(false);

  /**
   * The board's one AudioContext, unlocked by a real gesture.
   *
   * The sting used to build a NEW `AudioContext` per moment on the claim that
   * "autoplay policy is satisfied by the user having turned sound on". It is
   * not: the preference is a cookie read at render, and a preference carried
   * from a previous document is not transient activation. A context
   * constructed without activation starts SUSPENDED, `osc.start()` schedules
   * against a clock that never advances, and nothing throws — so the board
   * appeared to work and made no sound at all, which is exactly what it did.
   *
   * One context, created on the first real input and resumed then and before
   * every sting. If nobody ever touches the television there is no sound;
   * that is a browser rule, not something to paper over, and the setup screen
   * says so rather than leaving it a mystery.
   */
  const audioRef = useRef<AudioContext | null>(null);

  const unlockAudio = useCallback(() => {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!audioRef.current) audioRef.current = new Ctx();
      if (audioRef.current.state === 'suspended') void audioRef.current.resume().catch(() => {});
    } catch {
      /* a board that cannot make a noise is still a board */
    }
  }, []);

  /** Persist the sound choice, so a television left on remembers it. */
  const rememberSound = useCallback((next: boolean) => {
    try {
      document.cookie = `bc_sound=${next ? '1' : '0'}; path=/; max-age=${180 * 24 * 60 * 60}; samesite=lax`;
    } catch {
      /* a board that cannot remember is still a board */
    }
  }, []);

  useEffect(() => {
    let timer = 0;
    const wake = () => {
      setAwake(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAwake(false), 3000);
    };
    // Any real input is also the activation the audio clock needs. Doing it
    // here rather than in a button handler is the point: there is no button.
    const onInput = () => {
      wake();
      unlockAudio();
    };
    // `pointermove` covers mouse and trackpad; `pointerdown`, `touchstart` and
    // `keydown` are the ways a television, a remote or a phone reaches this.
    for (const ev of ['pointermove', 'pointerdown', 'touchstart', 'keydown'] as const) {
      window.addEventListener(ev, onInput, { passive: true });
    }
    return () => {
      window.clearTimeout(timer);
      for (const ev of ['pointermove', 'pointerdown', 'touchstart', 'keydown'] as const) {
        window.removeEventListener(ev, onInput);
      }
    };
  }, [unlockAudio]);

  /**
   * The board's only controls, and they occupy no pixels.
   *
   * A keypress carries transient activation, which is what lets `F` request
   * fullscreen where the setup screen's link cannot — fullscreen does not
   * survive a navigation, so it has to be asked for from inside this document.
   * Everything else about the board is chosen up front on the setup screen.
   *
   * Single letters only, and never while something is focused for typing: this
   * page has no text input today, but a shortcut that eats a keystroke is the
   * kind of thing that is discovered much later.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;

      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        const root = document.querySelector('.lbc');
        if (!document.fullscreenElement) void root?.requestFullscreen?.().catch(() => {});
        else void document.exitFullscreen().catch(() => {});
      } else if (key === 'm') {
        e.preventDefault();
        setSound((prev) => {
          const next = !prev;
          rememberSound(next);
          // Announce it, or the strip above keeps its old label and computes
          // its next click from a stale value — a toggle that does not toggle.
          document.dispatchEvent(
            new CustomEvent('lbc:sound', { detail: { on: next, from: 'board' } }),
          );
          return next;
        });
        unlockAudio();
      } else if (key === 'l') {
        // Back to the setup screen. It is the only way off the board now that
        // the Leagues link is gone, and it stays a KEY rather than a chip for
        // the same reason the other two do: nothing may occupy pixels here.
        e.preventDefault();
        window.location.href = `${data.pathname}?picker=1`;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data.pathname, rememberSound, unlockAudio]);

  /**
   * The strip above the board and the board are on the same page, so the
   * toggle up there has to reach the island — otherwise the cookie changes and
   * nothing happens until a reload, which on a television is never.
   */
  useEffect(() => {
    const onSound = (e: Event) => {
      const detail = (e as CustomEvent<{ on: boolean; from?: string }>).detail;
      // Our own announcement, bounced back off the document.
      if (detail?.from === 'board') return;
      if (typeof detail?.on === 'boolean') setSound(detail.on);
      // The click that produced this IS the activation the audio clock needs.
      unlockAudio();
    };
    document.addEventListener('lbc:sound', onSound);

    // The strip sits ABOVE this island and is clickable before it hydrates, so
    // a fast click writes the cookie and dispatches into nothing. `data.sound`
    // was read at RENDER and can already be stale by the time we mount; the
    // cookie cannot be. Reconcile against it once.
    const m = document.cookie.match(/(?:^|;\s*)bc_sound=([01])/);
    if (m) setSound(m[1] === '1');

    return () => document.removeEventListener('lbc:sound', onSound);
  }, [unlockAudio]);

  useEffect(() => {
    if (!sound || !current || current.side !== 'mine') return;
    // A short synthesized sting rather than an asset: there is no audio file
    // in the repo to ship, and a failure here must never break the board.
    //
    // Reuses the ONE context and resumes it first. A context that is still
    // suspended here — nobody has touched the television — plays nothing, and
    // that is the honest outcome rather than a silent pretence of sound.
    const ctx = audioRef.current;
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
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
      // The context is NOT closed here — it is the board's one context and
      // closing it would un-unlock the audio for every later moment.
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          /* already torn down */
        }
      };
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
      // The matchup this moment actually belongs to — NOT `matchups[0]`. On a
      // doubleheader week that printed the other game's score under the
      // reveal, and "what did it do to the matchup" is the takeover's whole
      // justification.
      const matchup =
        panel.matchups.find(
          (cell) =>
            cell.mine.franchiseId === m.franchiseId ||
            cell.opponent?.franchiseId === m.franchiseId,
        ) ?? panel.matchups[0];
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
    '--lbc-drift-x2': `${drift.x2}vw`,
    '--lbc-drift-y2': `${drift.y2}vh`,
    '--lbc-dim': isQuiet ? '0.72' : anyLive ? '1' : '0.86',
    // The strip insets itself by this, so the banner never covers row one.
    '--lbc-redzone-h': poll.redZone.length > 0 ? '6.5vh' : '0px',
  };

  const page = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))] ?? null;
  const outgoing = outgoingKey ? (pages.find((p) => p.key === outgoingKey) ?? null) : null;

  return (
    <main
      className={`lbc is-board${isStale ? ' is-stale' : ''}${awake ? ' is-awake' : ''}`}
      style={rootStyle}
      aria-label="Live scoring broadcast"
    >
      <BroadcastScoreHeader
        panels={featured}
        compact={compact}
        hasExtras={hasExtras}
        expanded={extrasOpen}
        onToggleExtras={toggleExtras}
        scores={scoresByLeague}
        tier={tier}
        hidden={occludes === 'all'}
        games={poll.games}
        meta={meta}
      />

      <BroadcastPlayerStrip
        page={page}
        outgoing={outgoing}
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
              defenders={defendersFor(stage.moment)}
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

      {/* No Leagues / Sound / Fullscreen chips. They lived here, at the
          bottom-left, and shipped visible on a real television three times
          running — see the stylesheet's "No chrome on the board" for the three
          separate reasons a conditional hide kept losing. They are on the
          setup screen now (`?picker=1`), which is where the viewer already is
          before casting this to a TV, and `F` / `M` reach fullscreen and
          sound from here without occupying a pixel.

          The header's overflow-row toggle is the ONE exception, and it is the
          opposite shape: always rendered when it has something to toggle, in
          normal flow inside the header, never hidden and never re-shown. A
          keyboard shortcut is not reachable on the hardware this board is for
          (an Xbox browser has no keyboard), so the choice was a fixed, known
          4.6vh or a control the owner cannot reach at all. */}

      {(status === 'error' || isStale || fetchedAt === 0) && (
        <p className={`lbc__status${status === 'error' ? ' is-error' : ''}`}>
          {fetchedAt === 0
            ? 'Connecting…'
            : `Reconnecting — scores from ${Math.max(1, Math.round(ageMs / 60000))}m ago`}
        </p>
      )}

      {data.demo && (
        <p className="lbc__demo-badge">
          Demo · {Math.floor(demoElapsed(nowTick, demoStartRef.current) / 1000)}s of{' '}
          {DEMO_PERIOD_MS / 60_000}m · loops
        </p>
      )}

      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </main>
  );
}
