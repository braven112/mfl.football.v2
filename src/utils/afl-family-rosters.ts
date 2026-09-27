/**
 * The route half of the AFL-family rosters page (components/afl-family/
 * RostersPage): which season to show, or where to send a request for one with
 * no usable roster. Outside the component because a redirect must come from
 * the page (`Astro.redirect()` does nothing in a component).
 */
const moduleData = (mod: any) => (mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod);

export type RostersRoute = { redirect: string } | { selectedYear: number; availableYears: number[] };

/**
 * Only seasons whose rosters.json has real data are offered (the AFL skips an
 * empty placeholder for a league year MFL has not created yet). The newest
 * such season is the default — and the fallback when there is none at all.
 */
export function resolveRostersRoute(
  url: URL,
  basePath: string,
  rosters: Map<number, unknown>,
  players: Map<number, unknown>,
  fallbackYear: number,
): RostersRoute {
  const availableYears = [...rosters.entries()]
    .filter(([, mod]) => (moduleData(mod) as any)?.rosters?.franchise)
    .map(([year]) => year)
    .sort((a, b) => b - a);
  const parsedYear = parseInt(url.searchParams.get('year') ?? '', 10);
  const selectedYear =
    !isNaN(parsedYear) && availableYears.includes(parsedYear) ? parsedYear : (availableYears[0] ?? fallbackYear);
  const rostersData = moduleData(rosters.get(selectedYear)) as any;
  const playersData = moduleData(players.get(selectedYear)) as any;
  if (!rostersData?.rosters?.franchise || !playersData?.players?.player) {
    return { redirect: `${basePath}/rosters?year=${availableYears[0] ?? fallbackYear}` };
  }
  return { selectedYear, availableYears };
}
