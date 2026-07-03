import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import leagueConfig from '../src/data/theleague.config.json' with { type: 'json' };

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = path.join(projectRoot, 'public');
const dataDir = path.join(projectRoot, 'src', 'data');
const leagueAssetsDir = path.join(publicDir, 'assets', 'theleague');
const outputJsonPath = path.join(dataDir, 'theleague.assets.json');

const aliasBuckets = ['icon', 'banner', 'groupMe'];
const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.psd']);

const fileSlug = (value = '') =>
  value
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const prettifySlug = (slug = '') =>
  slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const resolvePublicPath = (relativePath = '') =>
  path.join(publicDir, relativePath.replace(/^\/+/, ''));

const copyAlias = async (source, dest) => {
  if (source === dest) return;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(source, dest);
};

const ensureAliasForAsset = async (assetPath, franchiseId, bucket) => {
  if (!assetPath || !franchiseId) return null;

  const sourcePath = resolvePublicPath(assetPath);
  try {
    await fs.access(sourcePath);
  } catch {
    console.warn(`[sync-theleague] Missing source for ${bucket}: ${assetPath}`);
    return null;
  }

  const parsed = path.parse(sourcePath);
  const aliasPath = path.join(parsed.dir, `${franchiseId}${parsed.ext}`);
  await copyAlias(sourcePath, aliasPath);
  return aliasPath;
};

const buildTeamMeta = () => {
  const map = new Map();
  const teams = Array.isArray(leagueConfig.teams) ? leagueConfig.teams : [];

  teams.forEach((team) => {
    const slug =
      fileSlug(team.slug) || fileSlug(team.name) || team.franchiseId.toLowerCase();
    const entry = {
      ...team,
      slug,
      id: team.franchiseId,
      name: team.name || prettifySlug(slug)
    };

    const keys = [entry.slug, entry.id, ...(team.aliases ?? [])]
      .filter(Boolean)
      .map((key) => fileSlug(key));

    keys.forEach((key) => {
      if (key && !map.has(key)) {
        map.set(key, entry);
      }
    });
  });

  return map;
};

