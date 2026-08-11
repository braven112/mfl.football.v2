/**
 * AFL award badge SVG helpers.
 *
 * Badge art (`public/assets/afl/awards/*.svg`) ships with an editable year that
 * must be stamped per win. Two layouts:
 *   - Circular "medallion" badges carry the year on a curved
 *     `<textPath href="#yearArc">★  YYYY  ★</textPath>`.
 *   - Shield badges carry it as a flat `<text …>★  YYYY  ★</text>`.
 *
 * `stampBadgeYear` is a pure string transform (no Vite/Astro glob) so it can be
 * unit-tested and reused. The franchise page loads the raw SVGs and calls it.
 */

/**
 * Return `svg` with its win year stamped in and, when `uid` is given, its
 * `#yearArc` id made unique (so multiple medallions can coexist on one page
 * without duplicate-id collisions).
 *
 * The year is matched by the star-wrapped `★ … YYYY … ★` content rather than a
 * fixed coordinate, so it survives badge-art revisions that move the element.
 * Pass `year = ''` to blank the year for a locked/unwon placeholder.
 */
export function stampBadgeYear(
  svg: string,
  year?: number | string | null,
  uid = ''
): string {
  if (!svg) return '';
  let out = svg;
  if (uid) {
    out = out
      .replace(/id="yearArc"/, `id="yearArc-${uid}"`)
      .replace(/href="#yearArc"/, `href="#yearArc-${uid}"`);
  }
  if (year != null) {
    // Curved-arc badges (championship, cup, NIT, tiers).
    out = out.replace(
      /(<textPath\b[^>]*>)[\s\S]*?(<\/textPath>)/,
      `$1★  ${year}  ★$2`
    );
    // Shield badges (conference / division) — flat star-wrapped year.
    out = out.replace(
      /(<text\b[^>]*>[^<]*★[^<]*?)\d{4}([^<]*?<\/text>)/,
      `$1${year}$2`
    );
  }
  return out;
}

/**
 * Strip a badge's year-stamp element entirely — the ★ frame included, not
 * just the year inside it — for a "timeless" display context (an aggregate
 * trophy-count icon, a franchise-card summary) where no single win-year
 * applies. `stampBadgeYear(svg, '')` blanks the year but leaves the ★  ★
 * frame rendering; this removes the whole element so nothing shows.
 */
export function stripBadgeYear(svg: string): string {
  if (!svg) return '';
  let out = svg;
  // Curved-arc badges: remove only the ★-wrapped <textPath>, not the whole
  // enclosing <text>. A multi-arc badge (see the MULTI_ARC test fixture used
  // for stampBadgeYear below) can carry a second, unrelated <textPath> — e.g.
  // a curved label — sharing that same <text>; a wholesale `<text>...</text>`
  // removal would delete it along with the year. Content is bounded to
  // `[^<]*` (no nested tags) so this only ever matches the star-wrapped run.
  out = out.replace(/<textPath\b[^>]*>[^<]*★[^<]*<\/textPath>/g, '');
  // If that left its <text> wrapper completely empty (the common single-arc
  // case), drop the now-empty wrapper too. A multi-arc <text> with a
  // surviving second <textPath> won't match this (it isn't empty).
  out = out.replace(/<text\b[^>]*><\/text>/g, '');
  // The <path id="yearArc" .../> that fed the textPath above is now dead
  // weight — nothing references it once its <textPath href="#yearArc"> is
  // gone. Left behind, its id collides with every other stripped instance of
  // the same badge inlined on one page (e.g. the franchises index shows one
  // afl-championship.svg per team that's won it), so remove the definition
  // itself rather than just the reference to it.
  out = out.replace(/<path\b[^>]*\bid="yearArc"[^>]*>(?:\s*<\/path>)?/g, '');
  // Shield badges: flat star-wrapped <text ...>★ YYYY ★</text>
  out = out.replace(/<text\b[^>]*>[^<]*★[^<]*<\/text>/g, '');
  return out;
}

/**
 * Make every `id="..."` in `svg` unique by suffixing it with `-${uid}`,
 * rewriting the matching `href="#id"` / `url(#id)` references so they still
 * resolve. Badge art beyond the year arc carries its own ids — shield badges
 * (division/conference) define a `#sh` clip-path and a per-badge gradient,
 * e.g. `#g_north` — that `stampBadgeYear`'s `uid` param doesn't touch because
 * a franchise's own trophy wall only ever needs one instance of any given
 * badge file live at once. A page that inlines the SAME badge file once per
 * FRANCHISE (the franchises index's aggregate icons) doesn't have that
 * luxury: today's art is identical across every instance so a duplicate id
 * resolving to the first one in the DOM is harmless, but nothing prevents a
 * future revision from giving divisions distinct clip shapes or gradients,
 * at which point every instance but the first would silently render wrong.
 * Namespacing on load removes the collision instead of relying on today's
 * art staying uniform forever.
 */
export function namespaceBadgeIds(svg: string, uid: string): string {
  if (!svg || !uid) return svg;
  const ids = new Set<string>();
  const idPattern = /\bid="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = idPattern.exec(svg))) ids.add(match[1]);
  let out = svg;
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`id="${escaped}"`, 'g'), `id="${id}-${uid}"`)
      .replace(new RegExp(`href="#${escaped}"`, 'g'), `href="#${id}-${uid}"`)
      .replace(new RegExp(`url\\(#${escaped}\\)`, 'g'), `url(#${id}-${uid})`);
  }
  return out;
}
