/**
 * The custom-site demo's MyFantasyLeague (docs/plans/custom-site-demo.md).
 *
 * On a demo deployment every request to *.myfantasyleague.com is answered here
 * (src/utils/demo-isolation.ts routes it) and never reaches the network:
 *
 *   - EXPORTS are served from the fictional league the demo build generated
 *     (data/theleague/mfl-feeds/<year>/*.json), with the current prospect's own
 *     moves layered on top — so a roster page, a lineup page and a waiver
 *     read-back all agree with what the prospect just did.
 *   - WRITES (lineup, add/drop, waiver claims, trades, IR, taxi, watch list,
 *     draft list, trade bait) are recorded as simulated successes in that
 *     prospect's state, in the demo's own Redis under their namespace
 *     (redis-client.ts), and answered the way MFL answers success — the site's
 *     writer code then verifies them exactly as it verifies real ones.
 *
 * Trades auto-accept: the other side of a demo trade is fiction, so the
 * players simply change hands. Contracts are the site's own feature (Redis),
 * so they need nothing here.
 *
 * Request/response contracts were read off the site's own writers and readers;
 * see the stand-in section of docs/plans/custom-site-demo.md.
 */

import { getRedis } from './redis-client';
import { currentDemoContext } from './demo-request-context';
import { AsyncLocalStorage } from 'node:async_hooks';
import { LEAGUES } from '../config/leagues-data.mjs';

type Json = any; // MFL exports are loosely shaped; the readers own the typing.

// ── Base data: the generated league, loaded lazily per file ─────────────────

// One glob per league the demo serves an MFL for: the dynasty league in
// TheLeague's slot, and the keeper league in its demo-only slot. Literal
// specifiers — a glob cannot take a variable — keyed by the slot's slug.
const FEED_LOADERS: Record<'theleague' | 'keeper', Record<string, () => Promise<Json>>> = {
  theleague: import.meta.glob<Json>(
    '../../data/theleague/mfl-feeds/*/{league,rosters,players,standings,schedule,weekly-results-raw,transactions,draftResults,auctionResults,futureDraftPicks,salaryAdjustments,calendar,projectedScores,injuries,nflSchedule,fantasyPointsAllowed}.json',
    { import: 'default' },
  ),
  keeper: import.meta.glob<Json>(
    '../../data/keeper/mfl-feeds/*/{league,rosters,players,standings,schedule,weekly-results-raw,transactions,draftResults,auctionResults,futureDraftPicks,salaryAdjustments,calendar,projectedScores,injuries,nflSchedule,fantasyPointsAllowed}.json',
    { import: 'default' },
  ),
};
type StandinSlug = keyof typeof FEED_LOADERS;

/**
 * Which league this call is answering for — set once per call from its `L=`
 * parameter, and read by every feed load and state read beneath it. Scoped
 * rather than passed, because it reaches helpers several calls deep, and
 * scoped rather than module-level, because calls interleave at every await.
 */
const standinLeague = new AsyncLocalStorage<StandinSlug>();
const activeSlug = (): StandinSlug => standinLeague.getStore() ?? 'theleague';

const baseCache = new Map<string, Promise<Json | null>>();

function loadFeed(year: string, name: string): Promise<Json | null> {
  const slug = activeSlug();
  const key = `../../data/${slug}/mfl-feeds/${year}/${name}.json`;
  if (!baseCache.has(key)) {
    const loader = FEED_LOADERS[slug][key];
    baseCache.set(key, loader ? loader().then((v) => structuredClone(v)).catch(() => null) : Promise.resolve(null));
  }
  // Every caller gets its own copy: overlays mutate what they are handed.
  return baseCache.get(key)!.then((v) => (v == null ? null : structuredClone(v)));
}

// ── Per-prospect state ──────────────────────────────────────────────────────

interface PendingClaim {
  round: string;
  add: string;
  drop: string;
  bid: string | null;
  timestamp: string;
}

