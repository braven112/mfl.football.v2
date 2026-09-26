#!/usr/bin/env node
/**
 * `postbuild` hook: on a demo build, run the leak scan over the finished
 * output and fail the deployment on any real league name. A no-op everywhere
 * else. See scripts/demo/leak-scan.mjs and docs/plans/custom-site-demo.md.
 */
import { execFileSync } from 'node:child_process';
import { isDemoEnv } from '../../src/utils/demo-isolation-core.mjs';

if (isDemoEnv(process.env)) {
  execFileSync('node', ['scripts/demo/leak-scan.mjs'], { stdio: 'inherit' });
}
