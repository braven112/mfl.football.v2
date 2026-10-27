/**
 * The one-minute MFL checker: alerts for what happens on MFL's own site.
 *
 * The owner chose (2026-10-27) to have the server read MFL every minute, so a
 * trade, waiver run, chat message or draft pick made outside the app still
 * reaches the phone within about a minute, in ANY MFL league. MFL has no
 * webhooks; this is the poll.
 *
 * WHICH LEAGUES. Only leagues an app phone is registered in. Registration
 * (`/api/push/expo-register`) records each of the account's leagues here with
 * the year and host MFL listed it under, and stores the owner's MFL sign-in
 * encrypted (push-credentials.ts). A league whose phones have all gone, or
 * whose record lapsed, drops out on the next run.
 *
 *   push:watch:leagues            set of league ids
 *   push:watch:league:{leagueId}  { name, year, host }, TTL 30 days
 *   push:watch:state:{leagueId}   WatchState (below), TTL 7 days
 *
 * WHAT IT READS, per league per run:
 *   - transactions (O's reader, cached a minute) → waiver results, and a
 *     trade completing → "accepted" to whoever proposed it
 *   - the chat file (N's reader; public, no cookie) → chat
 *   - each phone owner's pendingTrades, with THEIR sign-in → offers to them,
 *     and the offers they made (remembered, so an acceptance can be credited)
 *   - the draft board (R's reader; each board, for a league that drafts by
 *     conference), every run while a draft is upcoming or live and every half
 *     hour otherwise → "you're on the clock"
 *
 * FIRST SIGHT ALERTS NOTHING. A league with no state is read once to record
 * what is already there; only what appears after that is news. Anything older
 * than a day is never news, so a lost state cannot replay a season.
 *
 * Every alert goes through `notifyLeagueEvent`, which dedupes by MFL's own id
 * against the app's instant path. Trade OFFERS are skipped in the leagues this
 * site runs: the site already alerts those (push-notify-trade.ts).
 *
 * Never logs a sign-in. A failure in one league never stops the others.
 */

import { getRedis } from './redis-client';
import { getLeagueById } from '../config/leagues';
import { notifyLeagueEvent, type LeagueEvent } from './push-events';
import { leagueIndexKey } from './push-expo';
import { readCredential } from './push-credentials';
import { readLeagueTransactions, type OwnerLeagueRef } from './live/mfl-live-transactions';
import { readMflChat, type MflChatMessage } from './mfl-chat';
import { fetchPendingTradeRows, resolveTradeProposer } from './mfl-trade-ops';
import { readMflLiveDraft } from './live/mfl-live-draft';
import type { OwnerLeague } from './live/owner-league';
import type { TransactionRow } from './mfl-transactions';

export const WATCH_LEAGUES_KEY = 'push:watch:leagues';
const LEAGUE_TTL_SECONDS = 30 * 24 * 60 * 60;
const STATE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Older than this is never news. */
const NEWS_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How many ids of each kind a league remembers. */
const SEEN_LIMIT = 200;
/** A draft that is neither upcoming nor live is looked at this often. */
const DRAFT_IDLE_MS = 30 * 60 * 1000;
/** An offer this owner made is remembered this long after it leaves pendingTrades. */
const OUTGOING_KEEP_MS = 24 * 60 * 60 * 1000;

export function watchLeagueKey(leagueId: string): string {
  return `push:watch:league:${leagueId}`;
}

export function watchStateKey(leagueId: string): string {
  return `push:watch:state:${leagueId}`;
}

export interface WatchLeague {
  name: string;
  year: number;
  host: string | null;
}

export interface WatchState {
  /** Transaction row ids already seen, newest first. */
  tx: string[];
  /** Chat message ids already seen. */
  chat: string[];
  /** Per franchise: incoming offer ids already alerted or seeded. */
  offersIn: Record<string, string[]>;
  /** Per franchise: offers it made — trade id → { to, seenAt }. */
  offersOut: Record<string, Record<string, { to: string; seenAt: number }>>;
  /** Per draft board (the room's `unit`, '' when the league has one board). */
  drafts: Record<string, DraftSeen>;
}

export interface DraftSeen {
  status: string;
  overall: number | null;
  checkedAt: number;
}

export function emptyState(): WatchState {
  return { tx: [], chat: [], offersIn: {}, offersOut: {}, drafts: {} };
}

