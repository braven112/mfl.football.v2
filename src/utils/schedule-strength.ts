/**
 * Schedule-strength ("The Gauntlet") view resolution shared by both league
 * pages. Pages own their import.meta.glob (Vite requires static literals) and
 * league config; this util turns the globbed derived files + config into
 * display-ready props for GauntletDashboard.
 */
import { chooseTeamName } from './team-names';
import type { StrengthRow } from '../components/shared/schedule-strength/StrengthTable.astro';
import type { LuckRow } from '../components/shared/schedule-strength/ScheduleLuckCallout.astro';
import type { HeatFranchise } from '../components/shared/schedule-strength/GauntletHeatMap.astro';
import type { TrapWeek } from '../components/shared/schedule-strength/TrapWeeksStrip.astro';
import type { YearOption } from '../components/shared/schedule-strength/GauntletDashboard.astro';

export interface GauntletDerived {
  league: 'theleague' | 'afl-fantasy';
  year: number;
  week: number;
  columnName: string;
  weeks: number[];
  runIn: Array<{
    rank: number; franchiseId: string; name: string;
    remainingOppPpg: number | null; difficulty: number; step: number;
    prevRank: number | null; trendDeltaRanks: number | null;
  }>;
  played: Array<{
    rank: number; franchiseId: string; name: string;
    pastOppPpg: number | null; difficulty: number; step: number; record: string;
  }>;
  scheduleLuck: Array<{
    franchiseId: string; name: string; record: string;
    pastDifficulty: number; gap: number; direction: 'lucky' | 'unlucky';
  }>;
  heatMap: {
    weeks: number[];
    franchises: Array<{
      franchiseId: string; name: string;
      cells: Array<{
        week: number; bye: boolean;
        /** One entry per game that week — AFL plays two games per week. */
        opps: Array<{ oppId: string; oppAbbrev?: string; difficulty: number | null }>;
        /** Averaged across the week's games. */
        difficulty: number | null; step: number;
      }>;
    }>;
  };
  trapWeeks: Array<{ week: number; avgDifficulty: number | null; step: number }>;
}

interface TeamConfigEntry {
  franchiseId: string;
  name: string;
  nameMedium?: string;
  nameShort?: string;
  abbrev?: string;
  icon?: string;
}

export interface GauntletView {
  data: GauntletDerived | null;
  year: number | null;
  yearOptions: YearOption[];
  seasonComplete: boolean;
  runIn: StrengthRow[];
  played: StrengthRow[];
  scheduleLuck: LuckRow[];
  heatMapFranchises: HeatFranchise[];
  heatMapWeeks: number[];
  trapWeeks: TrapWeek[];
}

/** Parse the derived-file glob into per-year latest issues. */
export function indexDerivedFiles(
  files: Record<string, GauntletDerived>
): Map<number, GauntletDerived> {
  const latestByYear = new Map<number, GauntletDerived>();
  for (const [file, data] of Object.entries(files)) {
    const m = file.match(/schedule-strength-(\d{4})-w(\d{1,2})\.json$/);
    if (!m) continue;
    const year = parseInt(m[1], 10);
    const existing = latestByYear.get(year);
    if (!existing || data.week > existing.week) latestByYear.set(year, data);
  }
  return latestByYear;
}

interface ResolveOptions {
  files: Record<string, GauntletDerived>;
  teams: TeamConfigEntry[];
  /** e.g. '/theleague' — used for franchise links */
  baseUrl: string;
  /** e.g. '/theleague/schedule-strength' — used for year-selector links */
  pagePath: string;
  requestedYear: string | null;
  /** Skip building the heat map (article pages never render it). */
  includeHeatMap?: boolean;
}

/**
 * Lazy-glob variant for pages that keep every weekly issue on disk: picks the
 * target year from the glob KEYS alone, then imports only that one file.
 * Weekly files are retained forever (published articles reference them), so
 * an eager glob would bundle every issue into the server chunk.
 */
