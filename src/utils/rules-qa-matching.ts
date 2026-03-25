import type { RulesQA } from '../types/rules-qa';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'about',
  'up', 'out', 'if', 'or', 'and', 'but', 'not', 'no', 'so', 'than',
  'too', 'very', 'just', 'that', 'this', 'it', 'its', 'my', 'your',
  'what', 'how', 'when', 'where', 'who', 'which', 'why', 'i', 'me',
  'we', 'they', 'them', 'he', 'she', 'you', 'there', 'here',
]);

function normalizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

export function wordOverlapScore(a: string, b: string): number {
  const wordsA = normalizeText(a);
  const wordsB = normalizeText(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setB = new Set(wordsB);
  const matches = wordsA.filter(w => setB.has(w)).length;

  // Score = percentage of query words found in the existing question
  return matches / wordsA.length;
}

export function findBestMatch(
  query: string,
  existing: RulesQA[],
  threshold = 0.6
): RulesQA | null {
  let best: RulesQA | null = null;
  let bestScore = 0;

  for (const qa of existing) {
    const score = wordOverlapScore(query, qa.question);
    if (score > bestScore) {
      bestScore = score;
      best = qa;
    }
  }

  return bestScore >= threshold ? best : null;
}

export function filterByRelevance(
  query: string,
  items: RulesQA[],
  threshold = 0.3
): RulesQA[] {
  if (!query.trim()) return items;

  const scored = items
    .map(qa => ({ qa, score: wordOverlapScore(query, qa.question) }))
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ qa }) => qa);
}
