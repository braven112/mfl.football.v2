/**
 * A franchise's name history from its own season rows — for a league with no
 * hand-kept identity history (package leagues). Each run of consecutive seasons
 * under one MFL name is an era; the last one is current.
 *
 * The AFL does not use this: its lineage follows ownerHistory claims and award
 * attribution (src/utils/afl-name-history.ts), which a season's MFL name alone
 * cannot express.
 */
import type { NameEra } from './afl-name-history';

type SeasonRow = { year: number; name?: string | null; icon?: string | null; banner?: string | null };

const key = (name: string | null | undefined) => String(name ?? '').trim().toLowerCase();

export function nameErasFromSeasons(
  seasons: SeasonRow[],
  current: { name: string; icon?: string; banner?: string },
): NameEra[] {
  const rows = [...seasons].filter((s) => key(s.name)).sort((a, b) => a.year - b.year);
  const eras: NameEra[] = [];
  for (const row of rows) {
    const last = eras[eras.length - 1];
    if (last && key(last.name) === key(row.name) && row.year === last.yearEnd + 1) {
      last.yearEnd = row.year;
      continue;
    }
    eras.push({
      name: String(row.name).trim(),
      yearStart: row.year,
      yearEnd: row.year,
      icon: row.icon ?? undefined,
      banner: row.banner ?? undefined,
      isCurrent: false,
    });
  }
  const last = eras[eras.length - 1];
  if (!last || key(last.name) !== key(current.name)) {
    eras.push({
      name: current.name,
      yearStart: (last?.yearEnd ?? new Date().getFullYear() - 1) + 1,
      yearEnd: 9999,
      icon: current.icon,
      banner: current.banner,
      isCurrent: true,
    });
  } else {
    Object.assign(last, { yearEnd: 9999, isCurrent: true, icon: current.icon ?? last.icon, banner: current.banner ?? last.banner });
  }
  return eras;
}
