/**
 * One GroupMe post per day, enforced at the source.
 *
 * The Owners' Poll leans on web push: the reminder and the personal result go
 * to an owner's phone, and the chat gets ONE post a day — the column on
 * Tuesday (with the ballot invite folded in) and the result on Thursday.
 *
 * This is a guard, not a style preference. The failure it prevents is silent:
 * someone adds a second poll cron, or re-adds a chat nag, and the league gets
 * two Schefter pings in a morning with nothing new in the second one. Nothing
 * at runtime would complain.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const WORKFLOW = read('.github/workflows/schefter-articles.yml');
const GENERATOR = read('scripts/generate-pecking-order.mjs');
const PASS = read('scripts/lib/owners-poll-pass.mjs');

/** Poll-related article types, and the cron each is mapped from. */
const POLL_TYPES = ['pecking-order', 'owners-poll-nag', 'owners-poll-close'];

/** `"m h dom mon dow") TYPE="x"` → the weekday each poll type fires on. */
function cronWeekdayFor(type: string): number | null {
  const m = WORKFLOW.match(
    new RegExp(`"(\\S+) (\\S+) (\\S+) (\\S+) (\\S+)"\\)\\s*TYPE="${type}"`),
  );
  if (!m) return null;
  const [, minute, hourUtc, , , dow] = m;
  // The cron is UTC; a post scheduled at 00:00 UTC is the PREVIOUS day in PT,
  // which is exactly how the Thursday-evening reveal is expressed.
  const hour = Number(hourUtc);
  const day = Number(dow);
  if (!Number.isFinite(hour) || !Number.isFinite(day)) return null;
  void minute;
  // PT is 7-8 hours behind UTC; anything before 08:00 UTC is the day before.
  return hour < 8 ? (day + 6) % 7 : day;
}

describe('one poll post per Pacific day', () => {
  it('maps every poll cron to a weekday', () => {
    for (const type of POLL_TYPES) {
      expect(cronWeekdayFor(type), `${type} has no cron mapping`).not.toBeNull();
    }
  });

  it('never schedules two CHAT-POSTING poll crons on the same PT day', () => {
    // owners-poll-nag is push-only, so it does not count against the budget
    // even though it shares Thursday with the reveal.
    const chatTypes = POLL_TYPES.filter((t) => t !== 'owners-poll-nag');
    const days = chatTypes.map(cronWeekdayFor);
    expect(new Set(days).size).toBe(days.length);
  });
});

describe('the nag is push-only', () => {
  it('has no GroupMe message builder left', () => {
    // Removed, not merely unused: an exported builder is an invitation to
    // call it, and the whole point is that this reminder never hits chat.
    expect(PASS).not.toMatch(/buildNagMessage/);
  });

  it('sends pushes rather than posting when the nag runs', () => {
    const nagBody = GENERATOR.slice(
      GENERATOR.indexOf('async function runNagPoll'),
      GENERATOR.indexOf('/** Every earlier issue of this season'),
    );
    expect(nagBody).toMatch(/buildNagPushes/);
    expect(nagBody).toMatch(/sendVoterPushes/);
    // It must not reach chat by either route — the direct one, or by queueing
    // a message for the post-deploy announce pass.
    expect(nagBody).not.toMatch(/postToGroupMe/);
    expect(nagBody).not.toMatch(/enqueueAnnounce/);
  });
});

describe('the poll only ever posts to chat twice a week', () => {
  it('posts on open (with the column) and on reveal, and nowhere else', () => {
    // The generator no longer sends to GroupMe itself: it QUEUES, and
    // scripts/schefter-announce-pending.mjs delivers after the commit, once
    // the issue is live (see scripts/lib/await-published.mjs). The budget is
    // unchanged and counted the same way — one queued chat message for the
    // column the ballot invite rides along with, one for the reveal.
    const queued = GENERATOR.match(/enqueueAnnounce\(/g) ?? [];
    expect(queued).toHaveLength(2);
    expect(GENERATOR.match(/kind: 'pecking-order'/g) ?? []).toHaveLength(1);
    expect(GENERATOR.match(/kind: 'owners-poll-close'/g) ?? []).toHaveLength(1);

    // And no direct chat path survives anywhere in the generator — one that
    // did would be a post that goes out before the deploy, which is the bug.
    expect(GENERATOR).not.toMatch(/postToGroupMeCapped\s*\(/);
    expect(GENERATOR).not.toMatch(/\bpostToGroupMe\s*\(/);
  });

  it('folds the ballot invite into the column post instead of adding one', () => {
    expect(GENERATOR).toMatch(/buildOpenLine/);
    // buildOpenLine returns a LINE appended to the announcement, never a post.
    expect(PASS).toMatch(/export function buildOpenLine/);
    expect(PASS).not.toMatch(/postToGroupMe[\s\S]{0,200}buildOpenLine/);
  });
});

// ---------------------------------------------------------------------------

describe('a zero-ballot week reaches nobody, through the announce QUEUE', () => {
  // The silence rule ("there is no point of posting about no poll") is enforced
  // in the builders: buildRevealMessage returns null and buildVoterPushes
  // returns [] when a week closed with nothing in it. But the generator no
  // longer SENDS — it enqueues, and schefter-announce-pending.mjs drains the
  // queue after the commit step. So the rule only actually holds if the close
  // pass declines to enqueue in the first place; an entry with a null
  // groupMeText and no pushes would still be a queued announcement.
  //
  // This asserts the guard that makes those compose. It is the same class of
  // seam that let the "Still good?" cron silently send nothing: two correct
  // halves, and the bug living in the join.

  it('the close pass returns before enqueueing when there is no text and no pushes', () => {
    const close = GENERATOR.slice(GENERATOR.indexOf('async function runClosePoll'));
    const body = close.slice(0, close.indexOf('\n}\n'));

    const guardIdx = body.indexOf('if (!text && voterPushes.length === 0) return;');
    const enqueueIdx = body.indexOf('enqueueAnnounce(');

    expect(guardIdx, 'the close pass must bail on an empty week').toBeGreaterThan(-1);
    expect(enqueueIdx, 'the close pass must enqueue its reveal').toBeGreaterThan(-1);
    // Order matters: the bail has to come FIRST, or the queue gets an entry
    // with nothing in it and the deploy announces a week nobody voted in.
    expect(guardIdx).toBeLessThan(enqueueIdx);
  });

});
