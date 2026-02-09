#!/usr/bin/env node
/**
 * Quick auction price predictor for current free agents.
 *
 * - Builds rank-slot price curves from historical auctionResults (2020-2024).
 * - Identifies 2025 expiring contracts (contractYear == 1) as free agents.
 * - Assigns each FA a position rank slot (salary-desc fallback).
 * - Maps slot → base price using rank-slot curves (max/avg/min) and writes all three.
 * - Outputs CSV for the selected curve and JSON for all curves (lightweight multipliers for now).
 *
 * Usage:
 *   node scripts/predict-auction-fas.mjs [--curve=max|avg|min]
 *
 * Output:
 *   tmp/auction-price-predictions.csv (selected curve)
 *   data/theleague/derived/auction-price-predictions-{curve}.json (all curves)
 */

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const curveArg = args.find(a => a.startsWith('--curve=')) || '';
const curve = curveArg.split('=')[1] || 'avg'; // default for CSV (typical/average)
const CURVES = ['max', 'avg', 'min'];
const years = [2020, 2021, 2022, 2023, 2024];
const positions = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
const leagueMin = 425_000;

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const players = new Map(
  (loadJson('data/theleague/mfl-feeds/2025/players.json').players?.player || [])
    .map(p => [p.id, { name: p.name, position: p.position }])
);

const franchises = new Map(
  (loadJson('data/theleague/mfl-feeds/2025/league.json').league?.franchises?.franchise || [])
    .map(f => [f.id, f.name])
);

// Build rank-slot price table from historical auctions
const rankSlotPrice = {}; // position -> slot -> {max, avg, min}
for (const pos of positions) rankSlotPrice[pos] = {};

for (const year of years) {
  const file = `data/theleague/mfl-feeds/${year}/auctionResults.json`;
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) continue;
  const data = loadJson(file);
  const raw = data.auctionResults?.auctionUnit?.auction;
  const arr = Array.isArray(raw) ? raw : [raw].filter(Boolean);
  const byPos = {};
  for (const a of arr) {
    const bid = Number(a.winningBid);
    const info = players.get(a.player);
    if (!bid || !info || !positions.includes(info.position)) continue;
    (byPos[info.position] = byPos[info.position] || []).push(bid);
  }
  // sort desc per position to map slots
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b - a);
    byPos[pos].forEach((bid, idx) => {
      const slot = idx + 1;
      const slotEntry = rankSlotPrice[pos][slot] || { samples: [] };
      slotEntry.samples.push(bid);
      rankSlotPrice[pos][slot] = slotEntry;
    });
  }
}

// finalize slot stats
for (const pos of positions) {
  for (const slot of Object.keys(rankSlotPrice[pos])) {
    const samples = rankSlotPrice[pos][slot].samples;
    const max = Math.max(...samples);
    const min = Math.min(...samples);
    const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
    rankSlotPrice[pos][slot] = { max, min, avg, samples: samples.length };
  }
}

// Identify current free agents (expiring contracts) from 2025 rosters
const rosters = loadJson('data/theleague/mfl-feeds/2025/rosters.json').rosters?.franchise || [];
const freeAgents = [];
rosters.forEach(fr => {
  const franchiseId = fr.id || fr.franchise;
  const playersArr = Array.isArray(fr.player) ? fr.player : [fr.player].filter(Boolean);
  playersArr.forEach(p => {
    const info = players.get(p.id);
    if (!info || !positions.includes(info.position)) return;
    const contractYear = Number(p.contractYear || p.contract_year || p.contractyear || p.contract_years || p.contractInfo);
    if (contractYear !== 1) return; // expiring
    const salary = Number(p.salary) || 0;
    freeAgents.push({
      id: p.id,
      name: info.name,
      position: info.position,
      franchiseId,
      salary,
    });
  });
});

// Rank free agents within each position by current salary as a proxy for slot
const faByPos = {};
positions.forEach(pos => {
  faByPos[pos] = freeAgents.filter(p => p.position === pos).sort((a, b) => b.salary - a.salary);
});

// Simple scarcity: supply (FA count) vs baseline starter demand (16 teams * starters)
const startersPerPos = { QB: 1, RB: 2, WR: 3, TE: 1, PK: 1, DEF: 1 };
const scarcityMultForPos = {};
positions.forEach(pos => {
  const supply = faByPos[pos].length || 1;
  const demand = (franchises.size || 16) * (startersPerPos[pos] || 1);
  const scarcityIndex = demand / supply;
  // clamp: oversupply floor 0.85, scarcity cap 1.40
  const raw = 1 + 0.25 * (scarcityIndex - 1);
  scarcityMultForPos[pos] = Math.max(0.85, Math.min(1.4, raw));
});

// Calculate prices for all curves
const predictionsByCurve = new Map();
CURVES.forEach(c => {
  const preds = [];
  positions.forEach(pos => {
    faByPos[pos].forEach((player, idx) => {
      const slot = idx + 1;
      const slotStats = rankSlotPrice[pos][slot];
      const base = slotStats ? slotStats[c] : leagueMin;
      const scarcityMult = scarcityMultForPos[pos] || 1;
      const finalPrice = Math.max(leagueMin, Math.round(base * scarcityMult));
      preds.push({
        ...player,
        slot,
        basePrice: base,
        scarcityMult,
        finalPrice,
        samples: slotStats?.samples || 0,
      });
    });
  });
  predictionsByCurve.set(c, preds);
});

// Output CSV
// CSV output
{
  const outDir = 'tmp';
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'auction-price-predictions.csv');
  const header = ['id', 'name', 'position', 'slot', 'basePrice', 'scarcityMult', 'finalPrice', 'samples', 'franchise'];
  const lines = [header.join(',')];
  const csvPredictions = predictionsByCurve.get(curve) || [];
  csvPredictions.forEach(p => {
    lines.push([
      p.id,
      `"${p.name}"`,
      p.position,
      p.slot,
      p.basePrice,
      p.scarcityMult.toFixed(2),
      p.finalPrice,
      p.samples,
      `"${franchises.get(p.franchiseId) || p.franchiseId || ''}"`,
    ].join(','));
  });
  fs.writeFileSync(outPath, lines.join('\n'));
  console.log(`Wrote ${outPath} (${csvPredictions.length} players) using curve=${curve}`);
}

// JSON output for app consumption
{
  const jsonDir = 'data/theleague/derived';
  fs.mkdirSync(jsonDir, { recursive: true });
  CURVES.forEach(c => {
    const jsonPath = path.join(jsonDir, `auction-price-predictions-${c}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(predictionsByCurve.get(c) || [], null, 2));
    console.log(`Wrote ${jsonPath}`);
  });
}
