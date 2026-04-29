/**
 * Append-only prediction ledger. Every prediction (per-target, per-mock-pick)
 * gets one row that can be scored later when the actual outcome is known.
 */
import fs from 'node:fs';
import path from 'node:path';

const LEDGER_PATH = path.join(
  process.cwd(),
  'data',
  'fantasy-expert',
  'scouting-system',
  'predictions-ledger.json'
);

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) {
    return { predictions: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  } catch {
    return { predictions: [] };
  }
}

function genId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append a batch of predictions. Each prediction must include:
 *   { eventType, year, franchiseId, predictionKind, predicted }
 * The ledger writer fills in id + predictedAt and an empty outcome slot.
 */
export function appendPredictions(newEntries) {
  const ledger = loadLedger();
  const now = new Date().toISOString();
  for (const entry of newEntries) {
    ledger.predictions.push({
      id: genId('pred'),
      predictedAt: now,
      eventType: entry.eventType,
      year: entry.year,
      franchiseId: entry.franchiseId,
      predictionKind: entry.predictionKind,
      predicted: entry.predicted,
    });
  }
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
  return ledger.predictions.length;
}

/**
 * Convert a full event report into ledger entries, one per concrete prediction.
 * For rookie-draft: each top target → 1 entry, each mock pick → 1 entry.
 */
export function predictionsFromReport(report) {
  const out = [];
  for (const brief of report.briefs) {
    for (const t of brief.topTargets) {
      out.push({
        eventType: report.eventType,
        year: report.year,
        franchiseId: brief.franchiseId,
        predictionKind: 'rookie-draft.target',
        predicted: { name: t.name, position: t.position, desire: t.desire },
      });
    }
    if (brief.wildcard) {
      out.push({
        eventType: report.eventType,
        year: report.year,
        franchiseId: brief.franchiseId,
        predictionKind: 'rookie-draft.wildcard',
        predicted: { name: brief.wildcard.name, position: brief.wildcard.position },
      });
    }
  }
  for (const pick of report.mock) {
    out.push({
      eventType: report.eventType,
      year: report.year,
      franchiseId: pick.franchiseId,
      predictionKind: 'rookie-draft.mock-pick',
      predicted: {
        round: pick.round,
        pick: pick.pickInRound,
        overall: pick.overallPick,
        name: pick.player.name,
        position: pick.player.position,
      },
    });
  }
  return out;
}
