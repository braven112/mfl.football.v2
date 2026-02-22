/**
 * One-time script to backfill salary JSON files from historical Google Sheets exports.
 *
 * Two spreadsheet formats:
 *   - Single-sheet (2009–2019): salary values only, grouped by position headers.
 *   - Multi-sheet  (2020–2025): separate QB/RB/WR/TE/PK/Def sheets with
 *     [rank, "Name, First TEAM POS", salary] rows.
 *
 * For single-sheet files: adds additional salary values beyond the existing top 5,
 *   and computes averageSalary, medianSalary, starterAverage, starterMedian.
 * For multi-sheet files: adds full topPlayers arrays with player names and
 *   computes all analytics fields.
 *
 * Preserves existing data — only fills gaps.
 *
 * Usage: node scripts/backfill-salary-from-sheets.mjs [sheetsDir]
 *   sheetsDir defaults to /tmp/salary-sheets
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = path.join(projectRoot, 'src', 'data');
const sheetsDir = process.argv[2] || '/tmp/salary-sheets';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'PK', 'Def'];
const STARTER_COUNTS = { QB: 16, RB: 30, WR: 48, TE: 18, PK: 16, Def: 16 };

const average = (values = []) => {
  if (!values.length) return 0;
  const total = values.reduce((sum, v) => sum + v, 0);
  return Math.round((total / values.length) * 100) / 100;
};

const median = (values = []) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
};

/**
 * Parse a single-sheet spreadsheet (2009–2019 format).
 * Returns { [position]: number[] } — arrays of salary values sorted desc.
 */
const parseSingleSheet = (wb) => {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  const result = {};
  let currentPos = null;

  for (const row of rows) {
    if (!row.length) continue;
    const cell0 = row[0];

    // Position header row
    if (typeof cell0 === 'string' && POSITIONS.includes(cell0)) {
      currentPos = cell0;
      result[currentPos] = [];
      continue;
    }

    // Salary value row (skip summary rows that have "Top N" labels in later columns)
    if (currentPos && typeof cell0 === 'number' && cell0 > 0) {
      result[currentPos].push(cell0);
    }
  }

  // Sort each position descending
  for (const pos of Object.keys(result)) {
    result[pos].sort((a, b) => b - a);
  }
  return result;
};

/**
 * Parse a multi-sheet spreadsheet (2020+ format).
 * Returns { [position]: Array<{ name, salary, rank }> } sorted by salary desc.
 */
const parseMultiSheet = (wb) => {
  const result = {};

  for (const pos of POSITIONS) {
    if (!wb.Sheets[pos]) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[pos], { header: 1 });
    const players = [];

    for (const row of rows) {
      if (!row.length) continue;
      // Expected: [rank, "Name, First TEAM POS", salary]
      // Some rows have null rank or different name format
      const salary = typeof row[2] === 'number' ? row[2] : typeof row[1] === 'number' ? row[1] : null;
      if (salary === null || salary <= 0) continue;

      let name = null;
      const nameCell = typeof row[1] === 'string' ? row[1] : typeof row[0] === 'string' ? row[0] : null;
      if (nameCell) {
        name = parsePlayerName(nameCell);
      }

      const rank = typeof row[0] === 'number' ? row[0] : null;
      players.push({ name, salary, rank });
    }

    // Sort by salary desc
    players.sort((a, b) => b.salary - a.salary);
    result[pos] = players;
  }
  return result;
};

/**
 * Extract a clean player name from the spreadsheet format.
 * Input formats:
 *   "Mahomes, Patrick KCC QB"
 *   "Browns, Cleveland CLE Def"
 *   "AJ Green" (no team/pos)
 *   "Tucker, Justin BAL PK"
 */
const parsePlayerName = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  // Try to match "Last, First TEAM POS" or "Last, First TEAM POS (R)"
  const match = trimmed.match(/^(.+?)\s+[A-Z]{2,3}\*?\s+(?:QB|RB|WR|TE|PK|Def)(?:\s*\(R\))?$/);
  if (match) {
    return match[1].trim();
  }

  // Try without position suffix (just name + team)
  const match2 = trimmed.match(/^(.+?)\s+[A-Z]{2,3}\*?$/);
  if (match2) {
    return match2[1].trim();
  }

  // Return as-is (e.g. "AJ Green")
  return trimmed;
};

/**
 * Determine the JSON year a spreadsheet should map to.
 * Uses the title year from the spreadsheet and tries to match
 * against existing JSON files by comparing top QB salary.
 */
