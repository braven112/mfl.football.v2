/**
 * The group chat as a fallback channel for deadline reminders.
 *
 * Every rule here is load-bearing for the notification migration: the chat post
 * carries a deadline only for the owners push could not reach, and it stops
 * happening on its own as owners subscribe. The failure direction is the part
 * worth guarding hardest — a push that could not run must produce the SAME
 * broadcast the chat always got, never silence.
 */

import { describe, it, expect } from 'vitest';

import {
  buildCta,
  buildFallbackPost,
  MAX_CHARS,
  MAX_NAMED,
} from '../scripts/lib/reminder-fallback.mjs';
import { locateMentions } from '../scripts/lib/groupme-mentions.mjs';

const URL = 'https://www.theleague.us/notifications';

const owner = (id: string, name: string, detail?: string) => ({
  franchiseId: id,
  name,
  ...(detail ? { detail } : {}),
});

describe('buildFallbackPost — no unreached owner, no post', () => {
  it('returns null for an empty unreached list', () => {
    expect(
      buildFallbackPost({ headline: 'Cut deadline', unreached: [], notificationsUrl: URL }),
    ).toBeNull();
  });

  it('returns null rather than an empty broadcast when every row is malformed', () => {
    // A row missing a name would otherwise render a nameless bullet and a
    // callout that calls nobody out.
    expect(
      buildFallbackPost({
        headline: 'Cut deadline',
        unreached: [{ franchiseId: '0001' } as never, null as never],
        notificationsUrl: URL,
      }),
    ).toBeNull();
  });

  it('posts as soon as one owner is unreached', () => {
    const post = buildFallbackPost({
      headline: 'Cut deadline',
      unreached: [owner('0001', 'Pacific Pigskins')],
      notificationsUrl: URL,
    });
    expect(post).not.toBeNull();
    expect(post!.text).toContain('Pacific Pigskins');
  });
});

describe('buildFallbackPost — names only the unreached', () => {
  it('never names an owner the caller did not pass', () => {
    const post = buildFallbackPost({
      headline: 'Lineup check',
      unreached: [owner('0001', 'Pacific Pigskins')],
      notificationsUrl: URL,
    })!;
    // The reached owners' problems are their own business: we already told
    // them privately, and repeating it in public is the noise this replaces.
    expect(post.text).not.toContain('Dark Magicians');
    expect(post.named).toEqual(['0001']);
  });

  it('summarizes past MAX_NAMED rather than posting a wall', () => {
    const many = Array.from({ length: MAX_NAMED + 4 }, (_, i) =>
      owner(String(i).padStart(4, '0'), `Team ${i}`),
    );
    const post = buildFallbackPost({
      headline: 'Cut deadline',
      unreached: many,
      notificationsUrl: URL,
    })!;
    expect(post.named).toHaveLength(MAX_NAMED);
    expect(post.text).toContain('…and 4 more');
  });
});

describe('buildFallbackPost — the notifications ask', () => {
  it('always carries the CTA and the URL', () => {
    const post = buildFallbackPost({
      headline: 'Cut deadline',
      unreached: [owner('0001', 'Pacific Pigskins')],
      notificationsUrl: URL,
    })!;
    expect(post.text).toContain(URL);
    expect(post.text.toLowerCase()).toContain('notifications');
  });

  it('never ends the message on punctuation glued to the URL', () => {
    // GroupMe autolinks a trailing period into the href and 404s every tap.
    for (const text of [buildCta(URL), buildCta(URL, { tagged: false })]) {
      expect(text.endsWith(URL)).toBe(true);
    }
  });

  it('offers a softer, untagged wording for a plain announcement', () => {
    expect(buildCta(URL, { tagged: false })).not.toMatch(/tagged/i);
    expect(buildCta(URL)).toMatch(/tagged/i);
  });
});

