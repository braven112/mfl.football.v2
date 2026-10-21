#!/usr/bin/env node
/**
 * Delete baselines no story produces any more (a story or mode was removed or
 * renamed). Run after `pnpm test:visual:update`, which writes new and changed
 * baselines but never removes one.
 *
 *   node scripts/visual/prune-baselines.mjs
 *
 * The expected names are derived the same way tests/visual/stories.spec.ts
 * derives them, from tests/visual/stories.manifest.json.
 */
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'tests/visual/__screenshots__';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function expectedBaselines(stories) {
  const names = new Set();
  for (const s of stories) {
    if (s.skip) continue;
    const modes = s.modes.length ? s.modes : [{ name: 'Default' }];
    for (const m of modes) names.add(`${s.id}--${slug(m.name)}.png`);
  }
  return names;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stories = JSON.parse(readFileSync('tests/visual/stories.manifest.json', 'utf8'));
  const keep = expectedBaselines(stories);
  if (!existsSync(DIR)) process.exit(0);
  const stale = readdirSync(DIR).filter((f) => f.endsWith('.png') && !keep.has(f));
  for (const f of stale) rmSync(join(DIR, f));
  console.log(`pruned ${stale.length} stale baseline(s)`);
}
