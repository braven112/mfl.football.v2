/**
 * League-wide GroupMe cap: one automated post per Pacific day.
 *
 * Two jobs here. The first is the calendar logic. The second, and the reason
 * this file matters more than most, is the ALLOWLIST guard: it reads every
 * script that can post to GroupMe and fails when a new one bypasses the cap
 * without being declared exempt. That failure mode is otherwise invisible —
 * nothing at runtime complains about a bot quietly posting a fourth message.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GROUPME_DAY_PLAN,
  EXEMPT_KINDS,
  PUSH_ONLY_KINDS,
  isExempt,
  isPlannedToday,
  plannedKindsFor,
  ptDay,
  dayClaimKey,
  describeRefusal,
} from '../scripts/lib/groupme-day-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Tuesday and Thursday 11:00 PT, well clear of any date boundary. */
const TUE = new Date('2026-09-08T18:00:00Z');
const THU = new Date('2026-09-10T18:00:00Z');

describe('the weekday calendar', () => {
  it('gives every weekday exactly one regular column', () => {
    // 'schedule-release' leads every day but is a no-op 364 days a year, so
    // the day's real post is whatever follows it.
    for (let day = 0; day <= 6; day += 1) {
      const regular = plannedKindsFor(day).filter((k: string) => k !== 'schedule-release');
      expect(regular.length, `weekday ${day} has ${regular.length} regular posts`).toBeLessThanOrEqual(1);
    }
  });

  it('never lists the same kind on two different days', () => {
    const seen = new Map<string, number>();
    for (let day = 0; day <= 6; day += 1) {
      for (const kind of plannedKindsFor(day)) {
        if (kind === 'schedule-release') continue;
        expect(seen.has(kind), `${kind} is scheduled twice`).toBe(false);
        seen.set(kind, day);
      }
    }
  });

  it('puts the column on Tuesday and the poll result on Thursday', () => {
    expect(isPlannedToday('pecking-order', TUE)).toBe(true);
    expect(isPlannedToday('owners-poll-close', THU)).toBe(true);
    // …and not on each other's day.
    expect(isPlannedToday('pecking-order', THU)).toBe(false);
    expect(isPlannedToday('owners-poll-close', TUE)).toBe(false);
  });

  it('holds a kind that has no day at all', () => {
    for (const kind of PUSH_ONLY_KINDS) {
      for (let day = 0; day <= 6; day += 1) {
        expect(plannedKindsFor(day)).not.toContain(kind);
      }
    }
  });

  it('never lists an exempt kind on the calendar', () => {
    // Exempt kinds bypass the cap; also giving them a day would imply they
    // consume the slot, which they must not.
    for (let day = 0; day <= 6; day += 1) {
      for (const kind of plannedKindsFor(day)) {
        expect(isExempt(kind), `${kind} is both exempt and scheduled`).toBe(false);
      }
    }
  });

  it('keeps exempt and push-only sets disjoint', () => {
    for (const kind of EXEMPT_KINDS) expect(PUSH_ONLY_KINDS.has(kind)).toBe(false);
  });
});

describe('exemptions', () => {
  it('lets a human, Roger, and a deadline warning through on any day', () => {
    for (const kind of ['human', 'admin-announce', 'roger-reply', 'roger-reminder', 'lineup-deadline']) {
      expect(isExempt(kind), kind).toBe(true);
      for (let d = 0; d <= 6; d += 1) {
        expect(isPlannedToday(kind, new Date(Date.UTC(2026, 8, 6 + d, 18)))).toBe(true);
      }
    }
  });

  it('exempts the lineup deadline warning, which costs real points if missed', () => {
    expect(EXEMPT_KINDS.has('lineup-deadline')).toBe(true);
  });

  it('does NOT exempt routine editorial', () => {
    for (const kind of ['pecking-order', 'transaction', 'rumor', 'weekly-recap']) {
      expect(isExempt(kind), kind).toBe(false);
    }
  });
});

