#!/usr/bin/env node

/**
 * Analyze exponential decay curves in actual salary data from 2020-2025
 * to project future auction prices based on historical rates
 */

import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function analyzeSalaryCurves() {
  console.log('\n=== ANALYZING SALARY DECAY CURVES BY POSITION (2020-2025) ===\n');
  
  // Load salary data from all available years
  const years = [2020, 2021, 2022, 2023, 2024, 2025];
  const allYearData = {};
  
  for (const year of years) {
    const dataPath = join(__dirname, `../data/theleague/mfl-player-salaries-${year}.json`);
    try {
      const data = JSON.parse(await fs.readFile(dataPath, 'utf-8'));
      allYearData[year] = data;
      console.log(`✓ Loaded ${year} data: ${data.players.length} players`);
    } catch (err) {
      console.log(`⚠ No data for ${year}: ${err.message}`);
    }
  }
  
  const positions = ['QB', 'RB', 'WR', 'TE'];
  const results = {};
  
  for (const position of positions) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`POSITION: ${position}`);
    console.log('='.repeat(60));
    
    // Aggregate salary data across all years by position rank
    // Key: position rank (1-based), Value: array of salaries from all years
    const salariesByRank = {};
    
    for (const [year, data] of Object.entries(allYearData)) {
      const players = data.players
        .filter(p => p.position === position && p.salary > 0)
        .sort((a, b) => b.salary - a.salary);
      
      players.forEach((p, index) => {
        const rank = index + 1;
        if (!salariesByRank[rank]) salariesByRank[rank] = [];
        salariesByRank[rank].push({
          year,
          salary: p.salary,
          name: p.name
        });
      });
    }
    
    const maxRank = Math.max(...Object.keys(salariesByRank).map(Number));
    console.log(`Historical data: ${maxRank} position ranks tracked across ${Object.keys(allYearData).length} years\n`);
    
    // Calculate average salary for each rank across all years
    console.log('AVERAGE SALARIES BY POSITION RANK (2020-2025):');
    console.log('Rank | Avg Salary | Sample Size | Examples');
    console.log('-'.repeat(80));
    
    const salaryByRank = [];
    
    for (let rank = 1; rank <= Math.min(50, maxRank); rank++) {
      if (!salariesByRank[rank] || salariesByRank[rank].length === 0) continue;
      
      const rankData = salariesByRank[rank];
      const avgSalary = rankData.reduce((sum, d) => sum + d.salary, 0) / rankData.length;
      const sampleSize = rankData.length;
      
      // Get most recent example
      const recent = rankData.sort((a, b) => b.year - a.year)[0];
      
      salaryByRank.push({
        rank,
        salary: avgSalary,
        sampleSize,
        examples: rankData
      });
      
      if (rank <= 30) {
        console.log(
          `${String(rank).padStart(4)} | ` +
          `$${(avgSalary / 1_000_000).toFixed(2).padStart(6)}M | ` +
          `${String(sampleSize).padStart(11)} | ` +
          `${recent.name} (${recent.year})`
        );
      }
    }
    
    const topSalary = salaryByRank[0].salary;
    
    // Analyze decay rates between ranks
    console.log('\n\nDECAY RATE ANALYSIS:');
    console.log('Ranks      | Salary Range        | Avg Drop per Rank');
    console.log('-'.repeat(60));
    
    const tiers = [
      { name: '1-5', start: 0, end: 5 },
      { name: '6-10', start: 5, end: 10 },
      { name: '11-15', start: 10, end: 15 },
      { name: '16-20', start: 15, end: 20 },
      { name: '21-30', start: 20, end: 30 },
    ];
    
    const decayRates = [];
    
    for (const tier of tiers) {
      if (tier.end > salaryByRank.length) continue;
      
      const tierPlayers = salaryByRank.slice(tier.start, tier.end);
      const topTier = tierPlayers[0].salary;
      const bottomTier = tierPlayers[tierPlayers.length - 1].salary;
      const avgDrop = (topTier - bottomTier) / (tier.end - tier.start);
      const pctDrop = ((1 - bottomTier / topTier) * 100).toFixed(1);
      
      decayRates.push({
        tier: tier.name,
        avgDrop,
        pctDrop: parseFloat(pctDrop)
      });
      
      console.log(
        `${tier.name.padEnd(10)} | ` +
        `$${(topTier / 1_000_000).toFixed(2)}M → $${(bottomTier / 1_000_000).toFixed(2)}M | ` +
        `-$${(avgDrop / 1_000_000).toFixed(3)}M (-${pctDrop}%)`
      );
    }
    
    // Calculate exponential decay coefficient
    // Formula: salary = topSalary * e^(-k * rank)
    // We'll fit k using ranks 1-20
    console.log('\n\nEXPONENTIAL DECAY COEFFICIENT:');
    
    const fitData = salaryByRank.slice(0, Math.min(20, salaryByRank.length));
    let sumLnRatio = 0;
    let sumRank = 0;
    
    for (const point of fitData) {
      if (point.rank > 1) {
        const ratio = point.salary / topSalary;
        if (ratio > 0) {
          sumLnRatio += Math.log(ratio);
          sumRank += point.rank - 1; // Offset so rank 1 = 0
        }
      }
    }
    
    const k = -sumLnRatio / sumRank;
    console.log(`Decay coefficient (k): ${k.toFixed(4)}`);
    console.log(`Formula: salary = $${(topSalary / 1_000_000).toFixed(2)}M × e^(-${k.toFixed(4)} × rank)`);
    
    // Test the formula
    console.log('\nFORMULA VALIDATION (Actual vs Predicted):');
    console.log('Rank | Actual      | Predicted   | Error');
    console.log('-'.repeat(50));
    
    let totalError = 0;
    const testRanks = [1, 5, 10, 15, 20, 25, 30];
    
    for (const rank of testRanks) {
      if (rank > salaryByRank.length) continue;
      
      const actual = salaryByRank[rank - 1].salary;
      const predicted = topSalary * Math.exp(-k * (rank - 1));
      const error = Math.abs(actual - predicted) / actual * 100;
      totalError += error;
      
      console.log(
        `${String(rank).padStart(4)} | ` +
        `$${(actual / 1_000_000).toFixed(2).padStart(6)}M | ` +
        `$${(predicted / 1_000_000).toFixed(2).padStart(6)}M | ` +
        `${error.toFixed(1).padStart(5)}%`
      );
    }
    
    const avgError = totalError / testRanks.filter(r => r <= salaryByRank.length).length;
    console.log(`\nAverage prediction error: ${avgError.toFixed(1)}%`);
    
    // Also show year-over-year trends
    console.log('\n\nYEAR-OVER-YEAR TRENDS (Top 5 Average):');
    console.log('Year | Avg Top 5 Salary');
    console.log('-'.repeat(30));
    
    for (const [year, data] of Object.entries(allYearData)) {
      const players = data.players
        .filter(p => p.position === position && p.salary > 0)
        .sort((a, b) => b.salary - a.salary)
        .slice(0, 5);
      
      if (players.length > 0) {
        const avgTop5 = players.reduce((sum, p) => sum + p.salary, 0) / players.length;
        console.log(`${year} | $${(avgTop5 / 1_000_000).toFixed(2)}M`);
      }
    }
    
    // Store results
    results[position] = {
      topSalary,
      decayCoefficient: k,
      playerCount: salaryByRank.length,
      avgError,
      salaryByRank: salaryByRank.slice(0, 30),
      yearsAnalyzed: Object.keys(allYearData).length
    };
  }
  
  // Summary recommendations
  console.log('\n\n' + '='.repeat(60));
  console.log('FORMULA RECOMMENDATIONS FOR AUCTION PREDICTOR');
  console.log('='.repeat(60));
  
  for (const [pos, data] of Object.entries(results)) {
    console.log(`\n${pos}:`);
    console.log(`  Historical Average Top Salary: $${(data.topSalary / 1_000_000).toFixed(2)}M (${data.yearsAnalyzed} years)`);
    console.log(`  Decay Coefficient: ${data.decayCoefficient.toFixed(4)}`);
    console.log(`  Formula: salary = $${(data.topSalary / 1_000_000).toFixed(2)}M × e^(-${data.decayCoefficient.toFixed(4)} × (positionRank - 1))`);
    console.log(`  Prediction Error: ${data.avgError.toFixed(1)}%`);
    
    console.log('\n  Projected Auction Salaries (Base Formula):');
    console.log('  Rank | Salary   | % of Top');
    console.log('  ' + '-'.repeat(30));
    for (let rank = 1; rank <= 20; rank++) {
      const salary = data.topSalary * Math.exp(-data.decayCoefficient * (rank - 1));
      const pct = (salary / data.topSalary * 100).toFixed(1);
      console.log(`  ${String(rank).padStart(4)} | $${(salary / 1_000_000).toFixed(2).padStart(6)}M | ${pct.padStart(5)}%`);
    }
  }
  
  console.log('\n\nIMPLEMENTATION NOTES:');
  console.log('- Use POSITION RANK for exponential decay calculation');
  console.log('- Base formula uses historical averages (2020-2025)');
  console.log('- Apply age/contract/franchise tag adjustments as multipliers AFTER base');
  console.log('- Historical data shows natural exponential decay at each position');
  console.log('- Steeper decay coefficient = higher scarcity premium for top players');
  console.log(`- Sample sizes: QB=${results.QB?.yearsAnalyzed || 0}yr, RB=${results.RB?.yearsAnalyzed || 0}yr, WR=${results.WR?.yearsAnalyzed || 0}yr, TE=${results.TE?.yearsAnalyzed || 0}yr`);
  
  return results;
}

// Run analysis
analyzeSalaryCurves().catch(console.error);
