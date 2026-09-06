/**
 * Merging same-day deadlines into one chat message.
 *
 * TheLeague's "Declare Contracts / Cut to 22" and "Offseason FA Closes" are
 * both the third Sunday in August, so their 7-day touches fire together and
 * the chat got two back-to-back Roger monologues. Two bot messages in a row is
 * how a chat gets muted, which costs more than the second message was worth.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildReminderDigest, describeDaysUntil } from '../scripts/lib/reminder-digest.mjs';
import { MAX_CHARS } from '../scripts/lib/reminder-fallback.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('buildReminderDigest', () => {
  it('returns null for one deadline, so it keeps Roger\'s own voice', () => {
    // A single reminder is not a list. The caller checks for null rather than
    // rendering a one-item bullet, which reads like a bug.
    expect(buildReminderDigest({ items: [{ name: 'Rookie Draft', daysUntil: 7 }] })).toBeNull();
    expect(buildReminderDigest({ items: [] })).toBeNull();
    expect(buildReminderDigest({})).toBeNull();
  });

  it('merges the real August collision into one message naming both', () => {
    const d = buildReminderDigest({
      items: [
        { name: 'Declare Contracts / Cut to 22', daysUntil: 7 },
        { name: 'Offseason FA Closes', daysUntil: 7 },
      ],
    })!;
    expect(d.headline).toBe('Two deadlines on the board');
    expect(d.body).toContain('Declare Contracts / Cut to 22');
    expect(d.body).toContain('Offseason FA Closes');
  });

  it('drops rows with no name rather than emitting an empty bullet', () => {
    const d = buildReminderDigest({
      items: [{ name: 'Rookie Draft', daysUntil: 7 }, { name: '' }, null as never],
    });
    // Only one usable row left, so there is nothing to merge.
    expect(d).toBeNull();
  });

  it('spells small counts and falls back to digits', () => {
    const mk = (n: number) =>
      buildReminderDigest({
        items: Array.from({ length: n }, (_, i) => ({ name: `Event ${i}`, daysUntil: 7 })),
      })!.headline;
    expect(mk(2)).toMatch(/^Two /);
    expect(mk(3)).toMatch(/^Three /);
    expect(mk(7)).toMatch(/^7 /);
  });

  it('stays far inside GroupMe\'s limit even for an implausible pile-up', () => {
    const d = buildReminderDigest({
      items: Array.from({ length: 8 }, (_, i) => ({
        name: `A Deadline With A Fairly Long Name ${i}`,
        daysUntil: i,
      })),
    })!;
    // Concatenating the full per-event copy is what this replaces — that is
    // the thing that overran the cap.
    expect(`${d.headline}\n\n${d.body}`.length).toBeLessThan(MAX_CHARS);
  });
});

describe('describeDaysUntil', () => {
  it('reads as a calendar day, not a duration', () => {
    // daysUntil is a midnight-to-midnight diff, so 0 is genuinely today.
    expect(describeDaysUntil(0)).toBe('today');
    expect(describeDaysUntil(1)).toBe('tomorrow');
    expect(describeDaysUntil(7)).toBe('in a week');
    expect(describeDaysUntil(14)).toBe('in 14 days');
  });

  it('says nothing rather than something wrong when the distance is unknown', () => {
    expect(describeDaysUntil(undefined as never)).toBe('');
    expect(describeDaysUntil(null as never)).toBe('');
  });

  it('never renders a negative countdown', () => {
    // The catch-up window fires a touch one day late, so daysUntil can be
    // negative on the day-of lane. "in -1 days" would ship.
    expect(describeDaysUntil(-1)).toBe('today');
  });
});

describe('the scanner sends once per lane, not once per touch', () => {
  const src = read('scripts/schefter-scan.mjs');

  it('sorts posts into lanes before sending', () => {
    // Posting inside the per-post loop is what produced two adjacent Roger
    // monologues on the one date TheLeague has two deadlines.
    expect(src).toMatch(/const announcing = \[\];/);
    expect(src).toMatch(/const fallbacks = \[\];/);
    expect(src).toMatch(/if \(announcing\.length > 0\)/);
    expect(src).toMatch(/if \(fallbacks\.length > 0\)/);
  });

  it('has no send left inside the classification loop', () => {
    // The loop that classifies must not also post, or the merge is bypassed
    // for whichever branch kept its inline send.
    const loopStart = src.indexOf('for (const post of newPosts) {\n      const meta = touchById.get');
    expect(loopStart, 'the classification loop moved — re-anchor this guard').toBeGreaterThan(-1);
    const loopEnd = src.indexOf('const digestItems =', loopStart);
    expect(loopEnd).toBeGreaterThan(loopStart);
    expect(src.slice(loopStart, loopEnd)).not.toContain('postToGroupMe');
  });

  it('carries the event name and distance for the digest to list', () => {
    // The post headline is Roger riffing on one deadline and does not list
    // cleanly beside another, so the digest uses the EVENT's own name.
    expect(src).toMatch(/eventName: event\.name/);
    expect(src).toMatch(/daysUntil: event\.daysUntil/);
  });

  it('points a merged post at the calendar, which carries every deadline', () => {
    expect(src).toMatch(/\{ \.\.\.digest, url: league\.calendarUrl \}/);
  });
});