/** Record the account's leagues for the checker. Called on every app launch. */
export async function watchLeagues(
  leagues: Array<{ leagueId: string; leagueName: string; year: number; host: string | null }>,
): Promise<void> {
  if (leagues.length === 0) return;
  const redis = await getRedis();
  if (!redis) return;
  for (const l of leagues) {
    if (!/^\d+$/.test(l.leagueId)) continue;
    const meta: WatchLeague = { name: l.leagueName, year: l.year, host: l.host };
    await redis.set(watchLeagueKey(l.leagueId), meta, { ex: LEAGUE_TTL_SECONDS });
  }
  await redis.sadd(WATCH_LEAGUES_KEY, ...leagues.map((l) => l.leagueId).filter((id) => /^\d+$/.test(id)));
}

// ---------------------------------------------------------------------------
// Detection: pure, so each rule is testable without MFL or Redis.

const pad = (v: unknown) => `${v ?? ''}`.trim().padStart(4, '0');

/** Rows not yet seen and recent enough to be news, oldest first. */
export function newRows(rows: TransactionRow[], seen: string[], now: number): TransactionRow[] {
  const known = new Set(seen);
  return rows.filter((r) => !known.has(r.id) && now - r.at < NEWS_WINDOW_MS).sort((a, b) => a.at - b.at);
}

/** Waiver and blind-bid wins, one event per franchise. */
export function waiverEvents(
  leagueId: string,
  rows: TransactionRow[],
  playerName: (id: string) => string,
): LeagueEvent[] {
  const byTeam = new Map<string, TransactionRow[]>();
  for (const r of rows) {
    if (r.kind !== 'waiver' && r.kind !== 'blind-bid') continue;
    if (r.added.length === 0) continue;
    byTeam.set(r.franchiseId, [...(byTeam.get(r.franchiseId) ?? []), r]);
  }
  return [...byTeam].map(([franchiseId, mine]) => ({
    kind: 'waiver-result' as const,
    leagueId,
    key: `${franchiseId}:${mine.map((r) => r.id).sort()[0]}`,
    franchiseId,
    added: mine.flatMap((r) => r.added.map(playerName)),
  }));
}

/**
 * A completed trade, told to whichever side proposed it — known only when
 * that owner has an app phone and the checker saw the offer while pending.
 */
export function acceptedEvents(
  leagueId: string,
  rows: TransactionRow[],
  offersOut: WatchState['offersOut'],
  teamName: (fid: string) => string,
): LeagueEvent[] {
  const out: LeagueEvent[] = [];
  for (const r of rows) {
    if (r.kind !== 'trade' || !r.trade) continue;
    const [a, b] = r.trade.sides.map((s) => pad(s.franchiseId));
    for (const [proposer, partner] of [[a, b], [b, a]]) {
      const made = Object.values(offersOut[proposer] ?? {});
      if (!made.some((o) => o.to === partner)) continue;
      out.push({ kind: 'trade-accepted', leagueId, key: r.id, toFranchiseId: proposer, fromName: teamName(partner) });
    }
  }
  return out;
}

/** Chat lines not yet seen. A message meant for one franchise is never broadcast. */
export function chatEvents(
  leagueId: string,
  messages: MflChatMessage[],
  seen: string[],
  franchiseIds: string[],
  teamName: (fid: string) => string,
  now: number,
): LeagueEvent[] {
  const known = new Set(seen);
  return messages
    .filter((m) => !known.has(m.id) && !m.toFranchiseId)
    .filter((m) => !m.postedAt || now - Date.parse(m.postedAt) < NEWS_WINDOW_MS)
    .map((m) => ({
      kind: 'chat' as const,
      leagueId,
      key: m.id,
      fromFranchiseId: m.franchiseId,
      fromName: m.franchiseId === '0000' ? 'Commissioner' : teamName(m.franchiseId),
      text: m.text,
      franchiseIds,
    }));
}

/** One owner's pendingTrades, split into offers made to them and offers they made. */
export function splitOffers(
  rows: Array<Record<string, unknown>>,
  franchiseId: string,
  nameToFid: Map<string, string>,
): { incoming: Array<{ id: string; from: string }>; outgoing: Array<{ id: string; to: string }> } {
  const me = pad(franchiseId);
  const incoming: Array<{ id: string; from: string }> = [];
  const outgoing: Array<{ id: string; to: string }> = [];
  for (const raw of rows) {
    const id = `${raw.trade_id ?? raw.id ?? ''}`.trim();
    if (!id) continue;
    const proposer = resolveTradeProposer(raw, me, nameToFid);
    if (proposer === me) outgoing.push({ id, to: pad(raw.offeredto ?? raw.franchise2) });
    else incoming.push({ id, from: proposer });
  }
  return { incoming, outgoing };
}

