/**
 * ESPN game-detail parsers — real NFL context for the live-scoring page.
 *
 * Three public ESPN endpoints back the live page. Everything in this module is
 * PURE: URL builders + parsers over already-fetched JSON, no network. That is
 * deliberate — ESPN's hosts are intermittently 403 from the dev sandbox, so the
 * only way this logic can be verified offline is if the fetching lives
 * elsewhere (src/pages/api/nfl-game-detail.ts) and the parsing is exercised
 * against committed fixtures (tests/fixtures/espn-*.json).
 *
 *   1. scoreboard  — .../nfl/scoreboard?week&seasontype&dates
 *      competitions[0].situation exists ONLY while a game is being played and
 *      carries isRedZone / downDistanceText / possession / lastPlay.
 *   2. summary     — .../nfl/summary?event={id}
 *      boxscore.players[] → per-team stat groups → athletes[], keyed by ESPN
 *      athlete id. This is the per-player box-score line.
 *   3. plays       — sports.core.api .../events/{id}/competitions/{id}/plays
 *      Athlete-attributed play-by-play. Better than summary.scoringPlays,
 *      which is text-only with no athlete id.
 *
 * THE JOIN KEY. Everything here speaks ESPN athlete ids; the island speaks MFL
 * player ids. The crosswalk (PlayerIdentity.nflEspnId → mflId) is built and
 * applied SERVER-SIDE by buildEspnToMflMap() below, so no ESPN id ever reaches
 * the client for joining. PlayerMeta.espnId must never be used for this: it can
 * hold a COLLEGE athlete id, and college and NFL ids are both plain 4-7 digit
 * numbers, so a rookie silently resolves to a different athlete (written up in
 * docs/claude/insights/features/player-news.md).
 */

import { normalizeTeamCode } from './nfl-logo';
import { normalizeEspnTeamCode } from './live-odds';
import { isValidEspnId } from './player-news';

/** Cap on the plays page we request — a full NFL game is ~180 plays. */
export const PLAYS_PAGE_LIMIT = 300;

const SUMMARY_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';
const CORE_BASE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

/**
 * Fold any ESPN-shaped team code into the ONE canonical form the rest of the
 * app uses (the `/assets/nfl-logos/*.svg` basenames, and PlayerIdentity.nflTeam).
 *
 * Both normalizers are load-bearing and they pull in OPPOSITE directions:
 * `normalizeEspnTeamCode` folds ESPN's spellings toward MFL's (WSH → WAS),
 * `normalizeTeamCode` folds MFL's toward ESPN's (WAS → WSH) and additionally
 * handles the legacy/relocated codes (OAK, SD, STL, RAM…). Running them in this
 * order round-trips ESPN's own codes back to canonical (WSH → WAS → WSH) while
 * still catching everything either map knows about. Comparing a raw ESPN
 * abbreviation against PlayerIdentity.nflTeam without this silently fails to
 * match Washington and Jacksonville.
 */
export function canonicalNflCode(raw: string | null | undefined): string {
  if (!raw) return '';
  return normalizeTeamCode(normalizeEspnTeamCode(String(raw).toUpperCase()));
}

// ── URL builders ───────────────────────────────────────────────────────────
// Every id is interpolated into an upstream URL path, so each builder returns
// null rather than a URL for anything that is not a plain ESPN numeric id.
// Same guard, and same reasoning, as buildAthleteNewsUrl in player-news.ts.

/** Game-summary (box score) URL, or null when the event id is not an ESPN id. */
export function buildSummaryUrl(eventId: unknown): string | null {
  if (!isValidEspnId(eventId)) return null;
  return `${SUMMARY_BASE}?event=${eventId}`;
}

