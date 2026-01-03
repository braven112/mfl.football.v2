#!/usr/bin/env node

/**
 * Generate Historical Salary Curves
 * 
 * Analyzes 2020-2025 auction data to create position-specific salary lookup tables.
 * Output: data/theleague/historical-salary-curves.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
const POSITIONS = ['QB', 'RB', 'WR', 'TE'];
const MAX_RANK = 50; // Track top 50 at each position

console.log('🏈 Generating Historical Salary Curves from 2020-2025 auction data...\n');

// Load salary data for all years
const yearlyData = {};
for (const year of YEARS) {
  const filePath = path.join(PROJECT_ROOT, 'data', 'theleague', `mfl-player-salaries-${year}.json`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  Skipping ${year} - file not found`);
    continue;
  }
  
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  yearlyData[year] = data.players || [];
  console.log(`✓ Loaded ${year}: ${yearlyData[year].length} players`);
}

console.log('');

// Process each position
const curves = {};

for (const position of POSITIONS) {
  console.log(`\n📊 Processing ${position}...`);
  
  const positionCurve = {};
  const rankSalaries = {}; // { rank: [year1_salary, year2_salary, ...] }
  
  // For each year, get salaries by rank
  for (const year of YEARS) {
    if (!yearlyData[year]) continue;
    
    // Get all players at this position, sorted by salary
    const positionPlayers = yearlyData[year]
      .filter(p => p.position === position)
      .filter(p => p.salary > 0) // Exclude $0 salaries
      .sort((a, b) => b.salary - a.salary);
    
    // Assign ranks and collect salaries
    positionPlayers.forEach((player, index) => {
      const rank = index + 1;
      if (rank > MAX_RANK) return; // Only track top 50
      
      if (!rankSalaries[rank]) {
        rankSalaries[rank] = [];
      }
      rankSalaries[rank].push(player.salary);
    });
    
    console.log(`  ${year}: ${positionPlayers.length} ${position}s, top salary: $${(positionPlayers[0]?.salary / 1_000_000).toFixed(2)}M`);
  }
  
  // Calculate average salary for each rank
  const averages = [];
  for (let rank = 1; rank <= MAX_RANK; rank++) {
    const salaries = rankSalaries[rank] || [];
    
    if (salaries.length === 0) {
      // No data for this rank - we'll interpolate later
      averages.push(null);
      continue;
    }
    
    // Calculate average
    const avg = Math.round(salaries.reduce((sum, s) => sum + s, 0) / salaries.length);
    averages.push(avg);
    positionCurve[rank] = {
      average: avg,
      samples: salaries.length,
      min: Math.min(...salaries),
      max: Math.max(...salaries),
      years: salaries.length
    };
  }
  
  // Fill gaps using exponential interpolation
  let lastKnownRank = null;
  let lastKnownSalary = null;
  
  for (let rank = 1; rank <= MAX_RANK; rank++) {
    if (averages[rank - 1] !== null) {
      lastKnownRank = rank;
      lastKnownSalary = averages[rank - 1];
      continue;
    }
    
    // Found a gap - interpolate
    if (lastKnownRank !== null) {
      // Find next known value
      let nextKnownRank = null;
      let nextKnownSalary = null;
      
      for (let r = rank + 1; r <= MAX_RANK; r++) {
        if (averages[r - 1] !== null) {
          nextKnownRank = r;
          nextKnownSalary = averages[r - 1];
          break;
        }
      }
      
      if (nextKnownRank !== null) {
        // Linear interpolation between known points
        const t = (rank - lastKnownRank) / (nextKnownRank - lastKnownRank);
        const interpolated = Math.round(lastKnownSalary + (nextKnownSalary - lastKnownSalary) * t);
        
        positionCurve[rank] = {
          average: interpolated,
          samples: 0,
          interpolated: true
        };
        
        averages[rank - 1] = interpolated;
      }
    }
  }
  
  // Extend curve beyond MAX_RANK using exponential decay
  if (averages[MAX_RANK - 1] && averages[0]) {
    // Calculate decay constant from known data
    const topSalary = averages[0];
    const rank50Salary = averages[MAX_RANK - 1];
    const k = -Math.log(rank50Salary / topSalary) / (MAX_RANK - 1);
    
    positionCurve.decayModel = {
      topSalary,
      k,
      formula: `${(topSalary / 1_000_000).toFixed(1)}M × e^(-${k.toFixed(4)} × (rank-1))`
    };
  }
  
  curves[position] = positionCurve;
  
  console.log(`  ✓ Generated curve: Rank #1 = $${(positionCurve[1]?.average / 1_000_000).toFixed(2)}M, Rank #50 = $${(positionCurve[50]?.average / 1_000_000).toFixed(2)}M`);
}

// Generate OVERALL curve (all positions combined)
console.log(`\n📊 Processing OVERALL (all positions)...`);
const OVERALL_MAX_RANK = 100; // Track top 100 overall
const overallCurve = {};
const overallRankSalaries = {};

for (const year of YEARS) {
  if (!yearlyData[year]) continue;

  // Get ALL players across all positions, sorted by salary
  const allPlayers = yearlyData[year]
    .filter(p => POSITIONS.includes(p.position)) // Only QB/RB/WR/TE
    .filter(p => p.salary > 0) // Exclude $0 salaries
    .sort((a, b) => b.salary - a.salary);

  // Assign overall ranks and collect salaries
  allPlayers.forEach((player, index) => {
    const rank = index + 1;
    if (rank > OVERALL_MAX_RANK) return; // Only track top 100

    if (!overallRankSalaries[rank]) {
      overallRankSalaries[rank] = [];
    }
    overallRankSalaries[rank].push(player.salary);
  });

  console.log(`  ${year}: ${allPlayers.length} total players, top salary: $${(allPlayers[0]?.salary / 1_000_000).toFixed(2)}M (${allPlayers[0]?.position})`);
}

// Calculate average salary for each overall rank
const overallAverages = [];
for (let rank = 1; rank <= OVERALL_MAX_RANK; rank++) {
  const salaries = overallRankSalaries[rank] || [];

  if (salaries.length === 0) {
    overallAverages.push(null);
    continue;
  }

  const avg = Math.round(salaries.reduce((sum, s) => sum + s, 0) / salaries.length);
  overallAverages.push(avg);
  overallCurve[rank] = {
    average: avg,
    samples: salaries.length,
    min: Math.min(...salaries),
    max: Math.max(...salaries),
    years: salaries.length
  };
}

// Fill gaps using linear interpolation
let lastKnownRank = null;
let lastKnownSalary = null;

for (let rank = 1; rank <= OVERALL_MAX_RANK; rank++) {
  if (overallAverages[rank - 1] !== null) {
    lastKnownRank = rank;
    lastKnownSalary = overallAverages[rank - 1];
    continue;
  }

  if (lastKnownRank !== null) {
    let nextKnownRank = null;
    let nextKnownSalary = null;

    for (let r = rank + 1; r <= OVERALL_MAX_RANK; r++) {
      if (overallAverages[r - 1] !== null) {
        nextKnownRank = r;
        nextKnownSalary = overallAverages[r - 1];
        break;
      }
    }

    if (nextKnownRank !== null) {
      const t = (rank - lastKnownRank) / (nextKnownRank - lastKnownRank);
      const interpolated = Math.round(lastKnownSalary + (nextKnownSalary - lastKnownSalary) * t);

      overallCurve[rank] = {
        average: interpolated,
        samples: 0,
        interpolated: true
      };

      overallAverages[rank - 1] = interpolated;
    }
  }
}

// Add decay model for ranks beyond 100
if (overallAverages[OVERALL_MAX_RANK - 1] && overallAverages[0]) {
  const topSalary = overallAverages[0];
  const rank100Salary = overallAverages[OVERALL_MAX_RANK - 1];
  const k = -Math.log(rank100Salary / topSalary) / (OVERALL_MAX_RANK - 1);

  overallCurve.decayModel = {
    topSalary,
    k,
    formula: `${(topSalary / 1_000_000).toFixed(1)}M × e^(-${k.toFixed(4)} × (rank-1))`
  };
}

curves.OVERALL = overallCurve;

console.log(`  ✓ Generated OVERALL curve: Rank #1 = $${(overallCurve[1]?.average / 1_000_000).toFixed(2)}M, Rank #50 = $${(overallCurve[50]?.average / 1_000_000).toFixed(2)}M, Rank #100 = $${(overallCurve[100]?.average / 1_000_000).toFixed(2)}M`);

// Add DEF and PK simple values
curves.Def = {
  1: { average: 1_200_000, samples: 6 },
  decayModel: { topSalary: 1_200_000, k: 0.05 }
};

curves.PK = {
  1: { average: 700_000, samples: 6 },
  decayModel: { topSalary: 700_000, k: 0.05 }
};

// Generate output
const output = {
  metadata: {
    generated: new Date().toISOString(),
    yearsAnalyzed: YEARS,
    positions: POSITIONS,
    maxRank: MAX_RANK,
    description: 'Historical salary curves derived from 2020-2025 auction data. Each rank shows the average salary paid to players at that position rank across all years.'
  },
  curves
};

// Write to file
const outputPath = path.join(PROJECT_ROOT, 'data', 'theleague', 'historical-salary-curves.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`\n✅ Successfully generated historical salary curves!`);
console.log(`📁 Output: ${outputPath}`);

// Print summary
console.log('\n📈 Summary:');

// OVERALL first
const overallRank1 = curves.OVERALL[1]?.average || 0;
const overallRank10 = curves.OVERALL[10]?.average || 0;
const overallRank25 = curves.OVERALL[25]?.average || 0;
const overallRank50 = curves.OVERALL[50]?.average || 0;
const overallRank100 = curves.OVERALL[100]?.average || 0;

console.log(`\nOVERALL (All Positions):`);
console.log(`  Rank #1:   $${(overallRank1 / 1_000_000).toFixed(2)}M`);
console.log(`  Rank #10:  $${(overallRank10 / 1_000_000).toFixed(2)}M`);
console.log(`  Rank #25:  $${(overallRank25 / 1_000_000).toFixed(2)}M`);
console.log(`  Rank #50:  $${(overallRank50 / 1_000_000).toFixed(2)}M`);
console.log(`  Rank #100: $${(overallRank100 / 1_000_000).toFixed(2)}M`);

// Then position-specific
for (const position of POSITIONS) {
  const curve = curves[position];
  const rank1 = curve[1]?.average || 0;
  const rank10 = curve[10]?.average || 0;
  const rank25 = curve[25]?.average || 0;
  const rank50 = curve[50]?.average || 0;

  console.log(`\n${position}:`);
  console.log(`  Rank #1:  $${(rank1 / 1_000_000).toFixed(2)}M`);
  console.log(`  Rank #10: $${(rank10 / 1_000_000).toFixed(2)}M`);
  console.log(`  Rank #25: $${(rank25 / 1_000_000).toFixed(2)}M`);
  console.log(`  Rank #50: $${(rank50 / 1_000_000).toFixed(2)}M`);
}

console.log('\n✨ Done! Use OVERALL curve for baseline pricing in auction-price-calculator.ts\n');
