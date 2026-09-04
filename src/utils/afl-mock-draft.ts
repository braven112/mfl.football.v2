/**
 * The AFL's mock draft — the pool it drafts from, and the window it is worth
 * running in.
 *
 * Two facts make this NOT a copy of TheLeague's mock, and both are in MFL's
 * own feed rather than anywhere a reader would look:
 *
 * ── 1. Availability is scoped to ONE CONFERENCE ────────────────────────────
 *
 * `league.json` carries `rostersPerPlayer: "1"` alongside
 * `playerLimitUnit: "CONFERENCE"`, which together say a player may be on one
 * roster PER CONFERENCE — so the same NFL player can be, and is, rostered in
 * both the AL and the NL at once. The 2026 feeds prove it: player 17472 went
 * 1.01 in CONFERENCE00 *and* 1.01 in CONFERENCE01.
 *
 * So the pool subtracts THIS conference's twelve rosters and no others.
 * Subtracting all twenty-four deletes roughly half the board — every player
 * the other conference kept — and does it silently, because the result is
 * still a plausible-looking list of available players.
 *
 * ── 2. The AFL draft is not a snake ───────────────────────────────────────
 *
 * Every round repeats the same order. 2026's CONFERENCE00 opens each of its
 * first three rounds `0006, 0004, 0003, 0010…`; there is no reversal. Running
 * TheLeague's `buildSnakeOrder` here would flip four of the AFL's nine rounds
 * and quietly teach owners the wrong thing about where they pick.
 *
 * ── The window ────────────────────────────────────────────────────────────
 *
 * A mock is only worth running once rosters are cut to keepers. That is a
 * DATA condition, not a date, and the roster history shows why the date alone
 * is not good enough: on Jul 14 (deadline eve) seven of twenty-four franchises
 * were already at seven while others still carried twenty, and on Jul 16 —
 * past the deadline — five still had cuts to make. Only from Jul 20 were all
 * twenty-four at exactly seven.
 *
 * So `resolveMockWindow` asks the rosters, and uses the deadline only to
 * explain itself. It also closes once the conference's real draft has begun:
 * by then the pool is being consumed for real and rosters are climbing back
 * toward sixteen, which would otherwise read as "still waiting on cuts".
 *
 * Pure module — callers inject parsed feeds. No file or network I/O here.
 */

import { KEEPER_LIMIT } from './afl-keeper-constants';
import aflEvents from '../data/afl-fantasy/league-events.json';
import aflConfig from '../../data/afl-fantasy/afl.config.json';

/**
 * Rounds in an AFL conference draft — read from the league config, not typed
 * here. It is the 16-man roster less the 7 keepers, and if either number ever
 * moves this follows rather than quietly drafting the wrong length.
 */
export const AFL_MOCK_ROUNDS: number = (aflConfig as { draftRounds?: number }).draftRounds ?? 9;

/** Id of the keeper-deadline event in the AFL's calendar. */
const KEEPER_DEADLINE_EVENT_ID = 'afl-keeper-deadline';

interface FixedEventDate {
  type?: string;
  month?: number;
  day?: number;
  time?: string;
}

/**
 * The keeper deadline for a season, read from the league calendar rather than
 * re-typed. The calendar is what the site already shows owners, and a second
 * copy of "July 15" here is a second thing to forget at the next rule change.
 */
export function keeperDeadlineFor(year: number): Date | null {
  const event = (aflEvents.events as Array<{ id: string; startDate?: FixedEventDate }>).find(
    (e) => e.id === KEEPER_DEADLINE_EVENT_ID
  );
  const start = event?.startDate;
  if (!start || start.type !== 'fixed' || !start.month || !start.day) return null;

  const [hours, minutes] = (start.time ?? '00:00').split(':').map((n) => parseInt(n, 10));
  return new Date(
    year,
    start.month - 1,
    start.day,
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0
  );
}

// ── Rosters ────────────────────────────────────────────────────────────────

/** One franchise as MFL's `rosters` export shapes it. */
export interface RosterFranchise {
  id?: string;
  player?: unknown;
}

/** MFL returns a lone child bare rather than in a one-element array. */
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** The franchise rows of a `rosters` feed, whichever shape it arrived in. */
export function rosterFranchisesOf(rostersFeed: unknown): RosterFranchise[] {
  const feed = rostersFeed as { rosters?: { franchise?: RosterFranchise | RosterFranchise[] } };
  return asArray(feed?.rosters?.franchise);
}

/** Player ids held by `franchiseIds` — and by nobody else's roster. */
export function rosteredPlayerIds(
  franchises: RosterFranchise[],
  franchiseIds: Iterable<string>
): Set<string> {
  const scope = new Set(franchiseIds);
  const ids = new Set<string>();
  for (const franchise of franchises) {
    if (!franchise.id || !scope.has(franchise.id)) continue;
    for (const player of asArray(franchise.player as { id?: string } | { id?: string }[])) {
      if (player?.id) ids.add(player.id);
    }
  }
  return ids;
}

