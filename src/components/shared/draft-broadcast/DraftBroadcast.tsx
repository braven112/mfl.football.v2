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
 * at the bottom. Both stay mounted and cross-fade, because a hard swap between
 * them looked like somebody changing the channel. The reveal arrives as ONE
 * card (`dbc-reveal-in`); the crest used to fly between the two screens as a
 * shared element and no longer does — see the note on that keyframe.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DraftRoomPick, DraftRoomTeam, DraftStatusResponse } from '../../../types/draft-room';
import type {
  BroadcastConference,
  BroadcastPlayer,
  DraftBroadcastPageData,
} from '../../../types/draft-broadcast';
import { collectFreshPicks } from '../../../utils/pick-reveal';
import { applyRehearsal, findOnTheClock, playerMap, teamMap } from '../../../utils/draft-broadcast';
import { planBroadcastImages } from '../../../utils/draft-broadcast-images';
import { BroadcastRevealCard } from './BroadcastRevealCard';
import { BroadcastWarmup } from './BroadcastWarmup';
import { OnTheClock } from './OnTheClock';

/** Poll cadence. The draft room's 12s/30s is tuned for an EMAIL draft; a room
 *  full of people watching a TV notices a 30s lag between the pick landing on
 *  MFL and the screen reacting. 5s is well inside MFL's tolerance for a public
 *  export and keeps the reveal feeling like it's responding to the room. */
const POLL_MS = 5_000;
/** After repeated failures, stop hammering — but keep trying, quietly. */
const POLL_BACKOFF_MS = 15_000;
const ERRORS_BEFORE_BACKOFF = 3;

/**
 * Ceiling on ONE poll's request.
 *
 * The loop is a self-chaining timeout: the next poll is only scheduled once the
 * current `await fetch(...)` settles. A `fetch` with no timeout can hang
 * indefinitely — a wifi drop, a sleeping laptop, a proxy holding the socket —
 * and when it does, the chain is not delayed, it is BROKEN. The board freezes
 * on the last value it saw and only a reload brings it back, which is exactly
 * what happened during the 2026 rehearsal (frozen at pick 7 while MFL was at
 * 25). The server side of this call has always had `AbortSignal.timeout`; the
 * browser side had nothing.
 */
const POLL_TIMEOUT_MS = 12_000;

/**
 * If no poll has COMPLETED in this long, force one.
 *
 * The abort above fixes the hang we found; the watchdog covers the class. A
 * chained timeout is also at the mercy of background-tab throttling and of the
 * machine suspending mid-wait, and this page is meant to run unattended on a TV
 * for hours. Cheap insurance: one comparison a second against a timestamp the
 * poll itself stamps.
 */
const POLL_WATCHDOG_MS = 30_000;

/**
 * Fresh picks past which an update is a CATCH-UP, not a fast round.
 *
 * MFL serves the draft from caches that disagree (see `filledRef`), so the
 * board can jump eighteen picks the moment a current snapshot finally answers.
 * Revealing all of them is 18 x REVEAL_RUSH_MS of narrating a round the room
 * finished minutes ago, during which the idle board — who is ACTUALLY on the
 * clock — never gets the screen. Past this many, only the newest pick is
 * revealed and the rest are taken as read: the room's attention belongs on the
 * pick that just happened.
 */
const CATCHUP_BURST = 5;

/**
 * How long a slot must be reported EMPTY, continuously, before the board
 * believes the pick is gone.
 *
 * The board holds a union of every pick it has seen so MFL's disagreeing
 * caches cannot un-fill a slot (see `filledRef`). A commissioner reverting the
 * draft to restart it is the case where an un-fill is real, and this is what
 * tells the two apart without guessing: a flap alternates, so some poll calls
 * the slot filled again within seconds — measured runs topped out at four
 * polls, about twenty seconds. A revert never does.
 *
 * 45s is nine polls: comfortably past the worst flap observed, and short
 * enough that a restarted draft is on screen inside a minute.
 */
const REVERT_CONFIRM_MS = 45_000;

/**
 * Is `next` a later selection than `prev` for the same slot?
 *
 * MFL stamps picks with epoch SECONDS as a string. A missing or unparseable
 * stamp answers false — keeping what the board already holds, which is the
 * stable choice when there is nothing to compare.
 */
