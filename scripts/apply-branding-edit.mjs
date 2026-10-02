#!/usr/bin/env node
/**
 * Publish one commissioner branding edit: validate it again, apply it to the
 * league's config file, write the file. Run by .github/workflows/branding-edit.yml,
 * which commits the result so the next deploy carries it everywhere the site
 * reads branding (it is read at build time in hundreds of places, so the
 * committed file stays the single source of truth).
 *
 * Input comes from the environment, never argv, so nothing the commissioner
 * typed is ever interpolated into a shell command:
 *   BRANDING_LEAGUE     registry slug, e.g. archies
 *   BRANDING_FRANCHISE  four-digit MFL franchise id
 *   BRANDING_PATCH      JSON object of changed fields
 *   BRANDING_DRY_RUN    "true" prints the result and writes nothing
 *
 * Validation repeats what /api/admin/branding did (src/utils/branding-edit.mjs),
 * because this workflow can also be dispatched by hand from the Actions tab.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { applyBrandingEdit, validateBrandingEdit } from '../src/utils/branding-edit.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * @param {{ leagueSlug: string, franchiseId: string, patchJson: string, dryRun?: boolean, root?: string,
 *   log?: { log: (...args: unknown[]) => void } }} opts
 */
export function runBrandingEdit({ leagueSlug, franchiseId, patchJson, dryRun = false, root = ROOT, log = console }) {
  const league = getLeagueBySlug(leagueSlug);
  if (!league) throw new Error(`Unknown league: ${leagueSlug}`);
  if (!league.features?.brandingEditor) throw new Error(`${leagueSlug} does not have the branding editor turned on.`);
  if (!/^\d{4}$/.test(String(franchiseId))) throw new Error(`Bad franchise id: ${franchiseId}`);

  let input;
  try {
    input = JSON.parse(patchJson);
  } catch {
    throw new Error('BRANDING_PATCH is not valid JSON.');
  }

  const file = path.join(root, league.configPath);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const current = (config.teams ?? []).find((t) => t.franchiseId === franchiseId);
  if (!current) throw new Error(`No franchise ${franchiseId} in ${league.configPath}.`);

  const checked = validateBrandingEdit(input, { leagueSlug, current });
  if (!checked.ok) throw new Error(`Rejected: ${checked.errors.join(' ')}`);

  const next = applyBrandingEdit(config, franchiseId, checked.patch);
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (dryRun) {
    log.log(JSON.stringify(next.teams.find((t) => t.franchiseId === franchiseId), null, 2));
    return { written: false };
  }
  fs.writeFileSync(file, text);
  log.log(`Updated ${current.name} (${franchiseId}) in ${league.configPath}: ${Object.keys(checked.patch).join(', ')}`);
  return { written: true, file: league.configPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runBrandingEdit({
      leagueSlug: process.env.BRANDING_LEAGUE ?? '',
      franchiseId: process.env.BRANDING_FRANCHISE ?? '',
      patchJson: process.env.BRANDING_PATCH ?? '',
      dryRun: process.env.BRANDING_DRY_RUN === 'true',
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
