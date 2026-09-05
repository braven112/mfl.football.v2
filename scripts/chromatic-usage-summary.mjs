#!/usr/bin/env node
/**
 * Turn a Chromatic run into a cost line in the GitHub Actions job summary.
 *
 * Chromatic's own Manage screen is the authority on the monthly quota, but it
 * lives behind a login and says nothing about which build spent what. This
 * writes the per-build numbers where you already are — the run's Summary tab —
 * so the cost of a push is visible without opening Chromatic at all.
 *
 * Reads `chromatic-diagnostics.json`, which the CLI writes next to the working
 * directory on every run (including failed ones). Field names come from the
 * Build type in chromatic/dist/node.d.cts. The file's exact nesting is not
 * contractual, so we search for the object that carries the counts rather than
 * hard-coding a path — a shape change degrades this to "couldn't parse", never
 * to a wrong number.
 *
 * Never fails the job: usage reporting must not turn a green build red.
 */

import { readFileSync, appendFileSync, existsSync } from 'node:fs';

const DIAGNOSTICS = process.argv[2] ?? 'chromatic-diagnostics.json';

/** Depth-first search for the first object carrying the build counters. */
function findBuild(node, depth = 0) {
  if (depth > 8 || node === null || typeof node !== 'object') return null;
  if (typeof node.actualCaptureCount === 'number' && typeof node.changeCount === 'number') {
    return node;
  }
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    const found = findBuild(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function main() {
  if (!existsSync(DIAGNOSTICS)) {
    console.log(`[chromatic-usage] no ${DIAGNOSTICS} — nothing to report`);
    return;
  }

  let build;
  try {
    build = findBuild(JSON.parse(readFileSync(DIAGNOSTICS, 'utf8')));
  } catch (err) {
    console.log(`[chromatic-usage] could not parse ${DIAGNOSTICS}: ${err.message}`);
    return;
  }

  if (!build) {
    console.log('[chromatic-usage] no build counters found in diagnostics');
    return;
  }

  const captured = build.actualCaptureCount ?? 0;
  const inherited = build.inheritedCaptureCount ?? 0;
  const turboSnap = build.turboSnapEnabled === true;

  // Chromatic bills a fresh capture at 1 and a TurboSnap-inherited snapshot at
  // 0.2. This is an ESTIMATE of this build's cost, not an account balance —
  // the Manage screen remains the authority on the monthly total.
  const billed = captured + inherited * 0.2;

  const lines = [
    '## Chromatic',
    '',
    `**Build ${build.number ?? '?'}** — ${build.componentCount ?? '?'} components, ${build.specCount ?? '?'} stories`,
    '',
    '| | |',
    '|---|---|',
    `| Snapshots captured | ${captured} |`,
    `| Inherited (TurboSnap) | ${inherited} |`,
    `| **Estimated billed** | **${billed.toFixed(1)}** |`,
    `| TurboSnap active | ${turboSnap ? 'yes' : 'no'} |`,
    `| Visual changes | ${build.changeCount ?? 0} |`,
    `| Errors | ${build.errorCount ?? 0} |`,
    `| Auto-accepted | ${build.autoAcceptChanges ? 'yes' : 'no'} |`,
    '',
  ];

  if (build.wasLimited) {
    lines.push('> **This build was LIMITED — the monthly snapshot quota is exhausted.**', '');
  }
  if (!turboSnap) {
    lines.push(
      '> TurboSnap is not active, so every story was captured at full price.',
      '> It is NOT the account tier and NOT a missing stats file. Two causes,',
      '> and the log names which one — search the Chromatic step above for',
      '> "TurboSnap disabled":',
      '>',
      '> 1. `...due to matching --externals` — a changed file matched an',
      '>    `externals` glob in `chromatic.config.json`.',
      '> 2. `...due to file change` / "cannot be linked to any specific',
      '>    stories" — a changed STATIC file under `public/`. Any such file',
      '>    forces a full build, whether or not it is in `externals`. Add it',
      '>    to `untraced` if no story renders it (What\'s New screenshots are',
      '>    already there).',
      '',
    );
  }
  if (build.webUrl) lines.push(`[Review this build](${build.webUrl})`, '');
  if (build.app?.manageUrl) {
    lines.push(`[Monthly quota and billing](${build.app.manageUrl}) — the authority on usage.`, '');
  }

  const summary = lines.join('\n');
  console.log(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  }
}

try {
  main();
} catch (err) {
  // Reporting is best-effort by design.
  console.log(`[chromatic-usage] skipped: ${err.message}`);
}
