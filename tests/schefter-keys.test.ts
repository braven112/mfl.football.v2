/**
 * Schefter Redis key-scoping guard.
 *
 * Two jobs, both load-bearing for multi-league safety:
 *
 * 1. FROZEN LEGACY KEYS — TheLeague's live Redis state predates multi-league
 *    support, so `schefterKey('theleague', …)` must return the exact legacy
 *    unprefixed strings forever. If one of these assertions fails, deployed
 *    counters/leaderboards/queues would silently orphan. Do NOT "fix" the
 *    fixture to match a code change — fix the code.
 *
 * 2. LITERAL GUARD — no `'schefter:…'` Redis key literal may appear in src/
 *    or scripts/ outside `scripts/lib/schefter-keys.mjs`. Every key goes
 *    through `schefterKey` (league-scoped) or `globalSchefterKey` (postId/
 *    tipId-keyed shared namespaces), so a new key can't accidentally collide
 *    across leagues. Mirrors the league-literal-guard pattern.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  schefterKey,
  globalSchefterKey,
  GLOBAL_SCHEFTER_NAMESPACES,
  DEFAULT_SCHEFTER_NAV_SLUG,
} from '../scripts/lib/schefter-keys.mjs';

// ── 1. Frozen legacy TheLeague key strings ─────────────────────────────────

/** suffix → exact legacy Redis key currently live in production. */
const FROZEN_THELEAGUE_KEYS: Record<string, string> = {
  'tips:queue': 'schefter:tips:queue',
  'tips:first_tip_ts': 'schefter:tips:first_tip_ts',
  'tips:processed': 'schefter:tips:processed',
  'tips:ratelimit:': 'schefter:tips:ratelimit:',
  'topic_timeline:': 'schefter:topic_timeline:',
  'off_topic:timeline:': 'schefter:off_topic:timeline:',
  'tipster:codename:': 'schefter:tipster:codename:',
  'tipster:codenames_used': 'schefter:tipster:codenames_used',
  'tipster:rumors_total:': 'schefter:tipster:rumors_total:',
  'tipster:rumors_season:': 'schefter:tipster:rumors_season:',
  'tipster:leaderboard:': 'schefter:tipster:leaderboard:',
  'tipster:topic_counts:': 'schefter:tipster:topic_counts:',
  'tipster:badges:': 'schefter:tipster:badges:',
  'tipster_target_count:': 'schefter:tipster_target_count:',
  'team_name_count:': 'schefter:team_name_count:',
  'style_book:': 'schefter:style_book:',
  'style_book:season:': 'schefter:style_book:season:',
  'style_book:last_shot_at:': 'schefter:style_book:last_shot_at:',
  'style_book:leaderboard:': 'schefter:style_book:leaderboard:',
  'style_book:anon:': 'schefter:style_book:anon:',
  'style_book:anon:season:': 'schefter:style_book:anon:season:',
  'style_book:anon:last_shot_at:': 'schefter:style_book:anon:last_shot_at:',
  'style_book:anon_leaderboard:': 'schefter:style_book:anon_leaderboard:',
  'rumor:posts_today': 'schefter:rumor:posts_today',
  'rumor:gossip_posts_today': 'schefter:rumor:gossip_posts_today',
  'rumor:last_post_ts': 'schefter:rumor:last_post_ts',
  'rumor:quiet_day_last_date': 'schefter:rumor:quiet_day_last_date',
  'rumor:totw:': 'schefter:rumor:totw:',
  'mailbag:done_date': 'schefter:mailbag:done_date',
  'ask_roger:last_riff_date': 'schefter:ask_roger:last_riff_date',
  'morning_greeting:last_used_date': 'schefter:morning_greeting:last_used_date',
  'trade_offers:seen': 'schefter:trade_offers:seen',
  'trade_offers:first_seen': 'schefter:trade_offers:first_seen',
  'trade_offers:exposure': 'schefter:trade_offers:exposure',
  'trade_offers:posted': 'schefter:trade_offers:posted',
  'trade_offers:archive': 'schefter:trade_offers:archive',
  'trade_offers:rolls': 'schefter:trade_offers:rolls',
  'trade_offers:owner:': 'schefter:trade_offers:owner:',
  'trade_offers:div:': 'schefter:trade_offers:div:',
  'trade_offers:owner_reports': 'schefter:trade_offers:owner_reports',
  'player_offer_history:': 'schefter:player_offer_history:',
  'tb_drafts:player:': 'schefter:tb_drafts:player:',
  'tb_drafts:owner:': 'schefter:tb_drafts:owner:',
  'groupme:last_mention_id': 'schefter:groupme:last_mention_id',
  'groupme:recent_mentions': 'schefter:groupme:recent_mentions',
  'groupme:bot_message_ids': 'schefter:groupme:bot_message_ids',
  'bigdrop:pending_groupme': 'schefter:bigdrop:pending_groupme',
};

