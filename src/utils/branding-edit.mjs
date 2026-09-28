/**
 * Commissioner branding edits — what may change, what is valid, and how an
 * edit lands in a league's config file.
 *
 * ONE module on purpose. The API validates an edit before dispatching the
 * publish workflow, and the workflow's script (scripts/apply-branding-edit.mjs)
 * validates it AGAIN before writing, because the workflow can be dispatched by
 * hand from the Actions tab and must not trust its input. Both call these
 * functions, so the two checks cannot drift.
 *
 * SCOPE: a team's CURRENT identity only. Throwback eras (`history[]`) have their
 * own recompute chain (docs/claude/insights/features/throwback-week.md) and are
 * never touched here; neither are ids, divisions or anything MFL owns.
 *
 * Pure: no fs, no network. Callers load and write the file.
 */

/** Same limits the site's name chooser enforces (src/utils/team-names.ts). */
export const BRANDING_LIMITS = Object.freeze({
  name: 40,
  nameMedium: 15,
  nameShort: 10,
  abbrevMin: 2,
  abbrevMax: 5,
  aliasCount: 10,
  alias: 30,
  url: 500,
});

export const NAME_FIELDS = Object.freeze(['name', 'nameMedium', 'nameShort', 'abbrev']);
export const COLOR_FIELDS = Object.freeze(['colorPrimary', 'colorSecondary', 'colorTertiary', 'colorQuaternary']);
export const IMAGE_FIELDS = Object.freeze(['icon', 'iconDark', 'banner']);
export const EDITABLE_FIELDS = Object.freeze([...NAME_FIELDS, 'aliases', ...COLOR_FIELDS, ...IMAGE_FIELDS]);

const HEX = /^#[0-9a-f]{6}$/;

/** Vercel Blob public hosts, the only place an uploaded mark may live. */
export function isBlobUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && /\.public\.blob\.vercel-storage\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** A site-relative asset path this league already ships (e.g. the suggested icons). */
function isOwnAssetPath(value, leagueSlug) {
  return typeof value === 'string' && value.startsWith(`/assets/${leagueSlug}/`) && !value.includes('..');
}