interface DemoMflState {
  /** Full rosters export for the year, once the prospect has changed anything. */
  rosters?: Record<string, Json>;
  lineups: Record<string, Record<string, string[]>>;
  claims: Record<string, PendingClaim[]>;
  transactions: Json[];
  watchList: Record<string, string[]>;
  draftList: Record<string, string[]>;
  tradeBait: Record<string, string[]>;
}

const STATE_KEY = 'mfl-standin-state';
/** Per league: the dynasty league keeps the original key; the keeper league its own. */
const stateKey = () => (activeSlug() === 'theleague' ? STATE_KEY : `${STATE_KEY}:${activeSlug()}`);
/** Matches the link's life closely enough; the link record is the real limit. */
const STATE_TTL_SECONDS = 15 * 86_400;

const emptyState = (): DemoMflState => ({
  lineups: {},
  claims: {},
  transactions: [],
  watchList: {},
  draftList: {},
  tradeBait: {},
});

async function loadState(): Promise<DemoMflState> {
  const redis = await getRedis();
  if (!redis) return emptyState();
  const raw = await redis.get<DemoMflState | string>(stateKey());
  if (!raw) return emptyState();
  return { ...emptyState(), ...(typeof raw === 'string' ? JSON.parse(raw) : raw) };
}

async function saveState(state: DemoMflState): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  await redis.set(stateKey(), JSON.stringify(state), { ex: STATE_TTL_SECONDS });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const asArray = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const csv = (v: string | null | undefined) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const now = () => String(Math.floor(Date.now() / 1000));

