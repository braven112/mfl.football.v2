/**
 * Pins the server process to Pacific Time.
 *
 * League semantics — event windows (isActive/isPast), calendar-day
 * boundaries, year rollovers — are defined in Pacific Time, and
 * src/utils/league-event-resolver.ts builds Dates with local setters
 * (new Date(year, month, day) / setHours). Vercel's serverless runtime
 * and build containers default to UTC, which shifted every window
 * ~7-8 hours early in production (verified live 2026-07-06; see
 * docs/claude/insights/features/afl-hero.md "Review follow-ups").
 *
 * The assignment is unconditional on purpose: AWS Lambda (Vercel's
 * function runtime) presets TZ=:UTC, so a `||=` guard would silently
 * no-op in production. Node flushes its cached zone when process.env.TZ
 * is reassigned, so all Date math after this import is Pacific —
 * matching the PT-pinned test suite (tests/global-setup-timezone.ts).
 *
 * Imported FIRST by src/middleware.ts (SSR runtime) and astro.config.ts
 * (build / prerendered pages). Keep it first: side-effect imports run in
 * source order, and this must win before any date math happens.
 */
process.env.TZ = 'America/Los_Angeles';

export {};
