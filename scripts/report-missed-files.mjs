/**
 * Prints what mfl.football has been asked for that it does not have.
 *
 * Reads the tallies src/utils/missed-file-log.ts keeps: each path requested on
 * the old InMotion host that 404'd on Vercel, and the pages that asked for it.
 * A referrer on an MFL host names the league still linking to the file.
 *
 *   node scripts/report-missed-files.mjs [--top 50]
 */
import { getRedisConfig, redisCommand } from './lib/redis.mjs';

const PATHS_KEY = 'mfl-football-misses:paths';
const REFERRERS_KEY = 'mfl-football-misses:referrers';

const topArg = process.argv.indexOf('--top');
const TOP = topArg > -1 ? Number(process.argv[topArg + 1]) || 50 : 50;

/** ZRANGE ... REV WITHSCORES comes back flat: [member, score, member, score…]. */
function pairs(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], Number(flat[i + 1])]);
  return out;
}

async function main() {
  const redis = getRedisConfig();
  if (!redis) {
    console.error('[missed-files] no Redis config');
    process.exitCode = 1;
    return;
  }
  const paths = pairs(await redisCommand(redis, ['ZRANGE', PATHS_KEY, 0, TOP - 1, 'REV', 'WITHSCORES']));
  const referrers = pairs(
    await redisCommand(redis, ['ZRANGE', REFERRERS_KEY, 0, TOP - 1, 'REV', 'WITHSCORES']),
  );
  const totalPaths = await redisCommand(redis, ['ZCARD', PATHS_KEY]);

  console.log(`Missed paths on mfl.football: ${totalPaths} distinct (top ${TOP})`);
  for (const [path, count] of paths) console.log(`${String(count).padStart(7)}  ${path}`);
  console.log('');
  console.log(`Path <- referring page (top ${TOP})`);
  for (const [entry, count] of referrers) console.log(`${String(count).padStart(7)}  ${entry}`);
}

main().catch((error) => {
  console.error('[missed-files] failed:', error);
  process.exitCode = 1;
});
