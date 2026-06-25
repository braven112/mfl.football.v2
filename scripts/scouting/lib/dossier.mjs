/**
 * Per-franchise dossier builder. Either loads an existing dossier from disk
 * (compounding behavioral notes from previous runs) or seeds a new one from
 * MFL data + RSP affinity.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const FRANCHISES_DIR = path.join(REPO_ROOT, 'data', 'fantasy-expert', 'scouting-system', 'franchises');

function franchiseSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function dossierFilePath(franchiseId, slug) {
  return path.join(FRANCHISES_DIR, `${franchiseId}-${slug}.json`);
}

/**
 * Load existing dossier from disk, or return null.
 */
export function loadDossier(franchiseId, slug) {
  const file = dossierFilePath(franchiseId, slug);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Build a fresh dossier from raw inputs. Used when no prior dossier exists.
 */
export function seedDossier({ franchise, rosterSummary, rspAffinity, season }) {
  const slug = franchiseSlug(franchise.nameShort || franchise.name);
  const affinity = rspAffinity[franchise.franchiseId] || { affinity: 'low', abCount: 0, abPct: 0 };
  return {
    franchiseId: franchise.franchiseId,
    franchiseSlug: slug,
    franchiseName: franchise.name,
    abbrev: franchise.abbrev || '',
    division: franchise.division || '',
    rosterSnapshot: {
      season,
      capUsed: rosterSummary.capUsed,
      capSpace: 45_000_000 - rosterSummary.capUsed,
      deadCap: 0,
      activeCount: rosterSummary.activeCount,
      taxiCount: rosterSummary.taxiCount,
      irCount: rosterSummary.irCount,
      contractsExpiring: rosterSummary.contractsExpiring,
      capturedAt: new Date().toISOString(),
    },
    behavioralNotes: [],
    rspAffinity: {
      score: affinity.affinity,
      abCount: affinity.abCount,
      abPct: affinity.abPct,
    },
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Update an existing dossier's roster snapshot in place. Behavioral notes
 * carry over.
 */
export function refreshDossierSnapshot(dossier, { rosterSummary, season }) {
  return {
    ...dossier,
    rosterSnapshot: {
      season,
      capUsed: rosterSummary.capUsed,
      capSpace: 45_000_000 - rosterSummary.capUsed,
      deadCap: 0,
      activeCount: rosterSummary.activeCount,
      taxiCount: rosterSummary.taxiCount,
      irCount: rosterSummary.irCount,
      contractsExpiring: rosterSummary.contractsExpiring,
      capturedAt: new Date().toISOString(),
    },
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Write dossier to disk, creating the directory if needed.
 */
export function writeDossier(dossier) {
  if (!fs.existsSync(FRANCHISES_DIR)) {
    fs.mkdirSync(FRANCHISES_DIR, { recursive: true });
  }
  const file = dossierFilePath(dossier.franchiseId, dossier.franchiseSlug);
  fs.writeFileSync(file, JSON.stringify(dossier, null, 2) + '\n');
  return file;
}

export { franchiseSlug, dossierFilePath };
