/**
 * Loaded into every process the demo build runs, with
 * `node --import ./scripts/demo/lib/guard-preload.mjs` (build-demo-data.mjs
 * sets it through NODE_OPTIONS, so the site's own compute scripts get it too).
 *
 * The demo build must produce the league from generated files alone. So in
 * every build process this:
 *   1. deletes the production credentials the demo branch inherits
 *      (the same families the server scrubs — demo-isolation-core.mjs);
 *   2. refuses EVERY outbound network call — fetch, http, https. Stricter than
 *      the server, which may still reach ESPN: a build step that fetches is a
 *      build step that could pull real league data (update:salary:all, the one
 *      prebuild step that always runs, live-fetches the real league's rosters).
 *
 * A refused call throws; build-demo-data.mjs treats any step failure as fatal,
 * so a fetch cannot be swallowed the way scripts/prebuild.mjs swallows one.
 */

import http from 'node:http';
import https from 'node:https';
import { scrubDemoEnvironment } from '../../../src/utils/demo-isolation-core.mjs';

export class DemoBuildNetworkError extends Error {
  constructor(target) {
    super(`Demo build refused a network call to ${target}. The demo build is offline by design — see scripts/demo/lib/guard-preload.mjs.`);
    this.name = 'DemoBuildNetworkError';
  }
}

const describe = (input) => {
  try {
    if (typeof input === 'string') return new URL(input).host;
    if (input instanceof URL) return input.host;
    if (input && typeof input === 'object') return input.url ? new URL(input.url).host : input.hostname ?? input.host ?? 'unknown';
  } catch {
    /* fall through */
  }
  return String(input);
};

scrubDemoEnvironment(process.env);
// Belt and braces for the one step known to fetch unconditionally.
process.env.SKIP_SALARY_FETCH = '1';

globalThis.fetch = async (input) => {
  throw new DemoBuildNetworkError(describe(input));
};
for (const mod of [http, https]) {
  const refuse = (input) => {
    throw new DemoBuildNetworkError(describe(input));
  };
  mod.request = refuse;
  mod.get = refuse;
}