/** Keep the offers still pending, plus recently vanished ones an acceptance may yet credit. */
export function mergeOutgoing(
  previous: Record<string, { to: string; seenAt: number }>,
  current: Array<{ id: string; to: string }>,
  now: number,
): Record<string, { to: string; seenAt: number }> {
  const next: Record<string, { to: string; seenAt: number }> = {};
  for (const [id, o] of Object.entries(previous)) if (now - o.seenAt < OUTGOING_KEEP_MS) next[id] = o;
  for (const o of current) next[o.id] = { to: o.to, seenAt: now };
  return next;
}

export function draftDue(drafts: WatchState['drafts'], now: number): boolean {
  const boards = Object.values(drafts);
  if (boards.length === 0) return true;
  return boards.some((d) => d.status === 'upcoming' || d.status === 'live' || now - d.checkedAt >= DRAFT_IDLE_MS);
}

// ---------------------------------------------------------------------------
// The run

interface Reader {
  account: string;
  franchiseId: string;
  cookie: string;
}

export interface LeagueRunResult {
  leagueId: string;
  sent: number;
  seeded?: boolean;
  skipped?: string;
}

/** Every phone owner in a league who has a usable stored sign-in. */
async function readersFor(leagueId: string): Promise<Reader[]> {
  const redis = await getRedis();
  if (!redis) return [];
  const index = (await redis.hgetall<Record<string, string>>(leagueIndexKey(leagueId))) ?? {};
  const readers: Reader[] = [];
  const cookies = new Map<string, string | null>();
  for (const [field, account] of Object.entries(index)) {
    const franchiseId = field.split(':')[0];
    if (!/^\d{4}$/.test(franchiseId) || typeof account !== 'string') continue;
    if (!cookies.has(account)) cookies.set(account, await readCredential(account).catch(() => null));
    const cookie = cookies.get(account);
    if (cookie) readers.push({ account, franchiseId, cookie });
  }
  return readers;
}

