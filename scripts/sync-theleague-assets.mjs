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

  const registerTeam = (slug, meta) => {
    if (!teams.has(slug)) {
      teams.set(slug, {
        key: slug,
        slug,
        id: meta?.id,
        name: meta?.name || prettifySlug(slug),
        division: meta?.division,
        aliases: meta?.aliases || [],
        assets: {}
      });
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

  return sortedTeams;
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

  const aggregatedTeams = await aggregateAssets();
  await fs.mkdir(path.dirname(outputJsonPath), { recursive: true });
  await fs.writeFile(
    outputJsonPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), teams: aggregatedTeams }, null, 2)
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
