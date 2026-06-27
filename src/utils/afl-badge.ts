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
