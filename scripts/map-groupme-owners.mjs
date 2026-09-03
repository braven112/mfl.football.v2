#!/usr/bin/env node
/**
 * Map GroupMe members to franchises, per league.
 *
 * Roger's clapbacks quote the sender's roster, which means he has to know whose
 * roster it is. The existing writer for that mapping
 * (src/pages/api/groupme/members.ts -> groupme-storage.ts#linkFranchise) is
 * hardcoded to TheLeague's team config and writes a BARE `groupme:user:<id>`
 * key, so the AFL had no way to be mapped at all. This is that way.
 *
 * TWO STEPS ON PURPOSE. A wrong mapping is worse than no mapping: it makes
 * Roger read out one owner's roster while addressing another, in front of the
 * whole league, and it looks authoritative because every number in it is real.
 * So nothing is ever written from a guess. Step one PROPOSES and step two
 * APPLIES what a human confirmed.
 *
 *   # 1. propose — table to stderr, machine-readable draft to stdout
 *   node scripts/map-groupme-owners.mjs --league afl-fantasy > afl-map.json
 *
 *   # 2. edit afl-map.json by hand, fixing any franchiseId the matcher got wrong
 *   #    (entries with "franchiseId": null are simply skipped)
 *
 *   # 3. apply
 *   node scripts/map-groupme-owners.mjs --league afl-fantasy --apply afl-map.json
 *
 * The draft file holds GroupMe user ids and nicknames — real people's account
 * identifiers. Keep it out of the repo; write it somewhere untracked and delete
 * it once applied. Nothing here writes to disk on its own.
 */

import fs from 'node:fs/promises';

import { getRedisConfig, createUpstashClient } from './lib/redis.mjs';
import { resolveLeagueGroupId, fetchGroupMembers } from './lib/groupme-groups.mjs';
import { getSchefterLeague } from './lib/schefter-leagues.mjs';

/** Written key must match franchiseMapKeys() in roger-groupme-reply.mjs. */
export function ownerMapKey(navSlug, userId) {
  return `groupme:${navSlug}:user:${userId}`;
}