function yearOf(url: URL): string {
  return url.pathname.match(/\/(\d{4})\//)?.[1] ?? String(new Date().getFullYear());
}

async function rostersFor(year: string, state: DemoMflState): Promise<Json | null> {
  return state.rosters?.[year] ?? (await loadFeed(year, 'rosters'));
}

function franchiseRoster(rosters: Json, fid: string): Json | null {
  return asArray(rosters?.rosters?.franchise).find((f: Json) => f.id === fid) ?? null;
}

async function editableRosters(year: string, state: DemoMflState): Promise<Json> {
  const current = await rostersFor(year, state);
  const copy = structuredClone(current ?? { rosters: { franchise: [] } });
  for (const f of asArray(copy.rosters.franchise)) f.player = asArray(f.player);
  copy.rosters.franchise = asArray(copy.rosters.franchise);
  state.rosters = { ...(state.rosters ?? {}), [year]: copy };
  return copy;
}

const json = (body: Json) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Demo-Mfl': 'standin' } });
const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="ISO-8859-1"?>\n${body}`, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=ISO-8859-1', 'X-Demo-Mfl': 'standin' },
  });
const ok = () => xml('<status>OK</status>');
/** add_drop / options are HTML forms on MFL; success is "no complaint". */
const htmlOk = () =>
  new Response('<html><body><p>Demo league: request recorded.</p></body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html', 'X-Demo-Mfl': 'standin' },
  });
const mflError = (message: string, wantsJson: boolean) =>
  wantsJson ? json({ error: { $t: message } }) : xml(`<error>${message}</error>`);

// ── Exports ─────────────────────────────────────────────────────────────────

async function weeklyResults(year: string, week: string, state: DemoMflState): Promise<Json> {
  const raw = asArray(await loadFeed(year, 'weekly-results-raw'));
  const played = raw.find((w: Json) => String(w?.weeklyResults?.week) === week);
  let body: Json;
  if (played) {
    body = structuredClone(played);
  } else {
    // A week not yet played: the schedule's pairings with each roster, no scores.
    const schedule = await loadFeed(year, 'schedule');
    const rosters = await rostersFor(year, state);
    const games = asArray(schedule?.schedule?.weeklySchedule).find((w: Json) => String(w.week) === week);
    body = {
      version: '1.0',
      encoding: 'utf-8',
      weeklyResults: {
        week,
        matchup: asArray(games?.matchup).map((m: Json) => ({
          franchise: asArray(m.franchise).map((side: Json) => {
            const roster = franchiseRoster(rosters, side.id);
            return {
              id: side.id,
              isHome: side.isHome,
              score: '0.00',
              starters: '',
              nonstarters: asArray(roster?.player).map((p: Json) => `${p.id},`).join(''),
              player: asArray(roster?.player).map((p: Json) => ({ id: p.id, score: '0.00', status: 'nonstarter' })),
            };
          }),
        })),
      },
    };
  }
  // The prospect's own lineup for this week.
  for (const [fid, byWeek] of Object.entries(state.lineups)) {
    const starters = byWeek[week];
    if (!starters) continue;
    for (const m of asArray(body.weeklyResults?.matchup)) {
      for (const side of asArray(m.franchise)) {
        if (side.id !== fid) continue;
        side.starters = starters.map((id) => `${id},`).join('');
        for (const p of asArray(side.player)) p.status = starters.includes(p.id) ? 'starter' : 'nonstarter';
      }
    }
  }
  return body;
}

async function exportResponse(url: URL, state: DemoMflState): Promise<Response> {
  const type = url.searchParams.get('TYPE') ?? '';
  const year = yearOf(url);
  const week = url.searchParams.get('W');
  const ctx = currentDemoContext();
  const fid = ctx.franchiseId ?? '';

  switch (type) {
    case 'league':
      return json((await loadFeed(year, 'league')) ?? { error: { $t: 'No league for that year.' } });
    case 'rosters': {
      const rosters = structuredClone((await rostersFor(year, state)) ?? { rosters: { franchise: [] } });
      rosters.rosters.franchise = asArray(rosters.rosters.franchise);
      const only = url.searchParams.get('FRANCHISE');
      if (only) rosters.rosters.franchise = rosters.rosters.franchise.filter((f: Json) => f.id === only);
      return json(rosters);
    }
    case 'players': {
      const players = (await loadFeed(year, 'players')) ?? { players: { player: [] } };
      const wanted = csv(url.searchParams.get('PLAYERS'));
      let list = asArray(players.players?.player);
      if (wanted.length) list = list.filter((p: Json) => wanted.includes(p.id));
      // MFL marks this year's rookies `R` with DETAILS=1; the taxi-squad move reads it.
      list = list.map((p: Json) => (Number(p.draft_year) === Number(year) ? { ...p, status: 'R' } : p));
      return json({ ...players, players: { ...players.players, player: list } });
    }
    case 'leagueStandings':
    case 'standings':
      return json((await loadFeed(year, 'standings')) ?? { leagueStandings: { franchise: [] } });
    case 'schedule': {
      const schedule = (await loadFeed(year, 'schedule')) ?? { schedule: { weeklySchedule: [] } };
      if (week) {
        schedule.schedule.weeklySchedule = asArray(schedule.schedule.weeklySchedule).filter((w: Json) => String(w.week) === week);
      }
      return json(schedule);
    }
    case 'weeklyResults': {
      if (week === 'YTD') {
        // The season so far, every played week, in MFL's YTD wrapper.
        const raw = asArray(await loadFeed(year, 'weekly-results-raw'));
        const weeks = await Promise.all(
          raw.map((w: Json) => weeklyResults(year, String(w?.weeklyResults?.week), state)),
        );
        return json({ allWeeklyResults: { weeklyResults: weeks.map((w) => w.weeklyResults) } });
      }
      return json(await weeklyResults(year, week ?? '1', state));
    }
    case 'liveScoring': {
      const wr = await weeklyResults(year, week ?? '1', state);
      return json({
        liveScoring: {
          week: wr.weeklyResults.week,
          matchup: asArray(wr.weeklyResults.matchup).map((m: Json) => ({
            franchise: asArray(m.franchise).map((f: Json) => ({
              id: f.id,
              score: f.score ?? '0',
              gameSecondsRemaining: '0',
              playersYetToPlay: '0',
              playersCurrentlyPlaying: '0',
              player: asArray(f.player).map((p: Json) => ({ id: p.id, score: p.score, status: p.status, gameSecondsRemaining: '0' })),
            })),
          })),
        },
      });
    }
    case 'transactions': {
      const base = (await loadFeed(year, 'transactions')) ?? { transactions: { transaction: [] } };
      base.transactions.transaction = [...state.transactions, ...asArray(base.transactions.transaction)];
      return json(base);
    }
    case 'draftResults':
    case 'auctionResults':
    case 'futureDraftPicks':
    case 'salaryAdjustments':
    case 'projectedScores':
    case 'injuries':
    case 'nflSchedule':
    case 'fantasyPointsAllowed': {
      const data = await loadFeed(year, type);
      return json(data ?? { [type]: {} });
    }
    case 'calendar': {
      const events = asArray(await loadFeed(year, 'calendar'));
      return json({ calendar: { event: events } });
    }
    case 'pendingWaivers': {
      const mine = state.claims[fid] ?? [];
      if (!mine.length) return json({ pendingWaivers: {} });
      const byRound = new Map<string, PendingClaim[]>();
      for (const c of mine) byRound.set(c.round, [...(byRound.get(c.round) ?? []), c]);
      return json({
        pendingWaivers: {
          blindBidWaiverRequest: [...byRound].map(([round, claims]) => ({
            round,
            timestamp: claims[0].timestamp,
            comments: '',
            addsDrops: claims.map((c) => [c.add, c.bid ?? '425000', c.drop || '0000'].join('_')).join(','),
          })),
        },
      });
    }
    case 'pendingTrades':
      return json({ pendingTrades: '' });
    case 'freeAgents':
      return json({ freeAgents: { leagueUnit: [{ unit: 'LEAGUE', player: [] }] } });
    case 'tradeBait':
      return json({
        tradeBaits: {
          tradeBait: Object.entries(state.tradeBait).map(([franchise_id, ids]) => ({
            franchise_id,
            willGiveUp: ids.join(','),
            willGiveUpComments: '',
            willTakeComments: '',
          })),
        },
      });
    case 'myleagues': {
      const league = await loadFeed(year, 'league');
      return json({
        leagues: {
          league: [
            {
              league_id: league?.league?.id ?? '',
              franchise_id: fid,
              name: league?.league?.name ?? 'Demo League',
              url: `https://${url.host}/${year}/home/${league?.league?.id ?? ''}`,
            },
          ],
        },
      });
    }
    case 'myWatchList':
      return json({ myWatchList: { player: (state.watchList[fid] ?? []).map((id) => ({ id })) } });
    case 'myDraftList':
      return json({ myDraftList: { player: (state.draftList[fid] ?? []).map((id) => ({ id })) } });
    case 'salaries': {
      const rosters = await rostersFor(year, state);
      return json({
        salaries: {
          leagueUnit: {
            unit: 'LEAGUE',
            player: asArray(rosters?.rosters?.franchise).flatMap((f: Json) =>
              asArray(f.player).map((p: Json) => ({ id: p.id, salary: p.salary, contractYear: p.contractYear, contractInfo: p.contractInfo ?? '' })),
            ),
          },
        },
      });
    }
    case 'accounting':
      return json({ accounting: { entry: [] } });
    case 'nflByeWeeks':
      return json({ nflByeWeeks: { team: [] } });
    default:
      return mflError(`The demo league does not provide ${type || 'that export'}.`, url.searchParams.get('JSON') === '1');
  }
}

