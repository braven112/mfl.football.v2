import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  COMMENT_MARKER,
  STATUS_PREFIX,
  buildComment,
  renderSection,
  renderSections,
  overallStatus,
} from '../scripts/lib/pr-review-providers.mjs';

/**
 * `/live` runs the Codex correctness-and-security lens two ways: the `codex`
 * CLI on a laptop, and `scripts/pr-review-external.mjs --providers openai
 * --section-only` in the Claude cloud sandbox, where that CLI (and the plugin
 * wrapping it) does not exist and its OAuth cannot complete headless.
 *
 * Two things about that fallback are load-bearing and neither is obvious from
 * reading either file alone:
 *
 * 1. The in-session run must NOT carry COMMENT_MARKER. The marker is how the
 *    Actions workflow finds its sticky comment to PATCH; a second producer
 *    carrying it means the two reviewers share one comment slot and the last
 *    writer silently replaces the other's findings.
 * 2. A run that reviewed nothing must be distinguishable from a clean pass.
 *    The script exits 0 with a friendly sentence when no key is configured —
 *    the exact shape that got counted as "Codex: 0 findings" before, which is
 *    the bug this whole pipeline exists to prevent.
 */

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'pr-review-external.mjs');
const LIVE_MD = path.join(REPO_ROOT, '.claude', 'commands', 'live.md');

/** Run the reviewer CLI with both provider keys unset, whatever the host has. */
function runUnkeyed(args: string[]): string {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.GEMINI_API_KEY;
  return execFileSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env,
  });
}

const OK_RESULT = {
  name: 'openai',
  label: 'Codex (OpenAI)',
  status: 'ok',
  model: 'gpt-5',
  truncated: false,
  text: 'NO FINDINGS',
  focus: 'correctness & security',
};

describe('Codex cloud fallback — comment-slot separation', () => {
  it('renderSections omits the sticky-comment marker', () => {
    expect(renderSections([OK_RESULT])).not.toContain(COMMENT_MARKER);
  });

  it('buildComment keeps the marker, so the workflow can still find its comment', () => {
    expect(buildComment([OK_RESULT])).toContain(COMMENT_MARKER);
  });

  it('the marker stays byte-stable — changing it orphans every existing comment', () => {
    expect(COMMENT_MARKER).toBe('<!-- external-pr-review -->');
  });

  it('--section-only prints no marker, so its output cannot be mistaken for the sticky comment', () => {
    expect(runUnkeyed(['--providers', 'openai', '--section-only'])).not.toContain(COMMENT_MARKER);
  });
});

describe('Codex cloud fallback — a reviewer that did not run never reads as clean', () => {
  it('reports skipped when no key is configured', () => {
    const out = runUnkeyed(['--providers', 'openai', '--section-only']);
    expect(out).toContain(`${STATUS_PREFIX} skipped`);
    expect(out).not.toContain(`${STATUS_PREFIX} ok`);
  });

  it('still reports skipped when --pr is passed, and posts nothing', () => {
    // --section-only is a promise not to write to the PR. If the no-key exit
    // ever moved below postComment(), this would try to reach GitHub.
    const out = runUnkeyed(['--providers', 'openai', '--section-only', '--pr', '123']);
    expect(out).toContain(`${STATUS_PREFIX} skipped`);
    expect(out).not.toContain('Posted new review comment');
    expect(out).not.toContain('Updated existing review comment');
  });

  it('renders a skipped reviewer as skipped, not as an empty section', () => {
    const section = renderSection({
      name: 'openai',
      label: 'Codex (OpenAI)',
      status: 'skipped',
      reason: 'OPENAI_API_KEY not set',
    });
    expect(section).toContain('Skipped');
    expect(section).toContain('OPENAI_API_KEY not set');
  });

  it('renders a failed reviewer with an explicit not-reviewed warning', () => {
    const section = renderSection({
      name: 'openai',
      label: 'Codex (OpenAI)',
      status: 'error',
      model: 'gpt-5',
      reason: 'OpenAI API 429: rate limited',
    });
    expect(section).toContain('Reviewer failed to run');
    expect(section).toContain('not as a clean pass');
  });

  it('overallStatus never rounds a partial run up to ok', () => {
    expect(overallStatus([OK_RESULT])).toBe('ok');
    expect(overallStatus([])).toBe('skipped');
    expect(overallStatus([{ ...OK_RESULT, status: 'skipped' }])).toBe('skipped');
    expect(overallStatus([{ ...OK_RESULT, status: 'error' }])).toBe('skipped');
    expect(overallStatus([OK_RESULT, { ...OK_RESULT, status: 'error' }])).toBe('degraded');
  });
});

describe('Codex cloud fallback — /live still documents the ladder', () => {
  const liveMd = readFileSync(LIVE_MD, 'utf8');

  it('documents the tier-2 fallback command', () => {
    expect(liveMd).toContain('--providers openai --section-only');
  });

  it('tells the reader to trust the status line over the prose', () => {
    expect(liveMd).toContain(STATUS_PREFIX);
  });

  it('keeps a tier-3 "did not run" state — a missing key is not a pass', () => {
    expect(liveMd).toMatch(/Codex: did not run/);
  });
});
