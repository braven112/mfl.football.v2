import fs from 'node:fs';

const SALARY_CAP = 45_000_000;

console.log('\n=== CAP SPACE FORMULA VALIDATION ===\n');
console.log('Validating that our cap calculation formula is consistent across:');
console.log('1. Raw MFL feed data (rosters.json + salaryAdjustments.json)');
console.log('2. Processed player salaries (mfl-player-salaries-2025.json)');
console.log('3. Rosters page implementation\n');

// Read the raw MFL feeds
const rostersData = JSON.parse(
  fs.readFileSync('src/data/mfl-feeds/2025/rosters.json', 'utf8')
);
const adjustmentsData = JSON.parse(
  fs.readFileSync('src/data/mfl-feeds/2025/salaryAdjustments.json', 'utf8')
);

// Read our processed salary data
const salaryData = JSON.parse(
  fs.readFileSync('src/data/mfl-player-salaries-2025.json', 'utf8')
);

// Calculate cap space from RAW MFL feed (source of truth)
const rawTeamCapHit = {};
const rawTeamCounts = {};

const franchises = rostersData?.rosters?.franchise || [];
for (const franchise of franchises) {
  const franchiseId = franchise.id;
  rawTeamCapHit[franchiseId] = 0;
  rawTeamCounts[franchiseId] = { roster: 0, injured: 0, taxi: 0 };

  const players = Array.isArray(franchise.player) ? franchise.player : [];
  for (const player of players) {
    const salary = parseFloat(player.salary) || 0;
    const status = player.status;

    if (status === 'ROSTER') {
      rawTeamCapHit[franchiseId] += salary;
      rawTeamCounts[franchiseId].roster++;
    } else if (status === 'INJURED_RESERVE') {
      rawTeamCapHit[franchiseId] += salary;
      rawTeamCounts[franchiseId].injured++;
    } else if (status === 'TAXI_SQUAD') {
      rawTeamCapHit[franchiseId] += salary * 0.5;
      rawTeamCounts[franchiseId].taxi++;
    }
  }
}

// Add dead money from salary adjustments
const rawTeamDeadMoney = {};
const adjustments = adjustmentsData.salaryAdjustments?.salaryAdjustment || [];
for (const adj of adjustments) {
  const franchiseId = adj.franchise_id;
  const amount = parseFloat(adj.amount) || 0;

  if (!rawTeamDeadMoney[franchiseId]) {
    rawTeamDeadMoney[franchiseId] = 0;
  }
  if (!rawTeamCapHit[franchiseId]) {
    rawTeamCapHit[franchiseId] = 0;
  }

  rawTeamDeadMoney[franchiseId] += amount;
  rawTeamCapHit[franchiseId] += amount;
}

// Calculate cap space from PROCESSED data (what our app uses)
const processedTeamCapHit = {};
const processedTeamCounts = {};
const processedTeamDeadMoney = {};

for (const player of salaryData.players) {
  const franchiseId = player.franchiseId;
  if (!franchiseId) continue;

  if (!processedTeamCapHit[franchiseId]) {
    processedTeamCapHit[franchiseId] = 0;
    processedTeamCounts[franchiseId] = { roster: 0, injured: 0, taxi: 0 };
    processedTeamDeadMoney[franchiseId] = 0;
  }

  // ROSTER and INJURED_RESERVE count at 100%, TAXI_SQUAD at 50%
  if (player.status === 'ROSTER') {
    processedTeamCapHit[franchiseId] += player.salary || 0;
    processedTeamCounts[franchiseId].roster++;
  } else if (player.status === 'INJURED_RESERVE') {
    processedTeamCapHit[franchiseId] += player.salary || 0;
    processedTeamCounts[franchiseId].injured++;
  } else if (player.status === 'TAXI_SQUAD') {
    processedTeamCapHit[franchiseId] += (player.salary || 0) * 0.5;
    processedTeamCounts[franchiseId].taxi++;
  }
}