// ── Writes ──────────────────────────────────────────────────────────────────

function params(url: URL, body: string | undefined): URLSearchParams {
  const merged = new URLSearchParams(url.search);
  if (body) for (const [k, v] of new URLSearchParams(body)) merged.set(k, v);
  return merged;
}

async function movePlayer(state: DemoMflState, year: string, fid: string, pid: string, status: string) {
  const rosters = await editableRosters(year, state);
  const player = franchiseRoster(rosters, fid)?.player.find((p: Json) => p.id === pid);
  if (player) player.status = status;
}

async function dropPlayer(state: DemoMflState, year: string, fid: string, pid: string) {
  const rosters = await editableRosters(year, state);
  const f = franchiseRoster(rosters, fid);
  if (f) f.player = f.player.filter((p: Json) => p.id !== pid);
}

async function addPlayer(state: DemoMflState, year: string, fid: string, pid: string, salary = '425000.00') {
  const rosters = await editableRosters(year, state);
  let f = franchiseRoster(rosters, fid);
  if (!f) {
    f = { id: fid, player: [] };
    rosters.rosters.franchise.push(f);
  }
  if (!f.player.some((p: Json) => p.id === pid)) {
    f.player.push({ id: pid, status: 'ROSTER', salary, contractYear: '1', contractInfo: '' });
  }
}

