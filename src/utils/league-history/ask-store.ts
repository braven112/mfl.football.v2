/**
 * Ask the History — saved answers, so every answer has a link an owner can
 * drop in the group chat.
 *
 *   history-ask:<league slug>:<id>   one SavedAnswer, kept a year
 *   history-ask:<league slug>:seen:<id>:<franchise>   one owner's open, counted once
 *   history-ask:<league slug>:asking:<week>   zset: topic → owners who asked or opened it that week
 *   history-ask:<league slug>:asking:<week>:<topic>   set: those owners, so each counts once
 *   history-ask:<league slug>:topic:<topic>   the latest answer on that topic
 *
 * A TOPIC is what an answer is about, so two owners wording one question
 * differently land on the same card of "The league is asking": the Record
 * Book board it cites, else the engine query it showed, else its question.
 * Keyed by registry slug because both leagues have a franchise 0001, and the
 * page reading an id checks it belongs to the league in the URL. The answer
 * is stored with its table, so a shared link shows what was computed when it
 * was asked even after more games are played.
 */
import { createHash, randomBytes } from 'node:crypto';
import { getRedis } from '../redis-client';
import type { AskHeadline, AskRecordLink, AskTable, AskTurn } from './ask';

export interface SavedAnswer {
  id: string;
  league: string;
  question: string;
  answer: string;
  table: AskTable | null;
  steps: string[];
  /** Missing on answers saved before it existed. */
  asOf?: string;
  /** Missing on answers saved before Record Book links existed. */
  records?: AskRecordLink[];
  /** Missing on answers saved before the answer card existed. */
  headline?: AskHeadline | null;
  followUps?: string[];
  /** The answer this one followed up on, and the turns before it (oldest first). */
  parent?: string | null;
  turns?: AskTurn[];
  askedBy: { franchiseId: string; name: string | null };
  /**
   * Asked by a signed-out visitor through the public demo (guest-ask.ts).
   * `askedBy.franchiseId` is then `guest:<visitor id>`. A guest answer never
   * counts toward "The league is asking", and its page is kept out of search.
   */
  guest?: boolean;
  createdAt: string;
}

const KEY = (league: string, id: string) => `history-ask:${league}:${id}`;
const SEEN = (league: string, id: string, franchiseId: string) => `history-ask:${league}:seen:${id}:${franchiseId}`;
const ASKING = (league: string, week: string) => `history-ask:${league}:asking:${week}`;
const ASKERS = (league: string, week: string, topic: string) => `history-ask:${league}:asking:${week}:${topic}`;
const TOPIC = (league: string, topic: string) => `history-ask:${league}:topic:${topic}`;
const TTL_SECONDS = 365 * 24 * 60 * 60;
const WEEK_TTL_SECONDS = 21 * 24 * 60 * 60;
/** Earlier turns a follow-up carries: one chat's worth (Brandon, 2026-11-26: 10, up from 4), each answer clipped in the prompt so it stays cheap. */
export const MAX_TURNS = 10;

export const isAnswerId = (id: string) => /^[A-Za-z0-9_-]{10}$/.test(id);

/** Save and return the answer's id, or null when Redis is unavailable. */
export async function saveAnswer(answer: Omit<SavedAnswer, 'id' | 'createdAt'>): Promise<SavedAnswer | null> {
  const redis = await getRedis();
  if (!redis) return null;
  const saved: SavedAnswer = { ...answer, id: randomBytes(8).toString('base64url').slice(0, 10), createdAt: new Date().toISOString() };
  await redis.set(KEY(saved.league, saved.id), saved, { ex: TTL_SECONDS });
  return saved;
}

/**
 * The turns a follow-up to `parent` carries: the parent's own turns plus the
 * parent itself, newest MAX_TURNS.
 */
export function turnsAfter(parent: SavedAnswer): AskTurn[] {
  return [...(parent.turns ?? []), { question: parent.question, answer: parent.answer, steps: parent.steps ?? [] }].slice(-MAX_TURNS);
}

/**
 * The answers a saved answer followed up on, oldest first, read back through
 * its `parent` links, so a shared link or a reopened chat shows the whole
 * conversation, every chart included, instead of only the last follow-up
 * (Brandon, 2026-11-26). At most MAX_TURNS; a link that has expired or left
 * the league ends the walk, and the caller falls back to `saved.turns` (text
 * only) for anything older.
 */
export async function loadConversation(saved: SavedAnswer): Promise<SavedAnswer[]> {
  const chain: SavedAnswer[] = [];
  const seen = new Set<string>([saved.id]);
  let next = saved.parent ?? null;
  while (next && chain.length < MAX_TURNS && !seen.has(next)) {
    seen.add(next);
    const parent = await readAnswer(saved.league, next).catch(() => null);
    // A guest's chat never continues an owner's answer (the API enforces it); never show one in it either.
    if (!parent || Boolean(parent.guest) !== Boolean(saved.guest)) break;
    chain.unshift(parent);
    next = parent.parent ?? null;
  }
  return chain;
}

/**
 * One conversation's turns as the page draws them: every earlier answer it
 * could read back in full, and the older ones it could not as text only.
 */
export type ConversationTurn = { full: SavedAnswer } | { text: AskTurn };

