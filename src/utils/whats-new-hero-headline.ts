/**
 * whats-new-hero-headline — the display headline a homepage hero shows for a
 * fresh What's New entry.
 *
 * The AFL hero's display line is a PAIR: a plain phrase plus a colour-accented
 * closing word ("GAMES ARE" / "LIVE."). Every other slot writes that pair by
 * hand; the feature slot used to hardcode "FRESH ON THE" / "SITE." for every
 * entry, so the hero announced that something shipped without ever saying
 * what — while TheLeague's composite hero has always led with the entry's own
 * title.
 *
 * Resolution order:
 *   1. `heroHeadline` (+ optional `heroAccentWord`) — copy written FOR the
 *      hero. Preferred: article titles run 26-54 chars, roughly twice what
 *      the condensed display type wants.
 *   2. Derived from `title` — last word accented, terminal punctuation added
 *      if the title has none. Every entry ever written works with no data
 *      change.
 *   3. The generic pair, for a title that is empty or whitespace.
 *
 * Casing is left as authored — the hero's `text-transform: uppercase` owns it,
 * so the same pair can be reused by a hero that does NOT shout.
 */

/** The pair an event hero renders as its display line. */
export interface HeroHeadline {
  headline: string;
  accentWord: string;
}

/** What a feature hero falls back to when there is no usable title. */
export const GENERIC_FEATURE_HEADLINE: HeroHeadline = {
  headline: 'Fresh on the',
  accentWord: 'Site.',
};

/** The subset of a What's New entry this module reads. */
interface HeadlineSource {
  title?: string;
  heroHeadline?: string;
  heroAccentWord?: string;
}

/** True when the word already closes a sentence, so we must not add a period. */
function isTerminated(word: string): boolean {
  return /[.!?\u2026:]["'\u2019)\]]?$/.test(word);
}

/** Give the accent word its own terminal punctuation when the title had none. */
function terminate(word: string): string {
  return isTerminated(word) ? word : `${word}.`;
}

/**
 * Words too weak to carry the accent alone. These titles are written as
 * sentences, so a naive last-word split lands on "In." or "You." — the accent
 * is the loudest thing on the card and must be the payoff, so a weak tail
 * pulls the word before it along.
 */
const WEAK_TAIL = new Set([
  'a', 'an', 'the', 'in', 'on', 'of', 'to', 'at', 'it', 'up', 'is', 'be', 'and',
  'or', 'for', 'with', 'you', 'your', 'my', 'his', 'her', 'their', 'its', 'out',
  'off', 'now', 'all', 'one', 'no', 'not', 'too', 'so', 'by', 'from', 'that',
]);

/** The longest trailing sentence still short enough to be the accent line. */
const MAX_SENTENCE_ACCENT = 24;

function bareWord(word: string): string {
  return word.replace(/[^\p{L}\p{N}'\u2019]/gu, '').toLowerCase();
}

/**
 * Split a plain title into the hero's two-part display line.
 *
 * These titles are written as sentences ("Twenty-Four Teams. One Ballot. Your
 * Call."), so the split follows the punctuation the author already used:
 *
 *   1. A short closing SENTENCE becomes the accent — the author's own beat.
 *   2. Otherwise the last word, plus the word before it when the last one is
 *      too weak to carry the colour on its own ("Live In.", not "In.").
 *
 * A one-word title becomes the accent alone: an accent-less hero line drops
 * the only colour the card has.
 */
export function splitTitleHeadline(title: string): HeroHeadline {
  const trimmed = title.trim().replace(/\s+/g, ' ');
  if (!trimmed) return GENERIC_FEATURE_HEADLINE;

  // 1. Author-supplied sentence break, as long as it leaves both halves real.
  const lastBreak = [...trimmed.matchAll(/[.!?\u2026]["'\u2019)\]]? /g)].pop();
  if (lastBreak) {
    const cut = lastBreak.index + lastBreak[0].length;
    const head = trimmed.slice(0, cut).trim();
    const tail = trimmed.slice(cut).trim();
    if (head && tail && tail.length <= MAX_SENTENCE_ACCENT) {
      return { headline: head, accentWord: terminate(tail) };
    }
  }

  // 2. Trailing word(s).
  const words = trimmed.split(' ');
  if (words.length === 1) return { headline: '', accentWord: terminate(words[0]) };

  const takeTwo = words.length >= 3 && WEAK_TAIL.has(bareWord(words[words.length - 1]));
  const tailCount = takeTwo ? 2 : 1;
  return {
    headline: words.slice(0, -tailCount).join(' '),
    accentWord: terminate(words.slice(-tailCount).join(' ')),
  };
}

/**
 * The display line for a fresh-feature hero. `heroAccentWord` on its own is
 * ignored on purpose: an authored accent bolted onto a derived headline reads
 * as a mistake, and failing back to the derived pair is always coherent.
 */
export function resolveFeatureHeadline(entry: HeadlineSource | undefined | null): HeroHeadline {
  if (entry?.heroHeadline && entry.heroHeadline.trim()) {
    return {
      headline: entry.heroHeadline.trim(),
      accentWord: entry.heroAccentWord?.trim() ?? '',
    };
  }
  if (entry?.title) return splitTitleHeadline(entry.title);
  return GENERIC_FEATURE_HEADLINE;
}