function isNewerPick(next: DraftRoomPick, prev: DraftRoomPick): boolean {
  const a = Number.parseInt(next.timestamp, 10);
  const b = Number.parseInt(prev.timestamp, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a > b;
}

/** How long one reveal owns the screen, and the hurry-up when picks stack. */
const REVEAL_MS = 18_000;
const REVEAL_RUSH_MS = 6_000;
/** Queue depth past which we switch to the rush duration to catch up. */
const RUSH_THRESHOLD = 3;

/**
 * Rehearsal cadence — 8 seconds of reveal, then 8 seconds of board, repeating.
 *
 * Rehearsal deliberately does NOT reuse the live pair. Live, the idle board is
 * what fills the real gaps between picks, so the reveal can afford to be long.
 * In a dry run the step is the ONLY thing separating one pick from the next, so
 * the two numbers below are not independent: the board gets STEP minus HOLD.
 * At the original 20s step against an 18s hold that was ~2s, and the half of
 * the screen you most need to watch while rehearsing was the half you never
 * saw. Keep the step exactly twice the hold to keep the two screens even.
 */
const REHEARSE_REVEAL_MS = 8_000;
const REHEARSE_STEP_MS = REHEARSE_REVEAL_MS * 2;

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

  /**
   * Every filled slot we have ever seen, by overall pick number.
   *
   * MFL SERVES A FLAPPING BOARD. Measured live during the 2026 AFL rehearsal
   * (2026-08-28), the same league and unit alternated between one filled pick
   * and zero across polls two seconds apart — on `api.myfantasyleague.com` AND
   * on the league's own `www44`, with runs of four consecutive stale reads. The
   * export is served from backends whose caches disagree, so a poll is not a
   * monotonic view of the draft: it is a sample of whichever backend answered.
   *
   * Rendered straight, that is what the room sees: 1.01 lands, the board flips
   * back to "Da Dangsters on the clock", then forward again, every few seconds.
   * Worse, it never re-reveals — `seenRef` already holds the pick, so the pick
   * disappears and returns in silence.
   *
   * So the board keeps the UNION rather than the latest response. A pick that
   * has landed cannot un-land, and a response that is stale for one slot but
   * fresh for another (which disagreeing backends make possible) contributes
   * its fresh half instead of being dropped whole.
   *
   * TWO THINGS THE PLAIN UNION GOT WRONG, both found by reverting the draft to
   * restart it (Brandon, 2026-08-28) — see `lastSeenFilledRef` and the
   * timestamp comparison in `ingest`:
   *
   *  - A slot can come back FILLED WITH A DIFFERENT PLAYER. After a revert and
   *    a re-pick, the stale caches still hold the old selection, so "a filled
   *    slot always wins" took whichever answered last and 1.01 flipped between
   *    the old player and the new one. MFL stamps every pick with a
   *    `timestamp`, and the newer one is the real one.
   *  - A revert is a legitimate un-fill. The union alone can never represent
   *    one, so a restarted draft would show the old board forever.
   */
  const filledRef = useRef<Map<number, DraftRoomPick>>(
    new Map(
      (rehearsing ? applyRehearsal(data.picks, data.rehearseUpTo!) : data.picks)
        .filter((p) => p.playerId)
        .map((p) => [p.overallPickNumber, p] as const)
    )
  );

  /**
   * When each held slot was last reported FILLED by any poll.
   *
   * This is what separates a cache flap from a revert, and it needs no guess
   * about which is which: a flap alternates, so some poll reports the slot
   * filled again within seconds (measured runs topped out at four polls, ~20s).
   * A revert does not — after it, EVERY backend eventually agrees the slot is
   * empty. So a slot is released only once it has been reported empty
   * continuously for REVERT_CONFIRM_MS, and any single filled report resets
   * that clock.
   */
  const lastSeenFilledRef = useRef<Map<number, number>>(new Map());

  /** Merge a freshly polled board in, queueing anything new for reveal. */
  const ingest = useCallback((rawIncoming: DraftRoomPick[]) => {
    if (rawIncoming.length === 0) return;

    const now = Date.now();

    // Reconcile the response against the union — see filledRef. Three cases,
    // and the middle one is the whole reason this is not a one-liner.
    const incoming = rawIncoming.map((p) => {
      const held = filledRef.current.get(p.overallPickNumber);

      if (p.playerId) {
        lastSeenFilledRef.current.set(p.overallPickNumber, now);
        // Same slot, DIFFERENT player: a revert plus a re-pick, seen against a
        // cache still holding the old selection. Newer timestamp wins, so the
        // old pick cannot flip back in. An unparseable or equal stamp keeps
        // what we hold, which is the stable answer either way.
        if (held && held.playerId !== p.playerId && !isNewerPick(p, held)) return held;
        return p;
      }

      if (!held) return p;

      // Empty here, filled in the union. Flap or revert — decided by how long
      // it has been since ANY poll called it filled, never by this poll alone.
      const lastFilled = lastSeenFilledRef.current.get(p.overallPickNumber) ?? now;
      if (now - lastFilled < REVERT_CONFIRM_MS) return held;

      // Confirmed gone. Drop it from the union AND from the seen-set, so the
      // slot reveals again when it is re-picked rather than being swallowed as
      // a duplicate.
      filledRef.current.delete(p.overallPickNumber);
      lastSeenFilledRef.current.delete(p.overallPickNumber);
      seenRef.current.delete(p.overallPickNumber);
      return p;
    });

    for (const p of incoming) {
      if (p.playerId) filledRef.current.set(p.overallPickNumber, p);
    }

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
      // A jump this big is the board catching up to MFL, not the room picking
      // that fast — see CATCHUP_BURST. Reveal the newest and take the rest as
      // read, so the screen lands on what just happened instead of narrating
      // its way there.
      const toReveal = fresh.length > CATCHUP_BURST ? fresh.slice(-1) : fresh;
      setQueue((q) => [
        ...q,
        // playerId is in the key so an undo + re-pick of the same slot reveals
        // again rather than being swallowed as a duplicate.
        ...toReveal.map((pick) => ({ key: `${pick.overallPickNumber}-${pick.playerId}`, pick })),
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

    // `feedUnit` rather than `conference.unit`: a `?mflLeague=` override may be
    // watching a board that is not split by conference at all, and MFL answers
    // a named unit that isn't there with a 404 rather than a board. `null` means
    // "whichever unit this draft has" — the param is omitted entirely.
    const feedUnit = data.feedUnit === undefined ? data.conference.unit : data.feedUnit;
    const params = new URLSearchParams({
      league: data.leagueId,
      host: data.mflHost,
      year: String(data.leagueYear),
    });
    if (feedUnit) params.set('unit', feedUnit);

    // When the last tick FINISHED. The watchdog reads it; nothing else does.
    let lastCompleted = Date.now();
    // Guards against two ticks running at once, which the watchdog and the
    // wake-up listeners can both otherwise cause.
    let inFlight = false;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(tick, ms);
    };

    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/draft/status?${params}`, {
          cache: 'no-store',
          // Without this the loop can be ended by a single request that never
          // settles — see POLL_TIMEOUT_MS. This is the line that keeps a
          // three-hour draft polling.
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });
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
        // A timeout lands here like any other failure: count it, back off if it
        // keeps happening, and — the point — schedule the next one regardless.
        if (cancelled) return;
        errorCountRef.current += 1;
      } finally {
        inFlight = false;
        lastCompleted = Date.now();
      }

      if (cancelled) return;
      const failing = errorCountRef.current >= ERRORS_BEFORE_BACKOFF;
      setConnectionLost(failing);
      schedule(failing ? POLL_BACKOFF_MS : POLL_MS);
    };

    // The watchdog covers what the abort cannot: a timer the browser throttled
    // while the tab was in the background, or one the machine slept through.
    // It only ever RE-ARMS the loop — it never polls in parallel (`inFlight`).
    const watchdog = setInterval(() => {
      if (cancelled || inFlight) return;
      if (Date.now() - lastCompleted > POLL_WATCHDOG_MS) schedule(0);
    }, 1_000);

    // Coming back from a sleeping laptop or a dropped network is the moment the
    // board is most out of date, so ask immediately rather than waiting out the
    // current interval.
    const wake = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      schedule(0);
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);

    schedule(POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [data.leagueId, data.mflHost, data.leagueYear, data.conference.unit, data.feedUnit, rehearsing, ingest]);

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

  // ── Which screen is up ──
  // The handoff is entirely CSS now: the layers cross-fade on `.dbc__screen`
  // and the reveal plays its own `dbc-reveal-in`. There WAS a measured
  // shared-element morph here (the crest flying between its two boxes, since
  // only the browser knows where those are); it was cut for a plain card
  // reveal, which is why nothing on this screen needs layout timing any more.
  const showingReveal = !!current;

  /**
   * Every image the night will need, most-needed first.
   *
   * Planned from the SSR payload, so it costs no bytes on the wire and is ready
   * the moment the island hydrates — which matters, because the warm-up's only
   * job is to finish before the first pick lands. Depth is `?warm=`; see
   * `resolveWarmDepth`.
   */
  const warmUrls = useMemo(
    () =>
      data.warmDepth === 0
        ? []
        : planBroadcastImages({
            players: data.players,
            teams: data.teams,
            defenseFaces: data.defenseFaces,
            depth: data.warmDepth,
          }).urls,
    [data.players, data.teams, data.defenseFaces, data.warmDepth]
  );

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
          the fade while the outgoing layer is still painted. Nothing here decides
          timing — the queue still does. */}
      <div
        className={`dbc__screen${current ? ' is-hidden' : ''}`}
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

      {/* Pre-flight, in one stack above BOTH layers.
          Top-centre because every other edge of this board is spoken for: the
          idle header owns the top-left and top-right, the fullscreen button is
          pinned top-right, the reveal's ghost pick number owns the bottom-left,
          and `.dbc__status` owns the bottom-right. Above the layers, not inside
          one, because an override that vanished for the eighteen seconds a
          reveal owns the TV would be an override nobody sees — the rehearsal
          flag learned that lesson the hard way (see BroadcastRevealCard). */}
      <div className="dbc__preflight">
        {data.sourceLabel ? (
          <div className="dbc__source-flag" data-testid="broadcast-source-flag">
            {data.sourceLabel}
          </div>
        ) : null}
        <BroadcastWarmup urls={warmUrls} />
      </div>

      {connectionLost ? (
        <div className="dbc__status" role="status">
          <span className="dbc__status-dot" aria-hidden="true" />
          Reconnecting to MFL…
        </div>
      ) : null}
    </div>
  );
}
