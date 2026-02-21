/**
 * One-time script to regenerate salary summary files from raw player salary data.
 * Updates topPlayers to include all players and adds averageSalary/medianSalary fields.
 *
 * Usage: node scripts/regenerate-salary-summaries.mjs
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataDir = path.join(projectRoot, 'src', 'data');
const rawDir = path.join(dataDir, 'theleague');

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

const run = async () => {
  const rawFiles = (await fs.readdir(rawDir)).filter((f) =>
    /^mfl-player-salaries-\d{4}\.json$/.test(f)
  );

  for (const rawFile of rawFiles) {
    const season = rawFile.match(/(\d{4})/)[1];
    const rawPath = path.join(rawDir, rawFile);
    const summaryPath = path.join(dataDir, `mfl-salary-averages-${season}.json`);

    const raw = JSON.parse(await fs.readFile(rawPath, 'utf8'));
    const players = raw.players ?? [];
    if (!players.length) {
      console.log(`[${season}] No players found, skipping.`);
      continue;
    }

    // Read existing summary to preserve metadata
    let existingSummary = {};
    try {
      existingSummary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
    } catch {
      // no existing summary
    }

    // Group by position and sort by salary desc
    const buckets = new Map();
    players.forEach((p) => {
      if (!p.position) return;
      if (!buckets.has(p.position)) buckets.set(p.position, []);
      buckets.get(p.position).push(p);
    });

    const STARTER_COUNTS = { QB: 16, RB: 30, WR: 48, TE: 18, PK: 16, Def: 16 };
    const positions = {};
    buckets.forEach((list, position) => {
      list.sort((a, b) => b.salary - a.salary);
      const top3 = list.slice(0, 3);
      const top5 = list.slice(0, 5);
      const starterCount = STARTER_COUNTS[position] ?? list.length;
      const starters = list.slice(0, starterCount);
      const allSalaries = list.map((p) => p.salary);
      positions[position] = {
        totalPlayers: list.length,
        top3Average: average(top3.map((p) => p.salary)),
        top5Average: average(top5.map((p) => p.salary)),
        starterAverage: average(starters.map((p) => p.salary)),
        starterMedian: median(starters.map((p) => p.salary)),
        starterCount,
        averageSalary: average(allSalaries),
        medianSalary: median(allSalaries),
        topPlayers: list.map((p) => ({
          id: p.id,
          name: p.name,
          salary: p.salary,
          franchiseId: p.franchiseId,
        })),
      };
    });

    const summary = {
      metadata: {
        ...(existingSummary.metadata ?? raw.metadata ?? {}),
        description:
          'Top salary averages calculated for franchise tag (top 3) and extension (top 5).',
        generatedAt: new Date().toISOString(),
      },
      positions,
    };

    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(
      `[${season}] Regenerated ${Object.keys(positions).length} positions with ${players.length} total players -> ${path.relative(projectRoot, summaryPath)}`
    );
  }
};

run().catch((err) => {
  console.error('Failed:', err.message);
  process.exitCode = 1;
});
