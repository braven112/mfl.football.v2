/**
 * Share one saved Ask the History answer into a group chat (GroupMe, mostly)
 * from the phone's share sheet. Client-side; used by the ask screen and the
 * shared answer page.
 *
 * The phone gets the portrait answer card as a PICTURE plus a line of text
 * that ends in the answer's link, so the chat shows the fact at full size and
 * a leaguemate can tap through to ask their own (Brandon, 2026-11-12: share
 * sheet, posted by the owner themself, portrait card). Where the browser
 * cannot share files it shares the link alone, whose unfurl is the same card
 * (the page's og:image); with no share sheet at all it copies the link.
 *
 * The link is the LAST thing in the text, with nothing after it: GroupMe
 * autolinks trailing punctuation into the URL (docs/claude/rules/league-urls.md).
 */

export interface ShareableAnswer {
  league: string;
  /** The league's path prefix ('/theleague', or '' on its own domain). */
  base: string;
  id: string;
  question: string;
}

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

export const answerPageUrl = (a: ShareableAnswer, origin: string) =>
  new URL(`${a.base}/history/ask/${encodeURIComponent(a.id)}`, origin).toString();

export const answerCardUrl = (a: Pick<ShareableAnswer, 'league' | 'id'>, origin: string) =>
  new URL(`/api/og/league-history/answer.png?league=${encodeURIComponent(a.league)}&id=${encodeURIComponent(a.id)}`, origin).toString();

/** The text that goes with the picture: the question, then the link, and nothing after the link. */
export function shareText(question: string, url: string): string {
  const q = question.replace(/\s+/g, ' ').trim();
  return `${q ? `“${q}” ` : ''}Ask the History has the answer. Ask your own: ${url}`;
}

const cards = new Map<string, Promise<File | null>>();

/**
 * Fetch the card ahead of the tap. A share sheet must open while the tap still
 * counts as the user's gesture, and Safari stops counting after a slow fetch,
 * so the button warms its card when it is drawn and the tap only awaits a
 * promise that has already settled.
 */
export function prefetchCard(a: Pick<ShareableAnswer, 'league' | 'id'>): Promise<File | null> {
  const key = `${a.league}:${a.id}`;
  let card = cards.get(key);
  if (!card) {
    card = loadCard(a);
    cards.set(key, card);
  }
  return card;
}

async function loadCard(a: Pick<ShareableAnswer, 'league' | 'id'>): Promise<File | null> {
  try {
    const res = await fetch(answerCardUrl(a, location.origin));
    if (!res.ok) return null;
    return new File([await res.blob()], `ask-the-history-${a.id}.png`, { type: 'image/png' });
  } catch {
    return null;
  }
}

export async function shareAnswer(a: ShareableAnswer): Promise<ShareOutcome> {
  const url = answerPageUrl(a, location.origin);
  const text = shareText(a.question, url);
  try {
    if (navigator.share) {
      const file = await prefetchCard(a);
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text, title: 'Ask the History' });
      } else {
        await navigator.share({ title: 'Ask the History', text, url });
      }
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch (err) {
    return (err as DOMException)?.name === 'AbortError' ? 'dismissed' : 'failed';
  }
}