describe('schefterKey — frozen TheLeague legacy keys', () => {
  it('returns byte-identical legacy strings for every TheLeague key family', () => {
    for (const [suffix, frozen] of Object.entries(FROZEN_THELEAGUE_KEYS)) {
      expect(schefterKey('theleague', suffix)).toBe(frozen);
    }
  });

  it('DEFAULT_SCHEFTER_NAV_SLUG is theleague (the legacy tenant)', () => {
    expect(DEFAULT_SCHEFTER_NAV_SLUG).toBe('theleague');
  });

  it('accepts a registry league object as the league argument', () => {
    expect(schefterKey({ navSlug: 'theleague' }, 'tips:queue')).toBe('schefter:tips:queue');
    expect(schefterKey({ navSlug: 'afl' }, 'tips:queue')).toBe('schefter:afl:tips:queue');
  });
});

describe('schefterKey — AFL isolation', () => {
  it('prefixes every AFL key with schefter:afl:', () => {
    for (const suffix of Object.keys(FROZEN_THELEAGUE_KEYS)) {
      const key = schefterKey('afl', suffix);
      expect(key).toBe(`schefter:afl:${suffix}`);
      expect(key).not.toBe(FROZEN_THELEAGUE_KEYS[suffix]);
    }
  });

  it('rejects unknown league slugs', () => {
    expect(() => schefterKey('nfl', 'tips:queue')).toThrow(/unknown league/);
    expect(() => schefterKey('', 'tips:queue')).toThrow(/unknown league/);
    // Registry canonical slug is 'afl-fantasy' but keys use navSlug 'afl' —
    // passing the wrong slug form must fail loudly, not mint a new keyspace.
    expect(() => schefterKey('afl-fantasy', 'tips:queue')).toThrow(/unknown league/);
  });

  it('rejects empty suffixes', () => {
    expect(() => schefterKey('theleague', '')).toThrow(/suffix/);
  });
});

describe('globalSchefterKey — shared id-keyed namespaces', () => {
  it('builds postId/tipId-keyed keys unprefixed for all leagues', () => {
    expect(globalSchefterKey('thread', 'abc')).toBe('schefter:thread:abc');
    expect(globalSchefterKey('threadOf', 'p1')).toBe('schefter:thread_of:p1');
    expect(globalSchefterKey('tipsterHashForTip', 't1')).toBe('schefter:tipster_hash_for_tip:t1');
    expect(globalSchefterKey('reactions')).toBe('schefter:reactions:');
    expect(globalSchefterKey('reactionsAnon')).toBe('schefter:reactions:anon:');
    expect(globalSchefterKey('replies')).toBe('schefter:replies:');
    expect(globalSchefterKey('replyRate')).toBe('schefter:reply-rate:');
    expect(globalSchefterKey('rumorImpressions', 'p9')).toBe('schefter:rumor:impressions:p9');
  });

  it('rejects unknown namespaces', () => {
    // @ts-expect-error — invalid namespace on purpose
    expect(() => globalSchefterKey('tips')).toThrow(/unknown namespace/);
  });

  it('global namespaces never collide with league-scoped families', () => {
    // Sanity: the global set is small and fixed. Growing it deserves the same
    // scrutiny as un-prefixing a league key — see schefter-keys.mjs docs.
    expect(Object.keys(GLOBAL_SCHEFTER_NAMESPACES).sort()).toEqual([
      'reactions',
      'reactionsAnon',
      'replies',
      'replyRate',
      'rumorImpressions',
      'thread',
      'threadOf',
      'tipsterHashForTip',
    ]);
  });
});

// ── 2. Literal guard — no raw 'schefter:' keys outside the helper ──────────

const ROOT = join(__dirname, '..');
const SCAN_DIRS = ['src', 'scripts'];
const SCAN_EXTS = new Set(['.ts', '.tsx', '.mjs', '.astro']);

/** Files allowed to contain quoted `schefter:` strings, with reasons. */
const ALLOWLIST = new Set([
  // The helper itself.
  'scripts/lib/schefter-keys.mjs',
]);

/** Specific non-Redis literals allowed anywhere (client-side storage etc.). */
const ALLOWED_LITERALS = [
  // localStorage key in the feed island — not a Redis key.
  'schefter:rumor-impression-seen-v1',
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function stripComments(source: string): string {
  // Good enough for a guard: removes /* */ blocks and // line tails.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('schefter key literal guard', () => {
  it("no quoted 'schefter:' literal appears outside schefter-keys.mjs", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file);
        const ext = file.slice(file.lastIndexOf('.'));
        if (!SCAN_EXTS.has(ext)) continue;
        if (ALLOWLIST.has(rel)) continue;
        let text = stripComments(readFileSync(file, 'utf8'));
        for (const allowed of ALLOWED_LITERALS) {
          text = text.split(allowed).join('');
        }
        const lines = text.split('\n');
        lines.forEach((line, i) => {
          if (/['"`]schefter:/.test(line)) {
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