const determineJsonYear = async (wb) => {
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
  const title = rows[0]?.[0] || '';
  const titleMatch = title.match(/(\d{4})/);
  if (!titleMatch) return null;
  const titleYear = parseInt(titleMatch[1]);
  const hasPositionSheets = wb.SheetNames.includes('QB');

  // Extract top QB salary from the spreadsheet
  let topQBSalary = null;
  if (hasPositionSheets) {
    const qbData = XLSX.utils.sheet_to_json(wb.Sheets.QB, { header: 1 });
    const firstPlayer = qbData.find((r) => r.length >= 3 && typeof r[2] === 'number');
    topQBSalary = firstPlayer?.[2] ?? null;
  } else {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.[0] === 'QB' && typeof rows[i + 1]?.[0] === 'number') {
        topQBSalary = rows[i + 1][0];
        break;
      }
    }
  }

  // Try matching against existing JSON files (titleYear and titleYear-1)
  for (const candidate of [titleYear, titleYear - 1]) {
    const jsonPath = path.join(dataDir, `mfl-salary-averages-${candidate}.json`);
    try {
      const json = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
      const jsonTopQB = json.positions?.QB?.topPlayers?.[0]?.salary;
      if (jsonTopQB === topQBSalary) return candidate;
    } catch {
      // file doesn't exist
    }
  }

  // Fallback: titleYear - 1 (the general pattern)
  return titleYear - 1;
};

/**
 * Select the best spreadsheet file for each target JSON year.
 * Prefers multi-sheet format, then most data rows.
 */
const buildFileMapping = async () => {
  const allFiles = (await fs.readdir(sheetsDir)).filter(
    (f) => f.endsWith('.xls') || f.endsWith('.xlsx')
  );

  const yearMap = new Map();

  for (const file of allFiles) {
    const filePath = path.join(sheetsDir, file);
    let wb;
    try {
      wb = XLSX.readFile(filePath);
    } catch (err) {
      console.warn(`  Skipping ${file}: ${err.message}`);
      continue;
    }

    const jsonYear = await determineJsonYear(wb);
    if (!jsonYear) {
      console.warn(`  Skipping ${file}: could not determine year`);
      continue;
    }

    const hasPositionSheets = wb.SheetNames.includes('QB');
    let dataRowCount = 0;
    if (hasPositionSheets) {
      for (const sn of POSITIONS) {
        if (wb.Sheets[sn]) {
          const sd = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1 });
          dataRowCount += sd.filter((r) => r.length > 0).length;
        }
      }
    } else {
      const sd = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      dataRowCount = sd.filter((r) => r.length > 0).length;
    }

    const existing = yearMap.get(jsonYear);
    const isBetter =
      !existing ||
      (hasPositionSheets && !existing.hasPositionSheets) ||
      (hasPositionSheets === existing.hasPositionSheets &&
        dataRowCount > existing.dataRowCount);

    if (isBetter) {
      yearMap.set(jsonYear, {
        file,
        filePath,
        hasPositionSheets,
        dataRowCount,
      });
    }
  }

  return yearMap;
};

/**
 * Enrich an existing JSON summary with data from a single-sheet spreadsheet.
 * Adds salary values and computes missing analytics fields.
 */
const enrichFromSingleSheet = (existing, sheetData) => {
  const positions = { ...(existing.positions ?? {}) };

  for (const [pos, salaries] of Object.entries(sheetData)) {
    const existingPos = positions[pos] ?? {};
    const existingPlayers = existingPos.topPlayers ?? [];

    // If existing already has full analytics and more players, skip
    if (
      existingPos.averageSalary &&
      existingPos.starterAverage &&
      existingPlayers.length >= salaries.length
    ) {
      continue;
    }

    // Build merged salary list: use existing player data where available,
    // extend with additional salary values from the spreadsheet
    let mergedPlayers;
    if (existingPlayers.length > 0) {
      // Match existing players by salary to preserve their IDs/names
      const usedIndices = new Set();
      mergedPlayers = existingPlayers.map((p) => ({ ...p }));

      // Add any additional salaries from the sheet that aren't in existing
      for (const sal of salaries) {
        const alreadyExists = mergedPlayers.some((p) => p.salary === sal);
        if (!alreadyExists) {
          mergedPlayers.push({ salary: sal });
        }
      }
      mergedPlayers.sort((a, b) => b.salary - a.salary);
    } else {
      mergedPlayers = salaries.map((sal) => ({ salary: sal }));
    }

    const allSalaries = mergedPlayers.map((p) => p.salary);
    const top3 = allSalaries.slice(0, 3);
    const top5 = allSalaries.slice(0, 5);
    const starterCount = STARTER_COUNTS[pos] ?? allSalaries.length;
    const starters = allSalaries.slice(0, starterCount);

    positions[pos] = {
      totalPlayers: mergedPlayers.length,
      top3Average: existingPos.top3Average ?? average(top3),
      top5Average: existingPos.top5Average ?? average(top5),
      starterAverage: existingPos.starterAverage ?? average(starters),
      starterMedian: existingPos.starterMedian ?? median(starters),
      starterCount,
      averageSalary: existingPos.averageSalary ?? average(allSalaries),
      medianSalary: existingPos.medianSalary ?? median(allSalaries),
      topPlayers: mergedPlayers,
    };
  }

  return { ...existing, positions };
};

