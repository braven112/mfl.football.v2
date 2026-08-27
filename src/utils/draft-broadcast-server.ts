/**
 * Server-side data assembly for the AFL draft broadcast board.
 *
 * Reads with `fs` rather than `import.meta.glob` for the same reason
 * `afl-draft-slot.ts` does: the page is SSR, and globbing these feeds would
 * compile every season of every feed into the server bundle to use one.
 *
 * Everything here runs at request time and ships with the page. The TV must
 * never depend on a client fetch landing mid-reveal — if the network drops
 * between polls the board keeps rendering the last state correctly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DraftRoomPick } from '../types/draft-room';
import type { BroadcastPlayer, BroadcastPlayerExtras } from '../types/draft-broadcast';
import { medianRank } from './draft-broadcast';
import { parseTradeFromComment, selectDraftUnit } from './draft-utils';
import { normalizeTeamCode } from './nfl-logo';

function readJson(relPath: string): any {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), relPath), 'utf-8'));
  } catch {
    return null;
  }
}

/** MFL returns single-element lists as a bare object; normalize both. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Build the full board skeleton for one conference from a `draftResults` feed.
 *
 * Every slot is returned, filled or not — the AFL publishes all 108 before the
 * draft starts, which is what makes "on the clock" and "next up" possible
 * without inferring anything.
 */
export function buildConferenceBoard(
  draftResults: any,
  unit: string
): { picks: DraftRoomPick[]; totalRounds: number; picksPerRound: number } {
  const selected = selectDraftUnit(draftResults?.draftResults?.draftUnit, unit);
  const raw = toArray<any>(selected?.draftPick);

  // Same (round, pickInRound) sort + sequential numbering the draft room and
  // /api/draft/status both use. Kept identical on purpose: the client swaps
  // polled picks into this array by overallPickNumber, so a different
  // numbering here would silently misalign the whole board.
  const sorted = [...raw].sort((a, b) => {
    const rDiff = parseInt(a.round || '1', 10) - parseInt(b.round || '1', 10);
    return rDiff !== 0 ? rDiff : parseInt(a.pick || '1', 10) - parseInt(b.pick || '1', 10);
  });

  const picks: DraftRoomPick[] = sorted.map((p, idx) => {
    const tradedFrom = parseTradeFromComment(p.comments || '');
    return {
      round: parseInt(p.round || '1', 10),
      pickInRound: parseInt(p.pick || '1', 10),
      overallPickNumber: idx + 1,
      franchiseId: p.franchise || '',
      playerId: p.player || '',
      timestamp: p.timestamp || '',
      comments: p.comments || '',
      isTraded: !!tradedFrom,
      originalTeamName: tradedFrom,
    };
  });

  const rounds = new Set(picks.map((p) => p.round));
  const totalRounds = rounds.size || 1;
  const picksPerRound = picks.filter((p) => p.round === picks[0]?.round).length || 1;

  return { picks, totalRounds, picksPerRound };
}

/** MFL week-1 projected points, by player id. */
function loadProjections(dataPath: string, year: number): Map<string, number> {
  const raw = readJson(`${dataPath}/mfl-feeds/${year}/projectedScores.json`);
  const out = new Map<string, number>();
  for (const s of toArray<any>(raw?.projectedScores?.playerScore)) {
    const score = parseFloat(s?.score);
    if (s?.id && Number.isFinite(score)) out.set(s.id, score);
  }
  return out;
}

/** Injury status by player id — only players WITH an injury appear in the feed. */
function loadInjuries(dataPath: string, year: number): Map<string, string> {
  const raw = readJson(`${dataPath}/mfl-feeds/${year}/injuries.json`);
  const out = new Map<string, string>();
  for (const i of toArray<any>(raw?.injuries?.injury)) {
    if (i?.id && i?.status) out.set(i.id, String(i.status));
  }
  return out;
}

/**
 * NFL bye week by team code for one season.
 *
 * Keyed through `normalizeTeamCode` because the two sides of this join speak
 * different dialects: `bye-weeks.json` comes from MFL and uses MFL's codes
 * (GBP, LVR, KCC), while a player's `nflTeam` has already been resolved
 * through `getPlayerMap()` to ESPN's (GB, LV, KC). Keying on the raw string
 * silently produced "no bye week" for eight teams — a miss that looks exactly
 * like a player who genuinely has no bye, which is why it needs normalizing on
 * BOTH sides rather than a lookup that tries a couple of spellings.
 */
function loadByeWeeks(year: number): Map<string, number> {
  const raw = readJson('data/nfl/bye-weeks.json');
  const season = raw?.seasons?.[String(year)] || {};
  const out = new Map<string, number>();
  for (const [team, week] of Object.entries(season)) {
    const w = typeof week === 'number' ? week : parseInt(String(week), 10);
    if (Number.isFinite(w)) out.set(normalizeTeamCode(team), w);
  }
  return out;
}

/**
 * Per-source ranks from the built-in ranking sources.
 *
 * The superflex board is deliberately EXCLUDED from the consensus: the AFL
 * starts one quarterback, and a superflex list ranks QBs 30+ slots high, which
 * is enough to make every QB reveal read as a reach. It stays out of the chips
 * too — a rank the league's format doesn't use is noise on a TV.
 */
const CONSENSUS_EXCLUDED_SOURCES = new Set(['espn-superflex']);

