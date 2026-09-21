/**
 * A franchise's mark, with the identity ladder's text rung underneath it.
 *
 * ── WHY THIS IS A COMPONENT AND NOT AN `<img>` ────────────────────────────
 * A mark on the uploaded-art rung is a URL SOMEBODY ELSE CONTROLS — a
 * commissioner's upload, on whatever host they used. This repo's own league
 * exports carry marks on `theleague.us`, `mfl.football`, `dynastytheleague.com`
 * and `nbc.com`, several of those hosts long dead. So a mark that fails to load
 * is a permanent condition, not an edge case, and there are two bad ways to
 * render one:
 *
 *  - **Let the browser paint the alt text.** It arrives at body size inside a
 *    1.4rem box, which on 2026-09-21 turned two matchup rows into "Rhinos logo"
 *    wrapped across three lines each.
 *  - **Hide the alt text and stop there.** That was the first fix, and it trades
 *    a broken layout for a silent empty square — the franchise loses the
 *    initials it would have had if the ladder had never found a mark at all.
 *
 * So a failed load falls THROUGH to the rung below: the initials, which is
 * exactly what this franchise showed before the mark existed. `onError` is the
 * only signal available for it — a broken image fires no other event, and the
 * server cannot know, because the fetch happens in the viewer's browser and the
 * host may be reachable from ours and not theirs.
 *
 * The CSS containment stays as a second line of defence (the alt text is still
 * hidden while the image is in flight, and `onError` does not fire for every
 * failure mode in every browser).
 */

import { useState, type JSX } from 'react';

export interface LvMarkProps {
  /** The mark's URL, already through `optimizedRemoteImage`. '' on the text rung. */
  icon: string;
  /** Alt text. '' where the surrounding element is already `aria-hidden`. */
  alt: string;
  /** The text rung — always present, and what a failed load falls back to. */
  initials: string;
  /**
   * Crop the mark square instead of fitting it inside the box.
   *
   * True only for the uploaded-art rung: MFL's "icon" is any shape, and
   * `contain` renders a 1500×636 banner as a sliver. A league crest or NFL club
   * mark is drawn to fit, so cropping one cuts off its logo.
   */
  crop?: boolean;
  /** Class names, because the board and the settings list style their own boxes. */
  classes: { wrap: string; crop: string; text: string };
  /** `true` where the caller already marks the whole element decorative. */
  decorative?: boolean;
}

export default function LvMark({
  icon,
  alt,
  initials,
  crop = false,
  classes,
  decorative = false,
}: LvMarkProps): JSX.Element {
  const [failed, setFailed] = useState(false);

  if (!icon || failed) {
    return (
      <span className={`${classes.wrap} ${classes.text}`} aria-hidden="true">
        {initials}
      </span>
    );
  }

  return (
    <span className={`${classes.wrap}${crop ? ` ${classes.crop}` : ''}`} aria-hidden={decorative || undefined}>
      <img
        src={icon}
        alt={decorative ? '' : alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
