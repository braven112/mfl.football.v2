/**
 * The Brand Book's non-club subjects — the league itself, its conferences, its
 * divisions and the archive of retired clubs — plus every seasonal mark set,
 * all derived from data so a new mark lands on its page without an edit here.
 *
 * Sources, and nothing else:
 *  - the league's aggregated asset file (`<league>.assets.json`, rebuilt by
 *    scripts/sync-<league>-assets.mjs from the folders under public/assets):
 *    league, championship, conference and division art in `extras`, and every
 *    club that has ever worn a mark in `teams`;
 *  - the league config's `conferences` and `masterAssets`;
 *  - the registry's logo pair and `seasonalThemes`;
 *  - each seasonal set (src/data/seasonal-marks/<navSlug>-<id>.json).
 *
 * This replaced the Brand Files library (`/brand/files`, retired Oct 2026):
 * every file that page listed is reachable from one of these pages, and
 * `allBrandFiles` is the inventory tests/brand-book-coverage.test.ts holds
 * against the asset file and the seasonal folders, so a mark that is added but
 * shown nowhere fails the build rather than going missing.
 *
 * The aggregated files and the config are PARAMETERS, not imports: a static
 * import specifier cannot be a runtime variable, so each route imports its own
 * league's data and passes it in (the same split the club pages use).
 */
import { getLeagueBySlug, type CanonicalLeagueSlug } from '../config/leagues';
import { SEASONAL_THEMES } from '../config/seasonal-themes.mjs';
import { seasonalMarkSet } from './seasonal-mark-css';
import { allFranchiseBrands, slugify, type FranchiseBrand } from './franchise-marks';

export interface RawBrandAsset {
  filename: string;
  relativePath: string;
}

export interface BrandBookAssets {
  extras?: Record<string, RawBrandAsset[] | undefined>;
  teams?: Array<{
    key: string;
    name: string;
    id?: string;
    category?: string;
    aliases?: string[];
    assets?: Record<string, RawBrandAsset[] | undefined>;
  }>;
}

export interface BrandBookConfig {
  conferences?: Array<{ code: string; name: string }>;
  masterAssets?: Array<{ label: string; description?: string; filename: string; relativePath: string }>;
  tierCompetition?: { tiers?: string[] };
}

export interface BrandFile {
  label: string;
  filename: string;
  url: string;
  /** Drawn for a dark ground, so its preview box paints one. */
  forDark: boolean;
  /** A layered source (PSD) — downloadable, not previewable. */
  source?: boolean;
}

export interface BrandFileGroup {
  title: string;
  note?: string;
  files: BrandFile[];
}

/** One seasonal set's files for one subject. `id` is the set's name in code. */
export interface SeasonalMarks {
  id: string;
  /** The display name — the id, capitalised. One name everywhere, by design. */
  name: string;
  /** The folder the set's files are served from, under /assets/<navSlug>/. */
  folder: string;
  files: BrandFile[];
}

export type BrandSubjectKind = 'league' | 'conference' | 'division';

export interface BrandSubject {
  kind: BrandSubjectKind;
  /** The URL segment under its kind (`division/<slug>`); the league's is 'league'. */
  slug: string;
  name: string;
  /** The conference a division sits in, or null. */
  parent: { slug: string; name: string } | null;
  /** False for a division no franchise plays in any more. */
  current: boolean;
  groups: BrandFileGroup[];
  franchises: FranchiseBrand[];
  seasonal: SeasonalMarks[];
}

export interface RetiredClub {
  key: string;
  name: string;
  aliases: string[];
  files: BrandFile[];
  /** The franchise that holds this club's slot today, when there is one. */
  franchise: { name: string; slug: string } | null;
}

export interface BrandFileIndexEntry {
  label: string;
  filename: string;
  url: string;
  /** Path under the league's /brand, '' for the index itself. */
  page: string;
  pageName: string;
}

/** Words a file name spells lowercase that read as initials ("afl-cup.svg" → "AFL Cup"). */
const INITIALS = new Set(['afl', 'al', 'nl', 'nit', 'nfl', 'mvp']);

