/**
 * A franchise's mark — the crest when the identity ladder found one, the
 * initials when it reached the text rung.
 *
 * Extracted because three surfaces now draw it (the matchup card's side rows,
 * the standings table, the top-scorers strip) and the rule it encodes is easy
 * to break by retyping: the text rung is a LABEL, never invented artwork. No
 * fabricated crest, and no hue derived from the name — a colour we made up
 * reads as the club's own and is wrong more often than not.
 */
import type { JSX } from 'react';

export interface LvCrestProps {
  icon: string;
  iconAlt: string;
  initials: string;
  /** BEM block to namespace the element classes under. */
  block: string;
}

export default function LvCrest({ icon, iconAlt, initials, block }: LvCrestProps): JSX.Element {
  if (icon) {
    return (
      <span className={`${block}__crest`}>
        <img src={icon} alt={iconAlt} loading="lazy" />
      </span>
    );
  }
  return (
    <span className={`${block}__initials`} aria-hidden="true">
      {initials}
    </span>
  );
}
