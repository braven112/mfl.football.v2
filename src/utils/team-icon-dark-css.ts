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
    const srcs = new Set<string>([team.icon]);
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