export interface RosterCutState {
  /** Franchises in the conference we could see a roster for. */
  total: number;
  /** Those already down to the keeper limit. */
  ready: number;
  /** Those still over it, largest roster first — the ones being waited on. */
  pending: Array<{ franchiseId: string; count: number }>;
}

/**
 * How far through its cuts a conference is.
 *
 * A franchise BELOW the limit counts as ready: dropping an eighth player is
 * allowed, and waiting for a roster to grow back to exactly seven would hang
 * the gate forever.
 */
export function rosterCutState(
  franchises: RosterFranchise[],
  franchiseIds: Iterable<string>,
  keeperLimit: number = KEEPER_LIMIT
): RosterCutState {
  const scope = new Set(franchiseIds);
  const byId = new Map(franchises.filter((f) => f.id).map((f) => [f.id!, f]));

  let total = 0;
  const pending: Array<{ franchiseId: string; count: number }> = [];

  for (const franchiseId of scope) {
    const franchise = byId.get(franchiseId);
    // A franchise missing from the feed is not evidence that it has cut.
    if (!franchise) continue;
    total += 1;
    const count = asArray(franchise.player as unknown[]).length;
    if (count > keeperLimit) pending.push({ franchiseId, count });
  }

  pending.sort((a, b) => b.count - a.count || a.franchiseId.localeCompare(b.franchiseId));
  return { total, ready: total - pending.length, pending };
}

// ── The pool ───────────────────────────────────────────────────────────────

/**
 * The players this conference can actually draft: everyone draftable who is
 * not on one of its own twelve rosters.
 *
 * `isDraftable` is injected rather than imported so this module stays pure —
 * `build-draft-players` reaches for the filesystem on import.
 */
export function availablePlayers<T extends { id?: string; position?: string }>(
  allPlayers: T[],
  rostered: ReadonlySet<string>,
  isDraftable: (position: string) => boolean
): T[] {
  return allPlayers.filter(
    (p) => !!p.id && !rostered.has(p.id) && isDraftable(p.position || '')
  );
}

// ── Draft order ────────────────────────────────────────────────────────────

interface RawPick {
  round?: string;
  pick?: string;
  franchise?: string;
  player?: string;
}

/**
 * The pick sequence for a mock, in overall order.
 *
 * Preferred source is MFL's own pre-populated pick slots for the season: they
 * already carry TRADED picks, which no reconstruction from a round-one order
 * can recover. 2026's CONFERENCE00 is exactly this case — its round 2 reads
 * `…0010, 0009, 0012, 0011…` where round 1 reads `…0010, 0012, 0009, 0011…`,
 * because two franchises swapped.
 *
 * The fallback repeats the given franchise order every round. It is a STRAIGHT
 * repeat, never a snake — see this module's header.
 */
export function buildAflMockOrder(
  unit: { draftPick?: RawPick | RawPick[] } | null | undefined,
  fallbackFranchiseIds: string[],
  rounds: number
): string[] {
  const picks = asArray(unit?.draftPick).filter((p) => p?.franchise);

  if (picks.length > 0) {
    const ordered = [...picks].sort((a, b) => {
      const r = parseInt(a.round || '1', 10) - parseInt(b.round || '1', 10);
      return r !== 0 ? r : parseInt(a.pick || '1', 10) - parseInt(b.pick || '1', 10);
    });
    const wanted = rounds * fallbackFranchiseIds.length;
    // Only trust the feed when it covers the whole mock. A partial unit (a
    // season MFL kept the order but not every round) would otherwise end the
    // draft early with no explanation.
    if (ordered.length >= wanted) {
      return ordered.slice(0, wanted).map((p) => p.franchise!);
    }
  }

  return buildRepeatingOrder(fallbackFranchiseIds, rounds);
}

/** The same order every round — the AFL's actual format. Not a snake. */
export function buildRepeatingOrder(franchiseIds: string[], rounds: number): string[] {
  const order: string[] = [];
  for (let round = 1; round <= rounds; round++) order.push(...franchiseIds);
  return order;
}

/** Picks in a unit that have actually been made. */
export function picksMadeIn(unit: { draftPick?: RawPick | RawPick[] } | null | undefined): number {
  return asArray(unit?.draftPick).filter((p) => !!p?.player).length;
}

// ── The window ─────────────────────────────────────────────────────────────

export type MockWindow =
  | {
      state: 'drafting';
      /** Picks already made in this conference's real draft. */
      picksMade: number;
    }
  | {
      state: 'waiting';
      /** Franchises still carrying more than the keeper limit. */
      pending: Array<{ franchiseId: string; count: number }>;
      ready: number;
      total: number;
      deadline: Date | null;
      /** True once the deadline has passed and cuts are simply late. */
      deadlinePassed: boolean;
    }
  | { state: 'open'; poolSize: number };

