#!/usr/bin/env node
/**
 * Post owner career milestones to each league's GroupMe, in Schefter's voice.
 *
 * Runs at the end of the Derived History Chain lane, after the freshly
 * computed owner-tenures.json has been committed — so a milestone is only ever
 * announced from numbers that are in git. See scripts/lib/owner-milestones.mjs
 * for what counts and why it is the OWNER's career, not the franchise's.
 *
 * Exempt from the one-post-a-day cap (kind `career-milestone`, Brandon's call,
 * Nov 2026): a few a year, and a milestone held for "its day" is stale.
 *
 * Dedupe is a Redis SET NX per owner+milestone, claimed BEFORE sending and
 * released if the send fails. No Redis means no posts: unlike a deadline, a
 * milestone that waits a day costs nothing, and a double post is the worse
 * failure.
 *
 * Usage:
 *   node scripts/post-owner-milestones.mjs             # post
 *   node scripts/post-owner-milestones.mjs --dry-run   # print what would post
 *   node scripts/post-owner-milestones.mjs --seed      # print a fresh baseline (never posts)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_LEAGUES, leagueUrl } from '../src/config/leagues-data.mjs';
import { chatConfigFor } from './lib/chat.mjs';
import { postToGroupMeCapped } from './lib/groupme-capped.mjs';
import { getRedisConfig, redisCommand } from './lib/redis.mjs';
import {
  MAX_NEW_PER_RUN,
  allHeldKeys,
  milestoneText,
  newMilestones,
} from './lib/owner-milestones.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const BASELINE_PATH = path.join(ROOT, 'src/data/owner-milestones-baseline.json');
export const MILESTONE_KIND = 'career-milestone';

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);

/** Leagues that get this lane: a GroupMe chat and an owner-tenures file. */
export function milestoneLeagues(leagues = ALL_LEAGUES, exists = fs.existsSync) {
  return leagues.filter(
    (l) =>
      chatConfigFor(l)?.provider === 'groupme' &&
      exists(path.join(ROOT, l.dataPath, 'derived', 'owner-tenures.json')),
  );
}

export const claimKey = (navSlug, key) => `groupme:${navSlug}:milestone:${key}`;

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const seed = args.includes('--seed');
  const baseline = readJson(BASELINE_PATH) ?? {};
  const leagues = milestoneLeagues();

  if (seed) {
    const out = {};
    for (const l of leagues) {
      const tenures = readJson(path.join(ROOT, l.dataPath, 'derived', 'owner-tenures.json'));
      out[l.slug] = allHeldKeys(tenures);
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const redis = getRedisConfig();
  if (!redis && !dryRun) {
    console.warn('[milestones] No Redis — cannot dedupe, posting nothing this run.');
    return;
  }

  for (const league of leagues) {
    const tag = `[milestones:${league.navSlug}]`;
    const known = baseline[league.slug];
    if (!Array.isArray(known)) {
      // A league with no baseline would announce every milestone it has ever
      // earned. Seed it first (--seed), on purpose.
      console.warn(`${tag} No baseline entry for ${league.slug} — skipping. Seed it with --seed.`);
      continue;
    }
    const tenures = readJson(path.join(ROOT, league.dataPath, 'derived', 'owner-tenures.json'));
    const fresh = newMilestones(tenures, known);
    if (fresh.length === 0) {
      console.log(`${tag} Nothing new.`);
      continue;
    }
    if (fresh.length > MAX_NEW_PER_RUN) {
      console.warn(
        `${tag} ${fresh.length} new milestones in one run (max ${MAX_NEW_PER_RUN}) — that is a data ` +
          `problem, not a big week. Posting none: ${fresh.map((f) => f.key).join(', ')}`,
      );
      continue;
    }

    const botId = process.env[chatConfigFor(league).botEnv];
    for (const { key, owner, milestone } of fresh) {
      const text = milestoneText({
        owner,
        milestone,
        ownerUrl: owner.slug ? leagueUrl(league, `/owners/${owner.slug}`) : null,
      });
      if (dryRun) {
        console.log(`${tag} [dry-run] ${key}\n${text}\n`);
        continue;
      }
      const ck = claimKey(league.navSlug, key);
      const claimed = await redisCommand(redis, ['SET', ck, new Date().toISOString(), 'NX']).catch(() => null);
      if (claimed !== 'OK' && claimed !== true) {
        console.log(`${tag} ${key} already announced.`);
        continue;
      }
      const result = await postToGroupMeCapped({
        kind: MILESTONE_KIND,
        league: { navSlug: league.navSlug },
        botId,
        text,
        checkStatus: true,
        onMissingBotId: () => console.warn(`${tag} ${chatConfigFor(league).botEnv} not set.`),
        onPosted: () => console.log(`${tag} Posted ${key}.`),
        onHttpError: (status) => console.warn(`${tag} GroupMe HTTP ${status} for ${key}.`),
        onFetchError: (err) => console.warn(`${tag} GroupMe error for ${key}: ${err?.message ?? err}`),
      });
      if (!result.posted) {
        // Give the claim back so tomorrow's run tries again.
        await redisCommand(redis, ['DEL', ck]).catch(() => null);
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[milestones] failed:', err);
    process.exit(1);
  });
}
