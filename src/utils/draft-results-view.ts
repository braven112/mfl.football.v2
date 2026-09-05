/**
 * Draft Results — the pure half of the historical draft archive.
 *
 * Turns one season's raw MFL `draftResults` feed into a board the page can
 * render, and resolves the year / conference / team selection from the query
 * string. No I/O and no Astro: the route loads the feeds, this decides what
 * they mean, and `tests/draft-results-view.test.ts` pins the parts that have
 * already been wrong in the codebase.
 *
 * Three things here are not incidental:
 *
 * 1. ROUNDS ARE NOT UNIFORM. TheLeague's rookie draft is 51 picks over three
 *    rounds of SIXTEEN, SEVENTEEN and EIGHTEEN — the extra slots are the
 *    toilet-bowl compensatory picks (1.17, 2.17, 2.18). The AFL's 2010 and
 *    2020 conference boards carry a 13th pick in one round for the same kind
 *    of reason. So an overall pick number has to be a running total of each
 *    round's ACTUAL size. The `(round - 1) * 16 + pick` this replaces gave
 *    round 3 pick 1 the number 33 — already taken by round 2 pick 17 — and
 *    stopped the board at 50 for a 51-pick draft.
 *
 * 2. `draftUnit` IS AN OBJECT OR AN ARRAY. TheLeague drafts as one LEAGUE
 *    unit, the AFL as two conference units. That shape drift is normalized
 *    once, here, through `selectDraftUnit` — the same helper the broadcast
 *    board uses, rather than a second ad-hoc reader.
 *
 * 3. AN EMPTY UNIT IS NOT A CONFERENCE. The AFL's 2003 and 2004 feeds carry a
 *    CONFERENCE01 with zero picks, because the league drafted as one body
 *    before it split. Offering it in the switcher would be a tab that opens
 *    onto nothing, so units are filtered on having picks BEFORE anything is
 *    selected — including before the default.
 */

import { parseTradeFromComment, selectDraftUnit, type RawDraftUnit } from './draft-utils';

/** One pick exactly as MFL writes it. Every field is a string in the feed. */
export interface RawDraftResultPick {
  round?: string;
  pick?: string;
  franchise?: string;
  player?: string;
  comments?: string;
  timestamp?: string;
}

/** A franchise as the league config knows it, for the year being viewed. */
export interface DraftResultsTeam {
  id: string;
  name: string;
  icon?: string;
  banner?: string;
}

/** What the page needs to render one row. */
export interface DraftResultsPick {
  /** 1-based position in the whole draft, across rounds. */
  overall: number;
  round: number;
  pick: number;
  /** "2.07" — round and pick, zero-padded, the way owners say it. */
  label: string;
  franchiseId: string;
  teamName: string;
  teamIcon: string;
  teamBanner: string;
  /** Franchise that ORIGINALLY held the pick, when MFL says it was traded. */
  tradedFrom: string | null;
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string;
  headshot: string;
  /**
   * Best-guess ESPN id, passed straight through to the shared player cell so
   * its headshot cascade and the player modal have something to resolve
   * against. May be a COLLEGE athlete id (see `resolveEspnId`) — fine for
   * pictures, never safe for ESPN's NFL athlete endpoints.
   */
  espnId: string;
  /** MFL's comment with its bracket noise stripped; '' when there's nothing. */
  note: string;
  timestamp: number | null;
}

/** One selectable board. The AFL has two; TheLeague has one and hides it. */
export interface DraftResultsUnit {
  /** MFL's unit id, e.g. 'CONFERENCE00' or 'LEAGUE'. */
  code: string;
  /** Display name, e.g. 'American League'. */
  label: string;
  pickCount: number;
}

/**
 * How this draft is shaped, and how that compares to how the league drafts
 * NOW. Derived rather than configured: the comparison year is simply the most
 * recent draft in the archive, so the league can change format without this
 * needing to be told.
 */
