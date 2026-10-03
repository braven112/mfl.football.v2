/**
 * The launch spec — what the League Launcher page sends and
 * scripts/new-league.mjs builds a league from. One validator for both, so the
 * page refuses exactly what the generator would.
 *
 * Pure (no filesystem): the site runs it before dispatching a launch, where
 * src/pages does not exist. The generator adds its filesystem checks (theme
 * file, page directory) on top.
 */
import { ALL_LEAGUES } from './leagues-data.mjs';
import { ARCHETYPE_KEYS } from './league-archetypes.mjs';
import { FEATURE_KEYS, featureDependencyErrors } from './league-feature-catalog.mjs';

/** Lowercase letters/digits, starting with a letter: safe as a slug, nav slug, path and JS identifier. */
export const SLUG_RE = /^[a-z][a-z0-9]{1,23}$/;
/** Text that is safe inside the generated source and JSON. */
export const SAFE_TEXT_RE = /^[^"`\\<>{}$]+$/;

/** Every problem with a spec, as readable strings. Empty = valid. */
export function specErrors(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return ['spec must be a JSON object'];
  if (!/^\d{3,6}$/.test(String(spec.mflId ?? ''))) errors.push('mflId must be a 3–6 digit MFL league id');
  if (!SLUG_RE.test(String(spec.slug ?? ''))) {
    errors.push('slug must be 2–24 lowercase letters/digits, starting with a letter (it is also the nav slug)');
  }
  for (const key of ['name', 'shortName']) {
    if (key === 'shortName' && (spec.shortName === undefined || spec.shortName === '')) continue;
    if (typeof spec[key] !== 'string' || !spec[key].trim() || spec[key].length > 80 || !SAFE_TEXT_RE.test(spec[key])) {
      errors.push(`${key} must be plain text up to 80 characters (no quotes, backticks, braces or angle brackets)`);
    }
  }
  if (!/^www\d+\.myfantasyleague\.com$/.test(String(spec.mflHost ?? ''))) {
    errors.push("mflHost must be the league's MFL server, e.g. wwwNN.myfantasyleague.com");
  }
  if (!ARCHETYPE_KEYS.includes(spec.archetype)) errors.push(`archetype must be one of ${ARCHETYPE_KEYS.join(', ')}`);
  const features = spec.features ?? {};
  const keys = Object.keys(features).sort();
  if (keys.join() !== [...FEATURE_KEYS].sort().join()) errors.push(`features must set exactly: ${FEATURE_KEYS.join(', ')}`);
  for (const [k, v] of Object.entries(features)) if (typeof v !== 'boolean') errors.push(`features.${k} must be true/false`);
  errors.push(...featureDependencyErrors(features));
  if (spec.duplicatePlayers !== undefined && typeof spec.duplicatePlayers !== 'boolean') {
    errors.push('duplicatePlayers must be true/false');
  }
  if (spec.adminFranchiseIds !== undefined && !Array.isArray(spec.adminFranchiseIds)) {
    errors.push('adminFranchiseIds must be a list');
  }
  for (const id of spec.adminFranchiseIds ?? []) if (!/^\d{4}$/.test(String(id))) errors.push(`admin franchise id ${id} is not 4 digits`);
  if (spec.theme !== undefined && !/^[a-z0-9-]{2,24}$/.test(String(spec.theme))) errors.push('theme must be a theme id');
  const clash = ALL_LEAGUES.find((l) => l.slug === spec.slug || l.navSlug === spec.slug || l.id === String(spec.mflId));
  if (clash) errors.push(`league ${clash.slug} already uses that slug or MFL id`);
  return errors;
}

/** Only the fields a spec may carry, so nothing else rides into the workflow input. */
export function cleanSpec(spec) {
  const out = {
    mflId: String(spec.mflId),
    slug: spec.slug,
    name: spec.name.trim(),
    mflHost: spec.mflHost,
    archetype: spec.archetype,
    features: Object.fromEntries(FEATURE_KEYS.map((k) => [k, Boolean(spec.features[k])])),
  };
  if (spec.shortName) out.shortName = spec.shortName.trim();
  if (spec.duplicatePlayers) out.duplicatePlayers = true;
  if (spec.adminFranchiseIds?.length) out.adminFranchiseIds = spec.adminFranchiseIds.map(String);
  if (spec.theme) out.theme = spec.theme;
  return out;
}
