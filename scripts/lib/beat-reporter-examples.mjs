/**
 * Max Insider's example bank — short sample deliveries in each of his style
 * lanes (src/utils/persona.mjs, BEAT_REPORTER_PERSONA).
 *
 * Why examples and not more adjectives: a model copies a demonstrated shape far
 * more reliably than a described one, and drawing a FEW at random for each
 * prompt is what keeps a feed from reading like a template (Brandon, Nov 2026:
 * "the goal is to have multiple ways of saying the same things").
 *
 * The bank itself is voice material, so it lives in the PRIVATE beat-reporter
 * repo at voice/beat-examples.json (scripts/lib/beat-reporter-pack.mjs). Its
 * content rules (placeholders only, never a real reporter's line) are pinned
 * by that repo's own tests. Without the pack every lane is empty and
 * `beatExamplesBlock` emits nothing: the post is written without examples,
 * which is the pre-bank behavior, never a broken prompt.
 */

import { readPackJson } from './beat-reporter-pack.mjs';

/** @typedef {'scoop' | 'numbers' | 'insider' | 'measured' | 'notebook' | 'hot-take'} BeatLane */

/** Every lane, in a stable order. */
export const BEAT_LANES = /** @type {readonly BeatLane[]} */ (
  Object.freeze(['scoop', 'numbers', 'insider', 'measured', 'notebook', 'hot-take'])
);

/**
 * The bank, from the private pack. A lane the pack omits, or any entry that
 * is not a non-empty string, is dropped rather than trusted.
 *
 * @returns {Readonly<Record<BeatLane, readonly string[]>>}
 */
export function loadBeatExamples() {
  const raw = /** @type {Record<string, unknown> | null} */ (readPackJson('voice/beat-examples.json'));
  /** @type {Record<string, readonly string[]>} */
  const bank = {};
  for (const lane of BEAT_LANES) {
    const list = raw && Array.isArray(raw[lane]) ? raw[lane] : [];
    bank[lane] = Object.freeze(list.filter((e) => typeof e === 'string' && e.trim()));
  }
  return /** @type {Readonly<Record<BeatLane, readonly string[]>>} */ (Object.freeze(bank));
}

/**
 * Draw `count` examples from the bank. Lanes named in `lanes` are drawn first
 * (the news decides the style); the rest of the draw comes from any lane so
 * the post still has range. No example repeats within one draw.
 *
 * @param {{ lanes?: readonly BeatLane[], count?: number, random?: () => number, bank?: Readonly<Record<string, readonly string[]>> }} [opts]
 * @returns {string[]}
 */
export function pickBeatExamples({ lanes = [], count = 3, random = Math.random, bank = loadBeatExamples() } = {}) {
  const preferred = lanes.flatMap((lane) => bank[lane] ?? []);
  const rest = BEAT_LANES.filter((lane) => !lanes.includes(lane)).flatMap((lane) => bank[lane] ?? []);
  const draw = (/** @type {string[]} */ pool, /** @type {number} */ n) => {
    const copy = [...pool];
    const out = [];
    while (copy.length && out.length < n) out.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
    return out;
  };
  const first = draw(preferred, Math.min(count, preferred.length ? Math.max(1, count - 1) : 0));
  return [...first, ...draw(rest, count - first.length)];
}

/**
 * The prompt block that carries the drawn examples. Fenced as rhythm only:
 * a placeholder must never turn into a name, and nothing in an example is a
 * fact about this league.
 *
 * @param {string[]} examples
 */
export function beatExamplesBlock(examples) {
  if (!examples.length) return '';
  return `EXAMPLES OF YOUR DELIVERY (rhythm and attitude only: the bracketed words are placeholders, nothing here is a fact about this league, and you never copy a line. Write something new in a similar spirit):
${examples.map((e) => `* ${e.replace(/\n/g, '\n  ')}`).join('\n')}

`;
}

/**
 * Which lanes a news item draws its examples from — the news picks the style
 * (Brandon, Nov 2026), so an injury never gets the hot-take treatment and a
 * trade leads with its terms.
 *
 * @param {string} kind  An MFL transaction type, or an article type id.
 * @returns {BeatLane[]}
 */
export function lanesForNews(kind) {
  switch (kind) {
    case 'IR':
      return ['measured'];
    case 'TRADE':
      return ['numbers', 'scoop'];
    case 'BBID_WAIVER':
    case 'WAIVER':
      return ['scoop', 'insider'];
    case 'FREE_AGENT':
      return ['scoop'];
    case 'roster-list':
      return ['notebook'];
    case 'schedule-strength':
      return ['numbers', 'notebook'];
    case 'matchup-preview':
      return ['insider', 'notebook'];
    case 'pecking-order':
      return ['hot-take', 'numbers'];
    case 'cut-watch':
      return ['measured', 'numbers'];
    case 'waiver-pickups':
      return ['notebook', 'scoop'];
    default:
      return [];
  }
}

/**
 * How the persona's own most recent posts opened — the first few words of
 * each body, newest first, with every team name masked so the memory cannot
 * put a name in front of the model that the current payload did not
 * (docs/claude/rules/schefter.md, the 2026-09-07 leak).
 *
 * @param {Array<Record<string, any>>} posts  The league's feed posts.
 * @param {Iterable<string>} teamNames
 * @param {{ limit?: number, words?: number }} [opts]
 * @returns {string[]}
 */
export function recentPersonaOpeners(posts, teamNames, { limit = 6, words = 5 } = {}) {
  const names = [...teamNames].filter(Boolean).sort((a, b) => b.length - a.length);
  const mask = (/** @type {string} */ text) =>
    names.reduce((t, n) => t.split(n).join('[TEAM]'), text);
  const at = (/** @type {Record<string, any>} */ p) => {
    const t = Date.parse(p?.timestamp ?? '');
    return Number.isFinite(t) ? t : -Infinity;
  };
  return (Array.isArray(posts) ? [...posts] : [])
    .filter((p) => (!p.authorId || p.authorId === 'claude') && typeof p.body === 'string' && p.body.trim())
    .sort((a, b) => at(b) - at(a))
    .slice(0, limit)
    .map((p) => mask(p.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).split(' ').slice(0, words).join(' '));
}

/**
 * The persona's own recent columns, as links it may call back to ("As I
 * reported last week…"). Only real feed posts with a stored internal link are
 * offered, so the href is one the article-link sanitizer will accept as-is.
 *
 * @param {Array<Record<string, any>>} posts  The league's feed posts.
 * @param {{ now?: Date, days?: number, limit?: number, excludeId?: string }} [opts]
 * @returns {Array<{ href: string, label: string, callback: true, primary: false, promo: false, publishedAt: string }>}
 */
export function callbackLinks(posts, { now = new Date(), days = 21, limit = 3, excludeId } = {}) {
  const since = now.getTime() - days * 86_400_000;
  return (Array.isArray(posts) ? posts : [])
    .filter((p) => p?.type === 'article' && (!p.authorId || p.authorId === 'claude'))
    .filter((p) => typeof p.link === 'string' && p.link.startsWith('/') && p.id !== excludeId)
    .filter((p) => {
      const t = Date.parse(p.timestamp ?? '');
      return Number.isFinite(t) && t >= since && t <= now.getTime();
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit)
    .map((p) => ({
      href: p.link,
      label: String(p.headline ?? 'my last column'),
      callback: /** @type {const} */ (true),
      primary: /** @type {const} */ (false),
      promo: /** @type {const} */ (false),
      publishedAt: String(p.timestamp).slice(0, 10),
    }));
}