/** Play-by-play URL, or null when either id is not an ESPN id. */
export function buildPlaysUrl(
  eventId: unknown,
  competitionId: unknown,
  limit = PLAYS_PAGE_LIMIT,
): string | null {
  if (!isValidEspnId(eventId) || !isValidEspnId(competitionId)) return null;
  const capped = Number.isInteger(limit) && limit > 0 && limit <= 1000 ? limit : PLAYS_PAGE_LIMIT;
  return `${CORE_BASE}/events/${eventId}/competitions/${competitionId}/plays?limit=${capped}`;
}

/**
 * Pull a trailing numeric id out of a core-API `$ref`, e.g.
 * `.../athletes/4890973?lang=en` → `4890973`.
 *
 * The plays feed embeds participant athletes and the play's team as `$ref`
 * URLs rather than inline objects, so this is what saves a follow-up fetch per
 * participant. Validated against the plain-ESPN-id shape before it is returned,
 * because the result is used as a map key and (transitively) decides which
 * rostered player a scoring play is attributed to.
 */
export function parseIdFromRef(ref: unknown, segment: string): string | null {
  if (typeof ref !== 'string') return null;
  const match = ref.match(new RegExp(`/${segment}/(\\d+)(?:[/?#]|$)`));
  const id = match?.[1];
  return id && isValidEspnId(id) ? id : null;
}

// ── scoreboard: live game situation ────────────────────────────────────────

/**
 * The live drive state ESPN attaches to a game that is actually being played.
 * Every field is optional: `situation` itself is absent before kickoff and
 * after the final whistle, and ESPN populates it unevenly in between.
 */
export interface EspnLiveSituation {
  /** True when the POSSESSING team has the ball inside the 20. */
  isRedZone: boolean;
  /** Canonical code of the team with the ball, or '' when ESPN omits it. */
  possession: string;
  /** e.g. "1st & Goal at WSH 8". Empty when absent. */
  downDistanceText: string;
  /** e.g. "1st & Goal" — the mobile-width form. Empty when absent. */
  shortDownDistanceText: string;
  /** Narration of the most recent play. Empty when absent. */
  lastPlay: string;
}

/**
 * Read the live situation off a scoreboard competition.
 *
 * `possessionTeamCode` resolution needs the competitors, because ESPN reports
 * possession as a numeric TEAM ID, not an abbreviation.
 *
 * Returns null when there is no situation — which is the normal state for a
 * game that has not kicked off or has ended, NOT an error.
 */
export function parseGameSituation(competition: any): EspnLiveSituation | null {
  const s = competition?.situation;
  if (!s || typeof s !== 'object') return null;

  const competitors: any[] = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const possId = s.possession != null ? String(s.possession) : '';
  const possTeam = possId ? competitors.find((c) => String(c?.team?.id) === possId) : undefined;

  // lastPlay is an object on the site API and a $ref on the core API; only the
  // former carries text we can show, so anything else degrades to ''.
  const lastPlayText = typeof s.lastPlay?.text === 'string' ? s.lastPlay.text : '';

  return {
    isRedZone: s.isRedZone === true,
    possession: canonicalNflCode(possTeam?.team?.abbreviation ?? ''),
    downDistanceText: typeof s.downDistanceText === 'string' ? s.downDistanceText : '',
    shortDownDistanceText:
      typeof s.shortDownDistanceText === 'string' ? s.shortDownDistanceText : '',
    lastPlay: lastPlayText,
  };
}

/**
 * Map every ESPN team id in a scoreboard payload to its canonical code.
 *
 * The plays feed names a play's team by `$ref` (`.../teams/6`) with no
 * abbreviation anywhere in the payload, so a scoring play cannot be attributed
 * to an NFL team without this lookup.
 */
export function buildTeamCodesById(scoreboard: any): Map<string, string> {
  const map = new Map<string, string>();
  for (const event of (scoreboard?.events ?? []) as any[]) {
    for (const comp of (event?.competitions ?? []) as any[]) {
      for (const c of (comp?.competitors ?? []) as any[]) {
        const id = c?.team?.id != null ? String(c.team.id) : '';
        const code = canonicalNflCode(c?.team?.abbreviation ?? '');
        if (id && code) map.set(id, code);
      }
    }
  }
  return map;
}

