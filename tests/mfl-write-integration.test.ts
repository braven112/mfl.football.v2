/**
 * MFL Integration Test — Contract Write Operations
 *
 * Validates that writeContractToMFL() can write salary/contract data
 * to MFL test league 36189 and read it back correctly.
 *
 * Run with: MFL_USER_ID=xxx MFL_IS_COMMISH=xxx MFL_LEAGUE_ID=36189 pnpm test:mfl-integration
 *
 * Safety:
 * - Hardcodes league 36189 (never touches production 13522)
 * - Always reverts changes in a finally block
 * - Uses APPEND=1 (built into the writer)
 */

import { writeContractToMFL } from '../src/utils/mfl-contract-writer.js';

const MFL_READ_HOST = process.env.MFL_HOST || 'https://api.myfantasyleague.com';
const MFL_USER_ID = process.env.MFL_USER_ID;
const MFL_IS_COMMISH = process.env.MFL_IS_COMMISH;
const LEAGUE_ID = '36189';
const FETCH_TIMEOUT_MS = 30_000;
// MFL write propagation is typically 1-3s but can spike under load
const MFL_REPLICATION_DELAY_MS = 3_000;

// ANSI color codes
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

interface MFLPlayerSalary {
  id: string;
  salary: string;
  contractYear: string;
  contractInfo: string;
}

interface MFLSalaryResponse {
  salaries: {
    leagueUnit: {
      unit: string;
      player: MFLPlayerSalary[] | MFLPlayerSalary;
    };
  };
}

class TestRunner {
  passed = 0;
  failed = 0;

  async test(name: string, fn: () => Promise<void>): Promise<void> {
    process.stdout.write(`${c.cyan}▶${c.reset} ${name}...`);
    try {
      await fn();
      console.log(` ${c.green}✓${c.reset}`);
      this.passed++;
    } catch (error) {
      console.log(` ${c.red}✗${c.reset}`);
      console.log(`  ${c.red}Error: ${error instanceof Error ? error.message : String(error)}${c.reset}`);
      this.failed++;
    }
  }

  assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
  }

  assertEqual(actual: string, expected: string, message: string): void {
    if (actual !== expected) {
      throw new Error(`${message}\n  Expected: ${expected}\n  Got: ${actual}`);
    }
  }

  summary(): boolean {
    console.log('\n' + '='.repeat(60));
    const total = this.passed + this.failed;
    console.log(`${c.cyan}Tests:${c.reset} ${total} total`);
    console.log(`${c.green}Passed:${c.reset} ${this.passed}`);
    if (this.failed > 0) {
      console.log(`${c.red}Failed:${c.reset} ${this.failed}`);
    }
    console.log('='.repeat(60));
    return this.failed === 0;
  }
}

/**
 * Read salary data for a specific player from test league.
 */
