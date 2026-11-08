/**
 * League story intake — the answers a new custom-site league sends from
 * /league-story (questions: src/data/league-story-questions.ts).
 *
 * One Redis list, newest first, read on /live/league-stories (the one-viewer
 * site-insights gate). A submission keeps the league's name, who sent it, an
 * email to follow up on (onboarding needs a reply: the follow-up questions and
 * the files), the answers keyed by question id, and anything they pasted from
 * their own AI. Nothing else: no IP, no session.
 *
 * Bounded so a bot cannot fill Redis: per caller and site-wide per day (the
 * endpoint), a size cap on every field, and a hard ceiling on the list.
 * SERVER ONLY.
 */
import { STORY_QUESTION_IDS } from '../../data/league-story-questions';
import { getRedis } from '../redis-client';

export const STORIES_KEY = 'league-story:submissions';
/** One answer box. A long owners list fits; a novel does not. */
export const MAX_ANSWER_CHARS = 4000;
/** The paste box, for a whole questionnaire answered by the owner's own AI. */
export const MAX_PASTED_CHARS = 40_000;
export const MAX_SHORT_CHARS = 120;
/** The list stops taking submissions past this many. */
export const MAX_STORIES = 2000;

export interface LeagueStorySubmission {
  league: string;
  name: string | null;
  email: string;
  platform: string | null;
  answers: Record<string, string>;
  pasted: string | null;
  /** The invite it came in on (src/utils/league-story/invites.ts). */
  invite: string | null;
  at: string;
}

const KNOWN_IDS = new Set(STORY_QUESTION_IDS);

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/**
 * The submission as we'd keep it, or null when there's nothing worth keeping.
 * `email` must already be normalized by the caller. A submission needs the
 * league's name and at least one answer or a paste; unknown question ids are
 * dropped, so a caller cannot grow the record with keys of its own.
 */
export function cleanSubmission(
  input: { league?: unknown; name?: unknown; platform?: unknown; answers?: unknown; pasted?: unknown },
  email: string,
  now = new Date(),
  invite: string | null = null,
): LeagueStorySubmission | null {
  const league = cleanText(input.league, MAX_SHORT_CHARS);
  if (league.length < 2) return null;
  const answers: Record<string, string> = {};
  if (input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers)) {
    for (const [id, value] of Object.entries(input.answers as Record<string, unknown>)) {
      if (!KNOWN_IDS.has(id)) continue;
      const text = cleanText(value, MAX_ANSWER_CHARS);
      if (text) answers[id] = text;
    }
  }
  const pasted = cleanText(input.pasted, MAX_PASTED_CHARS) || null;
  if (Object.keys(answers).length === 0 && !pasted) return null;
  return {
    league,
    name: cleanText(input.name, MAX_SHORT_CHARS) || null,
    email,
    platform: cleanText(input.platform, MAX_SHORT_CHARS) || null,
    answers,
    pasted,
    invite,
    at: now.toISOString(),
  };
}

/** Keep one submission. False when storage is down or the list is full. */
export async function saveSubmission(s: LeagueStorySubmission): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return false;
  if ((await redis.llen(STORIES_KEY)) >= MAX_STORIES) return false;
  await redis.lpush(STORIES_KEY, JSON.stringify(s));
  return true;
}

/** The newest submissions first, or null when storage is down. */
export async function listSubmissions(limit = MAX_STORIES): Promise<LeagueStorySubmission[] | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const rows = await redis.lrange<unknown>(STORIES_KEY, 0, limit - 1);
  return rows.flatMap((r) => {
    try {
      const v = (typeof r === 'string' ? JSON.parse(r) : r) as LeagueStorySubmission;
      return v && typeof v.league === 'string' && v.answers && typeof v.answers === 'object' ? [v] : [];
    } catch {
      return [];
    }
  });
}
