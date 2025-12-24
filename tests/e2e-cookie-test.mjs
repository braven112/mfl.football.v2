/**
 * E2E Cookie Behavior Test Script
 * Tests cookie setting and persistence with actual HTTP requests
 * Run with: node tests/e2e-cookie-test.mjs
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:4321';
const COOKIE_NAME = 'theleague_team_pref';

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

/**
 * Parse cookies from Set-Cookie header
 */
function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders) return {};

  const headers = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : [setCookieHeaders];

  const cookies = {};
  for (const header of headers) {
    const [cookiePart] = header.split(';');
    const [name, value] = cookiePart.split('=');
    if (name && value) {
      cookies[name.trim()] = decodeURIComponent(value.trim());
    }
  }
  return cookies;
}

/**
 * Make HTTP request and track cookies
 */
async function makeRequest(url, existingCookies = {}) {
  const cookieHeader = Object.entries(existingCookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');

  const headers = {};
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const response = await fetch(url, {
    headers,
    redirect: 'manual', // Don't follow redirects
  });

  const newCookies = parseCookies(response.headers.get('set-cookie'));

  return {
    status: response.status,
    cookies: { ...existingCookies, ...newCookies },
    newCookies,
  };
}

/**
 * Test helper
 */
class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.tests = [];
  }

  async test(name, fn) {
    process.stdout.write(`${colors.cyan}▶${colors.reset} ${name}...`);
    try {
      await fn();
      console.log(` ${colors.green}✓${colors.reset}`);
      this.passed++;
    } catch (error) {
      console.log(` ${colors.red}✗${colors.reset}`);
      console.log(`  ${colors.red}Error: ${error.message}${colors.reset}`);
      this.failed++;
    }
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message}\n  Expected: ${expected}\n  Got: ${actual}`);
    }
  }

  assertDefined(value, message) {
    if (value === undefined || value === null) {
      throw new Error(`${message}\n  Value was ${value}`);
    }
  }

  summary() {
    console.log('\n' + '='.repeat(60));
    const total = this.passed + this.failed;
    console.log(`${colors.cyan}Tests:${colors.reset} ${total} total`);
    console.log(`${colors.green}Passed:${colors.reset} ${this.passed}`);
    if (this.failed > 0) {
      console.log(`${colors.red}Failed:${colors.reset} ${this.failed}`);
    }
    console.log('='.repeat(60));

    return this.failed === 0;
  }
}

/**
 * Main test suite
 */
async function runTests() {
  const runner = new TestRunner();

  console.log(`\n${colors.blue}Team Preferences E2E Cookie Tests${colors.reset}`);
  console.log(`Testing: ${BASE_URL}\n`);

  // Test 1: Set preference with ?myteam parameter
  await runner.test('Should set cookie with ?myteam parameter', async () => {
    const { status, cookies, newCookies } = await makeRequest(
      `${BASE_URL}/theleague/rosters?myteam=0003`
    );

    runner.assertEqual(status, 200, 'Response should be 200 OK');
    runner.assertDefined(newCookies[COOKIE_NAME], 'Cookie should be set');

    const cookieValue = JSON.parse(newCookies[COOKIE_NAME]);
    runner.assertEqual(
      cookieValue.franchiseId,
      '0003',
      'Cookie should contain franchiseId: 0003'
    );
    runner.assertDefined(
      cookieValue.lastUpdated,
      'Cookie should have lastUpdated timestamp'
    );
  });

  // Test 2: Cookie persists on subsequent requests
  await runner.test('Should use cookie on requests without parameters', async () => {
    // First, set the cookie
    const { cookies: cookiesWithPref } = await makeRequest(
      `${BASE_URL}/theleague/rosters?myteam=0003`
    );

    // Then make request without params
    const { status, cookies } = await makeRequest(
      `${BASE_URL}/theleague/rosters`,
      cookiesWithPref
    );

    runner.assertEqual(status, 200, 'Response should be 200 OK');
    runner.assertDefined(cookies[COOKIE_NAME], 'Cookie should still exist');

    const cookieValue = JSON.parse(cookies[COOKIE_NAME]);
    runner.assertEqual(
      cookieValue.franchiseId,
      '0003',
      'Cookie should still be 0003'
    );
  });

  // Test 3: ?franchise parameter does NOT update cookie
  await runner.test('Should NOT update cookie with ?franchise parameter', async () => {
    // Set initial preference
    const { cookies: initialCookies } = await makeRequest(
      `${BASE_URL}/theleague/rosters?myteam=0003`
    );

    const initialCookieValue = JSON.parse(initialCookies[COOKIE_NAME]);

    // View different team with ?franchise
    const { cookies: afterViewCookies, newCookies } = await makeRequest(
      `${BASE_URL}/theleague/rosters?franchise=0008`,
      initialCookies
    );

    // Cookie should NOT be in Set-Cookie header (not updated)
    runner.assert(
      !newCookies[COOKIE_NAME],
      'Cookie should NOT be updated with ?franchise'
    );

    // Existing cookie should remain unchanged
    const afterCookieValue = JSON.parse(afterViewCookies[COOKIE_NAME]);
    runner.assertEqual(
      afterCookieValue.franchiseId,
      '0003',
      'Cookie should still be 0003, not 0008'
    );
  });

  // Test 4: ?myteam parameter updates existing cookie
  await runner.test('Should update cookie with new ?myteam parameter', async () => {
    // Set initial preference
    const { cookies: initialCookies } = await makeRequest(
      `${BASE_URL}/theleague/rosters?myteam=0003`
    );

    // Update preference
    const { cookies: updatedCookies, newCookies } = await makeRequest(
      `${BASE_URL}/theleague/rosters?myteam=0012`,
      initialCookies
    );

    runner.assertDefined(newCookies[COOKIE_NAME], 'Cookie should be updated');

    const newCookieValue = JSON.parse(newCookies[COOKIE_NAME]);
    runner.assertEqual(
      newCookieValue.franchiseId,
      '0012',
      'Cookie should be updated to 0012'
    );
  });

  // Test 5: Invalid franchise ID does not set cookie
  await runner.test('Should ignore invalid franchise ID', async () => {
    const { status, newCookies } = await makeRequest(
      `${BASE_URL}/theleague/rosters?myteam=9999`
    );

    runner.assertEqual(status, 200, 'Response should be 200 OK');
    runner.assert(
      !newCookies[COOKIE_NAME],
      'Cookie should NOT be set for invalid franchise ID'
    );
  });

  // Test 6: Commissioner ID (0000) normalizes to 0001
  await runner.test('Should normalize commissioner ID 0000 to 0001', async () => {
    const { newCookies } = await makeRequest(
      `${BASE_URL}/theleague/rosters?myteam=0000`
    );

    runner.assertDefined(newCookies[COOKIE_NAME], 'Cookie should be set');

    const cookieValue = JSON.parse(newCookies[COOKIE_NAME]);
    runner.assertEqual(
      cookieValue.franchiseId,
      '0001',
      'Commissioner ID should normalize to 0001'
    );
  });

  // Test 7: Numeric IDs without padding get normalized
  await runner.test('Should normalize short numeric IDs', async () => {
    const { newCookies } = await makeRequest(
      `${BASE_URL}/theleague/rosters?myteam=3`
    );

    runner.assertDefined(newCookies[COOKIE_NAME], 'Cookie should be set');

    const cookieValue = JSON.parse(newCookies[COOKIE_NAME]);
    runner.assertEqual(
      cookieValue.franchiseId,
      '0003',
      'Short ID should be padded to 0003'
    );
  });

  // Test 8: Priority order - ?myteam overrides ?franchise
  await runner.test('Should prioritize ?myteam over ?franchise', async () => {
    const { newCookies } = await makeRequest(
      `${BASE_URL}/theleague/rosters?myteam=0003&franchise=0008`
    );

    runner.assertDefined(newCookies[COOKIE_NAME], 'Cookie should be set');

    const cookieValue = JSON.parse(newCookies[COOKIE_NAME]);
    runner.assertEqual(
      cookieValue.franchiseId,
      '0003',
      'Should use myteam (0003) not franchise (0008)'
    );
  });

  return runner.summary();
}

/**
 * Run the tests
 */
runTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error(`${colors.red}Fatal error:${colors.reset}`, error);
    process.exit(1);
  });
