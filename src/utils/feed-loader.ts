/**
 * Feed Loader — direct JSON file reads to replace eager glob imports.
 *
 * Uses fs.readFileSync with specific file paths so that Vite/Vercel can
 * trace individual files rather than entire directories.
 *
 * IMPORTANT: Do NOT use fs.readdirSync in SSR pages — Vercel's bundler
 * traces the entire directory and includes all files in the serverless
 * function bundle (the 4.6GB data/ directory would explode the bundle).
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

/**
 * Load a single MFL feed JSON file for a specific year.
 * Path: data/{league}/mfl-feeds/{year}/{feed}
 */
export function loadFeed<T = any>(
  league: string,
  feed: string,
  year: number | string
): T | null {
  const feedPath = path.resolve(ROOT, `data/${league}/mfl-feeds/${year}/${feed}`);
  try {
    if (fs.existsSync(feedPath)) {
      return JSON.parse(fs.readFileSync(feedPath, 'utf8')) as T;
    }
  } catch (e) {
    console.warn(`[feed-loader] Failed to load ${feedPath}:`, e);
  }
  return null;
}

/**
 * Load feed data for multiple specific years.
 * Returns a Map keyed by year string.
 */
export function loadFeedForYears<T = any>(
  league: string,
  feed: string,
  years: (number | string)[]
): Map<string, T> {
  const result = new Map<string, T>();
  for (const year of years) {
    const data = loadFeed<T>(league, feed, year);
    if (data !== null) {
      result.set(String(year), data);
    }
  }
  return result;
}

/**
 * Load a single JSON file from the league's data directory.
 * Path: data/{league}/{filename}
 */
export function loadLeagueData<T = any>(
  league: string,
  filename: string
): T | null {
  const filePath = path.resolve(ROOT, `data/${league}/${filename}`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    }
  } catch (e) {
    console.warn(`[feed-loader] Failed to load ${filePath}:`, e);
  }
  return null;
}

/**
 * Load a single JSON file from src/data/.
 * Path: src/data/{relativePath}
 */
export function loadSrcData<T = any>(relativePath: string): T | null {
  const filePath = path.resolve(ROOT, `src/data/${relativePath}`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    }
  } catch (e) {
    console.warn(`[feed-loader] Failed to load ${filePath}:`, e);
  }
  return null;
}

/**
 * Load a JSON file from a league's subdirectory by exact filename.
 * Path: data/{league}/{subdir}/{filename}
 */
export function loadLeagueSubdirFile<T = any>(
  league: string,
  subdir: string,
  filename: string
): T | null {
  const filePath = path.resolve(ROOT, `data/${league}/${subdir}/${filename}`);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    }
  } catch (e) {
    console.warn(`[feed-loader] Failed to load ${filePath}:`, e);
  }
  return null;
}