const aggregateAssets = async () => {
  const teamMeta = buildTeamMeta();
  const teams = new Map();
  // Franchise ID is the only stable key across active-card registration and
  // the config's history entries — slugs can diverge (an explicit `slug`
  // field wouldn't match `fileSlug(team.name)`), franchise IDs can't.
  const franchiseIdToActiveCard = new Map();

  const registerTeam = (slug, meta) => {
    if (!teams.has(slug)) {
      const card = {
        key: slug,
        slug,
        id: meta?.id,
        name: meta?.name || prettifySlug(slug),
        category: meta ? 'active' : 'former',
        division: meta?.division,
        aliases: meta?.aliases || [],
        assets: {}
      };
      teams.set(slug, card);
      if (meta?.id) franchiseIdToActiveCard.set(meta.id, card);
    }
    return teams.get(slug);
  };

  let directories = [];
  try {
    directories = await fs.readdir(leagueAssetsDir, { withFileTypes: true });
  } catch (error) {
    console.warn('[sync-theleague] Unable to read assets directory:', error);
  }

  for (const dirent of directories) {
    if (!dirent.isDirectory()) continue;
    // Historical identity art is keyed by past team names, not current slugs —
    // it gets its own config-driven cards below instead of the generic scan.
    // Awards/conference/league art is aggregated into `extras` buckets below,
    // and favicons are site chrome, not library assets.
    if (['history', 'awards', 'conferences', 'favicons'].includes(dirent.name)) continue;
    const folder = dirent.name;
    const folderPath = path.join(leagueAssetsDir, folder);
    let files = [];
    try {
      files = await fs.readdir(folderPath);
    } catch {
      continue;
    }

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (!allowedExtensions.has(ext)) continue;

      const baseName = path.basename(file, ext);
      const normalizedKey = fileSlug(baseName);
      const meta = teamMeta.get(normalizedKey);
      const slug = meta?.slug || normalizedKey || baseName;

      if (meta?.id && baseName === meta.id) {
        continue;
      }

      const team = registerTeam(slug, meta);
      if (!team.assets[folder]) team.assets[folder] = [];

      team.assets[folder].push({
        type: folder,
        filename: file,
        relativePath: `/assets/theleague/${folder}/${file}`,
        extension: ext,
      });
    }
  }

  // Historical identity cards: grouped by identity NAME — a name that spans
  // multiple franchises or eras (e.g. an owner moving slots, or a rebrand
  // that came back) gets ONE card with the union of its year ranges and all
  // of its art variants.
  const teamsFromConfig = Array.isArray(leagueConfig.teams) ? leagueConfig.teams : [];
  const historyCards = new Map();
  for (const team of teamsFromConfig) {
    for (const entry of team.history ?? []) {
      const assetPairs = [
        ['icons', entry.icon],
        ['banners', entry.banner],
      ].filter(([, assetPath]) => typeof assetPath === 'string' && assetPath.includes('/history/'));
      if (assetPairs.length === 0) continue;

      const nameKey = fileSlug(entry.name);
      if (!historyCards.has(nameKey)) {
        historyCards.set(nameKey, {
          name: entry.name,
          ids: new Set(),
          ranges: [],
          eras: [], // per-entry {yearStart, yearEnd, franchiseId, conference}
          aliases: new Set(),
          assets: new Map(), // bucket -> Map(relativePath -> entry)
        });
      }
      const group = historyCards.get(nameKey);
      group.ids.add(team.franchiseId);
      group.ranges.push([entry.yearStart, entry.yearEnd]);
      group.eras.push({
        yearStart: entry.yearStart,
        yearEnd: entry.yearEnd,
        franchiseId: team.franchiseId,
        conference: entry.conference,
      });
      group.aliases.add(team.name);
      if (entry.abbrev) group.aliases.add(entry.abbrev);

      for (const [bucket, assetPath] of assetPairs) {
        try {
          await fs.access(resolvePublicPath(assetPath));
        } catch {
          console.warn(`[sync-theleague] Missing history asset: ${assetPath}`);
          continue;
        }
        if (!group.assets.has(bucket)) group.assets.set(bucket, new Map());
        group.assets.get(bucket).set(assetPath, {
          type: bucket,
          filename: path.basename(assetPath),
          relativePath: assetPath,
          extension: path.extname(assetPath).toLowerCase(),
        });
      }
    }
  }
  // Merge name-groups whose recovered art is IDENTICAL — the same team under
  // a renamed label (e.g. "ATF" / "Alcohol, Tobacco and Firearms"). The label
  // covering the most seasons wins; the other names stay searchable as aliases.
  const groupSignature = (group) =>
    [...group.assets.values()].flatMap((m) => [...m.keys()]).sort().join('|');
  const bySignature = new Map();
  for (const [nameKey, group] of historyCards) {
    const sig = groupSignature(group);
    if (!sig) continue;
    if (!bySignature.has(sig)) bySignature.set(sig, []);
    bySignature.get(sig).push(nameKey);
  }
  for (const keys of bySignature.values()) {
    if (keys.length < 2) continue;
    // Fullest name leads; the shorter labels follow in parens, e.g.
    // "Alcohol, Tobacco and Firearms (ATF)".
    const entries = keys
      .map((k) => [k, historyCards.get(k)])
      .sort((a, b) => b[1].name.length - a[1].name.length);
    const [, primary] = entries[0];
    const otherNames = [];
    for (const [k, g] of entries.slice(1)) {
      for (const id of g.ids) primary.ids.add(id);
      primary.ranges.push(...g.ranges);
      primary.eras.push(...g.eras);
      otherNames.push(g.name);
      primary.aliases.add(g.name);
      for (const a of g.aliases) primary.aliases.add(a);
      historyCards.delete(k);
    }
    primary.name = `${primary.name} (${otherNames.join(', ')})`;
  }

  // Merge contiguous same-slot, same-conference eras so the era note only
  // appears when there was an actual move to acknowledge.
  const coalesceEras = (eras) => eras
    .sort((a, b) => a.yearStart - b.yearStart)
    .reduce((acc, e) => {
      const last = acc[acc.length - 1];
      if (
        last &&
        last.franchiseId === e.franchiseId &&
        last.conference === e.conference &&
        e.yearStart <= last.yearEnd + 1
      ) {
        last.yearEnd = Math.max(last.yearEnd, e.yearEnd);
      } else {
        acc.push({ ...e });
      }
      return acc;
    }, []);

  for (const [nameKey, group] of historyCards) {
    if (group.assets.size === 0) continue;
    group.eras = coalesceEras(group.eras);
    // A historical era that shares its name with an ACTIVE team (same team,
    // owner moved franchise slots) folds its art into the active card
    // instead of appearing under Former Teams. Matched by NAME across every
    // registered active card (not `teams.get(nameKey)`, which only works
    // because no team config sets an explicit `slug` today — a card's Map
    // key can diverge from `fileSlug(card.name)` if one ever does). Can't
    // narrow by `group.ids`: those are the FORMER franchise slot(s) this
    // identity lived at, which is frequently a different franchise than
    // wherever the identity currently lives (that's the whole point of the
    // fold — Harambe's history is filed under franchise 0016, its active
    // card is franchise 0008).
    const activeCard = [...franchiseIdToActiveCard.values()]
      .find((card) => fileSlug(card.name) === nameKey);
    if (activeCard && activeCard.category === 'active') {
      activeCard.eras = [...(activeCard.eras ?? []), ...group.eras]
        .sort((a, b) => a.yearStart - b.yearStart);
      for (const [bucket, entries] of group.assets) {
        if (!activeCard.assets[bucket]) activeCard.assets[bucket] = [];
        for (const entry of entries.values()) {
          if (!activeCard.assets[bucket].some((a) => a.relativePath === entry.relativePath)) {
            activeCard.assets[bucket].push(entry);
          }
        }
      }
      continue;
    }
    // Coalesce overlapping/adjacent year ranges into a compact label,
    // e.g. [[2016,2016],[2017,2018]] -> "2016–2018".
    const ranges = group.ranges
      .sort((a, b) => a[0] - b[0])
      .reduce((acc, [s, e]) => {
        const last = acc[acc.length - 1];
        if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
        else acc.push([s, e]);
        return acc;
      }, []);
    const yearLabel = ranges.map(([s, e]) => (s === e ? `${s}` : `${s}–${e}`)).join(', ');
    const key = `history_${nameKey}`;
    teams.set(key, {
      key,
      slug: key,
      id: [...group.ids].sort().join(', '),
      name: `${group.name} (${yearLabel})`,
      category: 'former',
      eras: group.eras.length > 1 || group.eras.some((e) => e.conference)
        ? group.eras
        : undefined,
      aliases: [...group.aliases],
      assets: Object.fromEntries(
        [...group.assets.entries()].map(([bucket, entries]) => [bucket, [...entries.values()]])
      ),
    });
  }

  // League-level art: championship/award badges, league + tier logos,
  // conference and division marks. Rendered as their own sections on the
  // assets page, in a fixed order after the team cards.
  const extras = { championship: [], league: [], conference: [], division: [] };
  const pushExtra = (bucket, relativePath) => {
    const filename = path.basename(relativePath);
    extras[bucket].push({
      type: bucket,
      filename,
      relativePath,
      extension: path.extname(filename).toLowerCase(),
    });
  };
  const isDivisionBadge = () => false;
  const readExtraDir = async (folder, classify) => {
    let files = [];
    try {
      files = await fs.readdir(path.join(leagueAssetsDir, folder));
    } catch {
      return;
    }
    for (const file of files.sort()) {
      const ext = path.extname(file).toLowerCase();
      if (!allowedExtensions.has(ext)) continue;
      pushExtra(classify(path.basename(file, ext)), `/assets/theleague/${folder}/${file}`);
    }
  };
  await readExtraDir('awards', (base) => (isDivisionBadge(base) ? 'division' : 'championship'));
  await readExtraDir('conferences', () => 'conference');
  // League logo lives in the shared logos dir; root-level files in the league
  // assets dir (tier marks etc.) also count as league-level logos.
  for (const dirent of directories) {
    if (!dirent.isFile()) continue;
    const ext = path.extname(dirent.name).toLowerCase();
    if (!allowedExtensions.has(ext)) continue;
    pushExtra('league', `/assets/theleague/${dirent.name}`);
  }
  try {
    await fs.access(resolvePublicPath('/assets/logos/theleague-logo.svg'));
    extras.league.unshift({
      type: 'league',
      filename: path.basename('/assets/logos/theleague-logo.svg'),
      relativePath: '/assets/logos/theleague-logo.svg',
      extension: path.extname('/assets/logos/theleague-logo.svg').toLowerCase(),
    });
  } catch {
    console.warn('[sync-theleague] League logo not found: /assets/logos/theleague-logo.svg');
  }

  const sortedTeams = Array.from(teams.values())
    .map((team) => {
      const sortedAssets = Object.entries(team.assets)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([folder, assets]) => [
          folder,
          assets.sort((a, b) => a.filename.localeCompare(b.filename))
        ]);

      return { ...team, assets: Object.fromEntries(sortedAssets) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { teams: sortedTeams, extras };
};

const run = async () => {
  const teamsFromConfig = Array.isArray(leagueConfig.teams)
    ? leagueConfig.teams
    : [];
  const createdAliases = [];

  for (const team of teamsFromConfig) {
    for (const bucket of aliasBuckets) {
      const assetPath = team[bucket];
      const aliasPath = await ensureAliasForAsset(
        assetPath,
        team.franchiseId,
        bucket
      );
      if (aliasPath) {
        createdAliases.push(aliasPath);
      }
    }
  }

  const { teams: aggregatedTeams, extras } = await aggregateAssets();
  await fs.mkdir(path.dirname(outputJsonPath), { recursive: true });
  await fs.writeFile(
    outputJsonPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), teams: aggregatedTeams, extras }, null, 2)
  );

  console.log(
    `[sync-theleague] Created/updated ${createdAliases.length} franchise aliases.`
  );
  console.log(
    `[sync-theleague] Aggregated ${aggregatedTeams.length} teams into theleague.assets.json.`
  );
};

run().catch((error) => {
  console.error('[sync-theleague] Failed to create aliases:', error);
  process.exitCode = 1;
});
