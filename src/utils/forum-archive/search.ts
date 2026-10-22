/**
 * Keyword search over the forum archive. ~7k posts / ~3 MB of text, so a
 * linear scan of a cached lowercase haystack per post is a few milliseconds —
 * no index to build or keep in sync.
 *
 * A term matches at a word START, so "tag" finds "tags" and "tagged" but not
 * "vintage". "Quoted phrases" must appear verbatim. Posts matching more of the
 * terms rank above posts matching fewer; a term in the thread title counts
 * extra.
 */
import type { LoadedArchive } from './forum-archive-store';
import type { ArchivePost, ArchiveTopic } from './types';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'did', 'do', 'does', 'for', 'from', 'has', 'have', 'how',
  'i', 'if', 'in', 'is', 'it', 'of', 'on', 'or', 'so', 'that', 'the', 'this', 'to', 'was', 'we', 'were',
  'what', 'when', 'where', 'who', 'why', 'with', 'you', 'ever', 'about', 'our', 'us', 'any', 'there',
]);

export interface ParsedQuery {
  terms: string[];
  phrases: string[];
}

export function parseQuery(q: string): ParsedQuery {
  const phrases: string[] = [];
  const rest = String(q ?? '')
    .toLowerCase()
    .replace(/"([^"]+)"/g, (_, p: string) => {
      const phrase = p.replace(/\s+/g, ' ').trim();
      if (phrase) phrases.push(phrase);
      return ' ';
    });
  const terms = [
    ...new Set(
      rest
        .split(/[^a-z0-9$']+/)
        .map((w) => w.replace(/^'+|'+$/g, ''))
        .filter((w) => w.length >= 2 && !STOPWORDS.has(w)),
    ),
  ].slice(0, 12);
  return { terms, phrases: phrases.slice(0, 4) };
}

export interface SearchOptions {
  /** Restrict to this forum and its sub-forums. */
  forumId?: number;
  /** Restrict to posts made in this calendar year (UTC). */
  year?: number;
}

export interface SnippetPart {
  text: string;
  hit: boolean;
}

export interface PostHit {
  post: ArchivePost;
  topic: ArchiveTopic;
  score: number;
}

export interface TopicHit {
  topic: ArchiveTopic;
  score: number;
  /** Best-scoring matching posts in the thread, best first. */
  hits: PostHit[];
  matchCount: number;
}

const hayCache = new WeakMap<LoadedArchive, Map<number, string>>();

function haystacks(archive: LoadedArchive): Map<number, string> {
  let m = hayCache.get(archive);
  if (!m) {
    m = new Map();
    for (const p of archive.posts) m.set(p.id, plainText(p.body).toLowerCase());
    hayCache.set(archive, m);
  }
  return m;
}

/** The post body without Markdown markers — what a reader sees, as one string. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/^>+ ?/gm, '')
    .replace(/[ \t]+/g, ' ');
}

const isWordChar = (c: string | undefined) => !!c && /[a-z0-9]/.test(c);

/** Occurrences of `term` beginning at a word boundary. */
export function countWordStarts(hay: string, term: string): number {
  let n = 0;
  let at = hay.indexOf(term);
  while (at >= 0) {
    if (!isWordChar(hay[at - 1])) n++;
    at = hay.indexOf(term, at + term.length);
  }
  return n;
}

function forumScope(archive: LoadedArchive, forumId?: number): Set<number> | null {
  if (!forumId) return null;
  const scope = new Set<number>([forumId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of archive.forums) {
      if (!scope.has(f.id) && scope.has(f.parentId)) {
        scope.add(f.id);
        grew = true;
      }
    }
  }
  return scope;
}

/** Every matching post, best first. Empty query → no hits. */
export function searchPosts(archive: LoadedArchive, q: string, opts: SearchOptions = {}): PostHit[] {
  const { terms, phrases } = parseQuery(q);
  if (!terms.length && !phrases.length) return [];
  const hays = haystacks(archive);
  const scope = forumScope(archive, opts.forumId);

  const candidates: Array<{ post: ArchivePost; topic: ArchiveTopic; tfs: number[] }> = [];
  const df = terms.map(() => 0);
  for (const post of archive.posts) {
    const topic = archive.topicById.get(post.topicId);
    if (!topic) continue;
    if (scope && !scope.has(topic.forumId)) continue;
    if (opts.year && new Date(post.time * 1000).getUTCFullYear() !== opts.year) continue;
    const hay = hays.get(post.id) ?? '';
    if (phrases.some((ph) => !hay.includes(ph))) continue;
    const title = topic.title.toLowerCase();
    const tfs = terms.map((t) => countWordStarts(hay, t) + (countWordStarts(title, t) ? 1 : 0));
    if (terms.length && !tfs.some((n) => n > 0)) continue;
    tfs.forEach((n, i) => { if (n > 0) df[i]++; });
    candidates.push({ post, topic, tfs });
  }

  const total = archive.posts.length || 1;
  const idf = df.map((d) => Math.log(1 + total / (1 + d)));
  const hits: PostHit[] = candidates.map(({ post, topic, tfs }) => {
    let score = phrases.length * 2;
    let covered = 0;
    const title = topic.title.toLowerCase();
    tfs.forEach((n, i) => {
      if (!n) return;
      covered++;
      score += (1 + Math.log(n)) * idf[i];
      if (countWordStarts(title, terms[i])) score += 1.5 * idf[i];
    });
    if (terms.length > 1) score *= (covered / terms.length) ** 2;
    return { post, topic, score };
  });
  return hits.sort((a, b) => b.score - a.score || b.post.time - a.post.time);
}

/** Matching threads, best first, each carrying its best few posts. */
export function searchTopics(archive: LoadedArchive, q: string, opts: SearchOptions = {}): TopicHit[] {
  const byTopic = new Map<number, TopicHit>();
  for (const hit of searchPosts(archive, q, opts)) {
    const existing = byTopic.get(hit.topic.id);
    if (!existing) {
      byTopic.set(hit.topic.id, { topic: hit.topic, score: hit.score, hits: [hit], matchCount: 1 });
    } else {
      existing.matchCount++;
      existing.score += hit.score * 0.15;
      if (existing.hits.length < 3) existing.hits.push(hit);
    }
  }
  return [...byTopic.values()].sort((a, b) => b.score - a.score || b.topic.lastPostAt - a.topic.lastPostAt);
}

/**
 * A short excerpt of `markdown` around the first query match, split into
 * plain/hit parts so the caller can escape the text and mark the hits.
 */
export function snippet(markdown: string, q: string, width = 220): SnippetPart[] {
  const { terms, phrases } = parseQuery(q);
  const needles = [...phrases, ...terms].sort((a, b) => b.length - a.length);
  // Prefer the author's own words: a reply usually opens by quoting the post
  // it answers, so excerpt from outside the quotes when the match is there.
  const own = plainText(markdown.split('\n').filter((l) => !l.startsWith('>')).join('\n')).replace(/\s+/g, ' ').trim();
  const ownLower = own.toLowerCase();
  const ownHasMatch = needles.some((n) => ownLower.includes(n));
  const text = ownHasMatch || !needles.length ? own || plainText(markdown).replace(/\s+/g, ' ').trim() : plainText(markdown).replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();

  let first = -1;
  for (const n of needles) {
    let at = lower.indexOf(n);
    while (at >= 0 && isWordChar(lower[at - 1])) at = lower.indexOf(n, at + 1);
    if (at >= 0 && (first < 0 || at < first)) first = at;
  }
  let start = first < 0 ? 0 : Math.max(0, first - Math.floor(width / 3));
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space >= 0 && space < start + 20) start = space + 1;
  }
  let end = Math.min(text.length, start + width);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start + width / 2) end = space;
  }
  const windowText = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  return markHits(windowText, needles);
}

function markHits(text: string, needles: string[]): SnippetPart[] {
  if (!needles.length) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const parts: SnippetPart[] = [];
  let i = 0;
  let plainFrom = 0;
  while (i < text.length) {
    const needle = isWordChar(lower[i - 1]) ? undefined : needles.find((n) => lower.startsWith(n, i));
    if (needle) {
      if (i > plainFrom) parts.push({ text: text.slice(plainFrom, i), hit: false });
      parts.push({ text: text.slice(i, i + needle.length), hit: true });
      i += needle.length;
      plainFrom = i;
    } else {
      i++;
    }
  }
  if (plainFrom < text.length) parts.push({ text: text.slice(plainFrom), hit: false });
  return parts;
}
