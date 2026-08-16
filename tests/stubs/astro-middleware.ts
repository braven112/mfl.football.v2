/**
 * Stub for Astro's `astro:middleware` virtual module.
 *
 * Aliased in vitest.config.ts so `src/middleware.ts` can be imported and
 * exercised for real in unit tests. The production `defineMiddleware` is only
 * a typing helper — it returns the handler unchanged — so an identity
 * function is a faithful stand-in, not a simplification.
 */
export const defineMiddleware = <T>(handler: T): T => handler;
