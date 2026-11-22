/**
 * Every fantasy-eligible player in ONE real NFL game, scored by ONE league.
 *
 * The drill-in behind an NFL game card (`LvNflGameDetail`). Pure and
 * client-safe, so the board island calls it every render with the live
 * payloads and the screen moves with each poll, exactly like a fantasy
 * matchup's drill-in does.
 *
 * ── TWO SOURCES OF POINTS, AND WHICH ONE WINS ─────────────────────────────
 * A ROSTERED player's points are the board's own row — MFL's live score with
 * the ESPN overlay already applied (`espn-overlay.ts`) — so the number here is
 * the number on his fantasy team's card, to the hundredth. Recomputing it from
 * the box score would print a second, different score for the same player on
 * the same page whenever the league scores something ESPN cannot see.
 *
 * A FREE AGENT has no row: MFL's `liveScoring` only covers rostered players,
 * and its `playerScores` export does not move during a game. His points are
 * the ESPN box score scored by the league's own MFL rules (`scorePlayerStats`
 * → `itemized`), the same arithmetic the stat sheet itemizes. Until those
 * rules load he is left out rather than printed at 0, because "no points" and
 * "we have not scored him yet" are different claims.
 *
 * A free-agent TEAM DEFENSE is left out entirely: MFL's defenses carry no ESPN
 * athlete id, so the box score has no line for one (see the DEF/ST rule in
 * docs/claude/rules/live-scoring.md) and any number would be invented.
 *
 * ── "FREE AGENT" IS A CLAIM ABOUT THE WHOLE LEAGUE ────────────────────────
 * A league board's panel holds every matchup, so a player on no side in it is
 * genuinely unrostered. MFL Live's cross-league board holds only the viewer's
 * OWN matchup per league, so there a player on neither side may well be on
 * someone else's team. `rostersComplete: false` keeps the owner unknown there
 * instead of tagging him FA.
 *
 * ── OWNERSHIP IS A LIST ───────────────────────────────────────────────────
 * The AFL rosters the same NFL player in both conferences, so one player can
 * belong to two franchises at once. A `Map<playerId, owner>` would keep the
 * last one written and drop the other.
 */
import type { LivePanel, LiveTeam } from '../../types/live';
import type { LivePlayerRow, NflGame, PlayerBoxScore, PlayerMeta } from '../../types/live-scoring';
import { canonPosition, scorePlayerStats, type PositionRuleSet } from './scoring-rules';

/** The fantasy team a player is on, in the shape the row's mark needs. */
export interface NflGameOwner {
  franchiseId: string;
  name: string;
  nameShort: string;
  initials: string;
  icon: string;
  iconAlt: string;
  /** Uploaded-art rung, which crops rather than fits. */
  crop: boolean;
  /** The viewer's own franchise in this league. */
  mine: boolean;
}

export interface NflGamePlayer {
  row: LivePlayerRow;
  /** Empty for a free agent, and for a player whose owner this board cannot see. */
  owners: NflGameOwner[];
  /** On no roster in this league — only ever true when rosters are complete. */
  freeAgent: boolean;
  /** He has a projection to show (rostered rows only). */
  hasProjection: boolean;
}

export interface NflGameSide {
  code: string;
  /** Rostered players, and anyone with a stat — highest score first. */
  players: NflGamePlayer[];
  /** Eligible free agents with nothing in the box score yet. */
  quiet: NflGamePlayer[];
}

export interface NflGamePlayersInput {
  game: NflGame;
  panel: LivePanel;
  /** The board's shared identity map (rostered players). */
  meta: Record<string, PlayerMeta>;
  /** Every MFL player on the two NFL teams (`/api/nfl-team-players`). */
  pool: readonly PlayerMeta[];
  boxScore: Record<string, PlayerBoxScore>;
  /** This league's rules. `undefined` = not loaded; free agents wait for it. */
  rules: PositionRuleSet[] | undefined;
  /** The panel holds every franchise in the league (a league board). */
  rostersComplete: boolean;
}

export interface NflGamePlayers {
  away: NflGameSide;
  home: NflGameSide;
  /** Identity for the free agents, to merge under the board's own map. */
  meta: Record<string, PlayerMeta>;
  /** Free agents are being held back until the league's rules load. */
  freeAgentsPending: boolean;
}

const QUARTER_SECONDS = 15 * 60;
const GAME_SECONDS = 4 * QUARTER_SECONDS;

