/**
 * Dark-mode team icon swap.
 *
 * Generates the global CSS that swaps a team's icon for its dark variant
 * (`iconDark` in the league config) whenever `html.dark` is set.
 *
 * Why CSS keyed on `html.dark`, not a server-side src pick: when the theme
 * preference is 'auto', the server cannot know the resolved theme at render
 * time — the same bug was already fixed once for the league logo. A CSS rule
 * always follows the class the client-side theme script resolves.
 *
 * Why `content: url(...)` on the <img> itself: team icons render as plain
 * <img> tags in ~20 call sites across Astro components, React components,
 * and client-side HTML string builders. One generated stylesheet keyed on
 * the exact icon src covers every call site — present and future — with
 * zero markup changes. Teams without `iconDark` never get a rule, so they
 * render identically in both themes. Browsers without `content` support on
 * img elements (pre-2023) simply keep the light icon.
 *
 * Consumed by `src/components/TeamIconDarkStyles.astro`, which is included
 * once in the shared layout <head>.
 */

export interface DarkIconTeamLike {
  franchiseId?: string;
  icon?: string;
  iconDark?: string;
}

export interface TeamIconDarkCssOptions {
  /**
   * Directory holding franchise-id-named copies of the icons (e.g.
   * `/assets/theleague/icons` contains `0002.png` identical to
   * `da_dangsters.png`). Some client-side code builds icon paths from the
   * franchise id directly, so an alias rule is emitted for that path too.
   */
  franchiseIconDir?: string;
}

/** Escape a value for use inside a double-quoted CSS string. */
function cssStringEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Every form a given config `icon` may be RENDERED as, so an exact-src
 * selector matches whichever one a call site chose.
 *
 * The AFL configs store absolute production URLs
 * (`https://mflfootballv2.vercel.app/assets/afl/icons/x.png`) even though the
 * files are committed under `public/`. Call sites that render the raw config
 * value therefore make a cross-origin request; call sites that normalize it to
 * the same-origin path (as `TeamIconCell` does, so the crest isn't gated on a
 * second DNS+TLS handshake) render the bare pathname. Both must carry the dark
 * swap, or normalizing a src silently disables dark mode for that surface.
 */
export function iconSrcVariants(icon: string): string[] {
  const variants = new Set<string>([icon]);
  if (/^https?:\/\//i.test(icon)) {
    try {
      variants.add(new URL(icon).pathname);
    } catch {
      /* not a parseable URL — the raw value is the only form */
    }
  }
  return [...variants];
}

/**
 * The form a call site should RENDER: same-origin whenever the asset is one of
 * ours, so it rides the page's existing connection. Falls back to the raw
 * value for genuinely external hosts.
 */
export function preferredIconSrc(icon: string): string {
  if (!/^https?:\/\//i.test(icon)) return icon;
  try {
    const url = new URL(icon);
    return url.pathname.startsWith('/assets/') ? url.pathname : icon;
  } catch {
    return icon;
  }
}

/**
 * Build the dark-mode swap CSS for a list of teams. Returns an empty string
 * when no team declares an `iconDark` (the caller can skip the <style> tag).
 */
export function buildTeamIconDarkCss(
  teams: DarkIconTeamLike[],
  options: TeamIconDarkCssOptions = {},
): string {
  const rules: string[] = [];
  for (const team of teams) {
    if (!team?.icon || !team.iconDark) continue;
    const darkUrl = cssStringEscape(team.iconDark);
    const srcs = new Set<string>(iconSrcVariants(team.icon));
    if (options.franchiseIconDir && team.franchiseId) {
      const dir = options.franchiseIconDir.replace(/\/+$/, '');
      srcs.add(`${dir}/${team.franchiseId}.png`);
    }
    for (const src of srcs) {
      rules.push(
        `html.dark img[src="${cssStringEscape(src)}"] { content: url("${darkUrl}"); }`,
      );
    }
  }
  return rules.join('\n');
}
