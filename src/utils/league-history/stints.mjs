/**
 * Player stints — who had which player, how they got him, how he left, and
 * what he did for them. Built at index time from three committed records:
 *
 * - league-history-players.json: every rostered player-week (starter or
 *   bench), which is where a player is SEEN on a roster;
 * - league-history-moves.json: the dated acquisitions (drafts, auctions,
 *   waiver and free-agent pickups, trades, other adds) and releases (drops,
 *   trades away) that open and close a stint;
 * - the AFL's keeper-history.json, when the league has one: the seven players
 *   each franchise kept into a season.
 *
 * A stint is one player on one franchise under one holding, continuously. It
 * opens on an acquisition (or, with none on record, on the first week he is
 * seen there: `how` 'unknown') and closes on a release (traded, dropped). A
 * stint still open when a season ends carries into the next season while he
 * is still there (a contract, a keeper), with three exceptions:
 * - the same franchise acquires him again (an auction re-win, a re-draft):
 *   the old stint ends 'left roster', because the record shows no release;
 * - the league records keeper sets and he is not in that franchise's set for
 *   the new season: it ends 'not kept' (estimated sets are not used);
 * - the franchise changed hands: credit follows the OWNER (ask-query.mjs), so
 *   the old owner's stint ends 'franchise changed hands' and the new owner's
 *   opens 'came with the franchise'.
 *
 * Nothing here guesses. A stint whose start predates the transaction record
 * says 'unknown'; one with no release on record says 'left roster'.
 *
 * Pure: no I/O, no imports of data. ask-stints.mjs adapts it to the Ask
 * engine's prepared indexes.
 */

/** @typedef {{ year: number, week: number, date: string | null }} StintTime */
/**
 * @typedef {{ starts: number, points: number, playoffStarts: number, playoffPoints: number, weeks: number, carriedOver: boolean, keeper: boolean | null }} StintSeason
 * @typedef {{
 *   franchiseId: string, pid: string, holder: string | null,
 *   start: StintTime | null, how: string, ref: any,
 *   end: StintTime | null, ended: string, endRef: any,
 *   lastSeen: { year: number, week: number } | null,
 *   seasons: Map<number, StintSeason>,
 * }} Stint
 */

const r2 = (n) => Math.round(n * 100) / 100;

/** Acquisition methods, as a stint's `how` says them. */
export const HOW = {
  draft: 'draft',
  auction: 'auction',
  trade: 'trade',
  waiver: 'waiver',
  freeAgent: 'free agent',
  commissioner: 'commissioner',
  inherited: 'came with the franchise',
  unknown: 'unknown',
};

/** How a stint ended. */
export const ENDED = {
  traded: 'traded',
  dropped: 'dropped',
  current: 'still rostered',
  left: 'left roster',
  notKept: 'not kept',
  handsChanged: 'franchise changed hands',
};