// ── summary: per-player box score ──────────────────────────────────────────

/** One ESPN stat group (passing, rushing, …) as key → raw value. */
export interface EspnStatGroup {
  name: string;
  stats: Record<string, string>;
}

/** Everything the box score knows about one athlete in one game. */
export interface EspnBoxScoreLine {
  espnAthleteId: string;
  athleteName: string;
  /** Canonical code of the team the athlete is listed under. */
  teamCode: string;
  groups: EspnStatGroup[];
}

/**
 * Flatten `summary.boxscore.players[]` into one entry per athlete.
 *
 * Zips each group's `keys` (machine names — stable) against each athlete's
 * `stats` array. NEVER zip against `labels`: those are display strings ESPN
 * reserves the right to restyle, and they collide across groups (passing YDS
 * and rushing YDS are both "YDS").
 *
 * DEF/ST is absent by construction. `boxscore.players` is athlete-keyed, and a
 * team defense is not an athlete — see resolveDefStatLine() for what we do
 * about that.
 */
export function parseBoxScore(summary: any): EspnBoxScoreLine[] {
  const out: EspnBoxScoreLine[] = [];
  const byAthlete = new Map<string, EspnBoxScoreLine>();

  for (const teamBlock of (summary?.boxscore?.players ?? []) as any[]) {
    const teamCode = canonicalNflCode(teamBlock?.team?.abbreviation ?? '');
    for (const group of (teamBlock?.statistics ?? []) as any[]) {
      const name = typeof group?.name === 'string' ? group.name : '';
      const keys: string[] = Array.isArray(group?.keys) ? group.keys : [];
      if (!name || keys.length === 0) continue;

      for (const row of (group?.athletes ?? []) as any[]) {
        const id = row?.athlete?.id != null ? String(row.athlete.id) : '';
        if (!isValidEspnId(id)) continue;
        const values: string[] = Array.isArray(row?.stats) ? row.stats : [];
        if (values.length === 0) continue;

        const stats: Record<string, string> = {};
        keys.forEach((k, i) => {
          if (typeof k === 'string' && values[i] != null) stats[k] = String(values[i]);
        });

        let line = byAthlete.get(id);
        if (!line) {
          line = {
            espnAthleteId: id,
            athleteName: String(row?.athlete?.displayName ?? ''),
            teamCode,
            groups: [],
          };
          byAthlete.set(id, line);
          out.push(line);
        }
        line.groups.push({ name, stats });
      }
    }
  }
  return out;
}

const num = (raw: string | undefined): number => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Compress a box-score line to the one-line stat summary shown under a starter.
 *
 * Ordered passing → rushing → receiving → kicking so a player's primary role
 * leads, and a group is only emitted when the player actually touched the ball
 * in it (a QB who never ran does not get a `0 car` clause). Returns '' when
 * nothing meaningful happened — an empty string is the caller's cue that there
 * is NO STAT LINE YET, which is a different state from a failed fetch.
 */