/** Seconds left in a game, from ESPN's own clock. Only the projection reads it. */
export function gameSecondsLeft(game: NflGame): number {
  if (game.state === 'pre') return GAME_SECONDS;
  if (game.state === 'post') return 0;
  const [m, s] = String(game.clock ?? '').split(':').map((n) => Number.parseInt(n, 10));
  const clock = Number.isFinite(m) ? m * 60 + (Number.isFinite(s) ? s : 0) : 0;
  const period = Number.isFinite(game.period) ? game.period : 1;
  // Overtime counts what is on its clock; a regulation quarter adds the rest.
  return period >= 4 ? clock : (4 - period) * QUARTER_SECONDS + clock;
}

function ownerOf(team: LiveTeam, viewerFranchiseId: string | null): NflGameOwner {
  return {
    franchiseId: team.franchiseId,
    name: team.name,
    nameShort: team.nameShort || team.name,
    initials: team.initials,
    icon: team.icon,
    iconAlt: team.iconAlt,
    crop: team.rung === 'mfl',
    mine: viewerFranchiseId !== null && team.franchiseId === viewerFranchiseId,
  };
}

const byScore = (meta: Record<string, PlayerMeta>) => (a: NflGamePlayer, b: NflGamePlayer) =>
  b.row.live - a.row.live ||
  (b.row.projected ?? 0) - (a.row.projected ?? 0) ||
  (meta[a.row.id]?.name ?? '').localeCompare(meta[b.row.id]?.name ?? '') ||
  a.row.id.localeCompare(b.row.id);

export function buildNflGamePlayers(input: NflGamePlayersInput): NflGamePlayers {
  const { game, panel, meta, pool, boxScore, rules, rostersComplete } = input;
  const away = String(game.away.code ?? '').toUpperCase();
  const home = String(game.home.code ?? '').toUpperCase();

  // Ownership and the board's own row, from every side of every matchup —
  // starters AND bench, because a bench player is just as much on that team.
  const owners = new Map<string, NflGameOwner[]>();
  const rows = new Map<string, LivePlayerRow>();
  for (const m of panel.matchups) {
    for (const side of m.sides) {
      for (const row of [...side.players, ...side.bench]) {
        const list = owners.get(row.id) ?? [];
        if (!list.some((o) => o.franchiseId === side.franchiseId)) {
          list.push(ownerOf(side, panel.viewerFranchiseId));
        }
        owners.set(row.id, list);
        if (!rows.has(row.id)) rows.set(row.id, row);
      }
    }
  }

  // Which positions this league scores. No rules (not loaded) admits every
  // position the player map carries — the rostered rows still need a home.
  const eligible = rules
    ? new Set(rules.flatMap((block) => block.positions.map(canonPosition)))
    : null;
  const isEligible = (position: string) => !eligible || eligible.has(canonPosition(position));

  const extraMeta: Record<string, PlayerMeta> = {};
  const identity = (id: string): PlayerMeta | undefined => meta[id] ?? extraMeta[id];
  for (const p of pool) if (!meta[p.id]) extraMeta[p.id] = p;

  const secondsLeft = gameSecondsLeft(game);
  const sides: Record<string, NflGameSide> = {
    [away]: { code: away, players: [], quiet: [] },
    [home]: { code: home, players: [], quiet: [] },
  };

  const seen = new Set<string>();
  const candidates = [...rows.keys(), ...pool.map((p) => p.id)];
  let freeAgentsPending = false;

  for (const id of candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    const who = identity(id);
    if (!who) continue;
    const side = sides[String(who.nflTeam ?? '').toUpperCase()];
    if (!side) continue;
    if (!isEligible(who.position)) continue;

    const rostered = rows.get(id);
    // A rostered player always shows, stats or not: he is on somebody's team.
    if (rostered) {
      side.players.push({
        row: rostered,
        owners: owners.get(id) ?? [],
        freeAgent: false,
        hasProjection: (rostered.projected ?? 0) > 0,
      });
      continue;
    }

    // Unrostered from here on.
    if (canonPosition(who.position) === 'DEF') continue;
    if (!rules) {
      freeAgentsPending = true;
      continue;
    }
    const box = boxScore[id];
    const live = box?.stats
      ? scorePlayerStats({
          rules,
          position: who.position,
          stats: box.stats,
          fgLengths: box.fgLengths,
          total: 0,
        }).itemized
      : 0;
    const player: NflGamePlayer = {
      row: { id, live, secondsRemaining: secondsLeft, status: 'free-agent' },
      owners: [],
      freeAgent: rostersComplete,
      hasProjection: false,
    };
    const hasStats = Boolean(box?.statLine) || Math.abs(live) >= 0.005;
    (hasStats ? side.players : side.quiet).push(player);
  }

  const allMeta = { ...extraMeta, ...meta };
  for (const side of Object.values(sides)) {
    side.players.sort(byScore(allMeta));
    side.quiet.sort(byScore(allMeta));
  }

  return {
    away: sides[away],
    home: sides[home],
    meta: extraMeta,
    freeAgentsPending,
  };
}
