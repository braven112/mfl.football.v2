/**
 * Which site theme a request renders in — the league's own (registry
 * `siteTheme`), unless the visitor is previewing the other one.
 *
 * `?theme=primetime` or `?theme=editorial` on any page previews that theme and
 * remembers it for the browser session (a session cookie, so following links
 * keeps the preview); `?theme=default` forgets it. The middleware reads the
 * param and cookie once per request into `Astro.locals.siteThemePreview`, so
 * components never touch cookies (a component cannot write one).
 *
 * The preview is a sales and review tool: it changes nothing for anyone who
 * has not asked for it, and the league's real theme stays a registry setting.
 */
import { leagueSiteTheme, type SiteTheme } from '../config/leagues';

export const SITE_THEMES: readonly SiteTheme[] = ['editorial', 'primetime'];
export const THEME_PREVIEW_PARAM = 'theme';
export const THEME_PREVIEW_COOKIE = 'site-theme-preview';
/** `?theme=default` clears a preview and returns to the league's own theme. */
export const THEME_PREVIEW_RESET = 'default';

export function parseSiteTheme(value: string | null | undefined): SiteTheme | null {
  const v = value?.trim().toLowerCase();
  return SITE_THEMES.includes(v as SiteTheme) ? (v as SiteTheme) : null;
}

export type ThemePreviewAction =
  | { kind: 'set'; theme: SiteTheme }
  | { kind: 'clear' }
  | { kind: 'keep'; theme: SiteTheme | null };

/**
 * What a request does to the preview: a valid `?theme=` sets it, `?theme=default`
 * clears it, anything else (no param, or an unknown value) keeps the cookie's.
 */
export function resolveThemePreview(param: string | null, cookie: string | null | undefined): ThemePreviewAction {
  if (param?.trim().toLowerCase() === THEME_PREVIEW_RESET) return { kind: 'clear' };
  const fromParam = parseSiteTheme(param);
  if (fromParam) return { kind: 'set', theme: fromParam };
  return { kind: 'keep', theme: parseSiteTheme(cookie) };
}

/** The theme a league's page renders in for this request. */
export function resolveSiteTheme(slug: string, preview: SiteTheme | null | undefined): SiteTheme {
  return preview ?? leagueSiteTheme(slug);
}
