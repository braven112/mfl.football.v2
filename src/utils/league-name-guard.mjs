/**
 * No league ever publishes another league's name.
 *
 * TheLeague's registry name is "The League" — an ordinary English phrase. The
 * model reaches for it as one ("the league hits the wall"), title-cases it in
 * a headline, and on any other league's site it then reads as a DIFFERENT
 * league's name: the AFL's Week 5 Gauntlet shipped as "Week 5 Wall: The League
 * Hits the Gauntlet" to the AFL home page. The prompt already said "never name
 * any other league"; the model did not think it was naming one.
 *
 * So the rule is mechanical, and lives in ONE place:
 *  - `findForeignLeagueNames` says whether text names another league;
 *  - `scrubLeagueNames` rewrites every such name to this league's own;
 *  - the publish paths call these — the AI article lane regenerates once
 *    on a hit and then scrubs (the owner's call, Oct 2026: retry, then fix),
 *    and every other path (feed commit, GroupMe send, push) scrubs.
 *
 * Every name is read from the registry — a league's `name`, its share-card
 * name, its domains, and the run-together spelling of a "The X" name — so a
 * league added later is covered with no edit here. A league's SHORT name is
 * deliberately not a token: "Archie's" is also an ordinary possessive.
 */

import { LEAGUES } from '../config/leagues-data.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function ownTokens(league) {
  const reg = LEAGUES[league];
  if (!reg) return new Set();
  return new Set([reg.name, reg.shareCard?.name, ...(reg.domains ?? [])].filter(Boolean));
}

/** Every string that names some OTHER league, longest first. */
export function foreignLeagueNames(league) {
  if (!LEAGUES[league]) throw new Error(`Unknown league: ${league}`);
  const own = ownTokens(league);
  const names = new Set();
  for (const [slug, reg] of Object.entries(LEAGUES)) {
    if (slug === league || !reg?.name) continue;
    const tokens = [reg.name, reg.shareCard?.name, ...(reg.domains ?? [])];
    if (/^The\s+\S/.test(reg.name)) tokens.push(reg.name.replace(/\s+/g, ''));
    for (const t of tokens) if (t && !own.has(t)) names.add(t);
  }
  return [...names].sort((a, b) => b.length - a.length);
}

/**
 * How this league is called in running prose. An acronym carries its own
 * article ("the AFL"); every other name stands alone.
 */
export function ownLeagueLabel(league, { sentenceStart = false } = {}) {
  const name = LEAGUES[league]?.name;
  if (!name) throw new Error(`Unknown league: ${league}`);
  if (/^[A-Z0-9]{2,}$/.test(name)) return `${sentenceStart ? 'The' : 'the'} ${name}`;
  return name;
}

function ownDomainOrLabel(league) {
  return LEAGUES[league]?.domains?.[0] ?? ownLeagueLabel(league);
}

const cache = new Map();
function matcher(league) {
  if (!cache.has(league)) {
    const names = foreignLeagueNames(league);
    // An optional leading article is consumed with the name, so "the AFL"
    // never becomes "the The League"; the label supplies its own.
    cache.set(
      league,
      names.length
        ? new RegExp(`(?:\\b([Tt]he)\\s+)?(?<![\\w-])(${names.map(escapeRe).join('|')})(?![\\w-])`, 'g')
        : null,
    );
  }
  const re = cache.get(league);
  if (re) re.lastIndex = 0;
  return re;
}

/** The foreign league names `text` contains (empty when it is clean). */
export function findForeignLeagueNames(text, league) {
  if (typeof text !== 'string' || !text) return [];
  const re = matcher(league);
  if (!re) return [];
  return [...new Set([...text.matchAll(re)].map((m) => m[2]))];
}

// A block tag ends whatever sentence came before it; an inline one does not.
const BLOCK_TAG = /^<\/?(?:p|div|li|ul|ol|h[1-6]|br|blockquote|tr|td|th)\b/i;

/**
 * Rewrite every foreign league name in one string to this league's own.
 * Markup is left alone: only text between tags changes. Whether the name
 * opens a sentence is judged on the VISIBLE text, carried across inline tags,
 * so "in <strong>The League</strong>" stays mid-sentence.
 */
export function scrubLeagueNames(text, league) {
  if (typeof text !== 'string' || !text) return text;
  const re = matcher(league);
  if (!re) return text;
  let visible = '';
  return text
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (BLOCK_TAG.test(part)) visible = '';
        return part;
      }
      const out = part.replace(re, (_m, _article, name, offset, whole) => {
        if (name.includes('.')) return ownDomainOrLabel(league);
        const before = visible + whole.slice(0, offset);
        const sentenceStart = before.trim() === '' || /[.!?:—–-]\s*$/.test(before);
        return ownLeagueLabel(league, { sentenceStart });
      });
      visible += part;
      return out;
    })
    .join('');
}

