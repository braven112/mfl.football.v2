#!/usr/bin/env node
/**
 * Mint a fresh MFL session for the rest of a GitHub Actions job.
 *
 * Logs into MFL with MFL_USERNAME + MFL_PASSWORD and exports the resulting
 * MFL_USER_ID / MFL_IS_COMMISH cookies to $GITHUB_ENV, masked, so every later
 * step in the job authenticates with a cookie minted minutes ago rather than
 * one copied into a secret months ago.
 *
 * WHY: the stored MFL_USER_ID secret expires, and when it does every job that
 * replays it fails the same way regardless of what the commit changed. On
 * 2026-09-05 that turned the integration test's auto-revert into a loop that
 * redeployed production every 75 seconds. The username/password secrets do not
 * expire, so a job that can log in never depends on the stored cookie being
 * alive.
 *
 * Degrades in order, never fails the job by itself:
 *   1. login succeeds            → fresh cookies exported
 *   2. login fails / no creds    → the stored MFL_USER_ID / MFL_IS_COMMISH
 *                                  (if any) are exported unchanged, with a
 *                                  ::warning:: so the run shows why
 *
 * Later steps must NOT re-declare `MFL_USER_ID: ${{ secrets.MFL_USER_ID }}`
 * in their own `env:` — a step-level env wins over $GITHUB_ENV, which would
 * silently put the stale cookie back. tests/mfl-integration-rollback-guard
 * pins that for the integration-test workflow.
 *
 * Outside Actions ($GITHUB_ENV unset) it prints what it would export, with
 * the values redacted, so it can be smoke-tested locally.
 */

import { appendFileSync } from 'node:fs';
import { loginToMFL } from './lib/mfl-api.mjs';

const username = process.env.MFL_USERNAME;
const password = process.env.MFL_PASSWORD;
const storedUserId = process.env.MFL_USER_ID;
const storedIsCommish = process.env.MFL_IS_COMMISH;

/**
 * Decide which cookies to export. Pure, so the fallback order is testable
 * without a network: `login` is the (possibly failed) login result.
 *
 * @param {{ mflUserId?: string, mflIsCommish?: string } | null} login
 * @param {{ userId?: string, isCommish?: string }} stored
 * @returns {{ source: 'login' | 'stored' | 'none', userId?: string, isCommish?: string }}
 */
export function pickMflSession(login, stored) {
  if (login?.mflUserId) {
    return { source: 'login', userId: login.mflUserId, isCommish: login.mflIsCommish ?? stored.isCommish };
  }
  if (stored.userId) {
    return { source: 'stored', userId: stored.userId, isCommish: stored.isCommish };
  }
  return { source: 'none' };
}

function exportVar(name, value) {
  if (!value) return;
  // Mask BEFORE the value can appear in any later step's output.
  console.log(`::add-mask::${value}`);
  const envFile = process.env.GITHUB_ENV;
  if (envFile) {
    appendFileSync(envFile, `${name}=${value}\n`);
  } else {
    console.log(`(no GITHUB_ENV) would export ${name}=<${value.length} chars>`);
  }
}

async function main() {
  let login = null;
  if (username && password) {
    try {
      login = await loginToMFL(username, password);
      console.log(
        `[mint-mfl-session] Logged in via MFL_USERNAME/MFL_PASSWORD${login.mflIsCommish ? ' (commish cookie present)' : ''}.`,
      );
    } catch (err) {
      console.log(`::warning::[mint-mfl-session] MFL login failed — falling back to the stored cookie: ${err.message}`);
    }
  } else {
    console.log('::notice::[mint-mfl-session] MFL_USERNAME/MFL_PASSWORD not set — using the stored cookie as-is.');
  }

  const session = pickMflSession(login, { userId: storedUserId, isCommish: storedIsCommish });
  if (session.source === 'none') {
    console.log('::warning::[mint-mfl-session] No MFL session available (no login, no stored cookie).');
    return;
  }
  exportVar('MFL_USER_ID', session.userId);
  exportVar('MFL_IS_COMMISH', session.isCommish);
  console.log(`[mint-mfl-session] Exported MFL session from ${session.source}.`);
}

// Only run when executed directly, so the pure helper can be imported by tests.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    // Never fail the job from here: a login problem is reported, and the
    // steps that need the cookie report their own failure with context.
    console.log(`::warning::[mint-mfl-session] ${err.message}`);
  });
}
