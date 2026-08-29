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
import type {
  BroadcastDefenseFace,
  BroadcastPlayer,
  BroadcastPlayerExtras,
} from '../types/draft-broadcast';
import { parseTradeFromComment, selectDraftUnit } from './draft-utils';
import { buildMflExportUrl } from './mfl-url';
import { normalizeTeamCode } from './nfl-logo';
import { resolveCollegeDarkLogoUrl } from './college-logo-dark-css';
import { usesCollegeOrigin } from './pick-reveal';
import { getDefSpotlightPlayers } from '../data/theleague/def-spotlight-players';
import collegeLogos from '../data/college-logos.json';

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

/**
 * Injury status by player id — only players WITH an injury appear in the feed.
 *
 * `injuries.json` is written by our own fetcher as a KEYED MAP
 * (`injuries: { "9694": { injuryStatus, injuryBodyPart, … } }`), not as MFL's
 * raw `injuries.injury[]` list. Reading it the MFL way returned an empty map
 * every time, so the reveal card's injury chip could never render — a feature
 * that fails silently rather than loudly, which is why it survived a full
 * build and a live data check.
 */
function loadInjuries(dataPath: string, year: number): Map<string, string> {
  const raw = readJson(`${dataPath}/mfl-feeds/${year}/injuries.json`);
  const out = new Map<string, string>();
  for (const [id, entry] of Object.entries<any>(raw?.injuries ?? {})) {
    const status = entry?.injuryStatus;
    if (id && status) out.set(id, String(status));
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
 * How many marquee defenders ride along with a team defense.
 *
 * The card shows TWO of them, drawn at random, so this is the size of the hat
 * rather than a display budget. Five gives ten possible pairings — deep enough
 * that the same defense drafted in both conferences (`duplicatePlayers` allows
 * it) is unlikely to show the room the same two men, and shallow enough that
 * every name in it is one the room recognises. The pool's sixth is a
 * rotational safety nobody is looking up.
 */
const DEFENSE_FACE_LIMIT = 5;

/**
 * The marquee defenders each team defense in the pool can be represented by,
 * keyed by the RAW `nflTeam` string its players carry.
 *
 * Built per TEAM, not per player, and that is load-bearing rather than tidy:
 * `normPos` (build-draft-players.ts) folds every MFL team-unit pseudo-player —
 * `TMQB`, `TMRB`, `TMDL`, `TMPN`, and six more — into `DEF`, and each shares
 * its real defense's name and team code. The 2026 pool carries 320 such
 * players for 32 distinct defenses, so hanging the pool off each one added
 * 101 KB (+28%) to the serialized payload to ship 32 lists. There is no way to
 * tell the 32 from the 288 downstream: by the time a player reaches this
 * function its position has already been normalized, and the pseudo-players are
 * byte-identical on name and team.
 *
 * `getDefSpotlightPlayers` does the team-code normalization itself, which is
 * the whole reason to call it rather than index the map: a DEF's `nflTeam`
 * arrives in MFL's dialect (`NEP`, `GBP`, `KCC`), the map is keyed ESPN-style
 * (`NE`, `GB`, `KC`), and Washington disagrees with BOTH — indexing raw would
 * silently drop nine of the 32 defenses. The RESULT is keyed by the raw string
 * so the island can do a plain lookup without shipping a normalizer.
 *
 * A team with no mapped pool is simply absent, and its reveal falls back to the
 * crest-only treatment.
 */
export function buildDefenseFacesByTeam(
  players: BroadcastPlayer[]
): Record<string, BroadcastDefenseFace[]> {
  const out: Record<string, BroadcastDefenseFace[]> = {};
  for (const p of players) {
    if ((p.position || '').toUpperCase() !== 'DEF') continue;
    const key = p.nflTeam || '';
    if (!key || out[key]) continue;
    const pool = getDefSpotlightPlayers(key)
      .filter((d) => d.espnId)
      .slice(0, DEFENSE_FACE_LIMIT);
    if (pool.length === 0) continue;
    out[key] = pool.map((d) => ({ name: d.name, espnId: d.espnId, position: d.position }));
  }
  return out;
}

/**
 * School name → the logo the reveal card paints beside it, lowercased on the
 * key because MFL's spelling of a school is not reliably the table's casing.
 *
 * Dark cut preferred, light logo as the fallback, and that ordering is the same
 * decision `buildCollegeLogoDarkCss` makes in CSS: `resolveCollegeDarkLogoUrl`
 * returns null for the handful of ids whose `500-dark` cut 404s upstream, and
 * for those the light mark is strictly better than a URL known to render a
 * broken-image icon. The card's background is a franchise gradient in BOTH
 * themes, so unlike every other surface this choice is made once here rather
 * than left to an `html.dark` swap — see `resolveOrigin`.
 *
 * Built lazily and once: the table is 264 entries, and a page that reveals no
 * rookie should not pay for it at import time.
 */
const COLLEGE_LOGO_TABLE = collegeLogos as Record<
  string,
  { logo?: string | null; logoDark?: string | null } | undefined
>;

let collegeLogoIndex: Map<string, string> | null = null;

function collegeLogoFor(college?: string): string | undefined {
  if (!college) return undefined;
  if (!collegeLogoIndex) {
    collegeLogoIndex = new Map();
    for (const [name, entry] of Object.entries(COLLEGE_LOGO_TABLE)) {
      const dark = entry?.logoDark ? resolveCollegeDarkLogoUrl(entry.logoDark) : null;
      const url = dark ?? entry?.logo ?? null;
      if (url) collegeLogoIndex.set(name.toLowerCase(), url);
    }
  }
  return collegeLogoIndex.get(college.trim().toLowerCase());
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

  return players.map((p) => {
    const extras: BroadcastPlayerExtras = {
      projectedPoints: projections.get(p.id),
      injuryStatus: injuries.get(p.id),
      byeWeek: p.nflTeam ? byes.get(normalizeTeamCode(p.nflTeam)) : undefined,
      // Gated on the card's OWN origin rule rather than on `p.college` so the
      // two cannot drift: a veteran carries a school MFL never stops reporting,
      // and the card labels him with his NFL team regardless.
      collegeLogo: usesCollegeOrigin(p) ? collegeLogoFor(p.college) : undefined,
    };
    return { ...p, ...extras };
  });
}

/**
 * Drop players nobody will draft, to keep the serialized payload small.
 *
 * A TV page that ships all 2609 players wastes bytes on names that will never
 * be revealed. Anyone MFL lists an ADP or a week-1 projection for is plausibly
 * draftable in a 9-round league; everyone else is filler.
 *
 * The `boardPlayerIds` escape hatch below is NOT load-bearing on draft night
 * and must not be relied on: it is computed from the DEPLOYED board snapshot,
 * which is empty until picks start landing. So a live pick of someone with
 * neither an ADP nor a projection would not be in the shipped pool and would
 * reveal as a blank card — the one outcome worth spending bytes to avoid. That
 * is why the position filter below is the real guard: every draftable-position
 * player with a name ships, whether or not any feed ranks him.
 */
export function trimToDraftable(
  players: BroadcastPlayer[],
  boardPlayerIds: ReadonlySet<string>
): BroadcastPlayer[] {
  return players.filter(
    (p) =>
      boardPlayerIds.has(p.id) ||
      p.adpAveragePick !== undefined ||
      p.projectedPoints !== undefined ||
      // The catch-all: a real pick can be a deep flier no feed ranks. On the
      // 2025 board that was 1 of 108 — rare, but it lands on a 65" screen.
      // Gated on being ON an NFL roster: without that this also ships every
      // retired player at a draftable position (Teddy Bridgewater et al) and
      // the payload nearly doubles for names that cannot be picked.
      isPlausiblyDraftable(p)
  );
}

/** Positions the AFL actually drafts. DEF is included: team defenses go late. */
const DRAFTABLE_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'PK', 'DEF']);