const titleCase = (value: string) =>
  value
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => (INITIALS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

const isDarkFile = (path: string) => /[-_]dark\.\w+$/.test(path);

const stripQuery = (url: string) => url.replace(/\?.*$/, '');

/** "east.svg" → "East", "al-dark.svg" → "Al, dark". A caption; the file name prints beside it. */
function labelFor(filename: string): string {
  const base = filename.replace(/\.\w+$/, '');
  const dark = /[-_]dark$/.test(base);
  const name = titleCase(base.replace(/[-_]dark$/, ''));
  return dark ? `${name}, dark` : name;
}

const withDark = (name: string, path: string) => (isDarkFile(path) ? `${name}, dark` : name);

function toFile(entry: RawBrandAsset, label?: string): BrandFile {
  return {
    label: label ?? labelFor(entry.filename),
    filename: entry.filename,
    url: entry.relativePath,
    forDark: isDarkFile(entry.relativePath),
    ...(/\.psd$/i.test(entry.filename) ? { source: true } : {}),
  };
}

function fileFromPath(url: string, label?: string): BrandFile {
  const filename = stripQuery(url).split('/').pop() ?? url;
  return toFile({ filename, relativePath: url }, label);
}

const dedupe = (files: BrandFile[]) => {
  const seen = new Set<string>();
  return files.filter((f) => (seen.has(f.url) ? false : (seen.add(f.url), true)));
};

/** "American League" → "al", the prefix the AFL's conference and division art carry. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toLowerCase();

/** A set id as it is shown. The id IS the name, so code and page never disagree. */
export const seasonalSetName = (id: string) => titleCase(id);


function seasonalSets(slug: CanonicalLeagueSlug) {
  const league = getLeagueBySlug(slug);
  if (!league) return [];
  return (league.seasonalThemes ?? [])
    .map((id) => {
      const folder = SEASONAL_THEMES[id]?.marks;
      const set = folder ? seasonalMarkSet(league.navSlug, id) : null;
      return folder && set ? { id, folder, set, base: `/assets/${league.navSlug}/${folder}/` } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

/**
 * Every subject except the clubs, in page order: the league, its conferences,
 * then its divisions (current before former).
 */
export function brandSubjects(
  slug: CanonicalLeagueSlug,
  assets: BrandBookAssets,
  config: BrandBookConfig,
): BrandSubject[] {
  const league = getLeagueBySlug(slug);
  if (!league) return [];
  const extras = assets.extras ?? {};
  const brands = allFranchiseBrands(slug);

  // ── The league ─────────────────────────────────────────────────────────
  const logoFiles = dedupe([
    fileFromPath(league.logo.light, 'League logo'),
    ...(league.logo.dark !== league.logo.light ? [fileFromPath(league.logo.dark, 'League logo, dark')] : []),
    ...(extras.league ?? []).filter((e) => e.relativePath.startsWith('/assets/logos/')).map((e) => toFile(e)),
  ]);
  const competition = (extras.league ?? []).filter((e) => !e.relativePath.startsWith('/assets/logos/'));
  const groups: BrandFileGroup[] = [{ title: 'League logo', files: logoFiles }];
  if (competition.length) {
    groups.push({
      title: 'Competition marks',
      note: 'The league’s own competitions, each with a light and a dark cut.',
      files: competition.map((e) => {
        // premier.svg → "Premier League": the file names are short, the tiers are not.
        const squash = (v: string) => slugify(v).replace(/-/g, '');
        const base = squash(e.filename.replace(/\.\w+$/, '').replace(/-dark$/, ''));
        const tier = (config.tierCompetition?.tiers ?? []).find((t) => squash(t).startsWith(base));
        return toFile(e, tier ? withDark(tier, e.relativePath) : undefined);
      }),
    });
  }
  if (extras.championship?.length) {
    groups.push({
      title: 'Championships and awards',
      // "dleague-champion.svg" → "D-League Champion": a word that IS a tier, squashed, prints as the tier.
      files: extras.championship.map((e) => {
        const tiers = config.tierCompetition?.tiers ?? [];
        const label = labelFor(e.filename)
          .split(' ')
          .map((w) => tiers.find((t) => slugify(t).replace(/-/g, '') === w.toLowerCase()) ?? w)
          .join(' ');
        return toFile(e, label);
      }),
    });
  }
  if (config.masterAssets?.length) {
    groups.push({
      title: 'Source files',
      note: 'Layered masters. Download to edit; nothing on the site draws them directly.',
      files: config.masterAssets.map((m) => ({ ...toFile(m, m.label), source: true })),
    });
  }
  const subjects: BrandSubject[] = [
    {
      kind: 'league',
      slug: 'league',
      name: league.name,
      parent: null,
      current: true,
      groups,
      franchises: [],
      seasonal: [],
    },
  ];

  // ── Conferences ────────────────────────────────────────────────────────
  const conferences = (config.conferences ?? []).map((c) => ({ ...c, slug: initials(c.name) }));
  const confByCode = new Map(conferences.map((c) => [c.code, c]));
  for (const conf of conferences) {
    const files = (extras.conference ?? []).filter((e) =>
      new RegExp(`^${conf.slug}(-dark)?\\.\\w+$`).test(e.filename),
    );
    subjects.push({
      kind: 'conference',
      slug: conf.slug,
      name: conf.name,
      parent: null,
      current: true,
      groups: files.length
        ? [{ title: 'Conference marks', files: files.map((e) => toFile(e, withDark(conf.name, e.relativePath))) }]
        : [],
      franchises: brands.filter((b) => b.conference === conf.code),
      seasonal: [],
    });
  }

  // ── Divisions ──────────────────────────────────────────────────────────
  const divisions: BrandSubject[] = [];
  for (const entry of extras.division ?? []) {
    const base = entry.filename.replace(/\.\w+$/, '').replace(/-dark$/, '');
    const conf = conferences.find((c) => base.startsWith(`${c.slug}-`)) ?? null;
    const divSlug = base;
    const divName = conf ? `${conf.slug.toUpperCase()} ${titleCase(base.slice(conf.slug.length + 1))}` : titleCase(base);
    const plain = conf ? base.slice(conf.slug.length + 1) : base;
    const existing = divisions.find((d) => d.slug === divSlug);
    if (existing) {
      existing.groups[0].files.push(toFile(entry, withDark(divName, entry.relativePath)));
      continue;
    }
    const franchises = brands.filter(
      (b) =>
        b.division !== null &&
        slugify(b.division) === plain &&
        (!conf || (b.conference !== null && confByCode.get(b.conference)?.slug === conf.slug)),
    );
    divisions.push({
      kind: 'division',
      slug: divSlug,
      name: divName,
      parent: conf ? { slug: conf.slug, name: conf.name } : null,
      current: franchises.length > 0,
      groups: [{ title: 'Division badge', files: [toFile(entry, withDark(divName, entry.relativePath))] }],
      franchises,
      seasonal: [],
    });
  }
  divisions.sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
  subjects.push(...divisions);

  // ── Seasonal sets ──────────────────────────────────────────────────────
  for (const { id, folder, set, base } of seasonalSets(slug)) {
    const add = (subject: BrandSubject, file: BrandFile) => {
      let marks = subject.seasonal.find((s) => s.id === id);
      if (!marks) {
        marks = { id, name: seasonalSetName(id), folder, files: [] };
        subject.seasonal.push(marks);
      }
      // The sets are drawn white, for the dark ground the season locks the site to.
      if (!marks.files.some((f) => f.url === file.url)) marks.files.push({ ...file, forDark: true });
    };
    if (typeof set._logo === 'string') add(subjects[0], fileFromPath(`${base}${set._logo}`, 'League logo'));
    const swaps = (set._swaps && typeof set._swaps === 'object' ? set._swaps : {}) as Record<string, string>;
    for (const [from, file] of Object.entries(swaps)) {
      const owner =
        subjects.find((s) => s.groups.some((g) => g.files.some((f) => f.url === from))) ?? subjects[0];
      const replaces = owner.groups.flatMap((g) => g.files).find((f) => f.url === from);
      add(owner, fileFromPath(`${base}${file}`, replaces ? replaces.label.replace(/, dark$/, '') : undefined));
    }
  }

  return subjects;
}

export function brandSubject(
  slug: CanonicalLeagueSlug,
  assets: BrandBookAssets,
  config: BrandBookConfig,
  kind: BrandSubjectKind,
  segment: string,
): BrandSubject | null {
  const want = slugify(segment);
  return brandSubjects(slug, assets, config).find((s) => s.kind === kind && s.slug === want) ?? null;
}

/** One franchise's mark in every seasonal set that draws one (the built PNG the site swaps in). */
export function franchiseSeasonalMarks(slug: CanonicalLeagueSlug, franchiseId: string): SeasonalMarks[] {
  return seasonalSets(slug)
    .filter(({ set }) => typeof set[franchiseId] === 'string')
    .map(({ id, folder, set, base }) => {
      const v = (set._v as Record<string, string> | undefined)?.[franchiseId];
      // A set can also knit the club a trim strip for the roster header (`_trim`).
      const trim = (set._trim as Record<string, Record<string, string>> | undefined)?.[franchiseId];
      const trimFiles = trim
        ? (['top', 'bottom'] as const)
            .filter((edge) => typeof trim[edge] === 'string')
            .map((edge) => {
              const path = `${base}trim/${franchiseId}-${edge}.png`;
              return { ...fileFromPath(path, `Header trim, ${edge}`), url: `${path}?v=${trim[edge]}`, forDark: true };
            })
        : [];
      return {
        id,
        name: seasonalSetName(id),
        folder,
        files: [
          { ...fileFromPath(`${base}${franchiseId}.png`, 'Crest'), url: `${base}${franchiseId}.png${v ? `?v=${v}` : ''}`, forDark: true },
          ...trimFiles,
        ],
      };
    });
}

/** Every URL a franchise's page already shows: its cuts, retired cuts and former identities. */
function franchiseShownUrls(brand: FranchiseBrand): Set<string> {
  return new Set(
    [
      ...brand.marks.map((m) => m.url),
      ...brand.past.map((m) => m.url),
      ...brand.formerIdentities.flatMap((e) => [e.icon, e.banner]),
    ].filter((u): u is string => Boolean(u)),
  );
}

/**
 * Files on disk for a franchise that its page does not otherwise show — the
 * library listed every file in a club's folders, and not every one is a cut
 * the config names. Shown under "More files" so none of them is lost.
 */
export function franchiseExtraFiles(assets: BrandBookAssets, brand: FranchiseBrand): BrandFile[] {
  const shown = franchiseShownUrls(brand);
  const team = (assets.teams ?? []).find((t) => t.category !== 'former' && t.id === brand.franchiseId);
  if (!team) return [];
  return dedupe(
    Object.values(team.assets ?? {})
      .flatMap((entries) => entries ?? [])
      .filter((e) => !shown.has(e.relativePath))
      .map((e) => toFile(e)),
  );
}

/** Every club that no longer fields a team under that name — one archive page. */
export function retiredClubs(slug: CanonicalLeagueSlug, assets: BrandBookAssets): RetiredClub[] {
  const brands = new Map(allFranchiseBrands(slug).map((b) => [b.franchiseId, b]));
  return (assets.teams ?? [])
    .filter((t) => t.category === 'former')
    .map((t) => {
      const holder = t.id ? brands.get(t.id) : undefined;
      return {
        key: t.key,
        name: t.name,
        aliases: t.aliases ?? [],
        files: dedupe(
          Object.values(t.assets ?? {})
            .flatMap((entries) => entries ?? [])
            .map((e) => toFile(e)),
        ),
        franchise: holder ? { name: holder.name, slug: holder.slug } : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const subjectPath = (s: Pick<BrandSubject, 'kind' | 'slug'>) =>
  s.kind === 'league' ? 'league' : `${s.kind}/${s.slug}`;

/**
 * Every file the Brand Book shows, with the page that shows it — the index's
 * file search, and the inventory the coverage test checks the disk against.
 */
export function allBrandFiles(
  slug: CanonicalLeagueSlug,
  assets: BrandBookAssets,
  config: BrandBookConfig,
): BrandFileIndexEntry[] {
  const out: BrandFileIndexEntry[] = [];
  const push = (f: BrandFile, page: string, pageName: string) =>
    out.push({ label: f.label, filename: f.filename, url: stripQuery(f.url), page, pageName });

  for (const s of brandSubjects(slug, assets, config)) {
    const page = subjectPath(s);
    for (const g of s.groups) for (const f of g.files) push(f, page, s.name);
    for (const set of s.seasonal) for (const f of set.files) push({ ...f, label: `${set.name} ${f.label}` }, page, s.name);
  }
  for (const b of allFranchiseBrands(slug)) {
    for (const url of franchiseShownUrls(b)) push(fileFromPath(url), b.slug, b.name);
    for (const f of franchiseExtraFiles(assets, b)) push(f, b.slug, b.name);
    for (const set of franchiseSeasonalMarks(slug, b.franchiseId))
      for (const f of set.files) push({ ...f, label: `${set.name} crest` }, b.slug, b.name);
  }
  for (const club of retiredClubs(slug, assets)) for (const f of club.files) push(f, 'archive', club.name);
  return out;
}

/** A non-club subject drawn as an index tile. */
export interface SubjectTile {
  href: string;
  name: string;
  eyebrow: string;
  art: string | null;
  artForDark: boolean;
  flag?: string;
}

/** The tile a subject draws: its first light cut, else its first cut of any kind. */
export function subjectTile(subject: BrandSubject, href: string, eyebrow: string): SubjectTile {
  const files = subject.groups.flatMap((g) => g.files).filter((f) => !f.source);
  const art = files.find((f) => !f.forDark) ?? files[0] ?? null;
  return {
    href,
    name: subject.name,
    eyebrow,
    art: art?.url ?? null,
    artForDark: art?.forDark ?? false,
    ...(subject.current ? {} : { flag: 'former' }),
  };
}
