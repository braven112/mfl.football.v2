import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { awaitPublished } from '../scripts/lib/await-published.mjs';
import {
  enqueueAnnounce,
  readAnnounceQueue,
  clearAnnounceQueue,
  queuePath,
} from '../scripts/lib/announce-queue.mjs';
import { REPO_ROOT } from './helpers/scan-guard';

/**
 * The publish/deploy race.
 *
 * The Gauntlet's GroupMe promo went out the instant `appendToFeed` resolved —
 * a file write in the Actions runner. The commit lands in a LATER workflow
 * step and Vercel then builds, so for the first minutes of the article's life
 * `news/[id].astro` could not find the post and redirected every owner who
 * tapped the chat link to the Schefter index. It then fixed itself, which is
 * why it went unreported for as long as it did.
 *
 * Three things have to stay true, and each is pinned below:
 *   1. the announcement waits for a 200 (a 3xx is "not live", not success);
 *   2. the generator ENQUEUES rather than sends;
 *   3. the workflow drains the queue AFTER the commit step, never before.
 */

const silent = { log: () => {}, warn: () => {} };

describe('awaitPublished — waits for the page, not for a guess', () => {
  it('announces as soon as the permalink answers 200', async () => {
    const statuses = [302, 302, 200];
    const seen: string[] = [];
    const result = await awaitPublished({
      league: 'theleague',
      path: '/theleague/news/sf_2026_gauntlet_w05_theleague',
      fetchImpl: async (url: string) => {
        seen.push(url);
        return { status: statuses.shift() ?? 200 } as Response;
      },
      sleep: async () => {},
      log: silent,
    });

    expect(result.live).toBe(true);
    expect(result.attempts).toBe(3);
    // The league's own apex host, prefix dropped — never a doubled prefix.
    expect(seen[0]).toContain('https://www.theleague.us/news/sf_2026_gauntlet_w05_theleague');
    expect(seen[0]).not.toContain('theleague.us/theleague');
    // Cache-busted: an edge cache holding the pre-deploy response for the few
    // minutes that matter would defeat the whole check.
    expect(new Set(seen).size).toBe(3);
  });

  it('treats the not-found REDIRECT as "not live yet"', async () => {
    // This is the exact bug: following the redirect returns the Schefter
    // index's own 200, which would read as a live article.
    let calls = 0;
    let clock = 0;
    const result = await awaitPublished({
      league: 'theleague',
      path: '/theleague/news/missing',
      fetchImpl: async (_url: string, init: RequestInit) => {
        calls += 1;
        expect(init.redirect).toBe('manual');
        return { status: 302 } as Response;
      },
      timeoutMs: 100,
      intervalMs: 20,
      now: () => clock,
      sleep: async (ms: number) => { clock += ms; },
      log: silent,
    });
    expect(result.live).toBe(false);
    expect(calls).toBeGreaterThan(1);
  });

  it('fails OPEN on timeout — a quiet channel is worse than an early link', async () => {
    let clock = 0;
    const result = await awaitPublished({
      league: 'afl-fantasy',
      path: '/afl-fantasy/news/slow',
      fetchImpl: async () => ({ status: 404 }) as Response,
      timeoutMs: 50,
      intervalMs: 10,
      now: () => (clock += 0),
      sleep: async (ms: number) => { clock += ms; },
      log: silent,
    });
    // `live: false` is reported, not thrown: the caller announces anyway.
    expect(result.live).toBe(false);
    expect(result.url).toBe('https://www.afl-fantasy.com/news/slow');
  });

  it('survives a network error mid-poll', async () => {
    const statuses: (number | Error)[] = [new Error('ECONNRESET'), 200];
    const result = await awaitPublished({
      league: 'theleague',
      path: '/theleague/news/x',
      fetchImpl: async () => {
        const next = statuses.shift();
        if (next instanceof Error) throw next;
        return { status: next } as Response;
      },
      sleep: async () => {},
      log: silent,
    });
    expect(result.live).toBe(true);
  });

  it('never sleeps past its own deadline', async () => {
    // Fake clock: a sleep the loop takes has to advance time, or the poll
    // budget is measured against a stopwatch that never moves.
    let clock = 0;
    let slept = 0;
    await awaitPublished({
      league: 'theleague',
      path: '/theleague/news/x',
      fetchImpl: async () => ({ status: 404 }) as Response,
      timeoutMs: 100,
      intervalMs: 60,
      now: () => clock,
      sleep: async (ms: number) => { slept += ms; clock += ms; },
      log: silent,
    });
    expect(slept).toBeLessThan(100);
  });
});