export async function resolveGauntletViewLazy({
  files,
  ...rest
}: Omit<ResolveOptions, 'files'> & {
  files: Record<string, () => Promise<GauntletDerived>>;
}): Promise<GauntletView> {
  const latestKeyByYear = new Map<number, { key: string; week: number }>();
  for (const key of Object.keys(files)) {
    const m = key.match(/schedule-strength-(\d{4})-w(\d{1,2})\.json$/);
    if (!m) continue;
    const year = parseInt(m[1], 10);
    const week = parseInt(m[2], 10);
    const existing = latestKeyByYear.get(year);
    if (!existing || week > existing.week) latestKeyByYear.set(year, { key, week });
  }
  const years = [...latestKeyByYear.keys()].sort((a, b) => b - a);
  const parsed = rest.requestedYear ? parseInt(rest.requestedYear, 10) : NaN;
  const year = years.includes(parsed) ? parsed : (years[0] ?? null);
  const entry = year != null ? latestKeyByYear.get(year)! : null;
  const data = entry ? await files[entry.key]() : null;

  const view = resolveGauntletView({
    ...rest,
    files: entry && data ? { [entry.key]: data } : {},
    requestedYear: year != null ? String(year) : null,
  });
  // The single-file delegate only knows one year — restore the full list.
  view.yearOptions = years.map(y => ({
    year: y,
    href: y === years[0] ? rest.pagePath : `${rest.pagePath}?year=${y}`,
    current: y === year,
  }));
  return view;
}

export function resolveGauntletView({
  files,
  teams,
  baseUrl,
  pagePath,
  requestedYear,
  includeHeatMap = true,
}: ResolveOptions): GauntletView {
  const latestByYear = indexDerivedFiles(files);
  const years = [...latestByYear.keys()].sort((a, b) => b - a);

  // Validate the ?year= param against known years — unknown values fall back
  // to the latest (an unvalidated enum param renders a blank page otherwise).
  const parsed = requestedYear ? parseInt(requestedYear, 10) : NaN;
  const year = years.includes(parsed) ? parsed : (years[0] ?? null);
  const data = year != null ? latestByYear.get(year)! : null;

  const teamById = new Map(teams.map(t => [t.franchiseId, t]));
  const displayName = (fid: string, fallback: string) => {
    const t = teamById.get(fid);
    return t
      ? chooseTeamName({ fullName: t.name, nameMedium: t.nameMedium, nameShort: t.nameShort, abbrev: t.abbrev })
      : fallback;
  };
  const icon = (fid: string) => teamById.get(fid)?.icon;
  const franchiseHref = (fid: string) => `${baseUrl}/franchises/${fid}`;

  const yearOptions: YearOption[] = years.map(y => ({
    year: y,
    href: y === years[0] ? pagePath : `${pagePath}?year=${y}`,
    current: y === year,
  }));

  if (!data) {
    return {
      data: null, year, yearOptions, seasonComplete: false,
      runIn: [], played: [], scheduleLuck: [],
      heatMapFranchises: [], heatMapWeeks: [], trapWeeks: [],
    };
  }

  const seasonComplete = data.heatMap.weeks.length === 0 || data.runIn.length === 0;

  const runIn: StrengthRow[] = data.runIn.map(r => ({
    rank: r.rank,
    franchiseId: r.franchiseId,
    displayName: displayName(r.franchiseId, r.name),
    icon: icon(r.franchiseId),
    href: franchiseHref(r.franchiseId),
    oppPpg: r.remainingOppPpg,
    difficulty: r.difficulty,
    step: r.step,
    trendDeltaRanks: r.trendDeltaRanks,
  }));

  const played: StrengthRow[] = data.played.map(r => ({
    rank: r.rank,
    franchiseId: r.franchiseId,
    displayName: displayName(r.franchiseId, r.name),
    icon: icon(r.franchiseId),
    href: franchiseHref(r.franchiseId),
    oppPpg: r.pastOppPpg,
    difficulty: r.difficulty,
    step: r.step,
    record: r.record,
  }));

  const scheduleLuck: LuckRow[] = data.scheduleLuck.map(l => ({
    franchiseId: l.franchiseId,
    displayName: displayName(l.franchiseId, l.name),
    record: l.record,
    pastDifficulty: l.pastDifficulty,
    gap: l.gap,
    direction: l.direction,
  }));

  const heatMapFranchises: HeatFranchise[] = !includeHeatMap ? [] : data.heatMap.franchises.map(f => ({
    franchiseId: f.franchiseId,
    displayName: displayName(f.franchiseId, f.name),
    icon: icon(f.franchiseId),
    cells: f.cells.map(c => ({
      week: c.week,
      bye: c.bye,
      games: (c.opps ?? []).map(g => ({
        oppAbbrev: teamById.get(g.oppId)?.abbrev ?? g.oppAbbrev ?? g.oppId,
        oppName: displayName(g.oppId, g.oppAbbrev ?? g.oppId),
        oppHref: franchiseHref(g.oppId),
        difficulty: g.difficulty,
      })),
      difficulty: c.difficulty,
      step: c.step,
    })),
  }));

  return {
    data,
    year,
    yearOptions,
    seasonComplete,
    runIn,
    played,
    scheduleLuck,
    heatMapFranchises,
    heatMapWeeks: data.heatMap.weeks,
    trapWeeks: data.trapWeeks,
  };
}
