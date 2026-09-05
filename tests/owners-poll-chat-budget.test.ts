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
    expect(nagBody).not.toMatch(/postPollMessage/);
  });
});

describe('the poll only ever posts to chat twice a week', () => {
  it('posts on open (with the column) and on reveal, and nowhere else', () => {
    // postPollMessage is the poll's only chat path; postAnnouncement is the
    // column's, which the ballot invite rides along with.
    const calls = GENERATOR.match(/await postPollMessage\(/g) ?? [];
    expect(calls).toHaveLength(1); // the reveal
    expect(GENERATOR.match(/await postAnnouncement\(/g) ?? []).toHaveLength(1);
  });

  it('folds the ballot invite into the column post instead of adding one', () => {
    expect(GENERATOR).toMatch(/buildOpenLine/);
    // buildOpenLine returns a LINE appended to the announcement, never a post.
    expect(PASS).toMatch(/export function buildOpenLine/);
    expect(PASS).not.toMatch(/postToGroupMe[\s\S]{0,200}buildOpenLine/);
  });
});
