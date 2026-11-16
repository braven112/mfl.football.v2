#!/usr/bin/env node
/**
 * Clone the private beat-reporter pack into `.private/beat-reporter` for the
 * site build. The first prebuild step (scripts/prebuild.mjs).
 *
 * Why the BUILD needs it: Ask Roger answers live from a serverless function,
 * so his instructions (prompts/roger/*.md) are compiled into the server bundle
 * by src/utils/roger-prompts.ts. The scheduled jobs check the pack out with
 * actions/checkout instead and never run this.
 *
 * - Already there (a GitHub Actions checkout, or a local clone/symlink): no-op.
 * - Otherwise it clones with BEAT_REPORTER_TOKEN, a read-only token on the
 *   private repo (a Vercel environment variable).
 * - A PRODUCTION build (VERCEL_ENV=production) that cannot get the pack FAILS,
 *   so Roger never ships on the public stubs; the deployment already live
 *   stays live. Every other build warns and carries on with the stubs.
 *
 * The token never reaches the log: every message is scrubbed of it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { privateLoreRoot } from './lib/schefter-lore.mjs';

export const PACK_REPO = 'braven112/Beat-Reporter';
/** The one file whose presence means the pack is usable for the build. */
export const PACK_MARKER = path.join('prompts', 'roger', 'theleague.md');

/**
 * @param {{ env?: NodeJS.ProcessEnv, root?: string, exec?: typeof execFileSync, log?: Pick<Console, 'log' | 'warn' | 'error'> }} [opts]
 * @returns {{ ok: boolean, fatal: boolean, reason: string }}
 */
export function fetchBeatReporter({ env = process.env, root = privateLoreRoot(), exec = execFileSync, log = console } = {}) {
  const production = env.VERCEL_ENV === 'production';
  const fail = (reason) => {
    const result = { ok: false, fatal: production, reason };
    (production ? log.error : log.warn)(
      production
        ? `  [beat-reporter] ${reason} — failing this PRODUCTION build so Ask Roger never ships without his instructions.`
        : `  [beat-reporter] ${reason} — continuing with the public stub prompts (not a production build).`,
    );
    return result;
  };

  if (existsSync(path.join(root, PACK_MARKER))) {
    log.log(`  [beat-reporter] pack already present at ${root}`);
    return { ok: true, fatal: false, reason: 'present' };
  }

  const token = env.BEAT_REPORTER_TOKEN;
  if (!token) return fail('BEAT_REPORTER_TOKEN is not set');

  // Never delete what is there: a local clone on an old commit may hold work.
  if (existsSync(root) && readdirSync(root).length > 0) {
    return fail(`${root} exists but has no ${PACK_MARKER} (an old checkout? pull it)`);
  }

  const scrub = (text) => String(text ?? '').split(token).join('***');
  try {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(path.dirname(root), { recursive: true });
    exec('git', ['clone', '--depth', '1', '--quiet', `https://x-access-token:${token}@github.com/${PACK_REPO}.git`, root], {
      stdio: 'pipe',
      env: { ...env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 60_000,
    });
  } catch (err) {
    return fail(`could not clone ${PACK_REPO}: ${scrub(err?.stderr || err?.message).trim().split('\n').pop()}`);
  }

  if (!existsSync(path.join(root, PACK_MARKER))) return fail(`the clone has no ${PACK_MARKER}`);
  log.log(`  [beat-reporter] cloned ${PACK_REPO} into ${root}`);
  return { ok: true, fatal: false, reason: 'cloned' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = fetchBeatReporter();
  if (result.fatal) process.exit(1);
}
