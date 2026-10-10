/**
 * Another league's name, written by accident, rewritten to this league's own.
 *
 * TheLeague's registry name is "The League" — an ordinary English phrase. The
 * model reaches for it as one ("the league hits the wall"), title-cases it in
 * a headline, and on any other league's site it then reads as a DIFFERENT
 * league's name: the AFL's Week 5 Gauntlet shipped as "Week 5 Wall: The League
 * Hits the Gauntlet" to the AFL home page. The prompt already says "never
 * name any other league" (ai-client.mjs buildCachedSystem); the model did not
 * think it was naming one, so this is the mechanical half.
 *
 * Only names shaped "The X" are scrubbed. Those are the ones that collide with
 * prose; a name like "AFL" or "Best Ball #1" is never written by accident,
 * and rewriting it would mangle a legitimate mention (the Arena Football
 * League, say). Everything is read from the registry, so a league added later
 * is covered with no edit here.
 */

import { LEAGUES } from '../../src/config/leagues-data.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every other league's article-shaped name, plus its run-together spelling. */
export function foreignNames(league) {
  const own = LEAGUES[league]?.name;
  const names = new Set();
  for (const [slug, reg] of Object.entries(LEAGUES)) {
    if (slug === league || !reg?.name || reg.name === own) continue;
    if (!/^The\s+\S/.test(reg.name)) continue;
    names.add(reg.name);
    names.add(reg.name.replace(/\s+/g, ''));
  }
  return [...names];
}

/**
 * How this league is called in running prose: "the AFL" for an acronym,
 * the registry name otherwise. `sentenceStart` capitalises the article.
 */
export function ownLeagueLabel(league, { sentenceStart = false } = {}) {
  const name = LEAGUES[league]?.name;
  if (!name) throw new Error(`Unknown league: ${league}`);
  if (/^[A-Z0-9]{2,}$/.test(name)) return `${sentenceStart ? 'The' : 'the'} ${name}`;
  return name;
}

// A block tag ends whatever sentence came before it; an inline one does not.
const BLOCK_TAG = /^<\/?(?:p|div|li|ul|ol|h[1-6]|br|blockquote|tr|td|th)\b/i;

/**
 * Rewrite one string. Markup is left alone: only text between tags changes.
 * Whether the name opens a sentence is judged on the VISIBLE text, carried
 * across inline tags, so "in <strong>The League</strong>" stays mid-sentence.
 */
export function scrubLeagueNames(text, league) {
  if (typeof text !== 'string' || !text) return text;
  const names = foreignNames(league);
  if (!names.length) return text;
  const re = new RegExp(`\\b(?:${names.map(escapeRe).join('|')})\\b`, 'g');
  let visible = '';
  return text
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith('<')) {
        if (BLOCK_TAG.test(part)) visible = '';
        return part;
      }
      const out = part.replace(re, (_m, offset, whole) => {
        const before = visible + whole.slice(0, offset);
        const sentenceStart = before.trim() === '' || /[.!?:—–-]\s*$/.test(before);
        return ownLeagueLabel(league, { sentenceStart });
      });
      visible += part;
      return out;
    })
    .join('');
}

/**
 * Scrub a post's reader-facing prose in place. Returns the fields it changed,
 * so the caller can log them — a run that keeps scrubbing means the prompt is
 * losing to the model.
 */
export function scrubPostLeagueNames(post, league) {
  const changed = [];
  for (const key of ['headline', 'body', 'excerpt', 'linkLabel']) {
    const next = scrubLeagueNames(post[key], league);
    if (next !== post[key]) {
      post[key] = next;
      changed.push(key);
    }
  }
  // `content` is the flat shape; the grade-card types (draft-grades,
  // team-grades) put their prose in `intro` plus a headline/body per grade.
  for (const key of ['content', 'intro']) {
    if (!Array.isArray(post[key])) continue;
    const next = post[key].map((p) => scrubLeagueNames(p, league));
    if (next.some((p, i) => p !== post[key][i])) {
      post[key] = next;
      changed.push(key);
    }
  }
  if (Array.isArray(post.grades)) {
    let touched = false;
    post.grades = post.grades.map((g) => {
      if (!g || typeof g !== 'object') return g;
      const out = { ...g };
      for (const key of ['headline', 'body']) {
        const next = scrubLeagueNames(g[key], league);
        if (next !== g[key]) { out[key] = next; touched = true; }
      }
      return out;
    });
    if (touched) changed.push('grades');
  }
  return changed;
}
