import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * MFL integration-test rollback guard.
 *
 * `.github/workflows/mfl-integration-test.yml` reverts the pushed commit on
 * main when the contract-write test against the test league fails. Two
 * conditions on that rollback are load-bearing, and this test pins them:
 *
 *   1. It must never revert a commit the bot itself authored. A revert of a
 *      bot revert re-lands the original commit, which fails the same way and
 *      is reverted again. On 2026-09-05 that loop ran on main for over an
 *      hour: a production deploy and a new GitHub issue every ~75 seconds,
 *      with routes shipped by the reverted PR (the notifications preferences
 *      API among them) returning 404 on every other deploy.
 *
 *   2. It must not revert when the stored MFL cookie is dead. Every commit
 *      fails the write test the same way then ("API requires commissioner
 *      access"), so a revert removes unrelated work and fixes nothing — the
 *      loop above started from an expired cookie, not a bad commit.
 *
 * A string scan, deliberately: the guard is on the job's `if:` expression,
 * and parsing YAML to reach it would only add a dependency to get the same
 * text back.
 */

const WORKFLOW = '.github/workflows/mfl-integration-test.yml';
const BOT_NAME = 'MFL Integration Bot';

function rollbackIf(): string {
  const text = readFileSync(WORKFLOW, 'utf8');
  const start = text.indexOf('\n  rollback:');
  expect(start, `${WORKFLOW} has no rollback job`).toBeGreaterThan(-1);
  const job = text.slice(start);
  const match = job.match(/\n    if:\s*(>-?\s*)?([\s\S]*?)\n    [a-z]/);
  expect(match, 'rollback job has no if: condition').not.toBeNull();
  return match![2].replace(/\s+/g, ' ');
}

describe('mfl-integration-test rollback guard', () => {
  it('never reverts a commit authored by the bot (a revert of a revert is the loop)', () => {
    const cond = rollbackIf();
    expect(cond).toContain(`github.event.head_commit.author.name != '${BOT_NAME}'`);
  });

  it('the bot name in the guard is the one the revert step commits with', () => {
    const text = readFileSync(WORKFLOW, 'utf8');
    expect(text).toContain(`git config user.name "${BOT_NAME}"`);
  });

  it('does not revert when the MFL cookie is dead (an environment failure is not a regression)', () => {
    const cond = rollbackIf();
    expect(cond).toContain("needs.integration-test.outputs.cookie_ok == 'true'");
    const text = readFileSync(WORKFLOW, 'utf8');
    expect(text).toMatch(/cookie_ok:\s*\$\{\{\s*steps\.cookie\.outcome == 'success'\s*\}\}/);
    expect(text).toMatch(/\n\s+id: cookie\n/);
  });

  it('still only fires for pushes to main', () => {
    const cond = rollbackIf();
    expect(cond).toContain('failure()');
    expect(cond).toContain("github.event_name == 'push'");
    expect(cond).toContain("github.ref == 'refs/heads/main'");
  });
});
