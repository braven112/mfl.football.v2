/**
 * Division display-name aliasing — ONE implementation, shared by the Astro
 * pages and the node scripts.
 *
 * A league's config carries `divisionAliases`, a map from the name MFL stores
 * to the name the league actually displays. TheLeague's is `{ Eastern: 'East' }`:
 * MFL's archives call the fourth division "Eastern" from 2012 on, while the
 * league has always displayed "East" (commissioner, 2026-08-11). MFL has since
 * been renamed to "East" too, which makes the alias a no-op for fresh fetches —
 * but committed archive feeds keep saying "Eastern" until they are refetched,
 * so this stays load-bearing rather than transitional.
 *
 * WHY .mjs: `src/utils/historical-divisions.ts` (standings/playoffs pages) and
 * `scripts/compute-franchise-history.mjs` (the franchise-history ledger) both
 * need this, and a node script cannot import the .ts. Two hand-kept copies
 * would be free to drift on exactly the edge cases nobody tests — whitespace,
 * non-string names, the metadata key — and the whole point of the alias is that
 * the ledger and the pages can never disagree about what a division is called.
 * TS importing a sibling .mjs is an established pattern here (see
 * afl-conference-rosters.mjs, franchise-id.mjs, august-cut-selection-core.mjs).
 *
 * @typedef {Record<string, string>} DivisionAliases
 */

/**
 * Normalize one MFL division name to its display name.
 *
 * Trims first, so the two callers cannot diverge on padding. Metadata keys are
 * refused explicitly: `divisionAliases` carries a `_comment` in the JSON, and a
 * real division name never starts with an underscore — so an underscore-leading
 * input is metadata leaking in, not something to resolve.
 *
 * @param {string} name Raw division name from an MFL `league.json`.
 * @param {DivisionAliases|null|undefined} aliases The league's alias map.
 * @returns {string} The display name — unchanged when no alias applies.
 */
export function aliasDivisionName(name, aliases) {
  const raw = String(name ?? '').trim();
  if (!aliases || raw.startsWith('_')) return raw;
  const mapped = aliases[raw];
  return typeof mapped === 'string' && mapped.trim() !== '' ? mapped.trim() : raw;
}

/**
 * Is this a usable division name at all? Both callers must agree, or one drops
 * a malformed entry while the other emits an empty string for it.
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isUsableDivisionName(name) {
  return typeof name === 'string' && name.trim() !== '';
}