/**
 * Not on an NFL roster, not draftable. `nflTeam` resolves to the NFL shield
 * ('NFL') for free agents and retirees via `normalizeTeamCode`'s FA mapping,
 * which is exactly the population to exclude.
 */
function isPlausiblyDraftable(p: BroadcastPlayer): boolean {
  if (!p.name) return false;
  if (!DRAFTABLE_POSITIONS.has((p.position || '').toUpperCase())) return false;
  const team = normalizeTeamCode(p.nflTeam || '');
  return !!team && team !== 'NFL' && team !== 'FA';
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
 * Stamp each draftable player with his rank in this conference's pre-draft
 * pool — "board rank". Kept players get none; they were never on the board.
 *
 * Ordered by MFL average draft position and nothing else (Brandon,
 * 2026-08-27: the league's own ranking sources are not for this screen). MFL
 * ADP is also the right single source here — it is a real pick number rather
 * than an ordinal, and it is what the room's own drafters are looking at.
 * Its coverage is the actual draftable universe: 107 of the 108 picks made on
 * the 2025 board carried an MFL ADP, while the players it omits are the
 * retired tail. A player without one is left unranked rather than guessed at,
 * and the reveal simply shows no board line for him.
 */
export function assignBoardRanks(
  players: BroadcastPlayer[],
  keptIds: ReadonlySet<string>
): BroadcastPlayer[] {
  const rankable = players
    .filter((p) => !keptIds.has(p.id))
    .filter((p) => p.adpAveragePick !== undefined)
    .sort((a, b) => a.adpAveragePick! - b.adpAveragePick!);

  const rank = new Map<string, number>();
  rankable.forEach((p, i) => rank.set(p.id, i + 1));

  return players.map((p) => {
    const boardRank = rank.get(p.id);
    return boardRank === undefined ? p : { ...p, boardRank };
  });
}

/** How many seasons back to look for a board worth rehearsing against. */
const REHEARSAL_LOOKBACK_YEARS = 12;

/**
 * Most recent season before `leagueYear` whose board for THIS conference is
 * actually complete, or undefined when none is.
 *
 * Resolved by reading the feeds rather than assuming `leagueYear - 1`, because
 * the rehearsal link is the one control on the page that can dead-end: pointing
 * it at a season with an empty (or partial) board would drop the operator onto
 * a broadcast that never reveals anything, which looks identical to the page
 * being broken. Scoped per conference because `duplicatePlayers` lets the two
 * conferences draft — and finish — independently; in 2025 they ran on separate
 * days, so "the AL board is done" does not imply the NL board is.
 *
 * A board counts only if EVERY slot is filled. A half-finished season would
 * replay fine up to the gap and then stall on an empty slot forever.
 */
export function findRehearsalYear(
  dataPath: string,
  leagueYear: number,
  unit: string
): number | undefined {
  for (let year = leagueYear - 1; year >= leagueYear - REHEARSAL_LOOKBACK_YEARS; year--) {
    const raw = readJson(`${dataPath}/mfl-feeds/${year}/draftResults.json`);
    if (!raw) continue;
    const { picks } = buildConferenceBoard(raw, unit);
    if (picks.length > 0 && picks.every((p) => p.playerId)) return year;
  }
  return undefined;
}

/**
 * Does this feed actually carry a BOARD for the named unit?
 *
 * MFL publishes a league's draft units as soon as the league exists, but a
 * unit's `draftPick` array stays EMPTY until someone sets the draft up — the
 * copy league used to rehearse the 2026 AFL draft answered `draftResults` with
 * two named conferences and zero slots between them. That is a valid response,
 * not a failed fetch, so `fetchRemoteDraftResults` has nothing to report and an
 * override would happily render a board with no slots in it: no draft order, no
 * first pick, nothing on the pre-draft screen.
 *
 * The empty case has to be caught HERE rather than left to the poll, because
 * the poll fixes itself and the pre-draft screen does not — `ingest` ignores an
 * empty board, so the page would sit blank for however long it takes someone to
 * finish setting the draft up.
 */
export function hasDraftSlots(draftResults: any, unit: string): boolean {
  const selected = selectDraftUnit(draftResults?.draftResults?.draftUnit, unit);
  return toArray<any>(selected?.draftPick).length > 0;
}

/**
 * Fetch a draft board straight from MFL, for a league we hold no feed for.
 *
 * ONLY the `?mflLeague=` override path calls this (see
 * `draft-broadcast-source.ts`). The league's own board is read from the
 * committed feed — a page that reached the network on every SSR render would
 * put draft night behind MFL's availability, which is the one dependency this
 * page was built to avoid.
 *
 * Returns null on ANY failure, including a slow one. The caller falls back to
 * the local skeleton, so a test feed that cannot be reached degrades to "the
 * real board, not following anything" rather than a blank TV — and the flag
 * over the board still says an override was asked for, which is the difference
 * between a page that is wrong and a page that is confusing.
 */
export async function fetchRemoteDraftResults(options: {
  leagueId: string;
  host: string;
  year: number | string;
  timeoutMs?: number;
}): Promise<any | null> {
  const url = buildMflExportUrl({
    type: 'draftResults',
    leagueId: options.leagueId,
    year: options.year,
    host: `https://${options.host}`,
  });

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FantasyLeague/1.0)' },
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