export function formatStatLine(line: EspnBoxScoreLine): string {
  const g = (name: string) => line.groups.find((x) => x.name === name)?.stats;
  const parts: string[] = [];

  // ESPN packs made/attempted into ONE key whose name contains a slash
  // ("completions/passingAttempts" → "18/27"). Read the pair, don't look for
  // the halves as separate keys — they do not exist in the payload.
  const pair = (raw: string | undefined): [number, number] | null => {
    const m = typeof raw === 'string' ? raw.match(/^(\d+)\s*\/\s*(\d+)$/) : null;
    return m ? [Number(m[1]), Number(m[2])] : null;
  };

  const pass = g('passing');
  const passPair = pair(pass?.['completions/passingAttempts']);
  if (pass && passPair && passPair[1] > 0) {
    const seg = [`${passPair[0]}/${passPair[1]}, ${num(pass.passingYards)} yds`];
    if (num(pass.passingTouchdowns) > 0) seg.push(`${num(pass.passingTouchdowns)} TD`);
    if (num(pass.interceptions) > 0) seg.push(`${num(pass.interceptions)} INT`);
    parts.push(seg.join(', '));
  }

  const rush = g('rushing');
  if (rush && num(rush.rushingAttempts) > 0) {
    const seg = [`${num(rush.rushingAttempts)} car, ${num(rush.rushingYards)} yds`];
    if (num(rush.rushingTouchdowns) > 0) seg.push(`${num(rush.rushingTouchdowns)} TD`);
    parts.push(seg.join(', '));
  }

  const rec = g('receiving');
  if (rec && (num(rec.receptions) > 0 || num(rec.receivingTargets) > 0)) {
    const tgt = rec.receivingTargets != null ? ` (${num(rec.receivingTargets)} tgt)` : '';
    const seg = [`${num(rec.receptions)} rec${tgt}, ${num(rec.receivingYards)} yds`];
    if (num(rec.receivingTouchdowns) > 0) seg.push(`${num(rec.receivingTouchdowns)} TD`);
    parts.push(seg.join(', '));
  }

  const kick = g('kicking');
  const fg = pair(kick?.['fieldGoalsMade/fieldGoalAttempts']);
  const xp = pair(kick?.['extraPointsMade/extraPointAttempts']);
  if (fg || xp) {
    const seg: string[] = [];
    if (fg && (fg[1] > 0 || fg[0] > 0)) seg.push(`${fg[0]}/${fg[1]} FG`);
    if (xp && (xp[1] > 0 || xp[0] > 0)) seg.push(`${xp[0]}/${xp[1]} XP`);
    if (seg.length) parts.push(seg.join(', '));
  }

  const fum = g('fumbles');
  if (fum && num(fum.fumblesLost) > 0) {
    parts.push(`${num(fum.fumblesLost)} FUM lost`);
  }

  return parts.join(' \u00b7 ');
}

/**
 * DEF/ST is deliberately left with NO stat line.
 *
 * `boxscore.players` is keyed by ESPN athlete id and a team defense is not an
 * athlete, so ESPN has nothing to give us here — and MFL's 32 DEF units carry
 * no `espn_id` either, so there is no join key even in principle. The obvious
 * workaround (derive one from the OPPOSING team's totals) was considered and
 * rejected: a DEF's fantasy line is points-allowed + sacks + turnovers + return
 * TDs under each league's own scoring rules, which we do not model, so anything
 * we printed would be a plausible-looking number that disagrees with the score
 * MFL is already showing on the same row. A blank line reads as "nothing to add
 * here", which is true; a wrong line reads as fact.
 */
export const DEF_STAT_LINE = '';

// ── plays: athlete-attributed scoring ──────────────────────────────────────

/**
 * Play ids are NOT athlete ids and must not be validated as one.
 *
 * ESPN builds a play id by concatenating the event id with the play's sequence
 * number, so it grows past 12 digits partway through a normal game (the
 * captured fixture's fourth-quarter scores are all 13). `isValidEspnId`'s
 * `\d{1,12}` cap is correct for the athlete ids it guards — those are
 * interpolated into an upstream URL path — and widening it there would loosen a
 * real SSRF guard, so play ids get their own check. A play id never reaches a
 * URL here; it is a React key and a dedup-Set member, and digits-only keeps it
 * inert as both.
 */
const isEspnPlayId = (raw: unknown): raw is string =>
  typeof raw === 'string' && /^\d{1,24}$/.test(raw);

/**
 * "11:49" → seconds remaining in the period; null when unparseable.
 *
 * Needed because `sequenceNumber` orders plays WITHIN one game and says nothing
 * across games. Merging a 16-game slate on raw sequence interleaves them into
 * nonsense (a fourth-quarter play landing between two third-quarter ones), so
 * the real clock is the only shared ordering the slate has.
 */
