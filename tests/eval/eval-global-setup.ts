/**
 * Global setup for the live eval run.
 *
 * 1. Pin PT — the date block renders in America/Los_Angeles and date-sensitive
 *    cases inject PT calendar days (same rationale as tests/global-setup-timezone.ts).
 * 2. Hydrate process.env from .env / .env.local, mirroring astro.config.ts:
 *    generateRulesAnswer reads ANTHROPIC_API_KEY from process.env, and locally
 *    that key lives in the vercel-pulled env files. Real env always wins.
 */
import { loadEnv } from 'vite';

export default function setup(): void {
  process.env.TZ = 'America/Los_Angeles';

  const fileEnv = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');
  for (const [key, value] of Object.entries(fileEnv)) {
    process.env[key] ??= value;
  }
}
