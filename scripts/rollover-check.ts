/**
 * Render a page at the dates where the two year clocks turn, and report what
 * each render says the year is.
 *
 * CLAUDE.md "Year rollover — two independent clocks": Feb 14 advances the
 * league year (rosters, contracts, cap); the NL draft advances the season year
 * (standings, playoffs, draft order). Picking the wrong clock for a page
 * silently shows the wrong year for ~6 months, and the double-advance bug
 * (base year that itself moves at the season start) has shipped in five files. The
 * check is mechanical and nobody runs it, so this runs it:
 *
 *   pnpm exec tsx scripts/rollover-check.ts /theleague/draft/order
 *   pnpm exec tsx scripts/rollover-check.ts /theleague/rosters --cookie "session=…"
 *   pnpm exec tsx scripts/rollover-check.ts /afl-fantasy/standings --year 2027 --base http://localhost:4399
 *
 * Needs a running dev server (see .claude/skills/verify/SKILL.md for the
 * launch + cookie-forging recipe). For each of the six boundary dates it
 * fetches `<path>?testDate=YYYY-MM-DD` and prints one row: the two EXPECTED
 * years from src/utils/league-year.ts (imported, never re-ported — that is
 * how the double-advance shipped), the HTTP status, the <title>, and how many
 * times each candidate year appears in the visible text. Read the rows as a
 * pair: a page on the LEAGUE clock must change between Feb 13 and Feb 15 and
 * NOT across the NL draft; a page on the SEASON clock the reverse.
 *
 * Exit 1 if any render is not a 2xx.
 */
import {
  getCurrentSeasonYear,
  getSeasonStartForYear,
  getLeagueYearForSlug,
} from '../src/utils/league-year';
import { getLeagueByPath } from '../src/config/leagues';

