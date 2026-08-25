/**
 * Franchise ⇄ owner cross-linking.
 *
 * Both franchises index pages show a "Former Identities" strip, and the
 * destination they want is the OWNER page, not an era anchor: franchise detail
 * pages filter their eras to seasons the current owner is attributed
 * (`[id].astro`'s `renderedEraStarts`), so an identity held by a PRIOR owner of
 * the slot can never have an anchor to land on. That is why TheLeague's strip
 * resolved 0 of 23 links before the owners feature existed — re-keying the
 * anchor map would not have fixed it, because the anchor is genuinely absent.
 *
 * `identityIndex` in `owner-tenures.json` is keyed
 * `normalizeIdentity(name)|yearStart`, matching what
 * `buildHistoricalIdentities()` returns — with one wrinkle this helper exists
 * to absorb.
 */
import { normalizeIdentity } from './identity-normalize.mjs';

/** The `identityIndex` map from a league's `owner-tenures.json`. */
export type IdentityIndex = Record<string, string>;

/**
 * The owner slug that owned `name` starting in `yearStart`, or null.
 *
 * TWO keys are tried, in order, and both are load-bearing:
 *
 *  1. The strip's own display name. When an identity group covers more than one
 *     name, `buildHistoricalIdentities()` joins them ("Foo / Bar") while
 *     `owner-tenures.json` indexes each name separately — so a combined name
 *     misses.
 *  2. The DOMINANT name — the first segment of that join — which is exactly
 *     what the index holds.
 *
 * Measured on real data: 23/23 (TheLeague) and 95/95 (AFL) identities resolve,
 * and exactly one of TheLeague's needs step 2. Dropping either step is a silent
 * regression to a dead link, which is what this whole strip already was.
 */
export function ownerSlugForIdentity(
  identityIndex: IdentityIndex,
  name: string,
  yearStart: number
): string | null {
  const key = (n: string) => `${normalizeIdentity(n)}|${yearStart}`;
  const direct = identityIndex[key(name)];
  if (direct) return direct;
  const dominant = name.split(' / ')[0];
  return identityIndex[key(dominant)] ?? null;
}
