/**
 * The Schefter feed lives in Redis; git holds a daily snapshot
 * (scripts/lib/schefter-feed-store.mjs). Two things every workflow that hands
 * a feed to commit-feed-and-push must do, or the move quietly breaks:
 *
 *  - pull the live feed from Redis BEFORE its scripts run. Without it the job
 *    writes on top of a snapshot up to a day old: nothing is lost (the merge
 *    unions posts), but its dedup watermarks are a day stale, so it re-posts
 *    what it already announced.
 *  - give the commit step the Redis credentials. Without them the feed falls
 *    back to a git commit — a production build per write, the cost this whole
 *    move exists to remove — and nothing goes red.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { feedLeagues } from '../scripts/lib/schefter-feed-store.mjs';

const WF_DIR = path.join(__dirname, '..', '.github', 'workflows');
const feedPaths = feedLeagues().map((l) => l.feedPath);

type Step = { name?: string; run?: string; env?: Record<string, string> };

// A step's --files list names a feed literally or builds it: from the
// registry's `{schefterFeedPath}` (schefter-articles), from the derived
// chain's output list (which includes every feed), or from the snapshot list.
const BUILT_FEED_LISTS = ['{schefterFeedPath}', 'recompute-derived-chain.mjs --print-outputs', 'schefter-feed-sync.mjs paths'];
const commitsAFeed = (run: string) =>
  /commit-feed-and-push\.mjs/.test(run) &&
  [...feedPaths, ...BUILT_FEED_LISTS].some((p) => run.includes(p));

const workflows = fs
  .readdirSync(WF_DIR)
  .filter((f) => /\.ya?ml$/.test(f))
  .map((f) => {
    const doc = parseYaml(fs.readFileSync(path.join(WF_DIR, f), 'utf8')) as {
      jobs?: Record<string, { steps?: Step[] }>;
    };
    return { file: f, jobs: Object.entries(doc?.jobs ?? {}) };
  });

const feedJobs = workflows.flatMap(({ file, jobs }) =>
  jobs
    .filter(([, job]) => (job.steps ?? []).some((s) => commitsAFeed(s.run ?? '')))
    .map(([name, job]) => ({ id: `${file}#${name}`, steps: job.steps ?? [] })),
);

describe('workflows that publish a Schefter feed', () => {
  it('finds the feed writers (a scan that finds none is testing nothing)', () => {
    expect(feedJobs.map((j) => j.id)).toEqual(expect.arrayContaining(['schefter-scan.yml#scan']));
    expect(feedJobs.length).toBeGreaterThanOrEqual(10);
  });

  it.each(feedJobs)('$id pulls the live feed before anything writes it', ({ steps }) => {
    const pull = steps.findIndex((s) => /schefter-feed-sync\.mjs pull/.test(s.run ?? ''));
    const firstCommit = steps.findIndex((s) => commitsAFeed(s.run ?? ''));
    expect(pull, 'no `node scripts/schefter-feed-sync.mjs pull` step').toBeGreaterThan(-1);
    // Right after checkout: every step between could be a feed writer.
    const checkout = steps.findIndex((s) => /actions\/checkout/.test((s as { uses?: string }).uses ?? ''));
    expect(pull).toBe(checkout + 1);
    expect(pull).toBeLessThan(firstCommit);
  });

  it.each(feedJobs)('$id gives every feed commit and the pull Redis credentials', ({ steps }) => {
    for (const s of steps.filter((st) => commitsAFeed(st.run ?? '') || /schefter-feed-sync\.mjs pull/.test(st.run ?? ''))) {
      expect(Object.keys(s.env ?? {}), s.name).toEqual(
        expect.arrayContaining(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']),
      );
    }
  });

  it('exactly one job takes the daily snapshot', () => {
    const snapshots = workflows.flatMap(({ file, jobs }) =>
      jobs.flatMap(([name, job]) =>
        (job.steps ?? []).filter((s) => /--snapshot\b/.test(s.run ?? '')).map(() => `${file}#${name}`),
      ),
    );
    expect(snapshots).toEqual(['schefter-scan.yml#scan']);
  });
});