export function parseClockSeconds(clock: unknown): number | null {
  const m = typeof clock === 'string' ? clock.match(/^(\d{1,2}):(\d{2})$/) : null;
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Chronological order for plays from DIFFERENT games: period ascending, then
 * clock descending (an NFL clock counts DOWN, so a smaller number is later),
 * then sequence as the within-game tiebreak. A play with no readable clock
 * sorts to the end of its period rather than jumping the queue.
 */
export function comparePlaysChronologically(
  a: { period: number; clock: string; sequence: number },
  b: { period: number; clock: string; sequence: number },
): number {
  if (a.period !== b.period) return a.period - b.period;
  const ca = parseClockSeconds(a.clock);
  const cb = parseClockSeconds(b.clock);
  if (ca !== cb) {
    if (ca == null) return 1;
    if (cb == null) return -1;
    return cb - ca;
  }
  return a.sequence - b.sequence;
}

/** A scoring play, attributed to the ESPN athletes who produced it. */
export interface EspnScoringPlay {
  playId: string;
  /** Monotonic within a game — ESPN's own play ordering. */
  sequence: number;
  /** 1-4, then 5+ for overtime. 0 when ESPN omits it. */
  period: number;
  /** Game clock at the play, e.g. "11:49". Empty when absent. */
  clock: string;
  /** ESPN's one-line summary ("Javonte Williams 1 Yd Rush (Kick)"). */
  text: string;
  /** Play type abbreviation: TD, FG, SF… Empty when absent. */
  typeAbbrev: string;
  /** Play type in words ("Rushing Touchdown"). */
  typeText: string;
  /** Canonical code of the scoring team, '' when unresolvable. */
  teamCode: string;
  scoreValue: number;
  awayScore: number;
  homeScore: number;
  /** Distinct ESPN athlete ids credited on the play, in participant order. */
  espnAthleteIds: string[];
}

/**
 * Extract the scoring plays from a play-by-play page.
 *
 * `teamCodesById` comes from buildTeamCodesById() — the plays feed identifies a
 * play's team only by `$ref`, so without that map every play would be
 * unattributable to an NFL team.
 */
export function parseScoringPlays(
  plays: any,
  teamCodesById: Map<string, string> = new Map(),
): EspnScoringPlay[] {
  const out: EspnScoringPlay[] = [];

  for (const item of (plays?.items ?? []) as any[]) {
    if (item?.scoringPlay !== true) continue;
    const playId = item?.id != null ? String(item.id) : '';
    if (!isEspnPlayId(playId)) continue;

    const teamId = parseIdFromRef(item?.team?.$ref, 'teams');
    const athleteIds: string[] = [];
    for (const p of (item?.participants ?? []) as any[]) {
      const id = parseIdFromRef(p?.athlete?.$ref, 'athletes');
      // The same athlete appears once per credited role (a rusher is also the
      // scorer), so dedupe — otherwise one TD becomes several ticker rows.
      if (id && !athleteIds.includes(id)) athleteIds.push(id);
    }

    out.push({
      playId,
      sequence: Number(item?.sequenceNumber) || 0,
      period: Number(item?.period?.number) || 0,
      clock: typeof item?.clock?.displayValue === 'string' ? item.clock.displayValue : '',
      text: String(item?.shortText ?? item?.text ?? ''),
      typeAbbrev: String(item?.type?.abbreviation ?? ''),
      typeText: String(item?.type?.text ?? ''),
      teamCode: (teamId && teamCodesById.get(teamId)) || '',
      scoreValue: Number(item?.scoreValue) || 0,
      awayScore: Number(item?.awayScore) || 0,
      homeScore: Number(item?.homeScore) || 0,
      espnAthleteIds: athleteIds,
    });
  }

  return out.sort(comparePlaysChronologically);
}
