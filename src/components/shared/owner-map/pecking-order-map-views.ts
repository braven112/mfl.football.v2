/**
 * The Pecking Order map — which teams a view highlights and how each pin is
 * drawn. Pure, so the three views are tested without a map.
 *
 * Views (Brandon, 2026-10-25):
 * - `top`: the top three big and numbered, everyone else small and faded.
 *   The map opens here.
 * - `order`: every team, its pin sized by rank, with a green ring for a team
 *   that climbed and a red one for a team that fell.
 * - `movers`: only the week's big moves, tagged ▲/▼ with how far.
 *
 * A pin is the city a team represents (src/utils/owner-map.ts), never where
 * an owner lives, which is why the map can show on the public column.
 */
import type { OwnerMapCity } from '../../../utils/owner-map';

export type RankMapMode = 'top' | 'order' | 'movers';

export const RANK_MAP_MODES: { id: RankMapMode; label: string }[] = [
  { id: 'top', label: 'Top 3' },
  { id: 'order', label: 'Full order' },
  { id: 'movers', label: 'Movers' },
];

/** How many teams the `top` view spotlights. */
export const TOP_COUNT = 3;

/** A move this many places or more counts as big; smaller moves only show when nobody moved that far. */
export const BIG_MOVE = 2;

/** The most climbers, and separately the most fallers, the `movers` view shows. */
export const MOVERS_EACH_WAY = 3;

export interface RankMapPin {
  franchiseId: string;
  rank: number;
  previousRank: number | null;
  teamName: string;
  icon: string;
  href: string;
  city: (OwnerMapCity & { kind?: string }) | null;
}

export interface RankMapMark {
  /** Index into the pins array. */
  index: number;
  /** Badge diameter in px. */
  size: number;
  faded: boolean;
  ring: 'up' | 'down' | null;
  /** Short label under the badge: a rank ("1") or a move ("▲3"). */
  tag: string | null;
  /** Stacking order: a highlighted or higher-ranked pin draws on top. */
  z: number;
}

export interface RankMapView {
  marks: RankMapMark[];
  caption: string;
}

/** Places moved since last week: positive is up. Null with no prior rank. */
export const movedBy = (pin: RankMapPin): number | null =>
  pin.previousRank == null ? null : pin.previousRank - pin.rank;

const ringOf = (delta: number | null): RankMapMark['ring'] => (!delta ? null : delta > 0 ? 'up' : 'down');

const moveTag = (delta: number) => `${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`;

const LARGE = 46;
const SMALL = 26;
const FADED = 24;

/** Rank 1 gets the largest badge, last place the smallest, evenly in between. */
export function sizeForRank(rank: number, teamCount: number): number {
  if (teamCount <= 1) return LARGE;
  const t = Math.min(1, Math.max(0, (rank - 1) / (teamCount - 1)));
  return Math.round(LARGE - t * (LARGE - SMALL));
}

function names(pins: RankMapPin[], indexes: number[]): string {
  const list = indexes.map((i) => pins[i].teamName);
  if (list.length <= 2) return list.join(' and ');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The week's biggest moves: up to three climbers (biggest first), then up to
 * three fallers (biggest first). Ties go to the better-ranked team.
 */
export function movers(pins: RankMapPin[]): number[] {
  const moved = pins
    .map((pin, index) => ({ index, delta: movedBy(pin) ?? 0 }))
    .filter((m) => m.delta !== 0);
  const big = moved.filter((m) => Math.abs(m.delta) >= BIG_MOVE);
  const pool = big.length ? big : moved;
  const byRank = (a: { index: number }, b: { index: number }) => pins[a.index].rank - pins[b.index].rank;
  const up = pool.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta || byRank(a, b));
  const down = pool.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta || byRank(a, b));
  return [...up.slice(0, MOVERS_EACH_WAY), ...down.slice(0, MOVERS_EACH_WAY)].map((m) => m.index);
}

export function computeRankView(pins: RankMapPin[], mode: RankMapMode): RankMapView {
  const teamCount = pins.length;
  const placed = pins.map((pin, index) => ({ pin, index })).filter(({ pin }) => pin.city);
  const unplaced = (indexes: number[]) => indexes.filter((i) => !pins[i].city);
  const missingNote = (indexes: number[]) => {
    const missing = unplaced(indexes);
    if (!missing.length) return '';
    return ` ${names(pins, missing)} ${missing.length === 1 ? "hasn't" : "haven't"} picked a hometown yet.`;
  };

  if (mode === 'order') {
    const marks = placed.map(({ pin, index }) => ({
      index,
      size: sizeForRank(pin.rank, teamCount),
      faded: false,
      ring: ringOf(movedBy(pin)),
      tag: String(pin.rank),
      z: teamCount - pin.rank,
    }));
    const caption = `Every team at its hometown, bigger the higher it ranks. A green ring climbed this week, a red ring fell.${
      placed.length < teamCount ? ` ${teamCount - placed.length} haven't picked a hometown yet.` : ''
    }`;
    return { marks, caption };
  }

  if (mode === 'movers') {
    const moving = movers(pins);
    const set = new Set(moving);
    const marks = placed.map(({ pin, index }) => {
      const delta = movedBy(pin) ?? 0;
      return set.has(index)
        ? { index, size: Math.min(LARGE, 34 + Math.abs(delta) * 3), faded: false, ring: ringOf(delta), tag: moveTag(delta), z: 100 + Math.abs(delta) }
        : { index, size: FADED, faded: true, ring: null, tag: null, z: 0 };
    });
    const up = moving.filter((i) => (movedBy(pins[i]) ?? 0) > 0);
    const down = moving.filter((i) => (movedBy(pins[i]) ?? 0) < 0);
    const parts = [
      up.length ? `Climbing: ${names(pins, up)}.` : '',
      down.length ? `Falling: ${names(pins, down)}.` : '',
    ].filter(Boolean);
    const caption = moving.length ? `${parts.join(' ')}${missingNote(moving)}` : 'Nobody moved this week.';
    return { marks, caption };
  }

  const top = pins
    .map((pin, index) => ({ pin, index }))
    .filter(({ pin }) => pin.rank <= TOP_COUNT)
    .sort((a, b) => a.pin.rank - b.pin.rank)
    .map(({ index }) => index);
  const topSet = new Set(top);
  const marks = placed.map(({ pin, index }) =>
    topSet.has(index)
      ? { index, size: LARGE, faded: false, ring: null, tag: String(pin.rank), z: 100 - pin.rank }
      : { index, size: FADED, faded: true, ring: null, tag: null, z: 0 },
  );
  return {
    marks,
    caption: `The top ${TOP_COUNT}: ${names(pins, top)}.${missingNote(top)}`,
  };
}
