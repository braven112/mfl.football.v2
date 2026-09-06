/**
 * What to call a time zone AT AN INSTANT.
 *
 * Its own module, importing NOTHING, for one reason: both renderers need the
 * identical answer, and the two live on opposite sides of a dependency wall.
 * `formatKickoffZones` (sunday-ticket-slate.ts) is reachable from a Storybook
 * story, so Chromatic treats everything it can reach as a rendering file —
 * which is why `viewer-preferences.ts` keeps its catalog, seeds and registry
 * ties out of that graph. Importing the label resolver from there would drag
 * all of it in and wake every board snapshot on a seed edit; keeping a second
 * copy here would drift the first time a country with an `auto` zone is added.
 * A leaf module is the only shape that is neither.
 */

/** A zone as the catalog stores it — the shape both renderers pass in. */
export interface ZoneLabelSpec {
  zone: string;
  /** A fixed label (the site's ET / PT convention) or 'auto' for Intl's short name. */
  label: string;
  /** Locale for an `auto` label; en-AU spells "AEDT" where en-US says "GMT+11". */
  locale?: string;
}

/**
 * `auto` is resolved rather than stored because the answer changes with the
 * date: Sydney is AEST for most of the NFL season and AEDT from October, and
 * Britain spends the season on BST before flipping back in late October. A
 * fixed label would lie for months of every year — which is the whole reason
 * the catalog spells those zones `auto` in the first place.
 */
export function resolveZoneLabel(spec: ZoneLabelSpec, at: Date): string {
  if (spec.label !== 'auto') return spec.label;
  const named = new Intl.DateTimeFormat(spec.locale ?? 'en-US', {
    timeZone: spec.zone,
    timeZoneName: 'short',
  }).formatToParts(at);
  return named.find((p) => p.type === 'timeZoneName')?.value ?? spec.zone;
}
