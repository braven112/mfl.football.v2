/**
 * The icon sprite URL for React islands.
 *
 * An island's .astro parent resolves the URL (`spriteUrlFor(Astro.url)`) and
 * passes it as a prop; the island's root wraps its tree in
 * `<SpriteUrlContext.Provider value={spriteUrl}>` and leaves read it with
 * `useSpriteUrl()`. A prop rather than `clientSpriteUrl()` because an island
 * also renders on the server, where there is no document to read.
 */
import { createContext, useContext } from 'react';
import { CLASSIC_SPRITE_PATH } from './sprite-url-client';

export const SpriteUrlContext = createContext<string>(CLASSIC_SPRITE_PATH);

export function useSpriteUrl(): string {
  return useContext(SpriteUrlContext);
}