function loadRankingSources(
  year: number
): Map<string, { label: string; rank: number }[]> {
  const raw = readJson(`data/ranking-sources/${year}.json`);
  const out = new Map<string, { label: string; rank: number }[]>();
  for (const source of raw?.sources || []) {
    if (CONSENSUS_EXCLUDED_SOURCES.has(source?.id)) continue;
    for (const p of source?.players || []) {
      const rank = typeof p?.rank === 'number' ? p.rank : parseInt(String(p?.rank), 10);
      if (!p?.id || !Number.isFinite(rank)) continue;
      const list = out.get(p.id) ?? [];
      list.push({ label: source.label || source.id, rank });
      out.set(p.id, list);
    }
  }
  return out;
}

/**
 * Join broadcast-only extras onto an already-built draft player pool.
 *
 * Takes the pool from `buildDraftPlayers` rather than rebuilding it — that
 * util already resolves identity, headshots and ADP, and MFL player ids are
 * global so its theleague-rooted `players.json` resolves AFL players fine
 * (both leagues carry the identical 2609-player universe).
 */
export function enrichBroadcastPlayers(
  players: BroadcastPlayer[],
  opts: { dataPath: string; year: number }
): BroadcastPlayer[] {
  const projections = loadProjections(opts.dataPath, opts.year);
  const injuries = loadInjuries(opts.dataPath, opts.year);
  const byes = loadByeWeeks(opts.year);
  const ranks = loadRankingSources(opts.year);

  return players.map((p) => {
    const sourceRanks = ranks.get(p.id);
    const extras: BroadcastPlayerExtras = {
      projectedPoints: projections.get(p.id),
      injuryStatus: injuries.get(p.id),
      byeWeek: p.nflTeam ? byes.get(normalizeTeamCode(p.nflTeam)) : undefined,
      sourceRanks: sourceRanks?.length ? sourceRanks : undefined,
      consensusRank: sourceRanks?.length
        ? medianRank(sourceRanks.map((r) => r.rank))
        : undefined,
    };
    return { ...p, ...extras };
  });
}

/**
 * Drop players nobody will draft, to keep the serialized payload small.
 *
 * A TV page that ships all 2609 players wastes ~230 KB on names that will
 * never be revealed. Anyone carrying ADP, a consensus rank, or a projection is
 * plausibly draftable in a 9-round league; everyone else is filler. Players
 * already ON the board are always kept regardless — a pick whose player is
 * missing from the pool reveals as a blank card, which is the one outcome
 * worth spending bytes to avoid.
 */
export function trimToDraftable(
  players: BroadcastPlayer[],
  boardPlayerIds: ReadonlySet<string>
): BroadcastPlayer[] {
  return players.filter(
    (p) =>
      boardPlayerIds.has(p.id) ||
      p.adpAveragePick !== undefined ||
      p.consensusRank !== undefined ||
      p.projectedPoints !== undefined
  );
}

/**
 * Players a conference's franchises are KEEPING, and therefore never draft.
 *
 * Derived as "rostered by this conference, minus anyone already on the board"
 * rather than read as a static keeper list. MFL adds each pick to the drafting
 * franchise's roster as it lands, so a plain roster read mid-draft would count
 * the players just drafted as keepers and quietly shrink the pool under the
 * board. Subtracting the board makes the set correct however far into the
 * night the page is opened.
 *
 * Scoped to ONE conference on purpose: the AFL sets `duplicatePlayers`, so the
 * same NFL player can be kept in the National League and still be drafted in
 * the American. Pooling both conferences' keepers would delete ~84 legitimately
 * draftable players from the American League's board.
 */
export function loadConferenceKeepers(
  dataPath: string,
  year: number,
  franchiseIds: ReadonlySet<string>,
  draftedIds: ReadonlySet<string>
): Set<string> {
  const raw = readJson(`${dataPath}/mfl-feeds/${year}/rosters.json`);
  const kept = new Set<string>();
  for (const f of toArray<any>(raw?.rosters?.franchise)) {
    if (!f?.id || !franchiseIds.has(f.id)) continue;
    for (const p of toArray<any>(f.player)) {
      if (p?.id && !draftedIds.has(p.id)) kept.add(p.id);
    }
  }
  return kept;
}

/**
 * A consensus-only player sorts after every ADP-carrying player of the same
 * number. ADP and consensus rank are different scales — mixing them raw would
 * interleave a consensus #40 with an ADP 40.0 as though they meant the same
 * thing — and "no ADP at all" is itself weak evidence, so the tie-break pushes
 * those players down rather than up.
 */
const BOARD_RANK_FALLBACK_OFFSET = 1000;

/**
 * Stamp each draftable player with his rank in this conference's pre-draft
 * pool — "board rank". Kept players get none; they were never on the board.
 *
 * Ordered by MFL average draft position, falling back to the consensus rank
 * for a player no ADP feed lists. `averagePick` is preferred because it is a
 * real pick number rather than an ordinal, so two sources can't disagree about
 * spacing. A player with neither is left unranked rather than guessed at.
 */
export function assignBoardRanks(
  players: BroadcastPlayer[],
  keptIds: ReadonlySet<string>
): BroadcastPlayer[] {
  const rankable = players
    .filter((p) => !keptIds.has(p.id))
    .filter((p) => p.adpAveragePick !== undefined || p.consensusRank !== undefined)
    .sort((a, b) => {
      const av = a.adpAveragePick ?? (a.consensusRank ?? 0) + BOARD_RANK_FALLBACK_OFFSET;
      const bv = b.adpAveragePick ?? (b.consensusRank ?? 0) + BOARD_RANK_FALLBACK_OFFSET;
      return av - bv;
    });

  const rank = new Map<string, number>();
  rankable.forEach((p, i) => rank.set(p.id, i + 1));

  return players.map((p) => {
    const boardRank = rank.get(p.id);
    return boardRank === undefined ? p : { ...p, boardRank };
  });
}
