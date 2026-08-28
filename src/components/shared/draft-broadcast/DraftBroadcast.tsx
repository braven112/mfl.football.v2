/**
 * DraftBroadcast — the AFL draft-night TV board.
 *
 * Owns the live half of `/afl-fantasy/draft-broadcast`: poll MFL, diff the
 * board, queue reveals, and swap between the reveal and the idle screen. The
 * static half (board skeleton, franchise brands, player pool) is SSR'd and
 * arrives as `pageData` — nothing on this screen depends on a client fetch
 * landing, so a dropped poll degrades to "no new picks yet", never a blank TV.
 *
 * Three states, in order of how much of the night they own:
 *   pre-draft  → nothing picked yet: draft order and the room's first pick
 *   idle       → who's on the clock, recent picks, who's next (most of the night)
 *   reveal     → a selection just landed (the moment everyone looks up)
 *
 * The idle board and the reveal are LAYERS, not alternatives — see the render
 * at the bottom. Both stay mounted and cross-fade, and the crest and copy they
 * have in common travel between their two positions across that fade (see
 * `broadcast-morph.ts`), because a hard swap between them looked like somebody
 * changing the channel.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DraftRoomPick, DraftRoomTeam, DraftStatusResponse } from '../../../types/draft-room';
import type {
  BroadcastConference,
  BroadcastPlayer,
  DraftBroadcastPageData,
} from '../../../types/draft-broadcast';
import { collectFreshPicks } from '../../../utils/pick-reveal';
import { applyRehearsal, findOnTheClock, playerMap, teamMap } from '../../../utils/draft-broadcast';
import { morphScreens } from '../../../utils/broadcast-morph';
import { BroadcastRevealCard } from './BroadcastRevealCard';
import { OnTheClock } from './OnTheClock';

/**
 * `useLayoutEffect` on the client, a no-op `useEffect` on the server.
 *
 * This island is `client:load`, so it IS rendered once on the server, and React
 * logs "useLayoutEffect does nothing on the server" for every layout effect it
 * meets there — once per request to the broadcast page. The morph genuinely
 * needs layout timing in the browser (it measures both screens before the
 * browser paints the new arrangement) and needs nothing at all on the server,
 * which is exactly what this alias says.
 */
const useIsomorphicLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** Poll cadence. The draft room's 12s/30s is tuned for an EMAIL draft; a room
 *  full of people watching a TV notices a 30s lag between the pick landing on
 *  MFL and the screen reacting. 5s is well inside MFL's tolerance for a public
 *  export and keeps the reveal feeling like it's responding to the room. */
const POLL_MS = 5_000;
/** After repeated failures, stop hammering — but keep trying, quietly. */
const POLL_BACKOFF_MS = 15_000;
const ERRORS_BEFORE_BACKOFF = 3;

/** How long one reveal owns the screen, and the hurry-up when picks stack. */
const REVEAL_MS = 18_000;
const REVEAL_RUSH_MS = 6_000;
/** Queue depth past which we switch to the rush duration to catch up. */
const RUSH_THRESHOLD = 3;

/** Rehearsal cadence — a pick every ~35s, so a dry run plays at draft pace
 *  and each reveal gets its full turn on screen rather than being rushed.
 *
 *  Rehearsal deliberately does NOT reuse the live pair. Live, the idle board is
 *  what fills the real gaps between picks, so the reveal can afford to be long.
 *  In a dry run the step is the ONLY thing separating one pick from the next,
 *  and at 20s against an 18s hold the idle board flashed past in ~2s — the half
 *  of the screen you most need to look at while rehearsing was the half you
 *  never saw. A longer step and a shorter hold trade reveal time for idle time
 *  (~27s of board, vs ~2s) without touching draft night's timing. */
const REHEARSE_STEP_MS = 35_000;
const REHEARSE_REVEAL_MS = 8_000;

interface Props {
  pageData: string;
  conferences: string;
}

interface QueuedReveal {
  key: string;
  pick: DraftRoomPick;
}