/** Lowercase alphanumerics only — GroupMe nicknames are full of punctuation. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Significant words, for the token-overlap pass. */
function tokens(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/**
 * Score a nickname against one team. Higher is better; 0 means no evidence.
 *
 * Scores are deliberately coarse and the thresholds generous, because this
 * output is read by a human who will correct it. The matcher's job is to save
 * typing, not to be trusted.
 */
export function scoreMatch(nickname, team) {
  const nick = normalize(nickname);
  if (!nick) return 0;

  const candidates = [team.name, team.nameShort, team.nameMedium, team.abbrev, ...(team.aliases ?? [])]
    .filter(Boolean)
    .map((c) => ({ raw: c, norm: normalize(c) }))
    .filter((c) => c.norm);

  let best = 0;
  for (const c of candidates) {
    if (nick === c.norm) best = Math.max(best, 100);
    else if (nick.includes(c.norm) || c.norm.includes(nick)) best = Math.max(best, 70);
  }

  const nickTokens = new Set(tokens(nickname));
  for (const c of candidates) {
    const shared = tokens(c.raw).filter((t) => nickTokens.has(t)).length;
    if (shared > 0) best = Math.max(best, 40 + shared * 10);
  }
  return best;
}

/** Confidence label for the human reading the table. */
function confidenceOf(score) {
  if (score >= 100) return 'exact';
  if (score >= 70) return 'likely';
  if (score >= 50) return 'maybe';
  return 'none';
}

/**
 * Propose a mapping. Every member gets a row; unmatched rows carry a null
 * franchiseId so the file is a complete worksheet rather than a partial one.
 */
export function proposeMapping(members, teams) {
  const used = new Set();
  const rows = [];

  // Best matches first, so a strong match claims its franchise before a weak
  // one can. Without this a vague nickname can take the team a clear one wanted.
  const scored = [];
  for (const member of members) {
    for (const team of teams) {
      const score = scoreMatch(member.nickname, team);
      if (score > 0) scored.push({ member, team, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const claimed = new Map();
  for (const { member, team, score } of scored) {
    if (claimed.has(member.user_id) || used.has(team.franchiseId)) continue;
    if (score < 50) continue;
    claimed.set(member.user_id, { team, score });
    used.add(team.franchiseId);
  }

  for (const member of members) {
    const hit = claimed.get(member.user_id);
    rows.push({
      userId: member.user_id,
      nickname: member.nickname,
      franchiseId: hit ? hit.team.franchiseId : null,
      teamName: hit ? hit.team.name : null,
      confidence: confidenceOf(hit?.score ?? 0),
    });
  }
  return rows;
}

async function loadTeams(configPath) {
  const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));
  return raw.teams ?? [];
}

async function getRedis() {
  const config = getRedisConfig();
  if (!config) return null;
  return createUpstashClient(config);
}

async function propose(league) {
  const redis = await getRedis().catch(() => null);
  const { groupId, source } = await resolveLeagueGroupId({ league, redis });
  if (!groupId) {
    console.error(
      `Could not resolve a GroupMe group for ${league.slug}. The service token must own ` +
        `the league's Roger bot, or set the group id explicitly.`,
    );
    process.exit(1);
  }
  console.error(`Group ${groupId} (${source})`);

  const members = await fetchGroupMembers({ groupId });
  if (!members) {
    console.error('Could not read group members — check GROUPME_SERVICE_TOKEN.');
    process.exit(1);
  }

  const teams = await loadTeams(league.configPath);
  const rows = proposeMapping(members, teams);

  const width = Math.max(...rows.map((r) => (r.nickname ?? '').length), 8);
  console.error('');
  console.error(`${'NICKNAME'.padEnd(width)}  FRANCHISE  CONFIDENCE  TEAM`);
  console.error('-'.repeat(width + 40));
  for (const r of rows) {
    console.error(
      `${(r.nickname ?? '').padEnd(width)}  ${(r.franchiseId ?? '----').padEnd(9)}  ` +
        `${r.confidence.padEnd(10)}  ${r.teamName ?? ''}`,
    );
  }
  const unmatched = rows.filter((r) => !r.franchiseId).length;
  const unclaimed = teams.filter((t) => !rows.some((r) => r.franchiseId === t.franchiseId));
  console.error('');
  console.error(`${rows.length} members, ${rows.length - unmatched} matched, ${unmatched} unmatched.`);
  if (unclaimed.length > 0) {
    console.error(`Franchises with nobody mapped: ${unclaimed.map((t) => `${t.franchiseId} ${t.name}`).join(', ')}`);
  }
  console.error('');
  console.error('Review the JSON on stdout, fix any wrong franchiseId, then re-run with --apply.');

  process.stdout.write(JSON.stringify({ league: league.slug, mappings: rows }, null, 2) + '\n');
}

async function apply(league, filePath) {
  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (parsed.league && parsed.league !== league.slug) {
    console.error(
      `Refusing to apply: file was generated for "${parsed.league}" but --league says "${league.slug}". ` +
        `Writing one league's franchise ids under another's keys is the exact bug this scoping prevents.`,
    );
    process.exit(1);
  }

  const teams = await loadTeams(league.configPath);
  const validIds = new Set(teams.map((t) => t.franchiseId));
  const rows = (parsed.mappings ?? []).filter((r) => r.franchiseId);

  const bad = rows.filter((r) => !validIds.has(r.franchiseId));
  if (bad.length > 0) {
    console.error(`Refusing to apply — ${bad.length} unknown franchise id(s) for ${league.slug}:`);
    for (const r of bad) console.error(`  ${r.nickname}: ${r.franchiseId}`);
    process.exit(1);
  }

  const dupes = new Map();
  for (const r of rows) dupes.set(r.franchiseId, (dupes.get(r.franchiseId) ?? 0) + 1);
  const collisions = [...dupes.entries()].filter(([, n]) => n > 1);
  if (collisions.length > 0) {
    console.error(`Refusing to apply — franchise mapped to more than one member: ${collisions.map(([id]) => id).join(', ')}`);
    process.exit(1);
  }

  const redis = await getRedis();
  if (!redis) {
    console.error('No Redis configured — run `pnpm dlx vercel env pull` first.');
    process.exit(1);
  }

  for (const r of rows) {
    await redis.set(ownerMapKey(league.slug, r.userId), r.franchiseId);
    console.log(`  ${r.nickname} -> ${r.franchiseId} ${r.teamName ?? ''}`);
  }
  console.log(`\nWrote ${rows.length} mapping(s) for ${league.slug}.`);
  console.log('Delete the draft file — it holds real GroupMe account ids.');
}

// ── CLI ──
// Guarded so the matcher above stays importable by tests — an unguarded CLI
// body runs (and exits) the moment a test imports scoreMatch.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const leagueSlug = args[args.indexOf('--league') + 1] ?? 'afl-fantasy';
  const applyIdx = args.indexOf('--apply');
  const league = getSchefterLeague(leagueSlug);

  if (applyIdx !== -1) {
    const file = args[applyIdx + 1];
    if (!file) {
      console.error('--apply needs a file path');
      process.exit(1);
    }
    await apply(league, file);
  } else {
    await propose(league);
  }
}
