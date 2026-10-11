/**
 * View models for the standings board (src/components/shared/standings/board/):
 * the division board, the playoff picture and the all-play table, rendered in
 * either site theme (src/utils/site-theme.ts).
 *
 * Every function here takes rows the standings producers already ordered —
 * MFL's order for divisions and seeds, all-play order for the all-play view —
 * and never re-sorts them (docs/claude/rules/standings-brackets-draft-order.md).
 * What this adds is presentation: names at three lengths, the team's paint,
 * the badge it has earned and the groups the playoff picture draws.
 */
import type { TeamStanding } from '../types/standings';
import {
  resolveBand,
  resolvePlayoffBadgeStatus,
  seedValueFor,
  type StandingsTiering,
} from '../components/shared/standings/standings-table-config';
import { frontTeamArt } from './front-page-art';
import { teamAccentVar } from './team-accent-css';

export type BoardBadge = 'division_winner' | 'runner_up' | 'wild_card' | null;

export interface BoardTeam {
  id: string;
  /** MFL's official name (desktop). */
  name: string;
  /** The league's medium and short names (phones); the full name when it has none. */
  nameMedium: string;
  nameShort: string;
  icon: string;
  href?: string;
  /** Team-coloured fill for surfaces that are dark in both themes (Primetime paint). */
  gradient: string;
  /** Crest drawn on that fill — the dark-surface cut. */
  crest: string;
  crestFilter?: string;
  /** The league's crests are circle crops (Archie's), so frames clip them round; otherwise shown whole. */
  round: boolean;
  /** The franchise accent token, for a team colour used as a stripe or numeral. */
  accent: string;
  division: string;
  record: string;
  wins: number;
  losses: number;
  ties: number;
  /** Victory points, for a league that ranks on them; null where it does not. */
  vp: number | null;
  pf: number;
  pa: number;
  streak: string;
  divRecord: string;
  allPlay: { wins: number; losses: number; ties: number; pct: number };
  seed?: number;
  badge: BoardBadge;
  mine: boolean;
}

/** The identity fields the board reads from a season's config team. */
export interface BoardTeamConfig {
  franchiseId: string;
  name?: string;
  nameMedium?: string;
  nameShort?: string;
  icon?: string;
}

