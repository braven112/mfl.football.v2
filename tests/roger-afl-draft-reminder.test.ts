import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guards for the August 2026 AFL draft reminder bug.
 *
 * On Thu Aug 13 2026 at 1:00am PT, Roger posted "One week until AFL Annual
 * Draft Window" to the AFL GroupMe. Two independent defects:
 *
 *   1. WRONG DATE. scripts/compute-league-events.mjs carried an
 *      `afl-draft-window-opens` event pinned to a hardcoded Aug 20 (lifted
 *      from an "Annual draft window" line that the constitution, the rules
 *      page and docs/claude/afl-rules.md all carried, and which described a
 *      window the league has never drafted in — since corrected to "the
 *      weekend before Labor Day weekend"). The league actually drafts on the
 *      Labor-Day-anchored weekend — Sat Aug 29 (AL) and Sun Aug 30 (NL) in
 *      2026 — which is what /afl-fantasy/calendar renders from
 *      src/data/afl-fantasy/league-events.json. The reminder fired 16 days
 *      out and linked to a calendar that contradicted it.
 *
 *   2. WRONG HOUR. scanEventReminders posted to GroupMe with no quiet-hours
 *      gate, so the 15-minute scan cron sent it at whatever hour the touch
 *      first came due. Every other GroupMe lane honors isQuietHours.
 *
 * These tests read the source rather than executing the script because
 * compute-league-events.mjs writes to fixed repo paths on run.
 */

const projectRoot = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(projectRoot, p), 'utf8');

const AL_RULE = 'saturday-before-labor-day-weekend';
const NL_RULE = 'sunday-before-labor-day-weekend';

describe('AFL draft reminders — date source', () => {
  const computeSrc = read('scripts/compute-league-events.mjs');
  const aflEventsBlock =
    computeSrc.slice(
      computeSrc.indexOf('const AFL_EVENTS'),
      computeSrc.indexOf('// ── Resolve dates ──'),
    ) || computeSrc;

  it('anchors both AFL draft reminders to the Labor Day rules', () => {
    expect(aflEventsBlock).toContain(`id: 'afl-al-draft'`);
    expect(aflEventsBlock).toContain(`rule: '${AL_RULE}'`);
    expect(aflEventsBlock).toContain(`id: 'afl-nl-draft'`);
    expect(aflEventsBlock).toContain(`rule: '${NL_RULE}'`);
  });

  it('never re-pins an AFL draft event to a fixed calendar date', () => {
    // The exact shape of the original bug: a draft event with `type: 'fixed'`.
    // Comment lines are excluded — the block documents the retired event by
    // name so the next reader knows why it must not come back.
    const eventLines = aflEventsBlock
      .split('\n')
      .filter(line => !line.trim().startsWith('//'));
    const draftLines = eventLines.filter(line => /id: 'afl-[^']*draft/.test(line));
    expect(draftLines.length).toBeGreaterThan(0);
    for (const line of draftLines) {
      expect(line).not.toContain(`type: 'fixed'`);
    }
    expect(eventLines.join('\n')).not.toContain('afl-draft-window-opens');
  });

  it('uses the same rule names the calendar resolves', () => {
    // Reminders and /afl-fantasy/calendar must share one anchor. If either
    // side renames a rule, this fails instead of silently drifting apart.
    const resolverSrc = read('src/utils/league-event-resolver.ts');
    const calendarEvents = read('src/data/afl-fantasy/league-events.json');
    for (const rule of [AL_RULE, NL_RULE]) {
      expect(resolverSrc).toContain(`case '${rule}'`);
      expect(calendarEvents).toContain(`"rule": "${rule}"`);
    }
  });

  it('has no stale draft events in the committed AFL artifact', () => {
    const resolved = JSON.parse(read('data/afl-fantasy/resolved-events.json'));
    const draftIds = resolved.events
      .map((e: { id: string }) => e.id)
      .filter((id: string) => id.includes('draft'));
    expect(draftIds.sort()).toEqual(['afl-al-draft', 'afl-nl-draft']);
  });

  it('carries no reminder posts for the retired draft-window event', () => {
    const feed = JSON.parse(read('data/afl-fantasy/schefter-feed.json'));
    const stale = feed.posts.filter((p: { id: string }) =>
      p.id.startsWith('roger_afl-draft-window-opens_'),
    );
    expect(stale).toEqual([]);
  });
});

describe('Roger reminders — quiet hours', () => {
  const scanSrc = read('scripts/schefter-scan.mjs');
  const start = scanSrc.indexOf('async function scanEventReminders(');

  /** Slice exactly one function body by brace matching from its signature. */
  function sliceFunctionBody(src: string, fnStart: number): string {
    const open = src.indexOf('{', fnStart);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(fnStart, i + 1);
    }
    return '';
  }

  const body = sliceFunctionBody(scanSrc, start);

  it('extracts the scanEventReminders body', () => {
    expect(start).toBeGreaterThan(-1);
    expect(body.length).toBeGreaterThan(0);
    // Sanity: we sliced one function, not the rest of the file.
    expect(body).toContain('scanEventReminders');
    expect(body).not.toContain('BYLINE_TO_AUTHOR');
  });

  it('bails out during quiet hours', () => {
    expect(body).toMatch(/if \(isQuietHours\(.*\)\) \{/);
  });

  it('gates BEFORE writing the feed, not just before the GroupMe send', () => {
    // The feed post id is the dedup key: writing the post during quiet hours
    // and skipping only the send would swallow the notification forever.
    const gateIndex = body.indexOf('isQuietHours');
    const feedWriteIndex = body.indexOf('fs.writeFile');
    const groupMeIndex = body.indexOf('postToGroupMe');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(feedWriteIndex).toBeGreaterThan(gateIndex);
    expect(groupMeIndex).toBeGreaterThan(gateIndex);
  });
});