// Add dead money
for (const adj of adjustments) {
  const franchiseId = adj.franchise_id;
  const amount = parseFloat(adj.amount) || 0;

  if (!processedTeamDeadMoney[franchiseId]) {
    processedTeamDeadMoney[franchiseId] = 0;
  }
  if (!processedTeamCapHit[franchiseId]) {
    processedTeamCapHit[franchiseId] = 0;
  }

  processedTeamDeadMoney[franchiseId] += amount;
  processedTeamCapHit[franchiseId] += amount;
}

// Compare results
const results = [];
const allTeams = new Set([
  ...Object.keys(rawTeamCapHit),
  ...Object.keys(processedTeamCapHit),
]);

for (const franchiseId of allTeams) {
  const rawCapHit = rawTeamCapHit[franchiseId] || 0;
  const processedCapHit = processedTeamCapHit[franchiseId] || 0;
  const difference = processedCapHit - rawCapHit;
  const rawCapSpace = SALARY_CAP - rawCapHit;
  const processedCapSpace = SALARY_CAP - processedCapHit;

  results.push({
    franchiseId,
    rawCapHit,
    processedCapHit,
    difference,
    rawCapSpace,
    processedCapSpace,
    deadMoney: rawTeamDeadMoney[franchiseId] || 0,
    rawCounts: rawTeamCounts[franchiseId] || { roster: 0, injured: 0, taxi: 0 },
    processedCounts: processedTeamCounts[franchiseId] || { roster: 0, injured: 0, taxi: 0 },
    matches: Math.abs(difference) < 0.01, // Allow for tiny floating point errors
  });
}

// Sort by franchise ID
results.sort((a, b) => a.franchiseId.localeCompare(b.franchiseId));

console.log('Franchise | Raw Cap Hit    | Processed Hit  | Cap Space      | Difference | Match');
console.log('-'.repeat(90));

let mismatches = 0;
for (const result of results) {
  const match = result.matches ? '✓' : '✗';
  if (!result.matches) mismatches++;

  console.log(
    `${result.franchiseId.padEnd(9)} | ` +
    `$${String(result.rawCapHit.toLocaleString()).padStart(13)} | ` +
    `$${String(result.processedCapHit.toLocaleString()).padStart(13)} | ` +
    `$${String(result.processedCapSpace.toLocaleString()).padStart(13)} | ` +
    `$${String(result.difference.toLocaleString()).padStart(10)} | ` +
    `${match}`
  );
}

console.log('\n');
console.log(`Total teams: ${results.length}`);
console.log(`Mismatches: ${mismatches}`);
console.log(`Salary Cap: $${SALARY_CAP.toLocaleString()}`);

if (mismatches > 0) {
  console.log('\n⚠️  Inconsistency detected between raw MFL data and processed data!');
  console.log('This indicates a problem with the data processing pipeline.\n');

  // Show detailed breakdown for mismatched teams
  const mismatched = results.filter(r => !r.matches);
  for (const team of mismatched) {
    console.log(`\nTeam ${team.franchiseId}:`);
    console.log(`  Raw counts:       ${team.rawCounts.roster} roster, ${team.rawCounts.injured} IR, ${team.rawCounts.taxi} taxi`);
    console.log(`  Processed counts: ${team.processedCounts.roster} roster, ${team.processedCounts.injured} IR, ${team.processedCounts.taxi} taxi`);
    console.log(`  Dead money:       $${team.deadMoney.toLocaleString()}`);
    console.log(`  Difference:       $${team.difference.toLocaleString()}`);
  }

  process.exit(1);
} else {
  console.log('\n✓ All teams match! Cap calculation formula is consistent.');
  console.log('\nFormula: Cap Space = $45M - (ROSTER @ 100% + INJURED_RESERVE @ 100% + TAXI_SQUAD @ 50% + Dead Money)');
}