export interface ResolveMockWindowInput {
  cuts: RosterCutState;
  picksMade: number;
  poolSize: number;
  deadline: Date | null;
  now: Date;
}

/**
 * Whether a mock in this conference is worth running right now.
 *
 * Order matters. The real draft is checked FIRST because once it starts,
 * rosters climb back past the keeper limit — asking the roster question first
 * would report a finished draft as "waiting on cuts", which is both wrong and
 * unfixable by the owner reading it.
 *
 * A conference we could see no rosters for is treated as not ready. Opening
 * the board on an empty feed would mock against the entire NFL.
 */
export function resolveMockWindow(input: ResolveMockWindowInput): MockWindow {
  if (input.picksMade > 0) {
    return { state: 'drafting', picksMade: input.picksMade };
  }

  if (input.cuts.total === 0 || input.cuts.pending.length > 0) {
    return {
      state: 'waiting',
      pending: input.cuts.pending,
      ready: input.cuts.ready,
      total: input.cuts.total,
      deadline: input.deadline,
      deadlinePassed: !!input.deadline && input.now.getTime() > input.deadline.getTime(),
    };
  }

  return { state: 'open', poolSize: input.poolSize };
}

/** True when a mock may be created — the one check every caller shares. */
export function isMockWindowOpen(window: MockWindow): window is { state: 'open'; poolSize: number } {
  return window.state === 'open';
}

// ── Saying why, when the answer is no ──────────────────────────────────────

export interface MockGateCopy {
  heading: string;
  body: string;
  bullets?: string[];
  note?: string;
  link?: { label: string; href: string };
}

export interface DescribeMockGateOptions {
  /** Conference short name, e.g. 'AL'. */
  short: string;
  /** Conference full name, e.g. 'American League'. */
  label: string;
  keeperLimit?: number;
  /** Franchise id → display name, for naming who is still cutting. */
  nameOf: (franchiseId: string) => string;
  /** League-neutral paths, already prefixed for this reader. */
  boardHref: string;
  resultsHref: string;
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };

/**
 * The gate's copy — what to say when a mock cannot run.
 *
 * Deliberately specific. "Check back later" makes a working page look broken;
 * naming the three franchises still carrying twenty players tells an owner
 * both why it is shut and roughly when it will open.
 *
 * Returns null when the window is open, so a caller can pass the result
 * straight through as the component's `gate` prop.
 */
export function describeMockGate(
  window: MockWindow,
  opts: DescribeMockGateOptions
): MockGateCopy | null {
  const keeperLimit = opts.keeperLimit ?? KEEPER_LIMIT;

  if (window.state === 'open') return null;

  if (window.state === 'drafting') {
    const done = window.picksMade >= AFL_MOCK_ROUNDS * 12;
    return {
      heading: done
        ? `The ${opts.short} draft is over`
        : `The ${opts.short} draft is under way`,
      body: done
        ? `The ${opts.label} has drafted, so the pool a mock would run against no longer exists — every player worth practising on is on somebody's roster. This opens again next summer, once keepers are set.`
        : `${window.picksMade} picks are already in. Mocking against a pool that is being drafted for real would give you a board nobody is playing from.`,
      link: done
        ? { label: 'See the draft results', href: opts.resultsHref }
        : { label: 'Watch the live board', href: opts.boardHref },
    };
  }

  if (window.total === 0) {
    return {
      heading: 'Rosters are unavailable',
      body: `We could not read the ${opts.label}'s rosters, and without them there is no way to tell who is actually available. Rather than mock against the entire NFL, this stays shut until they load.`,
      note: 'Usually a passing MFL hiccup — try again in a minute.',
    };
  }

  const deadline = window.deadline ? window.deadline.toLocaleDateString('en-US', DATE_FORMAT) : null;
  return {
    heading: 'The pool is not set yet',
    body: `The ${opts.label} keeps ${keeperLimit} and drafts the rest, so a mock is only worth running once the cuts are in. ${window.ready} of ${window.total} teams are down to ${keeperLimit}; the rest are still carrying players who are about to hit the pool.`,
    bullets: window.pending
      .slice(0, 6)
      .map(
        (p) =>
          `${opts.nameOf(p.franchiseId)} — ${p.count} rostered, ${p.count - keeperLimit} still to release`
      ),
    note: deadline
      ? window.deadlinePassed
        ? `The keeper deadline was ${deadline}, so these are overdue. This opens the moment they land.`
        : `Keeper deadline is ${deadline}. This opens on its own once every roster is down to ${keeperLimit} — no need to come back and check.`
      : undefined,
  };
}
