/**
 * Ask the History for visitors who are not signed in: the public demo on
 * TheLeague (Brandon, 2026-11-07). A visitor from mfl.football gets to ask a
 * real league's history a few questions, so they can feel the product before
 * buying it for their own league.
 *
 *   - 3 questions a day free; leaving an email unlocks 3 more (6 a day).
 *     A follow-up is a question like any other.
 *   - Counted per visitor (a random id in an HttpOnly cookie) AND per network
 *     address (`nearestHop`, which a caller cannot forge; see client-ip.ts),
 *     so clearing cookies does not reset the count. The address ceiling is
 *     looser than the visitor one because a household or office shares it.
 *   - A site-wide daily ceiling on guest questions, the real protection
 *     against a bot: every question spends model tokens (~3-6c).
 *   - FAILS CLOSED. The owners' limiter fails open (rate-limit.ts) because an
 *     owner is signed in; a guest is anonymous, so with no Redis there is no
 *     guest asking.
 *
 * Owner names never reach a guest: the dataset is masked before the model
 * sees it (guest-mask.ts), and the answer is masked again on the way out.
 *
 *   history-guest:<league>:<day>:v:<visitor>   questions that visitor asked that day
 *   history-guest:<league>:<day>:h:<hop>       questions from that address that day
 *   history-guest:<league>:<day>:all           every guest question that day
 *   history-guest:email:<visitor>              set once the visitor left an email (a year)
 *
 * <day> is the Pacific date, the league's own clock.
 */
import { randomBytes } from 'node:crypto';
import { getRedis } from '../redis-client';
import { getClientIdentity } from '../client-ip';
import { GUEST_MASKED_LEAGUES } from './guest-names.mjs';

/** Leagues a signed-out visitor may ask. Their owner names are always masked. */
export const GUEST_ASK_LEAGUES: readonly string[] = GUEST_MASKED_LEAGUES;

export const GUEST_FREE_QUESTIONS = 3;
export const GUEST_EMAIL_QUESTIONS = 3;
/** One network address: a few visitors' worth, so a shared connection still works. */
export const GUEST_PER_ADDRESS = 24;
/** Every guest together, per league per day. ~$9-18 on the worst day. */
export const GUEST_DAILY_CEILING = 300;

export const GUEST_COOKIE = 'history_guest';
const COOKIE_MAX_AGE = 365 * 24 * 3600;
const DAY_TTL = 2 * 24 * 3600;
const EMAIL_TTL = 365 * 24 * 3600;

export const canGuestAsk = (slug: string) => GUEST_ASK_LEAGUES.includes(slug);
export const isGuestId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id);
export const newGuestId = () => randomBytes(16).toString('base64url');