function parseArgs(argv: string[]) {
  const out: { path?: string; base: string; cookie?: string; year: number } = {
    base: 'http://localhost:4321',
    year: new Date().getFullYear(),
  };
  const value = (flag: string, i: number) => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base') out.base = value(a, ++i);
    else if (a === '--cookie') out.cookie = value(a, ++i);
    else if (a === '--year') {
      out.year = Number(value(a, ++i));
      if (!Number.isInteger(out.year)) throw new Error('--year must be a four-digit year');
    } else if (a.startsWith('/')) out.path = a;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/**
 * The dates that matter for `year`: either side of every league-year
 * rollover the page could be on (TheLeague's Feb 14; the league's own
 * `leagueYearRollover` from the registry when it differs, e.g. the AFL's
 * June 1), either side of the NL draft, and mid-season.
 *
 * Rows sit at 20:00 UTC a full day either side of each boundary. The real
 * cutoffs are finer than that — TheLeague's is Feb 14 20:45 PT, which is
 * Feb 15 04:45 UTC (`getLeagueYear`), the AFL's is midnight PT — so do not
 * tighten these to hour-level without reading the constants in
 * src/utils/league-year.ts.
 */
export function boundaryDates(
  year: number,
  rollover: { month: number; day: number } | null = null,
): Array<{ label: string; date: Date }> {
  const at20 = (m: number, d: number) => new Date(Date.UTC(year, m - 1, d, 20));
  const feb14 = at20(2, 14);
  // The SEASON boundary is the NL draft (Sunday before Labor Day weekend), not
  // Labor Day. Sampling Labor Day +/- 1 put every September row on the same
  // side of the real cutoff, so this tool rendered one year at all four probes
  // and returned a confident all-clear for a page on the wrong clock — the one
  // failure it exists to catch.
  const seasonStart = getSeasonStartForYear(year);
  const seasonNoon = new Date(
    Date.UTC(seasonStart.getFullYear(), seasonStart.getMonth(), seasonStart.getDate(), 20),
  );
  const rows = [
    { label: 'day before Feb 14', date: shift(feb14, -1) },
    { label: 'day after Feb 14', date: shift(feb14, 1) },
  ];
  if (rollover && !(rollover.month === 2 && rollover.day === 14)) {
    const own = at20(rollover.month, rollover.day);
    const name = `${rollover.month}/${rollover.day} (this league's rollover)`;
    rows.push({ label: `day before ${name}`, date: shift(own, -1) }, { label: `day after ${name}`, date: shift(own, 1) });
  }
  rows.push(
    { label: 'day before the NL draft', date: shift(seasonNoon, -1) },
    { label: 'NL draft (season starts)', date: seasonNoon },
    { label: 'day after the NL draft', date: shift(seasonNoon, 1) },
    // Labor Day is now INSIDE the season. Kept as a probe precisely because it
    // used to be the boundary: a page still keying off it shows up here.
    { label: 'Labor Day (inside the season)', date: shift(seasonNoon, 8) },
    { label: 'mid-season (+5 weeks)', date: shift(seasonNoon, 43) },
  );
  return rows.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function visibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

async function main() {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`rollover-check: ${(err as Error).message}`);
    process.exit(2);
  }
  if (!args.path) {
    console.error('usage: pnpm exec tsx scripts/rollover-check.ts /<league>/<page> [--base URL] [--cookie "session=…"] [--year YYYY]');
    process.exit(2);
  }
  // The expected league year is the LEAGUE's clock, not TheLeague's: the AFL
  // rolls on June 1 (registry `leagueYearRollover`), and judging an AFL page
  // against Feb 14 inverts the verdict for exactly the pages this exists for.
  // getLeagueByPath always resolves (unprefixed paths belong to the default league).
  const league = getLeagueByPath(args.path);
  const slug = league.slug;
  const rollover = league.leagueYearRollover ?? null;
  const candidates = [args.year - 2, args.year - 1, args.year, args.year + 1, args.year + 2];
  const rows: string[] = [];
  let failed = false;

  console.log(`rollover-check ${args.path} @ ${args.base} (year ${args.year}, league clock: ${slug}${rollover ? ` rolls ${rollover.month}/${rollover.day}` : ' rolls Feb 14'})\n`);
  console.log('| date | label | league yr | season yr | HTTP | title | ' + candidates.join(' | ') + ' |');
  console.log('|---|---|---|---|---|---|' + candidates.map(() => '---').join('|') + '|');

  for (const { label, date } of boundaryDates(args.year, rollover)) {
    const day = iso(date);
    const url = `${args.base}${args.path}${args.path.includes('?') ? '&' : '?'}testDate=${day}`;
    const expectedLeague = getLeagueYearForSlug(slug, date);
    const expectedSeason = getCurrentSeasonYear(date);
    let status = 0;
    let title = '';
    let counts: number[] = candidates.map(() => 0);
    try {
      const res = await fetch(url, { headers: args.cookie ? { cookie: args.cookie } : undefined, redirect: 'manual' });
      status = res.status;
      const html = await res.text();
      title = (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '').trim().slice(0, 40);
      const text = visibleText(html);
      counts = candidates.map((y) => (text.match(new RegExp(`\\b${y}\\b`, 'g')) ?? []).length);
    } catch (err) {
      title = `fetch failed: ${(err as Error).message}`;
    }
    if (status < 200 || status >= 300) failed = true;
    rows.push(`| ${day} | ${label} | ${expectedLeague} | ${expectedSeason} | ${status} | ${title} | ${counts.join(' | ')} |`);
    console.log(rows[rows.length - 1]);
  }

  console.log(`\nRead as pairs: league-clock pages change across ${rollover ? `${rollover.month}/${rollover.day}` : 'Feb 14'} only; season-clock pages change across the NL draft only.`);
  console.log('A year column that jumps by 2 across one boundary is the double-advance bug (base year re-ported).');
  process.exit(failed ? 1 : 0);
}

const invokedDirectly = process.argv[1] && /rollover-check\.ts$/.test(process.argv[1]);
if (invokedDirectly) main();
