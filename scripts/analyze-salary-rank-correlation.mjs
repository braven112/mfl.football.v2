#!/usr/bin/env node

/**
 * Analyze 2025 salary distribution by position
 * to create data-driven salary curves for the auction predictor
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load data
const salariesPath = path.join(__dirname, '../src/data/theleague/mfl-player-salaries-2025.json');

console.log('📊 Analyzing 2025 salary distribution...\n');

const salariesData = JSON.parse(fs.readFileSync(salariesPath, 'utf-8'));

// Extract player salaries
const playerSalaries = salariesData.players || [];
console.log(`✓ Loaded ${playerSalaries.length} player salaries from 2025\n`);

// Analyze by position
const positions = ['QB', 'RB', 'WR', 'TE'];

const results = {};

positions.forEach(position => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📈 ${position} SALARY DISTRIBUTION ANALYSIS`);
  console.log('='.repeat(70));
  
  // Get players at this position with salary above minimum
  const playersAtPosition = playerSalaries
    .filter(p => p.position === position && p.salary > 425000) // Exclude league minimum
    .sort((a, b) => b.salary - a.salary); // Sort by salary (high to low)
  
  console.log(`\nFound ${playersAtPosition.length} ${position}s with contracts above league minimum\n`);
  
  if (playersAtPosition.length === 0) {
    console.log('⚠️  No data available for analysis');
    return;
  }
  
  // Show top 20 salaries
  console.log('TOP 20 SALARIES:');
  console.log('-'.repeat(70));
  console.log('Rank'.padEnd(8) + 'Name'.padEnd(30) + '2025 Salary');
  console.log('-'.repeat(70));
  
  playersAtPosition.slice(0, 20).forEach((p, idx) => {
    const rankStr = `#${idx + 1}`.padEnd(8);
    const nameStr = p.name.padEnd(30);
    const salaryStr = `$${(p.salary / 1_000_000).toFixed(2)}M`;
    console.log(rankStr + nameStr + salaryStr);
  });
  
  // Calculate salary percentiles
  console.log('\n\nSALARY PERCENTILES:');
  console.log('-'.repeat(70));
  
  const percentiles = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 95, 100];
  
  percentiles.forEach(pct => {
    const index = Math.floor((pct / 100) * playersAtPosition.length) - 1;
    const player = playersAtPosition[Math.max(0, index)];
    if (player) {
      console.log(`Top ${pct}% (#${index + 1})`.padEnd(20) + `: $${(player.salary / 1_000_000).toFixed(2)}M`.padEnd(20) + `(${player.name})`);
    }
  });
  
  // Calculate salary tiers based on actual ranks
  console.log('\n\nSALARY TIERS (by rank position):');
  console.log('-'.repeat(70));
  
  const tiers = [
    { name: 'Elite (Rank 1-12)', ranks: [0, 11] },
    { name: 'High (Rank 13-24)', ranks: [12, 23] },
    { name: 'Mid (Rank 25-48)', ranks: [24, 47] },
    { name: 'Starter (Rank 49-100)', ranks: [48, 99] },
    { name: 'Flex/QB2 (Rank 101-200)', ranks: [100, 199] },
  ];
  
  tiers.forEach(tier => {
    const [minIdx, maxIdx] = tier.ranks;
    const playersInTier = playersAtPosition.slice(minIdx, Math.min(maxIdx + 1, playersAtPosition.length));
    
    if (playersInTier.length === 0) {
      console.log(`${tier.name.padEnd(30)}: No data`);
      return;
    }
    
    const salaries = playersInTier.map(p => p.salary);
    const avgSalary = salaries.reduce((sum, s) => sum + s, 0) / salaries.length;
    const maxSalary = Math.max(...salaries);
    const minSalary = Math.min(...salaries);
    
    console.log(`${tier.name.padEnd(30)}: Avg $${(avgSalary / 1_000_000).toFixed(2)}M  |  Range: $${(minSalary / 1_000_000).toFixed(2)}M - $${(maxSalary / 1_000_000).toFixed(2)}M  |  (${playersInTier.length} players)`);
    
    // Store for recommendations
    if (!results[position]) results[position] = {};
    results[position][tier.name] = {
      avg: avgSalary,
      min: minSalary,
      max: maxSalary,
      count: playersInTier.length
    };
  });
  
  // Calculate what the baseline and multipliers should be
  console.log('\n\nRECOMMENDED BASELINE & MULTIPLIERS:');
  console.log('-'.repeat(70));
  
  const topTier = playersAtPosition.slice(0, 12); // Top 12 (elite)
  if (topTier.length > 0) {
    const avgEliteSalary = topTier.reduce((sum, p) => sum + p.salary, 0) / topTier.length;
    const recommendedBaseline = avgEliteSalary / 2.5; // Assuming 2.5x multiplier for elite
    
    console.log(`Top 12 avg salary: $${(avgEliteSalary / 1_000_000).toFixed(2)}M`);
    console.log(`Recommended baseline: $${(recommendedBaseline / 1_000_000).toFixed(2)}M`);
    console.log(`(Elite players with 2.5x multiplier = $${(avgEliteSalary / 1_000_000).toFixed(2)}M)\n`);
    
    // Show what multipliers would match each tier
    tiers.forEach(tier => {
      const tierData = results[position][tier.name];
      if (!tierData) return;
      
      const multiplier = tierData.avg / recommendedBaseline;
      console.log(`${tier.name.padEnd(30)}: ${multiplier.toFixed(2)}x → $${(tierData.avg / 1_000_000).toFixed(2)}M avg`);
    });
    
    // Store recommendations
    results[position].recommendations = {
      baseline: recommendedBaseline,
      eliteAvg: avgEliteSalary
    };
  }
});

console.log('\n\n' + '='.repeat(70));
console.log('📋 SUMMARY & RECOMMENDATIONS');
console.log('='.repeat(70));

positions.forEach(pos => {
  if (results[pos]?.recommendations) {
    const rec = results[pos].recommendations;
    console.log(`\n${pos}:`);
    console.log(`  Recommended baseline: $${(rec.baseline / 1_000_000).toFixed(2)}M`);
    console.log(`  Elite avg (2.5x): $${(rec.eliteAvg / 1_000_000).toFixed(2)}M`);
  }
});

console.log('\n\n' + '='.repeat(70));
console.log('✅ Analysis complete!');
console.log('='.repeat(70));
console.log('\nThis shows the actual 2025 salary distribution.');
console.log('Use rankings to map players to these salary tiers.');
console.log('Top-ranked players should get elite tier pricing.');
console.log('');