export default function DraftBroadcast({ pageData, conferences }: Props) {
  const data = useMemo(() => JSON.parse(pageData) as DraftBroadcastPageData, [pageData]);
  const allConferences = useMemo(
    () => JSON.parse(conferences) as BroadcastConference[],
    [conferences]
  );

  const rehearsing = data.rehearseUpTo !== undefined;

  // In rehearsal the SSR board is the COMPLETE season; the starting state is
  // that board trimmed back to `rehearseUpTo`, and the replay effect rolls it
  // forward from there.
  const [picks, setPicks] = useState<DraftRoomPick[]>(() =>
    rehearsing ? applyRehearsal(data.picks, data.rehearseUpTo!) : data.picks
  );
  const [queue, setQueue] = useState<QueuedReveal[]>([]);
  const [connectionLost, setConnectionLost] = useState(false);

  const teams = useMemo(() => teamMap(data.teams), [data.teams]);
  const players = useMemo(() => playerMap(data.players), [data.players]);

  /**
   * Slots we've already accounted for. Seeded from the SSR board on mount and
   * NEVER null after that. Note the SSR board is a deployed snapshot, so this
   * seed alone does not cover picks made since it was cut — see
   * `absorbedFirstPollRef`.
   */
  const seenRef = useRef<Set<number>>(
    new Set(
      (rehearsing ? applyRehearsal(data.picks, data.rehearseUpTo!) : data.picks)
        .filter((p) => p.playerId)
        .map((p) => p.overallPickNumber)
    )
  );
  /** Board size as of the LAST poll — drives collectFreshPicks' slot-sync
   *  guard, which only means anything when the slot array goes 0 → N. The AFL
   *  publishes all 108 slots before the draft starts, so that guard never
   *  actually fires here; `absorbedFirstPollRef` below is what protects the
   *  reload case instead. */
  const slotCountRef = useRef(data.picks.length);
  /**
   * The SSR board comes from the DEPLOYED feed snapshot, which the roster cron
   * refreshes every ~5 minutes. So on a mid-draft reload the first poll returns
   * every pick made since that snapshot — history the room already watched. In
   * broadcast mode `maxBurst` is Infinity, so nothing caps it and the TV would
   * replay minutes of reveals at a room that has moved on. Absorb the first
   * poll into the seen-set silently; reveal from the second onward.
   *
   * Starts TRUE when rehearsing: that path feeds `ingest` directly from a
   * complete board with no stale snapshot to reconcile, so gating it would
   * swallow the dry run's very first reveal.
   */
  const absorbedFirstPollRef = useRef(rehearsing);
  const errorCountRef = useRef(0);

  /** Merge a freshly polled board in, queueing anything new for reveal. */
  const ingest = useCallback((incoming: DraftRoomPick[]) => {
    if (incoming.length === 0) return;

    // maxBurst = Infinity: on a TV, dropping a burst is the worse failure.
    // A fast round that lands 4 picks inside one poll would otherwise reveal
    // NOTHING, and the room notices a missing pick far more than a late one.
    // Note collectFreshPicks' slot-sync guard does NOT protect us here — the
    // AFL publishes all 108 slots up front, so the array never goes 0 → N.
    // `absorbedFirstPollRef` below is what stops a reload storming.
    const fresh = collectFreshPicks(seenRef.current, slotCountRef.current, incoming, Infinity);
    slotCountRef.current = incoming.length;

    for (const p of fresh) seenRef.current.add(p.overallPickNumber);
    setPicks(incoming);

    // First poll after load reconciles a stale SSR snapshot against live MFL.
    // Whatever it turns up already happened; take it as read.
    if (!absorbedFirstPollRef.current) {
      absorbedFirstPollRef.current = true;
      return;
    }

    if (fresh.length > 0) {
      setQueue((q) => [
        ...q,
        // playerId is in the key so an undo + re-pick of the same slot reveals
        // again rather than being swallowed as a duplicate.
        ...fresh.map((pick) => ({ key: `${pick.overallPickNumber}-${pick.playerId}`, pick })),
      ]);
    }
  }, []);

  // ── Rehearsal replay ──
  // Rolls the completed board forward one pick at a time through `ingest`, the
  // exact path a live poll takes. That is the point: a dry run that used its
  // own code path would prove nothing about draft night. Stops when the board
  // runs out.
  useEffect(() => {
    if (!rehearsing) return;
    let step = data.rehearseUpTo!;

    const id = setInterval(() => {
      if (step >= data.picks.length) {
        clearInterval(id);
        return;
      }
      step += 1;
      ingest(applyRehearsal(data.picks, step));
    }, REHEARSE_STEP_MS);

    return () => clearInterval(id);
  }, [rehearsing, data.rehearseUpTo, data.picks, ingest]);

  // ── Poll MFL ──
  useEffect(() => {
    // Rehearsal drives the board itself; polling would immediately overwrite
    // the replay with the real (empty) board.
    if (rehearsing) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const params = new URLSearchParams({
      league: data.leagueId,
      host: data.mflHost,
      year: String(data.leagueYear),
      unit: data.conference.unit,
    });

    const tick = async () => {
      try {
        const res = await fetch(`/api/draft/status?${params}`, { cache: 'no-store' });
        const body = (await res.json()) as DraftStatusResponse & { error?: string };
        if (cancelled) return;

        if (!res.ok || body.error) {
          errorCountRef.current += 1;
        } else {
          errorCountRef.current = 0;
          setConnectionLost(false);
          ingest(body.picks);
        }
      } catch {
        if (cancelled) return;
        errorCountRef.current += 1;
      }

      if (cancelled) return;
      const failing = errorCountRef.current >= ERRORS_BEFORE_BACKOFF;
      setConnectionLost(failing);
      timer = setTimeout(tick, failing ? POLL_BACKOFF_MS : POLL_MS);
    };

    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [data.leagueId, data.mflHost, data.leagueYear, data.conference.unit, rehearsing, ingest]);

  // ── Advance the reveal queue ──
  const current = queue[0] ?? null;
  /**
   * Depth is read through a ref rather than listed as a dependency. Keying the
   * effect on `queue.length` meant every newly queued pick tore down and
   * restarted the CURRENT reveal's timer — and with picks arriving faster than
   * the hold (5s poll against an 18s hold), the board could sit on one player
   * indefinitely, which is precisely the moment it must not stall.
   */
  const queueDepthRef = useRef(queue.length);
  queueDepthRef.current = queue.length;

  useEffect(() => {
    if (!current) return;
    // Stacked picks get a shorter turn so the board catches back up to the room
    // rather than narrating a round that already finished. Decided ONCE, when
    // this reveal starts.
    const hold =
      queueDepthRef.current > RUSH_THRESHOLD
        ? REVEAL_RUSH_MS
        : rehearsing
          ? REHEARSE_REVEAL_MS
          : REVEAL_MS;
    const id = setTimeout(() => setQueue((q) => q.slice(1)), hold);
    return () => clearTimeout(id);
  }, [current, rehearsing]);

  // ── Keep the TV awake ──
  // A screen that sleeps between picks is the single most likely way this fails
  // in the room. Best-effort: unsupported browsers just don't get it, and the
  // lock is re-taken if the OS drops it on tab visibility change.
  useEffect(() => {
    let lock: any = null;
    let released = false;

    const acquire = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request('screen');
      } catch {
        /* not supported, or denied — nothing to do */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !released) acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      try {
        lock?.release?.();
      } catch {
        /* already gone */
      }
    };
  }, []);

  // ── Fullscreen ──
  // The whole point of the page: one click at the start of the night and the
  // board owns the TV with no site chrome around it.
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      // Best-effort: a browser that refuses (or doesn't support it) just leaves
      // the board inline, which still works — it's a nicer TV, not a required one.
      rootRef.current?.requestFullscreen?.().catch(() => {});
    }
  }, []);

  // ── Morph between the two screens ──
  // The cross-fade is CSS (`.dbc__screen`); this is the part that has to be
  // measured, because the crest and the copy live in completely different boxes
  // on the two screens and only the browser knows where. Runs on the ENTER /
  // LEAVE edge only — `current` changing from one pick straight to the next
  // (a stacked queue) is a reveal replacing a reveal, which keeps its own
  // entrance animation and has nothing to travel between.
  const idleLayerRef = useRef<HTMLDivElement>(null);
  const revealLayerRef = useRef<HTMLDivElement>(null);
  const showingReveal = !!current;
  /** Nothing to morph FROM on the first paint — the board simply arrives. */
  const morphedOnceRef = useRef(false);

  // Layout, not passive: this measures both screens and starts the animations
  // before the browser paints the new arrangement. A plain effect paints the
  // jump first and then animates away from it, which is the jump we are here to
  // remove.
  useIsomorphicLayoutEffect(() => {
    if (!morphedOnceRef.current) {
      morphedOnceRef.current = true;
      return;
    }
    // Read the fade duration off the CSS custom property rather than repeating
    // it here. One number, in the stylesheet, tuned where you can see it.
    const root = rootRef.current;
    const raw = root ? getComputedStyle(root).getPropertyValue('--dbc-fade').trim() : '';
    const durationMs = raw.endsWith('ms')
      ? parseFloat(raw)
      : raw.endsWith('s')
        ? parseFloat(raw) * 1000
        : 930;

    morphScreens(idleLayerRef.current, revealLayerRef.current, {
      durationMs: Number.isFinite(durationMs) ? durationMs : 930,
      toReveal: showingReveal,
    });
  }, [showingReveal]);

  const onTheClock = useMemo(() => findOnTheClock(picks), [picks]);
  const madeCount = useMemo(() => picks.filter((p) => p.playerId).length, [picks]);

  /**
   * The reveal currently on screen, OR the one that just finished its turn.
   *
   * Rendering `current` alone meant React unmounted the outgoing card the
   * instant the queue drained, so there was nothing left to fade OUT and the
   * idle board hard-cut in behind it. Holding the last reveal keeps that layer
   * mounted through its fade; it then sits inert (visibility: hidden) until the
   * next pick replaces it. Read during render rather than parked in state on a
   * timer: a state update lands AFTER the commit that dropped `current`, so the
   * card would unmount and remount for a frame — restarting its entrance
   * animations at the exact moment it is supposed to be leaving.
   */
  const lastRevealRef = useRef<QueuedReveal | null>(null);
  if (current) lastRevealRef.current = current;
  const shownReveal = current ?? lastRevealRef.current;

  const revealTeam: DraftRoomTeam | undefined = shownReveal
    ? teams.get(shownReveal.pick.franchiseId)
    : undefined;
  const revealPlayer: BroadcastPlayer | undefined = shownReveal
    ? players.get(shownReveal.pick.playerId)
    : undefined;

  return (
    <div className="dbc" data-testid="draft-broadcast" ref={rootRef}>
      {/* The wrapper is the hover target and the button is the click target —
          see the note on `.dbc__fullscreen-zone`. Nothing is bound to it. */}
      <div className="dbc__fullscreen-zone">
        <button
          className="dbc__fullscreen"
          type="button"
          onClick={toggleFullscreen}
          data-in-fullscreen={isFullscreen ? 'true' : 'false'}
        >
          {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>

      {/* Both screens are mounted at all times and cross-faded by class — see
          `.dbc__screen` in draft-broadcast.css. Two things keep the covered
          screen out of the way, and they cover different windows: the CSS ends
          the fade at `visibility: hidden`, which takes the idle board's
          conference switcher and rehearsal button out of the tab order and the
          accessibility tree — but only once the fade FINISHES. `inert` flips
          the moment the handoff starts, so nothing can be tabbed into during
          the ~620ms the outgoing layer is still painted. Nothing here decides
          timing — the queue still does. */}
      <div
        className={`dbc__screen${current ? ' is-hidden' : ''}`}
        ref={idleLayerRef}
        inert={showingReveal}
      >
        <OnTheClock
          conference={data.conference}
          conferences={allConferences}
          onTheClock={onTheClock}
          team={onTheClock ? teams.get(onTheClock.franchiseId) : undefined}
          picks={picks}
          teams={teams}
          players={players}
          totalRounds={data.totalRounds}
          picksPerRound={data.picksPerRound}
          madeCount={madeCount}
          rehearsing={rehearsing}
          rehearsalYears={data.rehearsalYears}
          leagueYear={data.leagueYear}
        />
      </div>

      {shownReveal ? (
        <div
          className={`dbc__screen dbc__screen--reveal${current ? '' : ' is-hidden'}`}
          ref={revealLayerRef}
          inert={!showingReveal}
        >
          <BroadcastRevealCard
            key={shownReveal.key}
            pick={shownReveal.pick}
            team={revealTeam}
            player={revealPlayer}
            picks={picks}
            players={players}
            rehearsing={rehearsing}
            leagueYear={data.leagueYear}
            defenseFaces={data.defenseFaces}
          />
        </div>
      ) : null}

      {connectionLost ? (
        <div className="dbc__status" role="status">
          <span className="dbc__status-dot" aria-hidden="true" />
          Reconnecting to MFL…
        </div>
      ) : null}
    </div>
  );
}
