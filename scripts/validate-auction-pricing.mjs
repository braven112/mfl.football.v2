#!/usr/bin/env node
/**
 * Validate auction pricing ranges using local data:
 * - Loads avg curve predictions (data/theleague/derived/auction-price-predictions-avg.json)
 * - Loads exported local rankings (auctionPredictor-local-data.json) for composite ordering
 * - Applies server-side adjustments: open-slot enforcement (73 slots), WR/RB caps, QB floors+uplift
 * - Prints summary totals and top QB/RB/WR price samples
 */

import fs from 'fs';

const PRED_FILE = 'data/theleague/derived/auction-price-predictions-avg.json';
const LOCAL_FILE = 'auctionPredictor-local-data.json';
const OPEN_SLOTS = 73;

if (!fs.existsSync(PRED_FILE)) {
  console.error(`Missing predictions file: ${PRED_FILE}`);
  process.exit(1);
}
if (!fs.existsSync(LOCAL_FILE)) {
  console.error(`Missing local data file: ${LOCAL_FILE}`);
  process.exit(1);
}

const preds = JSON.parse(fs.readFileSync(PRED_FILE, 'utf8'));
const local = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));

// Build composite rank map from footballguys rankings (redraft)
const rankMap = new Map();
const fg = local['auctionPredictor.footballguysRankings']?.rankings || [];
fg.forEach((r) => {
  if (r.playerId) rankMap.set(r.playerId, r.rank);
});

// Sort predictions by composite rank
const sorted = [...preds].sort((a, b) => {
  const ra = rankMap.get(a.id) ?? 9999;
  const rb = rankMap.get(b.id) ?? 9999;
  if (ra !== rb) return ra - rb;
  return (b.finalPrice || 0) - (a.finalPrice || 0);
});

// Apply open-slot enforcement: only top N priced, rest min salary
sorted.forEach((p, idx) => {
  if (idx >= OPEN_SLOTS) {
    p.finalPrice = 425_000;
  }
});

// Position rank mapping for caps/floors
const posMap = {};
sorted.forEach((p) => {
  posMap[p.position] = posMap[p.position] || [];
  posMap[p.position].push(p);
});
Object.keys(posMap).forEach((pos) => {
  posMap[pos].sort((a, b) => (rankMap.get(a.id) ?? 9999) - (rankMap.get(b.id) ?? 9999));
  posMap[pos].forEach((p, idx) => (p._slot = idx + 1));
});

// Apply caps/floors
sorted.forEach((p) => {
  let price = p.finalPrice || 425_000;
  const slot = p._slot || 9999;
  if (p.position === 'WR') price = Math.min(price, 12_000_000);
  if (p.position === 'RB') price = Math.min(price, 9_000_000);
  if (p.position === 'QB') {
    if (slot <= 5) price = Math.max(price, 7_000_000);
    else if (slot <= 10) price = Math.max(price, 5_000_000);
    else if (slot <= 20) price = Math.max(price, 3_000_000);
    price = Math.round(price * 1.15);
  }
  p.finalPrice = price;
});

const total = sorted.reduce((s, p) => s + (p.finalPrice || 0), 0);
console.log(`Players priced: ${sorted.length}`);
console.log(`Open slots priced: ${OPEN_SLOTS}, others min-salary forced`);
console.log(`Total predicted spend (1yr): $${(total / 1_000_000).toFixed(2)}M`);

const showTop = (pos, n = 5) => {
  const list = (posMap[pos] || []).slice(0, n);
  console.log(`\\nTop ${n} ${pos}:`);
  list.forEach((p, i) => {
    console.log(
      `${i + 1}. ${p.player || p.name} slot ${p._slot} -> $${(p.finalPrice / 1_000_000).toFixed(2)}M`
    );
  });
};

['QB', 'RB', 'WR', 'TE'].forEach((pos) => showTop(pos, 8));