describe('the day key', () => {
  it('is per league and per Pacific date', () => {
    expect(dayClaimKey('theleague', TUE)).toBe('groupme:theleague:day:2026-09-08');
    expect(dayClaimKey('afl', TUE)).toBe('groupme:afl:day:2026-09-08');
    expect(dayClaimKey('theleague', TUE)).not.toBe(dayClaimKey('afl', TUE));
  });

  it('uses the PACIFIC date, so a late-evening post charges the right day', () => {
    // 2026-09-09T05:00Z is Tuesday 22:00 PT — still Tuesday's slot.
    expect(dayClaimKey('theleague', new Date('2026-09-09T05:00:00Z'))).toContain('2026-09-08');
    expect(ptDay(new Date('2026-09-09T05:00:00Z')).weekday).toBe(2);
  });

  it('throws on a scope it cannot key', () => {
    expect(() => dayClaimKey('', TUE)).toThrow();
    expect(() => dayClaimKey(undefined as unknown as string, TUE)).toThrow();
  });
});

describe('refusals explain themselves', () => {
  it('says WHY, because a silent cron is indistinguishable from a broken one', () => {
    expect(describeRefusal('transaction', null, TUE)).toMatch(/push-only/);
    expect(describeRefusal('pecking-order', 'schedule-release', TUE)).toMatch(/already claimed/);
    expect(describeRefusal('weekend-preview', null, TUE)).toMatch(/not today's designated post/);
    // …and names what today's post actually is, so the log is actionable.
    expect(describeRefusal('weekend-preview', null, TUE)).toContain('pecking-order');
  });
});

// ---------------------------------------------------------------------------
// The allowlist guard
// ---------------------------------------------------------------------------

/**
 * Scripts allowed to call the RAW postToGroupMe, with the reason each one
 * bypasses the cap. Everything else must go through postToGroupMeCapped.
 */
const RAW_POST_ALLOWLIST: Record<string, string> = {
  'lib/groupme.mjs': 'the sender itself',
  'lib/groupme-capped.mjs': 'the capped wrapper, which calls it',
  'post-groupme-message.mjs': 'a human typed it',
  'roger-groupme-reply.mjs': 'Roger answering an owner who spoke to him',
  'lib/roger-clapback.mjs': 'Roger answering an owner who spoke to him',
  'lib/groupme-groups.mjs': 'group membership helper — reads groups, never posts',
  'roger-improvement-notify.mjs': 'developer notification, not the league chat',
  'apply-august-cuts.mjs': 'announces roster cuts that already happened — an owner must know',
  'gameday-health-check.mjs': 'infrastructure alert, spans every league, only fires on failure',
  'check-afl-waiver-order.ts': 'commissioner-facing waiver-order alert',
  'schefter-announce.mjs': 'a human composed the announcement',
};

function scriptsThatPost(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(path.join(dir, entry.name), rel);
        continue;
      }
      if (!/\.(mjs|ts)$/.test(entry.name)) continue;
      const src = readFileSync(path.join(dir, entry.name), 'utf8');
      // BOTH forms: the shared sender, and a raw /v3/bots/post fetch. The
      // speculation lane used the latter and was invisible to an earlier
      // version of this guard — which is precisely the hole it exists to close.
      if (/postToGroupMe\b/.test(src) || /v3\/bots\/post/.test(src)) out.push(rel);
    }
  };
  walk(path.join(ROOT, 'scripts'));
  return out.sort();
}

describe('every GroupMe sender is accounted for', () => {
  it('routes through the cap, or is on the allowlist with a reason', () => {
    const unaccounted: string[] = [];
    for (const rel of scriptsThatPost()) {
      if (rel in RAW_POST_ALLOWLIST) continue;
      const src = readFileSync(path.join(ROOT, 'scripts', rel), 'utf8');
      // Either the wrapper, or the pure calendar check for a lane that posts
      // /v3/bots/post directly.
      if (/postToGroupMeCapped|isPlannedToday/.test(src)) continue;
      unaccounted.push(rel);
    }
    expect(
      unaccounted,
      `These post to GroupMe without the cap. Either route them through ` +
        `postToGroupMeCapped, or add them to RAW_POST_ALLOWLIST with a reason:\n  ` +
        unaccounted.join('\n  '),
    ).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    // An allowlist that outlives its files stops describing reality.
    const present = new Set(scriptsThatPost());
    const stale = Object.keys(RAW_POST_ALLOWLIST).filter((f) => !present.has(f));
    expect(stale, `Allowlist entries with no matching file: ${stale.join(', ')}`).toEqual([]);
  });

  it('gives every allowlist entry a non-empty reason', () => {
    for (const [file, reason] of Object.entries(RAW_POST_ALLOWLIST)) {
      expect(reason.length, `${file} has no reason`).toBeGreaterThan(10);
    }
  });
});