/** The Pacific date `at` falls on, YYYY-MM-DD. */
export function guestDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** The visitor id from the request's cookie, or null. */
export function guestIdFrom(request: Request): string | null {
  const raw = request.headers.get('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${GUEST_COOKIE}=([^;]+)`).exec(raw);
  return m && isGuestId(m[1]) ? m[1] : null;
}

export function guestCookie(id: string, secure: boolean): string {
  return `${GUEST_COOKIE}=${id}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export interface GuestAllowance {
  /** Questions asked today. */
  used: number;
  /** Today's limit: 3, or 6 with an email. */
  limit: number;
  hasEmail: boolean;
}

const vKey = (league: string, day: string, id: string) => `history-guest:${league}:${day}:v:${id}`;
const hKey = (league: string, day: string, hop: string) => `history-guest:${league}:${day}:h:${hop}`;
const allKey = (league: string, day: string) => `history-guest:${league}:${day}:all`;
const emailKey = (id: string) => `history-guest:email:${id}`;

export const limitFor = (hasEmail: boolean) => GUEST_FREE_QUESTIONS + (hasEmail ? GUEST_EMAIL_QUESTIONS : 0);

/** Where a visitor stands today, without spending anything. Null when storage is down. */
export async function guestAllowance(league: string, id: string | null, now = new Date()): Promise<GuestAllowance | null> {
  const redis = await getRedis().catch(() => null);
  if (!redis) return null;
  if (!id) return { used: 0, limit: GUEST_FREE_QUESTIONS, hasEmail: false };
  const [used, email] = await Promise.all([redis.get<number>(vKey(league, guestDay(now), id)), redis.get(emailKey(id))]);
  const hasEmail = Boolean(email);
  return { used: Number(used) || 0, limit: limitFor(hasEmail), hasEmail };
}

export type GuestSpend =
  | { ok: true; allowance: GuestAllowance; refund: () => Promise<void> }
  | { ok: false; reason: 'unavailable' | 'need-email' | 'out' | 'address' | 'busy'; allowance: GuestAllowance | null };

/**
 * Take one question from the visitor, their address and the day's ceiling,
 * all or nothing. `refund` gives it back when the answer could not be worked
 * out, so a failure never costs the visitor a question.
 */
export async function spendGuestQuestion(league: string, id: string, request: Request, now = new Date()): Promise<GuestSpend> {
  const redis = await getRedis().catch(() => null);
  if (!redis) return { ok: false, reason: 'unavailable', allowance: null };
  const day = guestDay(now);
  const hop = getClientIdentity(request).nearestHop ?? 'unknown';
  const hasEmail = Boolean(await redis.get(emailKey(id)));
  const limit = limitFor(hasEmail);

  const taken: string[] = [];
  const take = async (key: string, max: number) => {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, DAY_TTL);
    taken.push(key);
    return n <= max ? n : null;
  };
  const giveBack = async () => {
    await Promise.all(taken.map((k) => redis.decr(k))).catch(() => {});
  };

  const used = await take(vKey(league, day, id), limit);
  if (used === null) {
    await giveBack();
    return { ok: false, reason: hasEmail ? 'out' : 'need-email', allowance: { used: limit, limit, hasEmail } };
  }
  const allowance = { used, limit, hasEmail };
  if ((await take(hKey(league, day, hop), GUEST_PER_ADDRESS)) === null) {
    await giveBack();
    return { ok: false, reason: 'address', allowance: { ...allowance, used: used - 1 } };
  }
  if ((await take(allKey(league, day), GUEST_DAILY_CEILING)) === null) {
    await giveBack();
    return { ok: false, reason: 'busy', allowance: { ...allowance, used: used - 1 } };
  }
  return { ok: true, allowance, refund: giveBack };
}

/** The visitor left an email: today's limit, and every day's after, is 6. */
export async function unlockWithEmail(id: string): Promise<boolean> {
  const redis = await getRedis().catch(() => null);
  if (!redis) return false;
  await redis.set(emailKey(id), 1, { ex: EMAIL_TTL });
  return true;
}

/** What a guest is told when a question is refused. */
export const GUEST_REFUSALS: Record<Exclude<GuestSpend, { ok: true }>['reason'], string> = {
  unavailable: 'Asking is resting for a minute. Try again shortly.',
  'need-email': `That's your ${GUEST_FREE_QUESTIONS} free questions for today. Leave your email for ${GUEST_EMAIL_QUESTIONS} more.`,
  out: 'That’s all your questions for today. Come back tomorrow for more.',
  address: 'Lots of questions from your network today. Come back tomorrow for more.',
  busy: 'Everyone’s been asking today, so the free questions are used up. Come back tomorrow.',
};

/**
 * A guest's question text is shown on its answer page, so a stranger must not
 * be able to post slurs or worse under the league's name. A short word list,
 * matched on whole words after folding common letter swaps; it errs toward
 * refusing, and a refused visitor just asks it another way.
 */
const BLOCKED = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard',
  'whore', 'slut', 'fag', 'faggot', 'dyke', 'tranny', 'retard', 'retarded', 'nigger', 'nigga', 'chink', 'spic', 'kike',
  'wetback', 'gook', 'raghead', 'coon', 'porn', 'rape', 'rapist', 'nazi', 'hitler', 'kill yourself', 'kys',
];
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[@4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ');
const BLOCKED_RE = new RegExp(`(?:^| )(?:${BLOCKED.map((w) => w.replace(/ /g, ' ?')).join('|')})s?(?= |$)`);

export function isCleanQuestion(question: string): boolean {
  const folded = fold(question).trim();
  // "f u c k" → "fuck": letters spaced out one at a time are read as one word.
  const joined = folded.replace(/\b([a-z]) (?=[a-z]\b)/g, '$1');
  return !BLOCKED_RE.test(folded) && !BLOCKED_RE.test(joined);
}