/**
 * Enrich an existing JSON summary with data from a multi-sheet spreadsheet.
 * Adds full player lists with names and computes all analytics fields.
 */
const enrichFromMultiSheet = (existing, sheetData) => {
  const positions = { ...(existing.positions ?? {}) };

  for (const [pos, players] of Object.entries(sheetData)) {
    const existingPos = positions[pos] ?? {};
    const existingPlayers = existingPos.topPlayers ?? [];

    // If existing already has more players with IDs, preserve them
    const existingHasIds = existingPlayers.length > 5 && existingPlayers.every((p) => p.id);
    if (existingHasIds && existingPlayers.length >= players.length) {
      // Still fill in missing analytics
      const allSalaries = existingPlayers.map((p) => p.salary);
      const starterCount = STARTER_COUNTS[pos] ?? allSalaries.length;
      const starters = allSalaries.slice(0, starterCount);
      positions[pos] = {
        ...existingPos,
        starterAverage: existingPos.starterAverage ?? average(starters),
        starterMedian: existingPos.starterMedian ?? median(starters),
        starterCount: existingPos.starterCount ?? starterCount,
        averageSalary: existingPos.averageSalary ?? average(allSalaries),
        medianSalary: existingPos.medianSalary ?? median(allSalaries),
      };
      continue;
    }

    // Build enriched player list from spreadsheet data
    // Try to match existing players by salary to preserve their MFL IDs
    const usedExistingIds = new Set();
    const enrichedPlayers = players.map((sp) => {
      // Find matching existing player by salary (avoid reusing the same player)
      const existingMatch = existingPlayers.find(
        (ep) => ep.salary === sp.salary && ep.id && !usedExistingIds.has(ep.id)
      );
      if (existingMatch?.id) usedExistingIds.add(existingMatch.id);
      return {
        ...(existingMatch ?? {}),
        name: existingMatch?.name ?? sp.name ?? undefined,
        salary: sp.salary,
      };
    });

    const allSalaries = enrichedPlayers.map((p) => p.salary);
    const top3 = allSalaries.slice(0, 3);
    const top5 = allSalaries.slice(0, 5);
    const starterCount = STARTER_COUNTS[pos] ?? allSalaries.length;
    const starters = allSalaries.slice(0, starterCount);

    positions[pos] = {
      totalPlayers: enrichedPlayers.length,
      top3Average: average(top3),
      top5Average: average(top5),
      starterAverage: average(starters),
      starterMedian: median(starters),
      starterCount,
      averageSalary: average(allSalaries),
      medianSalary: median(allSalaries),
      topPlayers: enrichedPlayers,
    };
  }

  return { ...existing, positions };
};

const run = async () => {
  console.log(`[backfill] Scanning spreadsheets in ${sheetsDir}...`);
  const mapping = await buildFileMapping();

  console.log(`[backfill] Found ${mapping.size} year mappings:`);
  for (const [year, info] of [...mapping.entries()].sort((a, b) => a - b)) {
    console.log(
      `  ${year} -> ${info.file} (${info.hasPositionSheets ? 'multi-sheet' : 'single-sheet'}, ${info.dataRowCount} rows)`
    );
  }

  let enriched = 0;
  let skipped = 0;

  for (const [year, info] of [...mapping.entries()].sort((a, b) => a - b)) {
    const jsonPath = path.join(dataDir, `mfl-salary-averages-${year}.json`);
    let existing;
    try {
      existing = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    } catch {
      console.log(`  [${year}] No existing JSON file, skipping.`);
      skipped++;
      continue;
    }

    const wb = XLSX.readFile(info.filePath);
    let updated;

    if (info.hasPositionSheets) {
      const sheetData = parseMultiSheet(wb);
      updated = enrichFromMultiSheet(existing, sheetData);
    } else {
      const sheetData = parseSingleSheet(wb);
      updated = enrichFromSingleSheet(existing, sheetData);
    }

    // Update metadata
    updated.metadata = {
      ...updated.metadata,
      backfilledFrom: info.file,
      backfilledAt: new Date().toISOString(),
    };

    await fs.writeFile(jsonPath, JSON.stringify(updated, null, 2));

    const posCount = Object.keys(updated.positions).length;
    const totalPlayers = Object.values(updated.positions).reduce(
      (sum, p) => sum + (p.topPlayers?.length ?? 0),
      0
    );
    console.log(
      `  [${year}] Enriched ${posCount} positions, ${totalPlayers} total players -> ${path.relative(projectRoot, jsonPath)}`
    );
    enriched++;
  }

  console.log(`\n[backfill] Done. Enriched ${enriched} files, skipped ${skipped}.`);
};

run().catch((err) => {
  console.error('[backfill] Failed:', err.message);
  console.error(err.stack);
  process.exitCode = 1;
});
