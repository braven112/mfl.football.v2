/**
 * Ask the History's sample answers for the /ask-the-history product page
 * (Brandon, 2026-11-16: "Both", a live ask box with real answers already
 * showing, so the page never looks empty).
 *
 * The samples are REAL answers: the same engine and the same masked guest
 * dataset a signed-out visitor asks (guest-mask.ts), so owner names never
 * appear. They are computed once and cached in Redis for a week, which keeps
 * the model cost to a handful of questions a week no matter how many people
 * open the page. A lock stops a burst of first visitors from each paying for
 * the same three answers.
 *
 * Fails soft: with no Redis or no masker the page shows the live box alone.
 */
import { getLeagueBySlug } from '../../config/leagues';
import { getRedis } from '../redis-client';
import { aiModelForLeague } from '../ai-plan.mjs';
import { recordAiUsage } from '../ai-usage';
import { askHistory, type AskHeadline, type AskRecordLink, type AskTable } from './ask';
import { loadLeagueCompetitions, loadLeagueHistoryDataset } from './datasets';
import { canGuestAsk } from './guest-ask';
import { guestMasker, maskAskData, maskValue } from './guest-mask';

/** Asked in this order; none says "my", which means nothing to a stranger. */
export const DEMO_QUESTIONS = [
  'Who has the most championships?',
  'Which team started 9-1 with the fewest points?',
  'Who won the most lopsided trade?',
] as const;

export interface DemoSample {
  question: string;
  answer: string;
  headline: AskHeadline | null;
  table: AskTable | null;
  records?: AskRecordLink[];
  asOf?: string;
}

const VERSION = 'v1';
const TTL_S = 7 * 24 * 3600;
const LOCK_S = 120;
const key = (slug: string) => `history-demo:samples:${VERSION}:${slug}`;
const lockKey = (slug: string) => `history-demo:samples-lock:${VERSION}:${slug}`;

export type DemoSamplesResult = { samples: DemoSample[] } | { pending: true } | { unavailable: true };

/** The cached samples, building them once if none are cached and no one else is. */
export async function demoSamples(slug: string): Promise<DemoSamplesResult> {
  const league = getLeagueBySlug(slug);
  if (!league || !canGuestAsk(slug)) return { unavailable: true };
  const redis = await getRedis();
  if (!redis) return { unavailable: true };

  const cached = await redis.get<DemoSample[]>(key(slug)).catch(() => null);
  if (Array.isArray(cached) && cached.length) return { samples: cached };

  const claimed = await redis.set(lockKey(slug), 1, { ex: LOCK_S, nx: true }).catch(() => null);
  if (claimed === null) return { pending: true };

  try {
    const mask = await guestMasker(slug)?.catch(() => null);
    if (!mask) return { unavailable: true };
    const [loaded, competitions] = await Promise.all([
      loadLeagueHistoryDataset(league.dataPath),
      loadLeagueCompetitions(league.dataPath, league.configPath),
    ]);
    if (!loaded) return { unavailable: true };
    const ds = maskAskData({ ...loaded, competitions }, mask);
    const settled = await Promise.allSettled(
      DEMO_QUESTIONS.map(async (question): Promise<DemoSample> => {
        const r = maskValue(
          await askHistory(slug, ds, question, {
            turns: [],
            asker: null,
            model: aiModelForLeague(slug, { guest: true }),
            onUsage: (u) => void recordAiUsage(`${slug}-guest`, u).catch(() => {}),
          }),
          mask,
        );
        return { question, answer: r.answer, headline: r.headline ?? null, table: r.table ?? null, records: r.records, asOf: r.asOf };
      }),
    );
    const samples = settled.flatMap((s) => (s.status === 'fulfilled' && s.value.answer ? [s.value] : []));
    if (!samples.length) return { unavailable: true };
    // A partial set is shown but cached briefly, so a failed question is retried soon.
    await redis.set(key(slug), samples, { ex: samples.length === DEMO_QUESTIONS.length ? TTL_S : 3600 }).catch(() => null);
    return { samples };
  } catch (e) {
    console.error('[league-history/demo-samples] build failed:', e);
    return { unavailable: true };
  } finally {
    await redis.del(lockKey(slug)).catch(() => null);
  }
}