export interface DraftShape {
  rounds: number;
  picks: number;
  units: number;
  /**
   * First round of the SECOND draft, when this unit holds two of them end to
   * end (AFL 2004). Null for every ordinary season.
   */
  concatenatedFrom: number | null;
  /** Earliest draft in the archive — the league's founding draft. */
  startup: boolean;
  /** More rounds than the league runs today. */
  oversized: boolean;
  /** Fewer boards than the league runs today (drafted as one body). */
  singleUnit: boolean;
  /** Short badge text, or null when the draft is shaped like a normal one. */
  badge: string | null;
}

export interface DraftResultsView {
  /** Every season with a draft, newest first. */
  years: number[];
  year: number;
  units: DraftResultsUnit[];
  /** Selected unit code, or null when the league drafts as one body. */
  unit: string | null;
  teams: DraftResultsTeam[];
  /** 'all', or a franchise id. */
  team: string;
  /** Rows after the team filter. */
  picks: DraftResultsPick[];
  /** Rows before the team filter — the size of the board itself. */
  totalPicks: number;
  shape: DraftShape;
  /** True when the selected season has no picks to show. */
  isEmpty: boolean;
  /**
   * Picks whose slot MFL recorded but whose SELECTION it never did. The AFL's
   * 2003 feed is entirely this: 360 slots, not one player id. Counted so the
   * page can say why a board is all blanks instead of looking broken.
   */
  selectionless: number;
  /**
   * Picks that name a player the identity unions can't resolve. The AFL drafted
   * from 2003 but its players.json only begins in 2011, so a 2004 pick who left
   * before then has no row to resolve against — about half of that draft.
   */
  unnamed: number;
}

/** Resolves an MFL player id to display identity. Supplied by the route so
 * this module stays free of the filesystem — and so the AFL can compose its
 * own identity union with TheLeague's as a fallback. */
export type PlayerResolver = (mflId: string) => {
  name?: string;
  position?: string;
  nflTeam?: string;
  headshot?: string;
  espnId?: string | null;
} | undefined;

const toArray = <T,>(v: T | T[] | undefined): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

/** Units that actually contain picks, in feed order. */
export function listDraftUnits(
  rawUnit: RawDraftUnit<RawDraftResultPick> | RawDraftUnit<RawDraftResultPick>[] | undefined,
  labelFor: (code: string) => string
): DraftResultsUnit[] {
  return toArray(rawUnit)
    .map((u) => ({
      code: (u?.unit || '').trim(),
      label: labelFor((u?.unit || '').trim()),
      pickCount: toArray(u?.draftPick).filter((p) => p?.round && p?.pick).length,
    }))
    // An empty unit is not a conference — see the header note.
    .filter((u) => u.pickCount > 0);
}

/**
 * Running-total pick numbering that respects each round's real size.
 *
 * Uses the highest pick number SEEN in a round rather than a count of rows, so
 * a round with a gap in it still lines the next round up correctly.
 */
export function buildOverallNumbering(
  picks: { round: number; pick: number }[]
): (round: number, pick: number) => number {
  const maxByRound = new Map<number, number>();
  for (const p of picks) {
    maxByRound.set(p.round, Math.max(maxByRound.get(p.round) ?? 0, p.pick));
  }
  const offsets = new Map<number, number>();
  let running = 0;
  for (const round of [...maxByRound.keys()].sort((a, b) => a - b)) {
    offsets.set(round, running);
    running += maxByRound.get(round) ?? 0;
  }
  return (round, pick) => (offsets.get(round) ?? 0) + pick;
}

