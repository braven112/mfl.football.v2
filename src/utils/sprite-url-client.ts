/**
 * The page's icon sprite URL, for code that runs in the browser.
 *
 * Every layout stamps `<html data-sprite-url>` with the league's set (resolved
 * server-side by src/utils/sprite-url.ts). The ClientRouter copies the new
 * page's <html> attributes on a soft navigation, so this stays right across a
 * cross-league click. Read it per call, never at module load — a module
 * survives navigations, the attribute does not.
 *
 * React islands must NOT call this while rendering: it has no document on the
 * server, so the server and client markup would disagree. They take the URL
 * from their .astro parent through SpriteUrlContext (src/utils/sprite-url-context.ts).
 */
export const CLASSIC_SPRITE_PATH = '/assets/icons/sprite.svg';

export function clientSpriteUrl(): string {
  if (typeof document === 'undefined') return CLASSIC_SPRITE_PATH;
  return document.documentElement.dataset.spriteUrl || CLASSIC_SPRITE_PATH;
}