/** A post's reader-facing strings, as [get, set] pairs, every shape a post can take. */
function postStrings(post) {
  const out = [];
  for (const key of ['headline', 'body', 'excerpt', 'linkLabel', 'title']) {
    if (typeof post[key] === 'string') out.push([key, () => post[key], (v) => { post[key] = v; }]);
  }
  // `content` is the flat shape; the grade-card types (draft-grades,
  // team-grades) put their prose in `intro` plus a headline/body per grade.
  for (const key of ['content', 'intro']) {
    if (!Array.isArray(post[key])) continue;
    post[key].forEach((p, i) => {
      if (typeof p === 'string') out.push([key, () => post[key][i], (v) => { post[key][i] = v; }]);
    });
  }
  if (Array.isArray(post.grades)) {
    post.grades.forEach((g) => {
      if (!g || typeof g !== 'object') return;
      for (const key of ['headline', 'body']) {
        if (typeof g[key] === 'string') out.push(['grades', () => g[key], (v) => { g[key] = v; }]);
      }
    });
  }
  return out;
}

/** The foreign league names anywhere in a post's reader-facing prose. */
export function findForeignLeagueNamesInPost(post, league) {
  if (!post || typeof post !== 'object') return [];
  const found = new Set();
  for (const [, get] of postStrings(post)) for (const n of findForeignLeagueNames(get(), league)) found.add(n);
  return [...found];
}

/**
 * Scrub a post's reader-facing prose in place. Returns the fields it changed,
 * so the caller can log them — a run that keeps scrubbing means the prompt is
 * losing to the model.
 */
export function scrubPostLeagueNames(post, league) {
  if (!post || typeof post !== 'object') return [];
  const changed = new Set();
  for (const [field, get, set] of postStrings(post)) {
    const before = get();
    const after = scrubLeagueNames(before, league);
    if (after !== before) {
      set(after);
      changed.add(field);
    }
  }
  return [...changed];
}

/**
 * Scrub a whole feed file's text for the league that owns it. Returns the
 * text unchanged (same string) when nothing needed fixing, so a caller can
 * skip the write and keep the file byte-identical.
 */
export function scrubFeedText(feedText, league) {
  const feed = JSON.parse(feedText);
  if (!Array.isArray(feed?.posts)) return { text: feedText, fixed: [] };
  const fixed = [];
  for (const post of feed.posts) {
    if (scrubPostLeagueNames(post, league).length) fixed.push(post.id);
  }
  return fixed.length ? { text: JSON.stringify(feed, null, 2) + '\n', fixed } : { text: feedText, fixed };
}

/** The league whose Schefter feed lives at `repoPath`, or null. */
export function leagueForFeedPath(repoPath) {
  for (const [slug, reg] of Object.entries(LEAGUES)) {
    if (reg?.schefterFeedPath && reg.schefterFeedPath === repoPath) return slug;
  }
  return null;
}

/**
 * The league a GroupMe bot id posts into, read from the registry's env-var
 * NAMES (`schefter.env.schefterBot` / `rogerBot`), or null when the id is no
 * league's bot. A sender can therefore guard its text without every caller
 * having to pass the league.
 */
export function leagueForGroupMeBot(botId, env = process.env) {
  if (!botId) return null;
  for (const [slug, reg] of Object.entries(LEAGUES)) {
    const names = reg?.schefter?.env;
    if (!names) continue;
    for (const key of ['schefterBot', 'rogerBot']) {
      const name = names[key];
      if (name && env[name] && env[name] === botId) return slug;
    }
  }
  return null;
}

/**
 * Scrub plain chat text, keeping mention offsets valid: each mention's span
 * is copied through untouched and only the text between mentions is
 * rewritten, so a `loci` start still points at the same name afterwards.
 *
 * @param {string} text
 * @param {string} league
 * @param {Array<object>} [attachments] GroupMe attachments; a `mentions` one is re-based.
 */
export function scrubChatText(text, league, attachments = []) {
  if (typeof text !== 'string' || !text || !league) return { text, attachments };
  const mention = (attachments ?? []).find((a) => a?.type === 'mentions' && Array.isArray(a.loci));
  if (!mention || mention.loci.length === 0) {
    return { text: scrubLeagueNames(text, league), attachments };
  }
  const order = mention.loci.map((l, i) => ({ start: l[0], length: l[1], i })).sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  const loci = mention.loci.map((l) => [...l]);
  for (const m of order) {
    out += scrubLeagueNames(text.slice(cursor, m.start), league);
    loci[m.i] = [out.length, m.length];
    out += text.slice(m.start, m.start + m.length);
    cursor = m.start + m.length;
  }
  out += scrubLeagueNames(text.slice(cursor), league);
  return {
    text: out,
    attachments: attachments.map((a) => (a === mention ? { ...a, loci } : a)),
  };
}