/** One league, one minute. */
export async function checkLeague(leagueId: string, now = Date.now()): Promise<LeagueRunResult> {
  const redis = await getRedis();
  if (!redis) return { leagueId, sent: 0, skipped: 'no-redis' };

  const meta = await redis.get<WatchLeague>(watchLeagueKey(leagueId));
  const readers = meta ? await readersFor(leagueId) : [];
  if (!meta || readers.length === 0) {
    await redis.srem(WATCH_LEAGUES_KEY, leagueId);
    return { leagueId, sent: 0, skipped: 'no-phones' };
  }

  const stored = await redis.get<WatchState>(watchStateKey(leagueId));
  const seeding = !stored;
  const state: WatchState = { ...emptyState(), ...(stored ?? {}) };
  const events: LeagueEvent[] = [];
  const registry = !!getLeagueById(leagueId);

  const lead = readers[0];
  const ref: OwnerLeagueRef = {
    leagueId,
    leagueName: meta.name,
    year: meta.year,
    host: meta.host,
    franchiseId: lead.franchiseId,
    franchiseName: '',
  };

  // Transactions first: an acceptance is credited from the offers recorded
  // BEFORE this run's pendingTrades read drops them.
  let franchises: Record<string, string> = {};
  const snapshot = await readLeagueTransactions(ref, lead.cookie).catch(() => null);
  if (snapshot) {
    franchises = snapshot.franchises;
    const teamName = (fid: string) => franchises[fid] || `Team ${fid}`;
    const playerName = (id: string) => snapshot.players[id]?.name || 'a player';
    const fresh = newRows(snapshot.rows, state.tx, now);
    if (!seeding) {
      events.push(...waiverEvents(leagueId, fresh, playerName));
      events.push(...acceptedEvents(leagueId, fresh, state.offersOut, teamName));
    }
    state.tx = snapshot.rows.slice(0, SEEN_LIMIT).map((r) => r.id);
  }
  const teamName = (fid: string) => franchises[fid] || `Team ${fid}`;

  const chat = await readMflChat({ leagueId, year: meta.year, host: meta.host });
  if (chat.ok) {
    const franchiseIds = Object.keys(franchises);
    if (!seeding && franchiseIds.length > 0) {
      events.push(...chatEvents(leagueId, chat.messages, state.chat, franchiseIds, teamName, now));
    }
    state.chat = chat.messages.slice(-SEEN_LIMIT).map((m) => m.id);
  }

  const nameToFid = new Map(Object.entries(franchises).map(([fid, name]) => [name.toLowerCase(), fid]));
  for (const reader of readers) {
    const pending = await fetchPendingTradeRows({
      leagueId,
      year: meta.year,
      mflUserCookie: reader.cookie,
      franchiseId: reader.franchiseId,
      host: meta.host,
    }).catch(() => ({ trades: null }));
    if (!pending.trades) continue;
    const { incoming, outgoing } = splitOffers(pending.trades, reader.franchiseId, nameToFid);
    const known = new Set(state.offersIn[reader.franchiseId] ?? []);
    if (!seeding && !registry) {
      for (const offer of incoming) {
        if (known.has(offer.id) || !offer.from) continue;
        events.push({
          kind: 'trade-offer',
          leagueId,
          key: offer.id,
          fromFranchiseId: offer.from,
          toFranchiseId: reader.franchiseId,
          fromName: teamName(offer.from),
        });
      }
    }
    state.offersIn[reader.franchiseId] = incoming.map((o) => o.id).slice(0, SEEN_LIMIT);
    state.offersOut[reader.franchiseId] = mergeOutgoing(state.offersOut[reader.franchiseId] ?? {}, outgoing, now);
  }

  if (draftDue(state.drafts, now)) {
    // A league can draft on more than one board (the AFL's conferences), and
    // an owner's room shows only theirs: read as each owner until every board
    // has been seen once.
    const boardsRead = new Set<string>();
    for (const reader of readers) {
      const league: OwnerLeague = { ...ref, franchiseId: reader.franchiseId };
      const room = await readMflLiveDraft(league, reader.cookie, new Date(now)).catch(() => null);
      if (!room?.ok) continue;
      const unit = room.unit ?? '';
      if (boardsRead.has(unit)) continue;
      boardsRead.add(unit);
      const seen = state.drafts[unit];
      const clock = room.onClock;
      const slot = clock ? room.slots.find((s) => s.overall === clock.overall) : undefined;
      if (!seeding && seen && clock && slot && clock.overall !== seen.overall) {
        events.push({
          kind: 'draft-on-clock',
          leagueId,
          franchiseId: clock.franchiseId,
          overall: clock.overall,
          round: slot.round,
          pick: slot.pick,
          ...(room.unit ? { unit: room.unit } : {}),
        });
      }
      state.drafts[unit] = { status: room.status, overall: clock?.overall ?? null, checkedAt: now };
      if (!room.unit) break;
    }
  }

  let sent = 0;
  for (const event of events) sent += await notifyLeagueEvent(event);
  await redis.set(watchStateKey(leagueId), state, { ex: STATE_TTL_SECONDS });
  return { leagueId, sent, ...(seeding ? { seeded: true } : {}) };
}

/** Every watched league, a few at a time, inside the time budget. */
export async function runPushWatch(opts: { budgetMs?: number; concurrency?: number } = {}): Promise<{
  leagues: number;
  results: LeagueRunResult[];
  unfinished: number;
}> {
  const budgetMs = opts.budgetMs ?? 45_000;
  const concurrency = opts.concurrency ?? 4;
  const redis = await getRedis();
  if (!redis) return { leagues: 0, results: [], unfinished: 0 };
  const ids = ((await redis.smembers<string>(WATCH_LEAGUES_KEY)) ?? []).filter((id) => /^\d+$/.test(id));

  const started = Date.now();
  const queue = [...ids];
  const results: LeagueRunResult[] = [];
  async function worker() {
    while (queue.length > 0 && Date.now() - started < budgetMs) {
      const id = queue.shift()!;
      try {
        results.push(await checkLeague(id));
      } catch (e) {
        console.warn(`[push-watch] league ${id} failed:`, e instanceof Error ? e.message : 'error');
        results.push({ leagueId: id, sent: 0, skipped: 'error' });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return { leagues: ids.length, results, unfinished: queue.length };
}