describe('buildFallbackPost — @-mentions', () => {
  const mentions = new Map([
    ['0001', { userId: 'u-1' }],
    ['0002', { userId: 'u-2' }],
  ]);

  it('builds one mentions attachment whose loci land on the names', () => {
    const post = buildFallbackPost({
      headline: 'Cut deadline',
      unreached: [owner('0001', 'Pacific Pigskins'), owner('0002', 'Cowboy Up')],
      mentions,
      notificationsUrl: URL,
    })!;

    expect(post.attachments).toHaveLength(1);
    const attachment = post.attachments[0] as { user_ids: string[]; loci: number[][] };
    expect(attachment.user_ids).toEqual(['u-1', 'u-2']);

    // The whole point: each locus must slice the intended name out of the
    // FINAL bytes. An off-by-one here highlights the wrong words in public.
    const sliced = attachment.loci.map(([start, len]) => post.text.slice(start, start + len));
    expect(sliced).toEqual(['@Pacific Pigskins', '@Cowboy Up']);
  });

  it('still names an owner with no GroupMe mapping, without an @', () => {
    const post = buildFallbackPost({
      headline: 'Cut deadline',
      unreached: [owner('0001', 'Pacific Pigskins'), owner('0009', 'Unmapped Team')],
      mentions,
      notificationsUrl: URL,
    })!;
    // Dropping the owner entirely would cost them the deadline; a weaker
    // callout is the correct degradation.
    expect(post.text).toContain('Unmapped Team');
    expect(post.text).not.toContain('@Unmapped Team');
    expect((post.attachments[0] as { user_ids: string[] }).user_ids).toEqual(['u-1']);
  });

  it('emits no attachment at all when nobody can be mentioned', () => {
    const post = buildFallbackPost({
      headline: 'Cut deadline',
      unreached: [owner('0009', 'Unmapped Team')],
      notificationsUrl: URL,
    })!;
    expect(post.attachments).toEqual([]);
  });
});

describe('buildFallbackPost — length', () => {
  it('drops per-owner detail before it overruns GroupMe, keeping every name', () => {
    const long = 'starting a player who is OUT, plus two empty slots and a bye-week starter';
    const rows = Array.from({ length: MAX_NAMED }, (_, i) =>
      owner(String(i).padStart(4, '0'), `A Team With A Fairly Long Name ${i}`, long),
    );
    const post = buildFallbackPost({
      headline: 'Lineup check',
      unreached: rows,
      notificationsUrl: URL,
    })!;

    expect(post.text.length).toBeLessThanOrEqual(MAX_CHARS);
    // The mention is what the post is FOR, so names survive and detail is what
    // gets cut — the push already carried the detail and the site has all of it.
    expect(post.text).not.toContain(long);
    for (const row of rows) expect(post.text).toContain(row.name);
  });

  it('keeps the detail when it fits', () => {
    const post = buildFallbackPost({
      headline: 'Lineup check',
      unreached: [owner('0001', 'Pacific Pigskins', 'no lineup submitted')],
      notificationsUrl: URL,
    })!;
    expect(post.text).toContain('no lineup submitted');
  });

  it('keeps mention loci correct after the detail is dropped', () => {
    // The re-render is exactly where loci go stale: offsets computed against
    // the long draft would run off the end of the shortened message.
    const long = 'x'.repeat(120);
    const rows = Array.from({ length: 6 }, (_, i) =>
      owner(String(i).padStart(4, '0'), `Team Number ${i}`, long),
    );
    const mentions = new Map(rows.map((r, i) => [r.franchiseId, { userId: `u-${i}` }]));
    const post = buildFallbackPost({
      headline: 'Cut deadline',
      unreached: rows,
      mentions,
      notificationsUrl: URL,
    })!;

    const attachment = post.attachments[0] as { loci: number[][] };
    const sliced = attachment.loci.map(([start, len]) => post.text.slice(start, start + len));
    expect(sliced).toEqual(rows.map((r) => `@${r.name}`));
  });
});

describe('locateMentions — two owners can share a display name', () => {
  it('advances the cursor so repeats do not both resolve to the first hit', () => {
    const text = '@Team A\n@Team A';
    const located = locateMentions(text, [
      { userId: 'u-1', token: '@Team A' },
      { userId: 'u-2', token: '@Team A' },
    ]);
    expect(located.map((m) => m.start)).toEqual([0, 8]);
  });

  it('skips a token that is not in the text rather than emitting a bad locus', () => {
    expect(locateMentions('nothing here', [{ userId: 'u-1', token: '@Ghost' }])).toEqual([]);
  });
});
