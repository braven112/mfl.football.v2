/**
 * Filesystem path helpers for the scouting system. Centralized so scripts
 * and Astro pages don't drift on directory structure.
 */
import path from 'node:path';
import type { EventType } from '../types/scouting-system';

export const SCOUTING_ROOT = path.join('data', 'fantasy-expert', 'scouting-system');
export const FRANCHISES_DIR = path.join(SCOUTING_ROOT, 'franchises');
export const REPORTS_DIR = path.join(SCOUTING_ROOT, 'reports');
export const LEDGER_PATH = path.join(SCOUTING_ROOT, 'predictions-ledger.json');

export function franchiseDossierPath(franchiseId: string, slug: string): string {
  return path.join(FRANCHISES_DIR, `${franchiseId}-${slug}.json`);
}

export function reportDir(year: number, eventType: EventType): string {
  return path.join(REPORTS_DIR, `${year}-${eventType}`);
}

export function reportPredictionsPath(year: number, eventType: EventType): string {
  return path.join(reportDir(year, eventType), 'predictions.json');
}

export function reportMetaPath(year: number, eventType: EventType): string {
  return path.join(reportDir(year, eventType), 'meta.json');
}
