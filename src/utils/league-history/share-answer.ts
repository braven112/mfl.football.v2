/**
 * Share one saved Ask the History answer into a group chat (GroupMe, mostly)
 * from the phone's share sheet. Client-side; used by the ask screen, the live
 * chat on the History home and the shared answer page.
 *
 * What goes out is a LINK to the answer page, which shows the whole
 * conversation from the first question down (Brandon, 2026-11-26: "share a
 * link to the site so they can see the full question and answer directly on
 * the site"). The picture rides along as the link's unfurl (the page's
 * og:image is the portrait answer card), never as an attached file: Android
 * drops the text when a share carries a file, so GroupMe got the picture and
 * no link at all. With no share sheet it copies the link.
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

/** The shared text: the question, then the link, and nothing after the link. */
export function shareText(question: string, url: string): string {
  const q = question.replace(/\s+/g, ' ').trim();
  return `${q ? `“${q}” ` : ''}See the full answer on the site: ${url}`;
}

export async function shareAnswer(a: ShareableAnswer): Promise<ShareOutcome> {
  const url = answerPageUrl(a, location.origin);
  const text = shareText(a.question, url);
  try {
    if (navigator.share) {
      // The URL lives inside `text`, and no `url` field is passed: Android
      // appends `url` to the text, which would post the link twice.
      await navigator.share({ title: 'Ask the History', text });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch (err) {
    return (err as DOMException)?.name === 'AbortError' ? 'dismissed' : 'failed';
  }
}
