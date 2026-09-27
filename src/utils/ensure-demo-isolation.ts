/**
 * Isolates the custom-site demo from every real league, before any other code
 * runs. A no-op everywhere else.
 *
 * On a demo deployment (`isDemoDeploy()`: `DEMO_PROFILE` set, or built from
 * the `demo` branch) this deletes the production credentials the branch
 * inherited from the shared Vercel project, installs the demo's own Redis and
 * session secret in their place, and wraps `fetch` so MyFantasyLeague is
 * answered by the demo stand-in and GroupMe/GitHub/push/Anthropic are refused.
 * See src/utils/demo-isolation.ts and docs/plans/custom-site-demo.md.
 *
 * Imported by src/middleware.ts (SSR runtime) and astro.config.ts (build /
 * prerendered pages), directly after ensure-pt-timezone and before anything
 * else: side-effect imports run in source order, and this must win before any
 * module reads a credential or makes a call. tests/demo-isolation.test.ts pins
 * the import order.
 */
import { isDemoDeploy } from './deploy-environment';
import { applyDemoIsolation } from './demo-isolation';

if (isDemoDeploy()) {
  const { removed } = applyDemoIsolation(process.env, globalThis);
  // Names only, never values.
  console.log(
    `[demo] isolation applied; removed ${removed.length} inherited credential(s)` +
      (removed.length ? `: ${removed.join(', ')}` : ''),
  );
}

export {};