async function writeResponse(url: URL, method: string, body: string | undefined, state: DemoMflState): Promise<Response> {
  const p = params(url, body);
  const year = yearOf(url);
  const fid = currentDemoContext().franchiseId;
  if (!fid) return xml('<error>Sign in with your demo link to make changes.</error>');
  const record = (tx: Json) => state.transactions.unshift({ franchise: fid, timestamp: now(), ...tx });

  // add_drop: cuts, instant adds, and waiver claims (FORCE_WAIVER) — MFL's form.
  if (url.pathname.endsWith('/add_drop')) {
    const del = p.get('DELETE');
    if (del) {
      const [round, add] = del.split('_');
      state.claims[fid] = (state.claims[fid] ?? []).filter((c) => !(c.round === round && c.add === add));
      return htmlOk();
    }
    const add = p.get('add_pid') ?? '';
    const drop = p.get('drop_pid') ?? '';
    if (p.get('FORCE_WAIVER') === 'on') {
      state.claims[fid] = [
        ...(state.claims[fid] ?? []),
        { round: p.get('ROUND') ?? '1', add, drop, bid: p.get('BBID_AMT'), timestamp: now() },
      ];
      return htmlOk();
    }
    if (drop) await dropPlayer(state, year, fid, drop);
    if (add) await addPlayer(state, year, fid, add);
    record({ type: 'FREE_AGENT', transaction: `${add ? `${add},` : ''}|${drop ? `${drop},` : ''}` });
    return htmlOk();
  }

  // options?form_name=editwr: change the drop on a filed claim.
  if (url.pathname.endsWith('/options')) {
    const round = p.get('ROUND') ?? '1';
    const claims = (state.claims[fid] ?? []).filter((c) => c.round === round);
    for (const [k, v] of p) {
      const index = Number(k.match(/^drop_(\d+)$/)?.[1]);
      if (Number.isInteger(index) && claims[index]) claims[index].drop = v;
    }
    return htmlOk();
  }

  if (!url.pathname.endsWith('/import')) return xml('<error>The demo league does not accept that request.</error>');

  switch (p.get('TYPE')) {
    case 'lineup': {
      const week = p.get('W') ?? '1';
      state.lineups[fid] = { ...(state.lineups[fid] ?? {}), [week]: csv(p.get('STARTERS')) };
      return ok();
    }
    case 'ir': {
      const onto = p.get('DEACTIVATE');
      const off = p.get('ACTIVATE');
      if (onto) await movePlayer(state, year, fid, onto, 'INJURED_RESERVE');
      if (off) await movePlayer(state, year, fid, off, 'ROSTER');
      record({ type: 'IR', activated: off ? `${off},` : '', deactivated: onto ? `${onto},` : '' });
      return ok();
    }
    case 'taxi_squad': {
      const demote = p.get('DEMOTE');
      const promote = p.get('PROMOTE');
      if (demote) await movePlayer(state, year, fid, demote, 'TAXI_SQUAD');
      if (promote) await movePlayer(state, year, fid, promote, 'ROSTER');
      record({ type: 'TAXI', promoted: promote ? `${promote},` : '', demoted: demote ? `${demote},` : '' });
      return ok();
    }
    case 'tradeProposal': {
      // The other side is fiction, so it accepts: the players change hands now.
      const other = p.get('OFFEREDTO') ?? '';
      const give = csv(p.get('WILL_GIVE_UP')).filter((id) => !id.startsWith('FP_'));
      const get = csv(p.get('WILL_RECEIVE')).filter((id) => !id.startsWith('FP_'));
      const rosters = await editableRosters(year, state);
      const mine = franchiseRoster(rosters, fid);
      const theirs = franchiseRoster(rosters, other);
      if (mine && theirs) {
        const out = mine.player.filter((pl: Json) => give.includes(pl.id));
        const inn = theirs.player.filter((pl: Json) => get.includes(pl.id));
        mine.player = [...mine.player.filter((pl: Json) => !give.includes(pl.id)), ...inn];
        theirs.player = [...theirs.player.filter((pl: Json) => !get.includes(pl.id)), ...out];
      }
      record({
        type: 'TRADE',
        franchise2: other,
        franchise1_gave_up: p.get('WILL_GIVE_UP') ?? '',
        franchise2_gave_up: p.get('WILL_RECEIVE') ?? '',
        comments: p.get('COMMENTS') ?? '',
        expires: now(),
      });
      return ok();
    }
    case 'tradeResponse':
      return ok();
    case 'tradeBait':
      state.tradeBait[fid] = csv(p.get('WILL_GIVE_UP'));
      return ok();
    case 'myWatchList': {
      const set = new Set(state.watchList[fid] ?? []);
      for (const id of csv(p.get('ADD'))) set.add(id);
      for (const id of csv(p.get('REMOVE'))) set.delete(id);
      state.watchList[fid] = [...set];
      return ok();
    }
    case 'myDraftList':
      state.draftList[fid] = csv(p.get('PLAYERS'));
      return ok();
    default:
      // Commissioner imports (salaries, accounting, franchises) have no demo
      // commissioner to send them; answer plainly rather than pretend.
      return xml('<error>The demo league does not accept that import.</error>');
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** Is this request a write, by MFL's own endpoints (mirrors mfl-fetch.ts isMflWrite)? */
function isWrite(url: URL, method: string): boolean {
  return method.toUpperCase() === 'POST' || /\/(import|add_drop|csetup|options)$/.test(url.pathname) || url.searchParams.has('DELETE');
}

/**
 * The league whose generated MFL feeds the stand-in serves. The best-ball
 * demo is draft-only and reads no MFL export for its league; any other league
 * id gets MFL's own "no such league" answer rather than the dynasty league's
 * data under another league's name.
 */
/** MFL league id → the slot the stand-in answers it from. */
const STANDIN_LEAGUES = new Map<string, StandinSlug>(
  [
    [LEAGUES.theleague.id, 'theleague'] as const,
    // Registered only on a demo deployment (leagues-data.mjs).
    [(LEAGUES as Record<string, { id: string } | undefined>).keeper?.id, 'keeper'] as const,
  ].filter((entry): entry is readonly [string, StandinSlug] => !!entry[0]),
);

export async function answerDemoMfl(url: URL, method: string, body: string | undefined): Promise<Response> {
  const wantsJson = url.searchParams.get('JSON') === '1';
  if (url.pathname.endsWith('/login')) {
    return xml('<error>The demo league has no MyFantasyLeague sign-in — use your demo link.</error>');
  }
  const leagueParam = url.searchParams.get('L') ?? new URLSearchParams(body ?? '').get('L');
  const slug = leagueParam ? STANDIN_LEAGUES.get(leagueParam) : 'theleague';
  if (!slug) return mflError('Invalid league ID.', wantsJson);
  return standinLeague.run(slug, () => answerForLeague(url, method, body, wantsJson));
}

async function answerForLeague(url: URL, method: string, body: string | undefined, wantsJson: boolean): Promise<Response> {
  const state = await loadState();
  if (isWrite(url, method)) {
    const response = await writeResponse(url, method, body, state);
    await saveState(state);
    return response;
  }
  if (url.pathname.endsWith('/export')) return exportResponse(url, state);
  return mflError('The demo league does not provide that page.', wantsJson);
}
