import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import leagueConfig from '../src/data/theleague.config.json' with { type: 'json' };

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = path.join(projectRoot, 'public');

const resolvePublicPath = (relativePath = '') =>
  path.join(publicDir, relativePath.replace(/^\//, ''));

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

const run = async () => {
  const teams = Array.isArray(leagueConfig.teams) ? leagueConfig.teams : [];
  const aliasBuckets = ['icon', 'banner', 'groupMe'];
  const createdAliases = [];

  for (const team of teams) {
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

  console.log(
    `[sync-theleague] Created/updated ${createdAliases.length} franchise aliases.`
  );
};

run().catch((error) => {
  console.error('[sync-theleague] Failed to create aliases:', error);
  process.exitCode = 1;
});