/** A trade's id: its date and the two franchises, as the moves file lists them (`#2` on a second same-day trade between them). */
export function tradeIds(trades) {
  const seen = new Map();
  return (trades ?? []).map(([, date, , fa, fb]) => {
    const base = `${date}:${fa}-${fb}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

const isPick = (token) => /^(FP|DP)_/.test(token);
const playersOf = (csv) =>
  String(csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !isPick(s));

/** Event order inside one (franchise, player) timeline. */
const KIND_ORDER = { acquire: 0, depart: 1, presence: 2 };
const cmpTime = (a, b) =>
  a.year - b.year || a.week - b.week || (a.date ?? '').localeCompare(b.date ?? '') || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.seq - b.seq;

/**
 * Build every stint.
 *
 * @param {{
 *   presence: Array<{ year: number, week: number, franchiseId: string, pid: string, started: boolean, counted: boolean, playoff: boolean, score: number }>,
 *   moves: any,
 *   keepers?: any,
 *   holderOf?: (year: number, franchiseId: string) => string | null,
 *   latest?: { year: number, week: number } | null,
 * }} input
 *   presence: one row per rostered player-week; `counted` = a regular-season
 *   or playoff week for that team (consolation and dead weeks are not),
 *   `playoff` = a playoff week. holderOf: who held the franchise that season
 *   (an owner key); omitted, every season of a franchise is one holding.
 *   latest: the last week on record, so a stint seen then is 'still rostered'.
 * @returns {Stint[]}
 */
export function buildStints({ presence, moves, keepers = null, holderOf = () => null, latest = null }) {
  const timelines = new Map();
  let seq = 0;
  const push = (f, pid, item) => {
    // MFL's empty-slot placeholder is not a player.
    if (!/^\d+$/.test(String(pid)) || /^0+$/.test(String(pid))) return;
    const k = `${f}|${pid}`;
    if (!timelines.has(k)) timelines.set(k, []);
    timelines.get(k).push({ ...item, seq: seq++ });
  };
  const at = (year, week, date) => ({ year, week: Number.isFinite(week) ? week : 0, date: date ?? null });

  // A pick with no timestamp (half of one AFL draft) happened during that
  // draft: the latest stamped pick of the same year stands in for its date.
  const draftDay = new Map();
  for (const [y, , , , , , , date, week] of moves?.drafts ?? []) {
    if (date && (!draftDay.has(y) || date > draftDay.get(y).date)) draftDay.set(y, { date, week });
  }
  for (const row of moves?.drafts ?? []) {
    const [y, unit, round, pick, overall, f, pid, date, week, from] = row;
    const when = date ? at(y, week, date) : at(y, draftDay.get(y)?.week ?? 0, draftDay.get(y)?.date ?? null);
    push(f, pid, { kind: 'acquire', how: HOW.draft, ...when, ref: { year: y, unit, round, pick, overall, from: from ?? null } });
  }
  for (const [y, f, pid, bid, date, week] of moves?.auctions ?? []) {
    push(f, pid, { kind: 'acquire', how: HOW.auction, ...at(y, week, date), ref: { bid } });
  }
  for (const [y, date, week, f, pid, how, bid] of moves?.pickups ?? []) {
    push(f, pid, { kind: 'acquire', how: how === 'waiver' ? HOW.waiver : HOW.freeAgent, ...at(y, week, date), ref: { bid } });
  }
  for (const [y, date, week, f, pid, how, bid] of moves?.adds ?? []) {
    push(f, pid, { kind: 'acquire', how: how === 'auction' ? HOW.auction : HOW.commissioner, ...at(y, week, date), ref: { bid } });
  }
  const ids = tradeIds(moves?.trades);
  (moves?.trades ?? []).forEach(([y, date, week, fa, fb, aGave, bGave], i) => {
    for (const [from, to, csv] of [
      [fa, fb, aGave],
      [fb, fa, bGave],
    ]) {
      for (const pid of playersOf(csv)) {
        const ref = { tradeId: ids[i], from, to };
        push(from, pid, { kind: 'depart', how: ENDED.traded, ...at(y, week, date), ref });
        push(to, pid, { kind: 'acquire', how: HOW.trade, ...at(y, week, date), ref });
      }
    }
  });
  for (const [y, date, week, f, pid] of moves?.drops ?? []) {
    push(f, pid, { kind: 'depart', how: ENDED.dropped, ...at(y, week, date), ref: null });
  }
  for (const p of presence ?? []) {
    push(p.franchiseId, p.pid, { kind: 'presence', year: p.year, week: p.week, date: null, row: p });
  }

  // Estimated keeper sets (the AFL's 2005-2008, rebuilt without a complete
  // transaction log) are not evidence a stint ended or carried.
  const estimated = new Set((keepers?.estimated?.seasons ?? []).map(Number));
  const keptSet = (y, f) => {
    if (estimated.has(Number(y))) return null;
    const list = keepers?.seasons?.[y]?.[f];
    return Array.isArray(list) ? new Set(list.map(String)) : null;
  };

  /** @type {Stint[]} */
  const stints = [];
  for (const [key, items] of timelines) {
    const [f, pid] = key.split('|');
    items.sort(cmpTime);
    sameDayOrder(items);
    /** @type {Stint | null} */
    let open = null;
    /** @type {Stint | null} */
    let lastClosed = null;

    const openStint = (start, how, ref, year) => {
      open = {
        franchiseId: f,
        pid,
        holder: holderOf(year, f),
        start,
        how,
        ref,
        end: null,
        ended: '',
        endRef: null,
        lastSeen: null,
        seasons: new Map(),
        _openedBy: null,
        _year: year,
      };
      stints.push(open);
      return open;
    };
    const close = (end, ended, endRef = null) => {
      open.end = end;
      open.ended = ended;
      open.endRef = endRef;
      lastClosed = open;
      open = null;
    };
    const closeQuietly = (ended) => close(open.lastSeen ? { year: open.lastSeen.year, week: open.lastSeen.week, date: null } : null, ended);

    /**
     * Before he is seen or acquired in a later season than the open stint's
     * latest: does the stint carry over? (a release never needs this check:
     * it closes whatever is open.)
     */
    const crossInto = (year) => {
      if (!open || year <= open._year) return;
      const holder = holderOf(year, f);
      if (holder !== open.holder) {
        const prev = open;
        closeQuietly(ENDED.handsChanged);
        openStint(null, HOW.inherited, { from: prev.holder }, year);
        open._year = year;
        return;
      }
      const kept = keptSet(year, f);
      if (kept && !kept.has(pid)) {
        closeQuietly(ENDED.notKept);
        return;
      }
      open._year = year;
    };

    for (const it of items) {
      if (it.kind === 'acquire') {
        crossInto(it.year);
        if (open) {
          // Seen there a week before the move was dated (MFL's "current week"
          // turns over mid-week): that is this acquisition, not a second one.
          const o = open;
          if (o.how === HOW.unknown && o._openedBy === 'presence' && o.start && o.start.year === it.year && it.week - o.start.week <= 1 && o.seasons.size <= 1) {
            o.how = it.how;
            o.ref = it.ref;
            o.start = { year: it.year, week: Math.min(it.week, o.start.week), date: it.date };
            o._openedBy = 'event';
            continue;
          }
          closeQuietly(ENDED.left);
        }
        openStint({ year: it.year, week: it.week, date: it.date }, it.how, it.ref, it.year);
        open._openedBy = 'event';
      } else if (it.kind === 'depart') {
        if (!open) {
          // Released with no stint on record: he was there, from a start the
          // record does not show. Unless a stint already ended this way today.
          // (A release both league-year feeds list across the Feb rollover, a day apart, is one release.)
          if (lastClosed?.end && lastClosed.ended === it.how && sameMove(lastClosed.end, it)) continue;
          openStint(null, HOW.unknown, null, it.year);
          open._openedBy = 'depart';
        }
        close({ year: it.year, week: it.week, date: it.date }, it.how, it.ref);
      } else {
        const p = it.row;
        crossInto(p.year);
        let target = open;
        if (!target) {
          // Scored for them the week he left (the move and the lineup share a
          // week): that week belongs to the stint that just ended.
          if (lastClosed?.end && lastClosed.end.year === p.year && lastClosed.end.week >= p.week) target = lastClosed;
          else {
            target = openStint({ year: p.year, week: p.week, date: null }, HOW.unknown, null, p.year);
            open._openedBy = 'presence';
          }
        }
        addWeek(target, p, keptSet);
      }
    }
    if (open) {
      const seen = open.lastSeen;
      if (seen && latest && seen.year === latest.year && seen.week === latest.week) {
        open.ended = ENDED.current;
        open.end = null;
        open = null;
      } else closeQuietly(ENDED.left);
    }
  }
  for (const s of stints) {
    delete s._openedBy;
    delete s._year;
  }
  return stints;
}

const dayNumber = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
/** Two dated moves within a few days of each other, or in the same week of the same season. */
function sameMove(a, b) {
  if (a.date && b.date) return Math.abs(dayNumber(a.date) - dayNumber(b.date)) <= 3;
  return a.year === b.year && a.week === b.week;
}

/**
 * The moves file dates a move to the day, not the minute. When one day holds
 * both an acquisition and a release of the same player by the same team, the
 * order is read from what follows: seen on the roster afterwards (before any
 * other move) means the acquisition came last (dropped, then claimed back);
 * otherwise the release did (claimed, then cut).
 */
function sameDayOrder(items) {
  for (let i = 0; i < items.length; ) {
    const a = items[i];
    let j = i + 1;
    while (j < items.length && items[j].kind !== 'presence' && items[j].year === a.year && items[j].week === a.week && items[j].date === a.date && a.date) j++;
    const run = items.slice(i, j);
    if (a.kind !== 'presence' && run.some((x) => x.kind === 'acquire') && run.some((x) => x.kind === 'depart')) {
      const acquireLast = items[j]?.kind === 'presence';
      const order = (x) => (x.kind === 'acquire') === acquireLast;
      run.sort((x, y) => Number(order(x)) - Number(order(y)) || x.seq - y.seq);
      items.splice(i, run.length, ...run);
    }
    i = j;
  }
}

function addWeek(stint, p, keptSet) {
  if (!stint.seasons.has(p.year)) {
    const kept = keptSet(p.year, stint.franchiseId);
    stint.seasons.set(p.year, {
      starts: 0,
      points: 0,
      playoffStarts: 0,
      playoffPoints: 0,
      weeks: 0,
      // On this roster in an earlier season (a contract, a keeper), or on it
      // when the franchise changed hands. An offseason acquisition is not.
      carriedOver: stint.seasons.size > 0 || stint.how === HOW.inherited,
      keeper: kept ? kept.has(stint.pid) : null,
    });
  }
  const s = stint.seasons.get(p.year);
  s.weeks++;
  if (p.started && p.counted) {
    s.starts++;
    s.points = r2(s.points + p.score);
    if (p.playoff) {
      s.playoffStarts++;
      s.playoffPoints = r2(s.playoffPoints + p.score);
    }
  }
  if (!stint.lastSeen || p.year > stint.lastSeen.year || (p.year === stint.lastSeen.year && p.week > stint.lastSeen.week)) {
    stint.lastSeen = { year: p.year, week: p.week };
  }
}

/** Starter points and starts over a stint's seasons. */
export function stintTotals(stint) {
  let starts = 0;
  let points = 0;
  let playoffStarts = 0;
  let playoffPoints = 0;
  for (const s of stint.seasons.values()) {
    starts += s.starts;
    points += s.points;
    playoffStarts += s.playoffStarts;
    playoffPoints += s.playoffPoints;
  }
  return { starts, points: r2(points), playoffStarts, playoffPoints: r2(playoffPoints) };
}
