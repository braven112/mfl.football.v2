/**
 * Owner links — the request-time loaders every owner surface reads through.
 *
 * `loadLiveOwnerTenures(slug)` is the committed `owner-tenures.json` plus the
 * league's APPROVED links (owner-link-overlay.mjs); `loadLiveLeagueHistory`
 * re-credits `league-history.json` to those tenures. With no approved link
 * both return the committed file unchanged, so a league nobody has linked in
 * renders exactly what it did before.
 *
 * Which leagues: those whose owners are fully claimed in owners-registry.json
 * (`ownerLinksSupported`). A link is expressed as a registry claim, so a league
 * still on inferred owners (no claims) has nothing to carve; it is left out by
 * data, not by slug.
 *
 * Caching: approved links are read at most every LINKS_TTL_MS per instance,
 * and the rebuilt payload is memoized on the approved set's signature, so a
 * page view pays one Redis read, not a rebuild. A write on this instance
 * clears the cache (`invalidateOwnerLinks`), which is what makes an approval
 * show up on the very next request.
 */
import { getLeagueBySlug } from '../config/leagues';
import { loadLeagueData, onLeagueDataChange } from './league-data';
import { listOwnerLinks, type OwnerLink } from './owner-link-store';
import {
  approvedLinks,
  latestLedgerYear,
  overlayHistoryDataset,
  overlayOwnerTenures,
} from './owner-link-overlay.mjs';
import type { OwnerTenuresFile } from '../types/owner-tenures';

const LINKS_TTL_MS = 15_000;

/** owners-registry.json, read through the league-data loader (never bundled). */
const REGISTRY_PATH = 'src/data/owners-registry.json';
const loadRegistry = () => loadLeagueData<any>(REGISTRY_PATH);

/** Leagues with registry claims — the ones a link can be expressed in. */
export async function ownerLinksSupported(leagueSlug: string): Promise<boolean> {
  const registry = await loadRegistry();
  return Boolean(registry?.people?.some((p: any) => (p.claims ?? []).some((c: any) => c.league === leagueSlug)));
}

const linkCache = new Map<string, { at: number; links: OwnerLink[] }>();

/** Every stored link for the league (any state), briefly cached. */
export async function cachedOwnerLinks(leagueSlug: string): Promise<OwnerLink[]> {
  const hit = linkCache.get(leagueSlug);
  if (hit && Date.now() - hit.at < LINKS_TTL_MS) return hit.links;
  const links = await listOwnerLinks(leagueSlug).catch((e) => {
    console.warn('[owner-links] read failed; serving committed owners', e);
    return [] as OwnerLink[];
  });
  linkCache.set(leagueSlug, { at: Date.now(), links });
  return links;
}

export function invalidateOwnerLinks(leagueSlug: string): void {
  linkCache.delete(leagueSlug);
}

const derived = (dataPath: string, file: string) => `${dataPath}/derived/${file}`;

async function loadInputs(leagueSlug: string) {
  const league = getLeagueBySlug(leagueSlug)!;
  const [config, ledger, history, awards] = await Promise.all([
    league.configPath ? loadLeagueData<any>(league.configPath) : null,
    loadLeagueData<any>(derived(league.dataPath, 'season-ledger.json')),
    loadLeagueData<any>(derived(league.dataPath, 'franchise-history.json')),
    loadLeagueData<any>(`${league.dataPath}/awards-history.json`),
  ]);
  if (!config || !ledger || !history) return null;
  const teams = Array.isArray(config.teams) ? config.teams : Object.values(config.teams ?? config);
  // Same flattening as scripts/lib/owner-tenure-inputs.mjs#loadAwardRows.
  const awardRows: Array<{ year: number; slug: string; sourceFranchiseId: string }> = [];
  for (const season of awards?.seasons ?? []) {
    for (const [slug, award] of Object.entries<any>(season.awards ?? {})) {
      if (award?.sourceFranchiseId) awardRows.push({ year: season.year, slug, sourceFranchiseId: award.sourceFranchiseId });
    }
  }
  return { teams, ledgerRows: ledger.rows ?? [], yearSummaries: history.yearSummaries ?? [], awardRows };
}

const memo = new Map<string, { signature: string; committed: unknown; data: OwnerTenuresFile }>();
// A data sync that moves the derived files drops the rebuilt payloads with it.
onLeagueDataChange(() => memo.clear());

const signatureOf = (links: OwnerLink[]) =>
  links.map((l) => `${l.id}:${l.decidedAt}:${l.franchiseId}:${l.yearStart}-${l.yearEnd}:${l.targetOwnerId}`).join('|');

/**
 * The league's owner tenures with approved links applied. `committed` may be
 * passed when the caller already loaded the file.
 */
export async function loadLiveOwnerTenures(
  leagueSlug: string,
  committed?: OwnerTenuresFile | null,
): Promise<OwnerTenuresFile | null> {
  const league = getLeagueBySlug(leagueSlug);
  if (!league) return null;
  const base =
    committed ?? (await loadLeagueData<OwnerTenuresFile>(derived(league.dataPath, 'owner-tenures.json')));
  if (!base || !(await ownerLinksSupported(leagueSlug))) return base ?? null;

  const approved = approvedLinks(await cachedOwnerLinks(leagueSlug), leagueSlug) as OwnerLink[];
  if (approved.length === 0) return base;

  const signature = signatureOf(approved);
  const hit = memo.get(leagueSlug);
  if (hit && hit.signature === signature && hit.committed === base) return hit.data;

  const [inputs, registry] = await Promise.all([loadInputs(leagueSlug), loadRegistry()]);
  const result = overlayOwnerTenures({ league, committed: base, registry, inputs, links: approved });
  if (result.error) console.warn(`[owner-links] ${leagueSlug} overlay refused: ${result.error}`);
  memo.set(leagueSlug, { signature, committed: base, data: result.data as OwnerTenuresFile });
  return result.data as OwnerTenuresFile;
}

/** league-history.json re-credited to the live owner tenures. */
export async function loadLiveLeagueHistory<T = any>(leagueSlug: string, history: T | null): Promise<T | null> {
  if (!history) return history;
  const live = await loadLiveOwnerTenures(leagueSlug);
  const league = getLeagueBySlug(leagueSlug);
  if (!live || !league) return history;
  const committed = await loadLeagueData<OwnerTenuresFile>(derived(league.dataPath, 'owner-tenures.json'));
  if (live === committed) return history;
  return overlayHistoryDataset(history, live) as T;
}

/** The newest season on the league's ledger (never linkable). */
export async function leagueLatestYear(leagueSlug: string): Promise<number> {
  const league = getLeagueBySlug(leagueSlug);
  if (!league) return 0;
  const ledger = await loadLeagueData<any>(derived(league.dataPath, 'season-ledger.json'));
  return latestLedgerYear(ledger?.rows ?? []);
}