describe('the announce queue', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'announce-queue-'));
    process.env.SCHEFTER_ANNOUNCE_QUEUE = path.join(dir, 'queue.json');
  });

  afterEach(() => {
    delete process.env.SCHEFTER_ANNOUNCE_QUEUE;
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends across calls — the Gauntlet queues one entry per league', async () => {
    await enqueueAnnounce(dir, { league: 'theleague', postId: 'a' });
    await enqueueAnnounce(dir, { league: 'afl-fantasy', postId: 'b' });
    const queue = await readAnnounceQueue(dir);
    expect(queue.map((e: { league: string }) => e.league)).toEqual(['theleague', 'afl-fantasy']);
  });

  it('reads an absent queue as empty, not as an error', async () => {
    expect(await readAnnounceQueue(dir)).toEqual([]);
  });

  it('clears unconditionally, so a failed send cannot re-announce hours later', async () => {
    await enqueueAnnounce(dir, { league: 'theleague', postId: 'a' });
    expect(await clearAnnounceQueue(dir)).toBe(true);
    expect(await readAnnounceQueue(dir)).toEqual([]);
  });

  it('honours SCHEFTER_ANNOUNCE_QUEUE and never writes into the repo', async () => {
    expect(queuePath(dir)).toBe(path.join(dir, 'queue.json'));
    delete process.env.SCHEFTER_ANNOUNCE_QUEUE;
    // The fallback is repo-local for a hand run, and gitignored.
    expect(queuePath(dir)).toBe(path.join(dir, '.schefter-announce-queue.json'));
    const ignored = await fs.readFile(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(ignored).toContain('.schefter-announce-queue.json');
  });
});