export function conversationTurns(saved: SavedAnswer, chain: SavedAnswer[]): ConversationTurn[] {
  const earlier = saved.turns ?? [];
  // `turns` is the newest MAX_TURNS before `saved`; the chain covers the newest `chain.length` of them.
  const textOnly = earlier.slice(0, Math.max(0, earlier.length - chain.length));
  return [...textOnly.map((text) => ({ text })), ...chain.map((full) => ({ full }))];
}

/** What an answer is about (see the header): one key per Record Book board or query. */
export function topicOf(saved: Pick<SavedAnswer, 'records' | 'table' | 'question'>): string {
  const basis = saved.records?.[0]?.query
    ? `rb ${saved.records[0].query}`
    : saved.table?.description
      ? `q ${saved.table.description}`
      : `t ${saved.question.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()}`;
  return createHash('sha1').update(basis).digest('base64url').slice(0, 12);
}

/** Monday of the Pacific week `at` falls in, as YYYY-MM-DD: the "this week" bucket. */
export function askingWeek(at: Date = new Date()): string {
  const pt = new Date(at.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  pt.setDate(pt.getDate() - ((pt.getDay() + 6) % 7));
  return `${pt.getFullYear()}-${String(pt.getMonth() + 1).padStart(2, '0')}-${String(pt.getDate()).padStart(2, '0')}`;
}

/**
 * One owner showing interest in an answer's topic this week, by asking it or
 * opening someone's link to it. Each owner counts once per topic per week, so
 * one owner asking ten times cannot top the list.
 */
async function noteInterest(saved: SavedAnswer, franchiseId: string, asked: boolean): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  const topic = topicOf(saved);
  const week = askingWeek();
  if (asked) await redis.set(TOPIC(saved.league, topic), saved.id, { ex: WEEK_TTL_SECONDS });
  const added = await redis.sadd(ASKERS(saved.league, week, topic), franchiseId);
  await redis.expire(ASKERS(saved.league, week, topic), WEEK_TTL_SECONDS);
  if (added) {
    await redis.zincrby(ASKING(saved.league, week), 1, topic);
    await redis.expire(ASKING(saved.league, week), WEEK_TTL_SECONDS);
  }
}

/** Count a fresh answer toward "The league is asking". */
export async function recordAsk(saved: SavedAnswer): Promise<void> {
  if (saved.guest) return;
  await noteInterest(saved, saved.askedBy.franchiseId, true);
}

export async function readAnswer(league: string, id: string): Promise<SavedAnswer | null> {
  if (!isAnswerId(id)) return null;
  const redis = await getRedis();
  if (!redis) return null;
  const saved = (await redis.get<SavedAnswer>(KEY(league, id))) ?? null;
  return saved && saved.league === league ? saved : null;
}

/**
 * Count one owner opening a shared answer toward "The league is asking". Only a signed-in owner of the league counts, once per
 * answer, and never the owner who asked it: an anonymous visitor cannot be
 * told apart from a refresh (client-ip.ts: the per-caller header is
 * spoofable), and the list is meant to show what the league passed around.
 */
export async function countAnswerOpen(saved: SavedAnswer, franchiseId: string | null): Promise<void> {
  if (saved.guest || !franchiseId || franchiseId === saved.askedBy.franchiseId) return;
  const redis = await getRedis();
  if (!redis) return;
  const first = await redis.set(SEEN(saved.league, saved.id, franchiseId), 1, { ex: TTL_SECONDS, nx: true });
  if (!first) return;
  await noteInterest(saved, franchiseId, false);
}

export interface AskingTopic {
  /** The latest answer on the topic. */
  answer: SavedAnswer;
  /** Owners who asked or opened it in the week. */
  owners: number;
}

/**
 * "The league is asking": this week's topics, most owners first, each shown
 * through its latest answer. Early in a quiet week it falls back to last week,
 * and says so (`week`).
 */
export async function leagueIsAsking(league: string, limit = 4, at: Date = new Date()): Promise<{ week: 'this' | 'last'; topics: AskingTopic[] }> {
  const redis = await getRedis();
  if (!redis) return { week: 'this', topics: [] };
  const lastWeek = new Date(at.getTime() - 7 * 24 * 60 * 60 * 1000);
  for (const [label, week] of [['this', askingWeek(at)], ['last', askingWeek(lastWeek)]] as const) {
    const ranked = (await redis.zrange<string | number>(ASKING(league, week), 0, limit * 2 - 1, { rev: true, withScores: true })) ?? [];
    const pairs: Array<{ topic: string; owners: number }> = [];
    for (let i = 0; i + 1 < ranked.length; i += 2) pairs.push({ topic: String(ranked[i]), owners: Number(ranked[i + 1]) });
    if (!pairs.length) continue;
    const ids = await redis.mget<string>(...pairs.map((p) => TOPIC(league, p.topic)));
    const live = pairs.map((p, i) => ({ ...p, id: ids[i] })).filter((p) => p.id && isAnswerId(String(p.id)));
    if (!live.length) continue;
    const saved = await redis.mget<SavedAnswer>(...live.map((p) => KEY(league, String(p.id))));
    const topics = live
      .map((p, i) => ({ answer: saved[i] as SavedAnswer, owners: p.owners }))
      .filter((t) => t.answer && t.answer.league === league && t.owners > 0)
      .slice(0, limit);
    if (topics.length) return { week: label, topics };
  }
  return { week: 'this', topics: [] };
}