const clean = (v) =>
  String(v ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Validate one team's edit.
 *
 * `input` holds only the fields being changed; anything not in
 * EDITABLE_FIELDS is rejected rather than ignored, so a typo'd field name is
 * an error instead of a silent no-op. An image field may be a Blob URL (a new
 * upload), the team's CURRENT value (unchanged), or one of this league's own
 * `/assets/<league>/` paths.
 *
 * @param {Record<string, unknown>} input
 * @param {{ leagueSlug: string, current: Record<string, unknown> }} ctx
 * @returns {{ ok: true, patch: Record<string, unknown> } | { ok: false, errors: string[] }}
 */
export function validateBrandingEdit(input, { leagueSlug, current }) {
  const errors = [];
  const patch = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['The edit must be an object of fields.'] };
  }

  for (const key of Object.keys(input)) {
    if (!EDITABLE_FIELDS.includes(key)) errors.push(`"${key}" is not an editable field.`);
  }
  // Team names were developer-committed until this editor existed, and some
  // surfaces still build HTML from them on the client. Refusing angle brackets
  // keeps a commissioner-typed name from ever becoming markup there.
  for (const key of ['name', 'nameMedium', 'nameShort']) {
    if (key in input && /[<>]/.test(String(input[key] ?? ''))) errors.push(`${key} cannot contain < or >.`);
  }
  if (Array.isArray(input.aliases) && input.aliases.some((a) => /[<>]/.test(String(a ?? '')))) {
    errors.push('Aliases cannot contain < or >.');
  }

  if ('name' in input) {
    const v = clean(input.name);
    if (!v) errors.push('Team name is required.');
    else if (v.length > BRANDING_LIMITS.name) errors.push(`Team name must be ${BRANDING_LIMITS.name} characters or fewer.`);
    else patch.name = v;
  }
  if ('nameMedium' in input) {
    const v = clean(input.nameMedium);
    if (!v) errors.push('Medium name is required.');
    else if (v.length > BRANDING_LIMITS.nameMedium) errors.push(`Medium name must be ${BRANDING_LIMITS.nameMedium} characters or fewer.`);
    else patch.nameMedium = v;
  }
  if ('nameShort' in input) {
    const v = clean(input.nameShort);
    if (!v) errors.push('Short name is required.');
    else if (v.length > BRANDING_LIMITS.nameShort) errors.push(`Short name must be ${BRANDING_LIMITS.nameShort} characters or fewer.`);
    else patch.nameShort = v;
  }
  if ('abbrev' in input) {
    const v = clean(input.abbrev).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(v) || v.length < BRANDING_LIMITS.abbrevMin || v.length > BRANDING_LIMITS.abbrevMax) {
      errors.push(`Abbreviation must be ${BRANDING_LIMITS.abbrevMin}-${BRANDING_LIMITS.abbrevMax} letters or digits.`);
    } else patch.abbrev = v;
  }
  if ('aliases' in input) {
    const list = Array.isArray(input.aliases) ? input.aliases : [];
    const out = [...new Set(list.map(clean).filter(Boolean))];
    if (!Array.isArray(input.aliases)) errors.push('Aliases must be a list.');
    else if (out.length > BRANDING_LIMITS.aliasCount) errors.push(`At most ${BRANDING_LIMITS.aliasCount} aliases.`);
    else if (out.some((a) => a.length > BRANDING_LIMITS.alias)) errors.push(`Each alias must be ${BRANDING_LIMITS.alias} characters or fewer.`);
    else patch.aliases = out;
  }
  for (const key of COLOR_FIELDS) {
    if (!(key in input)) continue;
    const v = clean(input[key]).toLowerCase();
    if (v === '' && key !== 'colorPrimary' && key !== 'colorSecondary') patch[key] = null;
    else if (!HEX.test(v)) errors.push(`${key} must be a 6-digit hex colour like #1d3a6e.`);
    else patch[key] = v;
  }
  for (const key of IMAGE_FIELDS) {
    if (!(key in input)) continue;
    const v = clean(input[key]);
    if (v === '') {
      if (key === 'icon') errors.push('A team needs an icon.');
      else patch[key] = null;
      continue;
    }
    const ok =
      v.length <= BRANDING_LIMITS.url &&
      (v === current?.[key] || isBlobUrl(v) || isOwnAssetPath(v, leagueSlug));
    if (!ok) errors.push(`${key} must be an uploaded image (or keep the current one).`);
    else patch[key] = v;
  }

  if (errors.length > 0) return { ok: false, errors };
  if (Object.keys(patch).length === 0) return { ok: false, errors: ['Nothing to change.'] };
  return { ok: true, patch };
}

/**
 * Apply a validated patch to one team in a league config, returning a NEW config.
 *
 * A rename keeps the old name as an alias: Schefter's redaction must cover
 * every name a team has had (docs/claude/rules/schefter.md), and the
 * commissioner should not have to remember that. `null` removes an optional
 * field. When the primary colour changes, the chart colour (`color`) follows
 * it unless the team set a separate one.
 *
 * @param {{ teams: Array<Record<string, unknown>> }} config
 * @param {string} franchiseId
 * @param {Record<string, unknown>} patch
 */
export function applyBrandingEdit(config, franchiseId, patch) {
  const teams = Array.isArray(config?.teams) ? config.teams : [];
  const index = teams.findIndex((t) => t?.franchiseId === franchiseId);
  if (index === -1) throw new Error(`No franchise ${franchiseId} in this league's config.`);
  const before = teams[index];
  const next = { ...before };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }

  if (patch.colorPrimary && (!before.color || before.color === before.colorPrimary)) {
    next.color = patch.colorPrimary;
  }

  if (typeof patch.name === 'string' && before.name && patch.name !== before.name) {
    const aliases = Array.isArray(next.aliases) ? next.aliases : [];
    if (!aliases.includes(before.name)) next.aliases = [...aliases, before.name];
  }

  const out = { ...config, teams: [...teams] };
  out.teams[index] = next;
  return out;
}
