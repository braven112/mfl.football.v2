import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Two ways the screenshot workflow broke in Nov 2026, pinned so neither
 * comes back:
 *
 * 1. `runs-on: ubuntu-latest` moved to Ubuntu 26.04, which Playwright 1.57
 *    cannot install Chromium on. Every staging run failed and the baselines
 *    stopped updating. Baselines are only comparable to renders from one
 *    runner image, so the image is pinned and moved on purpose.
 * 2. The `visual-baselines` branch is an orphan holding only PNGs, so the
 *    repo's vercel.json never reaches it and Vercel tried (and failed) to
 *    build it on every baselines push. The push step writes its own
 *    vercel.json turning deployments off.
 */
const workflow = readFileSync('.github/workflows/visual-tests.yml', 'utf8');

describe('visual-tests workflow', () => {
  it('pins the runner image instead of ubuntu-latest', () => {
    expect(workflow).not.toMatch(/runs-on:\s*ubuntu-latest/);
    expect(workflow).toMatch(/runs-on:\s*ubuntu-\d\d\.\d\d/);
  });

  it('writes a vercel.json that disables deployments into the baselines branch before committing', () => {
    const push = workflow.slice(workflow.indexOf('- name: Push baselines'));
    const write = push.indexOf('> vercel.json');
    const add = push.indexOf('git add -A');
    expect(write).toBeGreaterThan(-1);
    expect(write).toBeLessThan(add);
    expect(push).toMatch(/"deploymentEnabled":\s*false/);
  });
});
