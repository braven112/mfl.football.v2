/**
 * Intel Page Helpers
 *
 * Loads digest JSON files from data/fantasy-expert/news/, formats dates,
 * and provides color/badge helpers for the Intel page.
 */

import type { IntelDigest, IntelStrategicNote } from '../types/intel';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

const NEWS_DIR = path.resolve(process.cwd(), 'data/fantasy-expert/news');

/**
 * Load all available intel digests, sorted newest-first.
 * Reads JSON files matching YYYY-MM-DD.json or sample-YYYY-MM-DD.json
 */
export function loadAllDigests(): IntelDigest[] {
  if (!fs.existsSync(NEWS_DIR)) return [];

  const files = fs.readdirSync(NEWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  const digests: IntelDigest[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(NEWS_DIR, file), 'utf-8');
      const data = JSON.parse(raw) as IntelDigest;
      if (data.date) digests.push(data);
    } catch {
      // Skip malformed files
    }
  }

  return digests;
}

/**
 * Load a single digest by date string (YYYY-MM-DD).
 * Checks both exact and sample-prefixed filenames.
 */
export function loadDigestByDate(date: string): IntelDigest | null {
  const candidates = [
    path.join(NEWS_DIR, `${date}.json`),
    path.join(NEWS_DIR, `sample-${date}.json`),
  ];

  for (const filepath of candidates) {
    if (fs.existsSync(filepath)) {
      try {
        const raw = fs.readFileSync(filepath, 'utf-8');
        const data = JSON.parse(raw) as IntelDigest;
        if (data.date) return data;
      } catch {
        // Skip malformed
      }
    }
  }

  return null;
}

/**
 * Get all available digest dates sorted newest-first.
 */
export function getAvailableDates(): string[] {
  if (!fs.existsSync(NEWS_DIR)) return [];

  return fs.readdirSync(NEWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      // Extract date from filename: "2026-03-19.json" or "sample-2026-03-19.json"
      const match = f.match(/(\d{4}-\d{2}-\d{2})\.json$/);
      return match ? match[1] : null;
    })
    .filter((d): d is string => d !== null)
    .sort()
    .reverse();
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Format a YYYY-MM-DD date string as "Wednesday, March 19, 2026"
 */
export function formatDigestDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${day}, ${year}`;
}

/**
 * Format a YYYY-MM-DD date string as "Mar 19"
 */
export function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-').map(Number);
  return `${MONTHS[month - 1].slice(0, 3)} ${day}`;
}

// ---------------------------------------------------------------------------
// Action badge colors
// ---------------------------------------------------------------------------

export type ActionType = 'bid' | 'watch' | 'trade' | 'hold' | 'sell';

const ACTION_COLORS: Record<ActionType, string> = {
  bid: '#2e8743',     // green
  watch: '#1c497c',   // blue
  trade: '#7c3aed',   // purple
  hold: '#6b7280',    // gray
  sell: '#dc2626',    // red
};

export function getActionColor(action: string): string {
  return ACTION_COLORS[action as ActionType] ?? '#6b7280';
}

// ---------------------------------------------------------------------------
// Impact dot colors
// ---------------------------------------------------------------------------

const IMPACT_COLORS: Record<string, string> = {
  high: '#dc2626',
  medium: '#d97706',
  low: '#6b7280',
};

export function getImpactColor(impact: string): string {
  return IMPACT_COLORS[impact] ?? '#6b7280';
}

// ---------------------------------------------------------------------------
// RSP tier colors
// ---------------------------------------------------------------------------

const TIER_COLORS: Record<string, string> = {
  A: '#2e8743',
  B: '#1c497c',
  C: '#d97706',
  D: '#9ca3af',
  E: '#6b7280',
  F: '#374151',
};

export function getTierColor(tier: string): string {
  return TIER_COLORS[tier] ?? '#6b7280';
}

// ---------------------------------------------------------------------------
// Strategic note normalization (backward-compatible with plain strings)
// ---------------------------------------------------------------------------

export function normalizeStrategicNote(note: string | IntelStrategicNote): IntelStrategicNote {
  if (typeof note === 'string') return { text: note };
  return note;
}