/** MFL wraps its notes in brackets: "[Pick made from Pre-Draft List] ". */
function cleanNote(comment: string): string {
  return comment.replace(/[[\]]/g, '').trim();
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Build the rows for one unit. Sorted into true draft order. */
export function buildDraftBoard(
  unit: RawDraftUnit<RawDraftResultPick> | null,
  teams: Map<string, DraftResultsTeam>,
  resolvePlayer: PlayerResolver
): DraftResultsPick[] {
  const raw = toArray(unit?.draftPick).filter((p) => p?.round && p?.pick && p?.franchise);
  const parsed = raw.map((p) => ({
    round: parseInt(p.round as string, 10),
    pick: parseInt(p.pick as string, 10),
    src: p,
  }));
  const overallFor = buildOverallNumbering(parsed);

  return parsed
    .map(({ round, pick, src }) => {
      const team = teams.get(src.franchise as string);
      // MFL writes '----' into the player field for a pick the commissioner
      // skipped. It is a sentinel, not an id — resolving it would look up a
      // player that cannot exist, and printing it would read as a real
      // selection called "----".
      const playerId = src.player && /^\d+$/.test(src.player) ? src.player : '';
      const identity = playerId ? resolvePlayer(playerId) : undefined;
      const ts = src.timestamp ? parseInt(src.timestamp, 10) : NaN;
      return {
        overall: overallFor(round, pick),
        round,
        pick,
        label: `${round}.${pad(pick)}`,
        franchiseId: src.franchise as string,
        teamName: team?.name ?? 'Unknown Team',
        teamIcon: team?.icon ?? '',
        teamBanner: team?.banner ?? '',
        tradedFrom: parseTradeFromComment(src.comments || '') ?? null,
        playerId,
        playerName: identity?.name || '',
        position: identity?.position || '',
        nflTeam: identity?.nflTeam || '',
        headshot: identity?.headshot || '',
        espnId: identity?.espnId || '',
        note: cleanNote(src.comments || ''),
        timestamp: Number.isFinite(ts) ? ts : null,
      };
    })
    .sort((a, b) => a.overall - b.overall);
}

/**
 * Whether one "unit" is really TWO drafts stored end to end.
 *
 * The AFL's 2004 feed is the case this exists for: a single CONFERENCE00 unit
 * carrying rounds 1-16, where rounds 1-8 belong to twelve franchises and
 * rounds 9-16 to a completely different twelve — the same two sets MFL splits
 * into proper conference units from 2005 on. The same players are drafted in
 * both halves, because they were two independent drafts.
 *
 * Detected from the DATA (a round boundary with disjoint franchises either
 * side) rather than from a hardcoded year, and reported rather than
 * rearranged: renumbering the second half would silently rewrite what MFL
 * recorded, and the honest thing is to say what the feed contains.
 *
 * @returns the first round of the second draft, or null.
 */
export function detectConcatenatedDrafts(
  picks: { round: number; franchiseId: string }[]
): number | null {
  const rounds = [...new Set(picks.map((p) => p.round))].sort((a, b) => a - b);
  if (rounds.length < 4) return null;

  for (let i = 1; i < rounds.length; i++) {
    const before = new Set(
      picks.filter((p) => p.round < rounds[i]).map((p) => p.franchiseId)
    );
    const after = new Set(
      picks.filter((p) => p.round >= rounds[i]).map((p) => p.franchiseId)
    );
    if (before.size < 2 || after.size < 2) continue;
    if ([...after].every((f) => !before.has(f))) return rounds[i];
  }
  return null;
}

/** Compare this draft's shape to the league's most recent one. */
export function describeShape(
  picks: DraftResultsPick[],
  units: DraftResultsUnit[],
  opts: { isEarliestYear: boolean; currentRounds: number; currentUnits: number }
): DraftShape {
  const rounds = new Set(picks.map((p) => p.round)).size;
  const concatenatedFrom = detectConcatenatedDrafts(picks);
  // Two 8-round drafts stacked is not a 16-round draft, so it must not be
  // called an expanded one.
  const oversized =
    concatenatedFrom === null && opts.currentRounds > 0 && rounds > opts.currentRounds;
  const singleUnit =
    concatenatedFrom === null && opts.currentUnits > 1 && units.length < opts.currentUnits;

  // Order matters: a founding draft is a startup draft first and an oversized
  // one only incidentally, and that is the more useful thing to call it.
  const badge = opts.isEarliestYear && (oversized || singleUnit)
    ? 'Startup Draft'
    : concatenatedFrom !== null
      ? 'Two Drafts, One Board'
      : oversized
        ? 'Expanded Draft'
        : singleUnit
          ? 'One Draft, No Conferences'
          : null;

  return {
    rounds,
    picks: picks.length,
    units: units.length,
    concatenatedFrom,
    startup: opts.isEarliestYear && (oversized || singleUnit),
    oversized,
    singleUnit,
    badge,
  };
}

export interface ResolveDraftResultsInput {
  /** Every season that has a draftResults feed, any order. */
  availableYears: number[];
  /** The season being viewed (already resolved by the route). */
  year: number;
  /** That season's raw `draftResults.draftUnit`. */
  rawUnit: RawDraftUnit<RawDraftResultPick> | RawDraftUnit<RawDraftResultPick>[] | undefined;
  /** Franchises as configured FOR THAT SEASON — names and slots move. */
  teams: DraftResultsTeam[];
  /** Query string of the request. */
  params: URLSearchParams;
  /** MFL unit code → display name. */
  labelForUnit: (code: string) => string;
  resolvePlayer: PlayerResolver;
  /** Rounds and units in the league's most recent draft, for shape comparison. */
  currentRounds: number;
  currentUnits: number;
  /** Franchise to default the team filter to (the signed-in owner's), if any. */
  preferredTeamId?: string | null;
}

/**
 * Resolve the whole view: which board, which team, which rows.
 *
 * `?conference=` accepts MFL's unit id or the bare conference code, because
 * `selectDraftUnit` does — the AFL broadcast page links with the bare code.
 */
export function resolveDraftResultsView(input: ResolveDraftResultsInput): DraftResultsView {
  const years = [...input.availableYears].sort((a, b) => b - a);
  const units = listDraftUnits(input.rawUnit, input.labelForUnit);

  const requested = input.params.get('conference');
  const selected =
    (requested && units.find((u) => matchesUnit(u.code, requested))?.code) ||
    units[0]?.code ||
    null;

  const unit = selected ? selectDraftUnit<RawDraftResultPick>(input.rawUnit, selected) : null;
  const teamMap = new Map(input.teams.map((t) => [t.id, t]));
  const board = buildDraftBoard(unit, teamMap, input.resolvePlayer);

  // 'all' is honored explicitly; otherwise the signed-in owner's franchise is
  // only a HIGHLIGHT, never a filter — a cold visitor must see the whole board.
  const teamParam = input.params.get('team');
  const team = teamParam && (teamParam === 'all' || teamMap.has(teamParam)) ? teamParam : 'all';
  const picks = team === 'all' ? board : board.filter((p) => p.franchiseId === team);

  const shape = describeShape(board, units, {
    isEarliestYear: years.length > 0 && input.year === years[years.length - 1],
    currentRounds: input.currentRounds,
    currentUnits: input.currentUnits,
  });

  return {
    years,
    year: input.year,
    units,
    unit: units.length > 1 ? selected : null,
    teams: input.teams,
    team,
    picks,
    totalPicks: board.length,
    shape,
    isEmpty: board.length === 0,
    selectionless: board.filter((p) => !p.playerId).length,
    unnamed: board.filter((p) => p.playerId && !p.playerName).length,
  };
}

function matchesUnit(code: string, requested: string): boolean {
  const a = code.trim().toUpperCase();
  const b = requested.trim().toUpperCase();
  return a === b || a === `CONFERENCE${b}`;
}

/**
 * The season the page opens on: the most recent draft that actually HAPPENED.
 *
 * A feed exists for a draft before it is conducted (MFL stubs the slots), so
 * "newest year with a feed" would open on an empty board all offseason.
 * `hasPicks` is asked of each year, newest first, until one answers.
 */
export function resolveDefaultYear(
  availableYears: number[],
  hasPicks: (year: number) => boolean
): number | null {
  const descending = [...availableYears].sort((a, b) => b - a);
  return descending.find(hasPicks) ?? descending[0] ?? null;
}

/** The season requested by `?year=`, when it's one we actually have. */
export function resolveRequestedYear(
  params: URLSearchParams,
  availableYears: number[]
): number | null {
  const raw = params.get('year');
  if (!raw) return null;
  const year = parseInt(raw, 10);
  return availableYears.includes(year) ? year : null;
}