async function fetchMFL(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Cookie: `MFL_USER_ID=${MFL_USER_ID}` },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`MFL HTTP ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`MFL returned non-JSON response: ${text.slice(0, 200)}`);
  }
}

async function readPlayerSalary(playerId: string): Promise<MFLPlayerSalary | null> {
  const year = new Date().getFullYear();
  const url = `${MFL_READ_HOST}/${year}/export?TYPE=salaries&L=${LEAGUE_ID}&JSON=1`;
  const data = (await fetchMFL(url)) as MFLSalaryResponse;
  const players = data.salaries?.leagueUnit?.player;
  if (!players) return null;

  const playerList = Array.isArray(players) ? players : [players];
  return playerList.find(p => p.id === playerId) || null;
}

/**
 * Write contract data for a player using the production writer.
 */
async function writePlayer(params: {
  playerId: string;
  salary: string;
  contractYear: string;
  contractInfo: string;
}): Promise<void> {
  const result = await writeContractToMFL(params);
  if (!result.success) {
    throw new Error(`Write failed: ${result.error}`);
  }
}

/**
 * Small delay to let MFL propagate the write before re-reading.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests(): Promise<boolean> {
  const runner = new TestRunner();

  console.log(`\n${c.blue}MFL Integration Tests — Contract Write Operations${c.reset}`);
  console.log(`${c.dim}League: ${LEAGUE_ID} (test league)${c.reset}\n`);

  // Pre-flight checks
  if (!MFL_USER_ID) {
    console.error(`${c.red}MFL_USER_ID env var is required${c.reset}`);
    process.exit(1);
  }
  if (!MFL_IS_COMMISH) {
    console.error(`${c.red}MFL_IS_COMMISH env var is required${c.reset}`);
    process.exit(1);
  }

  // Safety: force test league even if env says otherwise
  process.env.MFL_LEAGUE_ID = LEAGUE_ID;

  // Find a player to test with — read the first player from the salary export
  console.log(`${c.dim}Reading salary data from league ${LEAGUE_ID}...${c.reset}`);
  const year = new Date().getFullYear();
  const salaryUrl = `${MFL_READ_HOST}/${year}/export?TYPE=salaries&L=${LEAGUE_ID}&JSON=1`;

  let salaryData: MFLSalaryResponse;
  try {
    salaryData = (await fetchMFL(salaryUrl)) as MFLSalaryResponse;
  } catch (err) {
    console.error(`${c.red}Failed to read salaries: ${err instanceof Error ? err.message : String(err)}${c.reset}`);
    process.exit(1);
  }
  const allPlayers = salaryData.salaries?.leagueUnit?.player;
  if (!allPlayers) {
    console.error(`${c.red}No salary data found in league ${LEAGUE_ID}${c.reset}`);
    process.exit(1);
  }

  const playerList = Array.isArray(allPlayers) ? allPlayers : [allPlayers];
  // Pick the first player with a salary > 0 as our test subject
  const testPlayer = playerList.find(p => parseFloat(p.salary) > 0);
  if (!testPlayer) {
    console.error(`${c.red}No player with salary > 0 found in league ${LEAGUE_ID}${c.reset}`);
    process.exit(1);
  }

  const playerId = testPlayer.id;
  const originalSalary = testPlayer.salary;
  const originalContractYear = testPlayer.contractYear;
  const originalContractInfo = testPlayer.contractInfo;

  console.log(`${c.dim}Test player: ${playerId} (salary: ${originalSalary}, year: ${originalContractYear}, info: "${originalContractInfo}")${c.reset}\n`);

  const newContractYear = originalContractYear === '5' ? '1' : String(Number(originalContractYear) + 1);
  const testContractInfo = originalContractInfo === 'F' ? 'T' : 'F';

  try {
    // ─── Test 1: contractYear write → verify ───

    await runner.test('Write contractYear change', async () => {
      await writePlayer({
        playerId,
        salary: originalSalary,
        contractYear: newContractYear,
        contractInfo: originalContractInfo,
      });
    });

    await runner.test('Verify contractYear was updated', async () => {
      await delay(MFL_REPLICATION_DELAY_MS);
      const player = await readPlayerSalary(playerId);
      runner.assert(player !== null, `Player ${playerId} not found after write`);
      runner.assertEqual(player!.contractYear, newContractYear, 'contractYear should match new value');
    });

    await runner.test('Revert contractYear to original', async () => {
      await writePlayer({
        playerId,
        salary: originalSalary,
        contractYear: originalContractYear,
        contractInfo: originalContractInfo,
      });
    });

    await runner.test('Verify contractYear reverted', async () => {
      await delay(MFL_REPLICATION_DELAY_MS);
      const player = await readPlayerSalary(playerId);
      runner.assert(player !== null, `Player ${playerId} not found after revert`);
      runner.assertEqual(player!.contractYear, originalContractYear, 'contractYear should be back to original');
    });

    // ─── Test 2: contractInfo write → verify ───

    await runner.test('Write contractInfo change', async () => {
      await writePlayer({
        playerId,
        salary: originalSalary,
        contractYear: originalContractYear,
        contractInfo: testContractInfo,
      });
    });

    await runner.test('Verify contractInfo was updated', async () => {
      await delay(MFL_REPLICATION_DELAY_MS);
      const player = await readPlayerSalary(playerId);
      runner.assert(player !== null, `Player ${playerId} not found after write`);
      runner.assertEqual(player!.contractInfo, testContractInfo, 'contractInfo should match new value');
    });

    await runner.test('Revert contractInfo to original', async () => {
      await writePlayer({
        playerId,
        salary: originalSalary,
        contractYear: originalContractYear,
        contractInfo: originalContractInfo,
      });
    });

    await runner.test('Verify contractInfo reverted', async () => {
      await delay(MFL_REPLICATION_DELAY_MS);
      const player = await readPlayerSalary(playerId);
      runner.assert(player !== null, `Player ${playerId} not found after revert`);
      runner.assertEqual(player!.contractInfo, originalContractInfo, 'contractInfo should be back to original');
    });
  } finally {
    // Unconditional revert — guarantees test league is restored even if tests crash
    console.log(`\n${c.dim}Restoring original values for player ${playerId}...${c.reset}`);
    try {
      await writePlayer({
        playerId,
        salary: originalSalary,
        contractYear: originalContractYear,
        contractInfo: originalContractInfo,
      });
      console.log(`${c.green}Restored successfully.${c.reset}`);
    } catch (revertError) {
      console.error(`${c.red}CRITICAL: Failed to restore original values! Manual fix needed.${c.reset}`);
      console.error(`${c.red}Player: ${playerId}, salary: ${originalSalary}, contractYear: ${originalContractYear}, contractInfo: "${originalContractInfo}"${c.reset}`);
      console.error(`${c.red}Error: ${revertError instanceof Error ? revertError.message : String(revertError)}${c.reset}`);
    }
  }

  return runner.summary();
}

// Run
runTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error(`${c.red}Fatal error:${c.reset}`, error);
    process.exit(1);
  });
