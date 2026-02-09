#!/usr/bin/env node
/**
 * Generates historical salary curves (Max, Avg, Min) based on auction results from 2020-2024.
 * 
 * Logic:
 * 1. Loads auction results for 5 years.
 * 2. Groups winning bids by Position.
 * 3. Sorts bids descending to determine "Rank Prices" for each year.
 * 4. For each Rank Slot (e.g. WR #1, WR #2), calculates the Max, Average, and Min price seen across the 5 years.
 * 5. Fits three separate exponential decay curves: 
 *    - Ceiling (Max)
 *    - Standard (Avg)
 *    - Floor (Min)
 * 6. Exports parameters to JSON.
 */

import fs from 'fs';
import path from 'path';

const YEARS = [2020, 2021, 2022, 2023, 2024];
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'PK', 'DEF'];
const OUTPUT_FILE = 'data/theleague/historical-salary-curves.json';

// Helper to load JSON
const loadJson = (p) => {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
};

// 1. Gather Data
// bidsByPosition[pos] = [ [year1_bids], [year2_bids], ... ]
const bidsByPosition = {}; 
POSITIONS.forEach(p => bidsByPosition[p] = []);

const playersFile = 'data/theleague/mfl-feeds/2025/players.json';
const playersData = loadJson(playersFile)?.players?.player || [];
const playerMap = new Map(playersData.map(p => [p.id, p.position]));

console.log(`Loaded ${playersData.length} players for position lookup.`);

YEARS.forEach(year => {
    const file = `data/theleague/mfl-feeds/${year}/auctionResults.json`;
    const data = loadJson(file);
    if (!data) {
        console.warn(`⚠️ Warning: No auction data for ${year}`);
        return;
    }

    const auctions = data.auctionResults?.auctionUnit?.auction;
    const auctionList = Array.isArray(auctions) ? auctions : (auctions ? [auctions] : []);

    const yearBids = { QB: [], RB: [], WR: [], TE: [], PK: [], DEF: [] };

    auctionList.forEach(a => {
        const pid = a.player;
        const bid = Number(a.winningBid);
        const pos = playerMap.get(pid);

        if (pos && yearBids[pos] && bid > 0) {
            yearBids[pos].push(bid);
        }
    });

    POSITIONS.forEach(pos => {
        yearBids[pos].sort((a, b) => b - a);
        if (yearBids[pos].length > 0) {
            bidsByPosition[pos].push(yearBids[pos]);
        }
    });
});

// 2. Calculate Stats per Rank Slot
const curveParameters = {};

// Helper: Exponential Regression (y = A * e^(kx))
// x is 0-based rank (Rank 1 -> x=0)
const fitCurve = (points) => {
    // points: { x, y }
    // Filter out low/zero values to avoid log(0)
    const validPoints = points.filter(p => p.y > 425000); 
    
    if (validPoints.length < 2) return { basePrice: 1000000, decayRate: -0.1 };

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    const n = validPoints.length;

    validPoints.forEach(p => {
        const logY = Math.log(p.y);
        sumX += p.x;
        sumY += logY;
        sumXY += p.x * logY;
        sumXX += p.x * p.x;
    });

    const denominator = (n * sumXX - sumX * sumX);
    if (denominator === 0) return { basePrice: validPoints[0].y, decayRate: 0 };

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;

    return {
        basePrice: Math.round(Math.exp(intercept)),
        decayRate: Number(slope.toFixed(4)),
        dataPoints: n
    };
};

POSITIONS.forEach(pos => {
    const yearsData = bidsByPosition[pos];
    if (yearsData.length === 0) {
        curveParameters[pos] = { 
            avg: { basePrice: 500000, decayRate: 0 },
            max: { basePrice: 500000, decayRate: 0 },
            min: { basePrice: 500000, decayRate: 0 }
        };
        return;
    }

    const maxDepth = Math.max(...yearsData.map(arr => arr.length));
    const relevantDepth = Math.min(maxDepth, 36); 

    const pointsMax = [];
    const pointsAvg = [];
    const pointsMin = [];

    for (let i = 0; i < relevantDepth; i++) {
        const slotBids = [];
        yearsData.forEach(yearBids => {
            if (yearBids[i] !== undefined) slotBids.push(yearBids[i]);
        });

        if (slotBids.length > 0) {
            const maxVal = Math.max(...slotBids);
            const minVal = Math.min(...slotBids);
            const avgVal = slotBids.reduce((a,b) => a+b, 0) / slotBids.length;

            pointsMax.push({ x: i, y: maxVal });
            pointsMin.push({ x: i, y: minVal });
            pointsAvg.push({ x: i, y: avgVal });
        }
    }

    curveParameters[pos] = {
        max: fitCurve(pointsMax),
        avg: fitCurve(pointsAvg),
        min: fitCurve(pointsMin)
    };
    
    console.log(`${pos} Curves:`);
    console.log(`  Max: $${curveParameters[pos].max.basePrice.toLocaleString()} (decay ${curveParameters[pos].max.decayRate})`);
    console.log(`  Avg: $${curveParameters[pos].avg.basePrice.toLocaleString()} (decay ${curveParameters[pos].avg.decayRate})`);
    console.log(`  Min: $${curveParameters[pos].min.basePrice.toLocaleString()} (decay ${curveParameters[pos].min.decayRate})`);
});

// 3. Export
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(curveParameters, null, 2));
console.log(`✅ Wrote multi-tier curves to ${OUTPUT_FILE}`);