const num = (v: string | number | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** "8-0" or "8-0-1": a tie column only when there is a tie. */
export function formatRecord(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function parseWlt(wlt: string | undefined): { wins: number; losses: number; ties: number } {
  const [w = 0, l = 0, t = 0] = String(wlt ?? '')
    .split('-')
    .map((p) => num(p));
  return { wins: w, losses: l, ties: t };
}

export interface BoardTeamOptions {
  leagueSlug: string;
  /** Badge ladder (the page profile's), or undefined for no badges. */
  badgeSeeding?: StandingsTiering;
  /** Whether the league ranks on victory points. */
  usesVictoryPoints: boolean;
  preferredTeamId?: string;
  hrefFor: (id: string) => string | undefined;
  configFor: (id: string) => BoardTeamConfig | undefined;
}

export function toBoardTeam(team: TeamStanding, opts: BoardTeamOptions): BoardTeam {
  const cfg = opts.configFor(team.id);
  const name = team.teamName || cfg?.name || team.fname;
  const art = frontTeamArt(
    { ...(cfg ?? {}), franchiseId: team.id, name, icon: team.teamIcon || cfg?.icon },
    opts.leagueSlug,
    opts.hrefFor(team.id) ?? ''
  );
  const wins = num(team.h2hw);
  const losses = num(team.h2hl);
  const ties = num(team.h2ht);
  const ap = parseWlt(team.all_play_wlt);
  const apGames = ap.wins + ap.losses + ap.ties;
  return {
    id: team.id,
    name,
    nameMedium: cfg?.nameMedium || name,
    nameShort: cfg?.nameShort || cfg?.nameMedium || name,
    icon: team.teamIcon || cfg?.icon || '',
    href: opts.hrefFor(team.id),
    gradient: art.gradient,
    crest: art.crest || team.teamIcon,
    crestFilter: art.crestFilter,
    round: art.round,
    accent: teamAccentVar(team.id),
    division: team.division,
    record: formatRecord(wins, losses, ties),
    wins,
    losses,
    ties,
    vp: opts.usesVictoryPoints ? num(team.vp) : null,
    pf: num(team.pf),
    pa: num(team.pa),
    streak: team.strk ?? '',
    divRecord: team.divwlt ?? '',
    allPlay: { ...ap, pct: apGames ? (ap.wins + ap.ties / 2) / apGames : 0 },
    // The seed on the ladder the badges are cut on — a conference league's
    // field is per conference (`conferenceSeed`), everyone else's league-wide.
    seed: opts.badgeSeeding ? seedValueFor(team, opts.badgeSeeding) : team.seed,
    badge: opts.badgeSeeding ? resolvePlayoffBadgeStatus(team, opts.badgeSeeding) : null,
    mine: Boolean(opts.preferredTeamId) && team.id === opts.preferredTeamId,
  };
}

// ---------------------------------------------------------------------------
// Group cards (a division, or an AFL tier)
// ---------------------------------------------------------------------------

export type Tone = 'up' | 'danger' | 'down' | 'plain';

export interface GroupCell {
  text?: string;
  strong?: boolean;
  prize?: string;
  arrow?: 'up' | 'down';
  hideSm?: boolean;
}

export interface GroupRow {
  team: BoardTeam;
  lead?: boolean;
  /** A line drawn ABOVE this row. */
  cut?: Tone;
  zone?: Exclude<Tone, 'plain'>;
  zoneLabel?: { tone: Tone; text: string };
  /** The left column: a plain rank, a medal rank, or the team's seed mark. */
  rank: { kind: 'num'; n: number } | { kind: 'medal'; n: number; medals?: number } | { kind: 'seed'; n: number };
  cells: GroupCell[];
  /** Second line under the name (Primetime puts the seed mark here). */
  sub?: string;
}

// ---------------------------------------------------------------------------
// Division board
// ---------------------------------------------------------------------------

export interface BoardDivision {
  name: string;
  teams: BoardTeam[];
  /** Rows above the dashed line: the teams this division sends to the playoffs. */
  qualifiers: number;
}

/**
 * How many of each division's rows reach the playoffs on their own: the leader,
 * plus the runner-up where the ladder seeds runners-up (MAD POWER 99).
 */
export function divisionQualifiers(tiering: StandingsTiering | undefined): number {
  return tiering?.bands.some((b) => b.name === 'runners-up') ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Playoff picture
// ---------------------------------------------------------------------------

export type SeedGroupKind = 'tiles' | 'chips' | 'chase' | 'line';

export interface SeedGroup {
  kind: SeedGroupKind;
  band: string;
  label: string;
  /** "seeds 1–4". */
  range: string;
  teams: Array<{ team: BoardTeam; line: string }>;
  /** The playoff line's right-hand note. */
  note?: string;
}

const BAND_LABEL: Record<string, string> = {
  'division-winners': 'Division winners',
  'runners-up': 'Runners-up',
  'wild-cards': 'Wild cards',
  'play-in': 'Play-in',
  'toilet-bowl': 'Toilet Bowl',
  eliminated: 'In the hunt',
};
/** Bands inside the playoff field; everything after them is below the line. */
const IN_FIELD = new Set(['division-winners', 'runners-up', 'wild-cards', 'play-in']);

export interface SeedFieldOptions {
  /** "Division leaders" where the league calls them that (MAD). */
  leaderLabel?: string;
  /** How many teams below the line to show; undefined shows them all. */
  chaseLimit?: number;
}

/**
 * The playoff picture as groups, one per band of the ladder, in seed order.
 * `teams` must already be in seed order (the page's league standings).
 */
export function buildSeedField(
  teams: BoardTeam[],
  tiering: StandingsTiering,
  opts: SeedFieldOptions = {}
): SeedGroup[] {
  const seeded = teams.filter((t) => t.seed);
  const byBand = new Map<string, BoardTeam[]>();
  for (const t of seeded) {
    const band = resolveBand(t.seed, tiering);
    if (!band) continue;
    if (!byBand.has(band)) byBand.set(band, []);
    byBand.get(band)!.push(t);
  }
  const lastIn = [...seeded].reverse().find((t) => IN_FIELD.has(resolveBand(t.seed, tiering)));
  const lineVp = lastIn?.vp ?? null;
  const groups: SeedGroup[] = [];
  let lineDrawn = false;
  for (const { name } of tiering.bands) {
    const members = byBand.get(name);
    if (!members?.length) continue;
    const range = (list: BoardTeam[]) =>
      list.length === 1 ? `seed ${list[0].seed}` : `seeds ${list[0].seed}–${list[list.length - 1].seed}`;
    if (!IN_FIELD.has(name) && !lineDrawn && lastIn) {
      lineDrawn = true;
      groups.push({
        kind: 'line',
        band: 'line',
        label: 'Playoff line',
        range: '',
        teams: [],
        note:
          lineVp !== null
            ? `${lineVp} VP holds seed ${lastIn.seed}`
            : name === 'eliminated'
              ? `Seeds ${members[0].seed}–${members[members.length - 1].seed} miss the field`
              : `Seeds ${members[0].seed}–${members[members.length - 1].seed} play the ${BAND_LABEL[name] ?? 'consolation'}`,
      });
    }
    const inField = IN_FIELD.has(name);
    const shown = !inField && opts.chaseLimit ? members.slice(0, opts.chaseLimit) : members;
    const kind: SeedGroupKind = !inField
      ? 'chase'
      : name === 'play-in' || (name === 'wild-cards' && members.length > 4)
        ? 'chips'
        : 'tiles';
    const label = name === 'division-winners' && opts.leaderLabel ? opts.leaderLabel : (BAND_LABEL[name] ?? name);
    groups.push({
      kind,
      band: name,
      label,
      range: range(shown),
      teams: shown.map((team) => ({ team, line: seedLine(team, kind, lineVp) })),
    });
  }
  return groups;
}

/** The small line under a team in the playoff picture. */
function seedLine(team: BoardTeam, kind: SeedGroupKind, lineVp: number | null): string {
  if (kind === 'chase' && lineVp !== null && team.vp !== null) {
    const back = lineVp - team.vp;
    return `${team.record} · ${back > 0 ? `${back} VP back` : 'level on VP'}`;
  }
  if (kind === 'tiles' && team.vp !== null) return `${team.record} · ${team.vp} VP · ${team.division}`;
  return `${team.record} · ${team.division}`;
}

/** A division name's short form for phones: its last word ("Lawrence Taylor" → "Taylor"). */
export function shortDivision(name: string): string {
  const words = name.replace(/\s+Division$/i, '').trim().split(/\s+/);
  return words[words.length - 1] || name;
}

// ---------------------------------------------------------------------------
// All-play
// ---------------------------------------------------------------------------

export interface AllPlayRow {
  rank: number;
  team: BoardTeam;
  /** Actual wins minus the wins the all-play rate predicts; positive = lucky. */
  luck: number;
}

/** Rows in all-play order (as the producer returned them), with luck. */
export function buildAllPlayRows(teams: BoardTeam[]): AllPlayRow[] {
  return teams.map((team, i) => {
    const games = team.wins + team.losses + team.ties;
    const luck = team.wins + team.ties / 2 - games * team.allPlay.pct;
    return { rank: i + 1, team, luck: Math.round(luck * 10) / 10 };
  });
}
