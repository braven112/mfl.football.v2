import { normalizeIdentityName } from './afl-awards';

export type NameEra = {
  name: string;
  yearStart: number;
  yearEnd: number;
  icon?: string;
  banner?: string;
  isCurrent: boolean;
  rebrandGroup?: string;
  sourceFranchiseId?: string | null;
};

type AflHistoryEntry = {
  name: string;
  yearStart: number;
  yearEnd: number;
  icon?: string;
  banner?: string;
  rebrand?: { group?: string };
};

type AflTeam = {
  franchiseId: string;
  name: string;
  icon?: string;
  banner?: string;
  currentRebrand?: { group?: string };
  history?: AflHistoryEntry[];
};

type AflConfigLike = { teams: AflTeam[] };

/**
 * Build the identity segments for one franchise ID within [rangeStart, rangeEnd],
 * filling any years not covered by its own `history` with its current name.
 *
 * `rangeEnd` is normally CURRENT_YEAR (the season-results clock, which stays at
 * last year until Labor Day) — not the franchise-identity clock. So a history
 * entry can close exactly at rangeEnd (e.g. a punitive rename's final season)
 * with no room left for a trailing gap-fill segment, even though the live team
 * name has already changed. In that case we only treat the closed entry itself
 * as "current" when its name still matches the live name; otherwise the live
 * name has moved on and needs its own current segment.
 */
export function segmentsForFranchiseRange(
  aflConfig: AflConfigLike,
  viewedFranchiseId: string,
  franchiseId: string,
  rangeStart: number,
  rangeEnd: number,
  finalSegmentIsCurrent: boolean
): NameEra[] {
  const t = aflConfig.teams.find((x) => x.franchiseId === franchiseId);
  if (!t) return [];
  const isForeignSlot = franchiseId !== viewedFranchiseId;
  const hist = Array.isArray(t.history)
    ? [...t.history].sort((a, b) => a.yearStart - b.yearStart)
    : [];

  const clipped: NameEra[] = [];
  for (const h of hist) {
    const s = Math.max(h.yearStart, rangeStart);
    const e = Math.min(h.yearEnd, rangeEnd);
    if (s > e) continue;
    clipped.push({
      name: h.name,
      yearStart: s,
      yearEnd: e,
      icon: h.icon,
      banner: h.banner,
      isCurrent: false,
      rebrandGroup: h.rebrand?.group,
      sourceFranchiseId: isForeignSlot ? franchiseId : null,
    });
  }

  const segments: NameEra[] = [];
  let cursor = rangeStart;
  for (const seg of clipped) {
    if (cursor < seg.yearStart) {
      segments.push({
        name: t.name,
        yearStart: cursor,
        yearEnd: seg.yearStart - 1,
        icon: t.icon,
        banner: t.banner,
        isCurrent: false,
        rebrandGroup: t.currentRebrand?.group,
        sourceFranchiseId: isForeignSlot ? franchiseId : null,
      });
    }
    segments.push(seg);
    cursor = seg.yearEnd + 1;
  }
  if (cursor <= rangeEnd) {
    segments.push({
      name: t.name,
      yearStart: cursor,
      yearEnd: finalSegmentIsCurrent ? 9999 : rangeEnd,
      icon: t.icon,
      banner: t.banner,
      isCurrent: finalSegmentIsCurrent,
      rebrandGroup: t.currentRebrand?.group,
      sourceFranchiseId: isForeignSlot ? franchiseId : null,
    });
  } else if (finalSegmentIsCurrent && segments.length > 0) {
    const last = segments[segments.length - 1];
    if (normalizeIdentityName(last.name) === normalizeIdentityName(t.name)) {
      last.isCurrent = true;
    } else {
      segments.push({
        name: t.name,
        yearStart: last.yearEnd + 1,
        yearEnd: 9999,
        icon: t.icon,
        banner: t.banner,
        isCurrent: true,
        rebrandGroup: t.currentRebrand?.group,
        sourceFranchiseId: isForeignSlot ? franchiseId : null,
      });
    }
  }
  return segments;
}