describe('the generator queues; the workflow sends after the push', () => {
  it('schefter-weekly-articles.mjs no longer posts to GroupMe or push itself', async () => {
    const src = await fs.readFile(
      path.join(REPO_ROOT, 'scripts/schefter-weekly-articles.mjs'),
      'utf8',
    );
    const code = src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
    expect(code).toContain('enqueueAnnounce');
    // The senders live in scripts/schefter-announce-pending.mjs now. Calling
    // one from the generator puts the announcement back in front of the
    // deploy, which is the whole bug.
    expect(code).not.toMatch(/postToGroupMeCapped\s*\(/);
    expect(code).not.toMatch(/sendPushFanout\s*\(/);
  });

  it('the announce step runs AFTER the commit step in the workflow', async () => {
    const wf = parseYaml(
      await fs.readFile(path.join(REPO_ROOT, '.github/workflows/schefter-articles.yml'), 'utf8'),
    );
    const steps: { name?: string; run?: string }[] = wf.jobs.generate.steps;
    const names = steps.map((s) => s.name ?? '');

    const commit = names.findIndex((n) => /commit and push/i.test(n));
    const announce = steps.findIndex((s) => /schefter-announce-pending/.test(s.run ?? ''));
    const generate = names.findIndex((n) => /^generate article$/i.test(n));

    expect(commit).toBeGreaterThan(-1);
    expect(announce).toBeGreaterThan(-1);
    expect(announce).toBeGreaterThan(commit);
    expect(commit).toBeGreaterThan(generate);
  });

  it('both steps share one queue path, declared per STEP and outside the workspace', async () => {
    const wf = parseYaml(
      await fs.readFile(path.join(REPO_ROOT, '.github/workflows/schefter-articles.yml'), 'utf8'),
    );
    const job = wf.jobs.generate;

    // `runner` does not exist as a context at JOB level — a runner is not
    // assigned until steps run, so `jobs.<id>.env` referencing it is rejected
    // outright. This assertion used to pin that broken form.
    expect(JSON.stringify(job.env ?? {})).not.toContain('runner.');

    const queues = (job.steps as { env?: Record<string, string> }[])
      .map((s) => s.env?.SCHEFTER_ANNOUNCE_QUEUE)
      .filter(Boolean);
    // The generator writes it and the announce step reads it: two steps, ONE
    // path, and outside the workspace so it can never be committed.
    expect(queues).toHaveLength(2);
    expect(new Set(queues).size).toBe(1);
    expect(queues[0]).toContain('runner.temp');
  });

  it('the announce step carries the credentials the senders need', async () => {
    const wf = parseYaml(
      await fs.readFile(path.join(REPO_ROOT, '.github/workflows/schefter-articles.yml'), 'utf8'),
    );
    const steps: { run?: string; env?: Record<string, string> }[] = wf.jobs.generate.steps;
    const step = steps.find((s) => /schefter-announce-pending/.test(s.run ?? ''))!;
    // Roger's bot is never Schefter's fallback, so both Schefter bots must be
    // present or a league silently loses its chat post.
    expect(Object.keys(step.env ?? {})).toEqual(
      expect.arrayContaining([
        'GROUPME_SCHEFTER_BOT_ID',
        'GROUPME_AFL_SCHEFTER_BOT_ID',
        'UPSTASH_REDIS_REST_URL',
        'CRON_SECRET',
      ]),
    );
  });
});

describe('the Pecking Order queues too — same race, softer symptom', () => {
  /**
   * The column's announcement links `/pecking-order`, a page that exists every
   * week of the year. So instead of a redirect, a pre-deploy tap showed LAST
   * week's column to everyone the message had just told to read this one.
   */
  let generator = '';
  beforeEach(async () => {
    generator ||= await fs.readFile(
      path.join(REPO_ROOT, 'scripts/generate-pecking-order.mjs'),
      'utf8',
    );
  });

  it('the Tuesday column waits on its issue permalink, never the landing page', async () => {
    // `/pecking-order` answers 200 every week of the season, so waiting on it
    // is waiting on nothing — and announcing with NO wait is what showed
    // owners Week 5 under the Week 6 post on 2026-10-20 (the deploy carrying
    // Week 6 started building the minute the chat message went out).
    expect(generator).toMatch(/verifyPath: issuePermalink\(league, year, week\),/);
    // And it does NOT fail open: an early post names the wrong week, so on a
    // timeout the column says nothing (Brandon, 2026-10-20).
    expect(generator).toMatch(/skipIfNotLive: true,/);
    expect(generator).not.toMatch(/verifyPath: '\/pecking-order'/);
    const { issuePermalink } = await import('../scripts/generate-pecking-order.mjs');
    expect(issuePermalink({ slug: 'afl-fantasy' }, 2026, 6)).toBe('/afl-fantasy/pecking-order/2026/6');

    // Queueing is still the point: the announcement cannot go out ahead of the
    // commit step, and cannot go out at all if that step failed.
    expect(generator.match(/enqueueAnnounce\(/g) ?? []).toHaveLength(1);
  });

  it('the probed permalink is server-rendered and 404s a week it does not have', async () => {
    // Prerendered, the route was a static file the apex-host middleware rewrite
    // never reached, so it 500'd on every league domain and could not be a
    // probe. And it must 404 an undeployed week, or the probe passes early.
    for (const league of ['theleague', 'afl-fantasy', 'archies']) {
      const src = await fs.readFile(
        path.join(REPO_ROOT, `src/pages/${league}/pecking-order/[year]/[week].astro`),
        'utf8',
      );
      expect(src, league).toMatch(/export const prerender = false;/);
      expect(src, league).not.toMatch(/getStaticPaths/);
      expect(src, league).toMatch(/if \(!issue\) Astro\.response\.status = 404;/);
    }
  });

  it('carries the column push category', () => {
    // 'column', not 'article' — owners subscribe per category, and a wrong one
    // is dropped server-side rather than delivered to someone who did not ask.
    expect(generator).toMatch(/pushCategory: 'column'/);
  });
});

describe('announceOne', () => {
  it('a dry run never touches the day claim', async () => {
    // postToGroupMeCapped claims the league's one slot for the day BEFORE it
    // checks dryRun, and releases it only when a LIVE send failed — so a
    // rehearsal routed through it would burn the day and silence the real
    // post. A dry run must therefore print, not call.
    const { announceOne } = await import('../scripts/schefter-announce-pending.mjs');
    const lines: string[] = [];
    const result = await announceOne(
      {
        league: 'theleague',
        kind: 'schedule-strength',
        postId: 'sf_dry',
        verifyPath: '/theleague/news/sf_dry',
        groupMeText: 'THE GAUNTLET — Week 5',
        botEnv: 'GROUPME_SCHEFTER_BOT_ID',
        push: { franchiseIds: ['0001'], title: 'T', body: 'B', url: '/x', tag: 'sf_dry' },
        dryRun: true,
      },
      {
        dryRun: true,
        wait: async () => ({ live: true, attempts: 1 }),
        log: { log: (...a: unknown[]) => lines.push(a.join(' ')), warn: () => {} },
      },
    );
    expect(result.announced).toBe(true);
    expect(result.posted).toBe(false);
    expect(lines.join('\n')).toContain('[dry-run] Would post to GroupMe');
  });

  it('a dry run does not wait on the live site either', async () => {
    // Nothing was committed, so the probe could only burn its full 12-minute
    // timeout against a page that is never going to appear.
    const { announceOne } = await import('../scripts/schefter-announce-pending.mjs');
    let waited = false;
    await announceOne(
      {
        league: 'theleague',
        kind: 'schedule-strength',
        postId: 'sf_dry_nowait',
        verifyPath: '/theleague/news/sf_dry_nowait',
        groupMeText: 'x',
        botEnv: 'GROUPME_SCHEFTER_BOT_ID',
        push: null,
        dryRun: true,
      },
      { dryRun: true, wait: async () => { waited = true; return { live: true, attempts: 1 }; }, log: silent },
    );
    expect(waited).toBe(false);
  });

  it('waits before it sends, and reports an unknown league instead of guessing', async () => {
    const { announceOne } = await import('../scripts/schefter-announce-pending.mjs');
    const order: string[] = [];
    // A LIVE entry: the dry-run path deliberately skips the wait, so it cannot
    // show the ordering. No bot id is set for this env name, so the send stops
    // at onMissingBotId without reaching the network.
    //
    // `kind` MUST BYPASS THE DAY CAP, and that is not a detail. This asserted
    // `schedule-strength`, which `groupme-day-plan.mjs` plans for Wednesday PT
    // only — and `announceOne` does not thread a `now`, so `isPlannedToday`
    // read the real clock. The send was held before it ever reached
    // `onMissingBotId`, so this passed on Wednesdays and failed the other six
    // days: red on `staging` CI most of the week, for a test about ORDERING
    // that never meant to involve the calendar at all. `roger-reply` is exempt
    // (`EXEMPT_KINDS`), so the ordering is now the only thing under test.
    await announceOne(
      {
        league: 'theleague',
        kind: 'roger-reply',
        postId: 'sf_order',
        verifyPath: '/theleague/news/sf_order',
        groupMeText: 'x',
        botEnv: 'GROUPME_BOT_ID_DELIBERATELY_UNSET',
        push: null,
      },
      {
        wait: async () => { order.push('wait'); return { live: true, attempts: 1 }; },
        log: {
          log: (m: string) => { if (String(m).includes('not set')) order.push('send'); },
          warn: () => {},
        },
      },
    );
    expect(order).toEqual(['wait', 'send']);

    const bad = await announceOne(
      { league: 'not-a-league', postId: 'x' },
      { dryRun: true, log: silent },
    );
    expect(bad.announced).toBe(false);
  });
  it('skipIfNotLive drops every channel when the page never went live', async () => {
    // The Pecking Order's link shows LAST week's column until the deploy
    // lands, so a timed-out wait must announce nothing — not chat, not push.
    const { announceOne } = await import('../scripts/schefter-announce-pending.mjs');
    const lines: string[] = [];
    const entry = {
      league: 'theleague',
      kind: 'roger-reply',
      postId: 'po_skip',
      verifyPath: '/theleague/pecking-order/2026/6',
      groupMeText: 'x',
      botEnv: 'GROUPME_BOT_ID_DELIBERATELY_UNSET',
      push: { franchiseIds: ['0001'], title: 'T', body: 'B', url: '/x', tag: 'po_skip' },
      skipIfNotLive: true,
    };
    const result = await announceOne(entry, {
      wait: async () => ({ live: false, attempts: 36 }),
      log: { log: (...a: unknown[]) => lines.push(a.join(' ')), warn: (...a: unknown[]) => lines.push(a.join(' ')) },
    });
    expect(result).toMatchObject({ announced: false, reason: 'not live' });
    expect(lines.join('\n')).toContain('NOT announcing');
    expect(lines.join('\n')).not.toContain('not set'); // never reached the chat send

    // Without the flag the default stays fail-open, as articles want.
    const order: string[] = [];
    await announceOne({ ...entry, push: null, skipIfNotLive: undefined }, {
      wait: async () => ({ live: false, attempts: 36 }),
      log: { log: (m: string) => { if (String(m).includes('not set')) order.push('send'); }, warn: () => {} },
    });
    expect(order).toEqual(['send']);
  });
});
