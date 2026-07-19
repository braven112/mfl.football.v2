#!/usr/bin/env node
/**
 * Read-only owner-cookie replay canary for the August cuts automation.
 *
 * The deadline job (scripts/apply-august-cuts.mjs) executes cuts by replaying
 * owners' stored MFL session cookies from a GitHub Actions runner. This check
 * continuously verifies that mechanism between build time and August: it
 * replays the stored test cookie against the cheap authenticated read
 * (export?TYPE=myleagues&JSON=1 — returns {"leagues":{}} when the cookie is
 * dead, per docs/claude/insights/domains/mfl-api.md) and fails loudly if the
 * cookie no longer authenticates.
 *
 * Runs from .github/workflows/mfl-integration-test.yml. Strictly read-only —
 * the write path got its one live proof in the Phase 0 spike. Skips itself
 * (exit 0) when MFL_USER_ID is absent so forks/PRs without secrets stay green.
 */

import { mflFetch, extractMyLeagues } from './lib/mfl-api.mjs';

const cookie = process.env.MFL_USER_ID;
if (!cookie) {
  console.log('::notice::MFL_USER_ID not set — skipping owner-cookie replay check.');
  process.exit(0);
}

const year = new Date().getFullYear();
const url = `https://api.myfantasyleague.com/${year}/export?TYPE=myleagues&JSON=1`;

try {
  const res = await mflFetch({ url, cookies: { MFL_USER_ID: cookie } });
  if (!res.ok) {
    console.error(`::error::owner-cookie replay check: myleagues read returned HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json().catch(() => null);
  // MFL wraps this response as either `myleagues` or `leagues` depending on
  // the host/year — extractMyLeagues tolerates both (and a bare object).
  const list = extractMyLeagues(body);
  if (list.length === 0) {
    console.error(
      '::error::owner-cookie replay check FAILED — the stored MFL cookie no longer authenticates ' +
        '(myleagues returned no leagues). Cookie replay for the August cuts job would fail the same way; ' +
        'refresh the MFL_USER_ID secret.',
    );
    process.exit(1);
  }
  console.log(`::notice::owner-cookie replay OK — myleagues returned ${list.length} league(s).`);
} catch (err) {
  console.error(`::error::owner-cookie replay check errored: ${err.message}`);
  process.exit(1);
}
