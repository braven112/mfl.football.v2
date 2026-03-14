/**
 * Security tests for trade-bait and move-to-ir API endpoints.
 *
 * Verifies:
 * - No write endpoint uses process.env.MFL_USER_ID (commish credentials)
 * - Roster ownership is validated before writes
 * - Only contract endpoints use commish-level auth
 * - Contract endpoints verify the logged-in user IS the commissioner before proceeding
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC_ROOT = path.resolve(__dirname, '../src');

/**
 * Read all .ts files in a directory recursively
 */
function readTsFiles(dir: string): Array<{ file: string; content: string }> {
  const results: Array<{ file: string; content: string }> = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...readTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts')) {
      results.push({ file: fullPath, content: fs.readFileSync(fullPath, 'utf8') });
    }
  }
  return results;
}

describe('write endpoint security', () => {
  const apiDir = path.join(SRC_ROOT, 'pages/api');
  const apiFiles = readTsFiles(apiDir);

  // Contracts are the ONLY endpoints allowed to use commish credentials
  const COMMISH_ALLOWED = ['contracts/approve.ts', 'contracts/reject.ts'];

  const writeEndpoints = apiFiles.filter(({ file }) => {
    const rel = path.relative(apiDir, file);
    // Exclude auth endpoints, read-only endpoints, and commish-allowed endpoints
    return (
      !rel.startsWith('auth/') &&
      !rel.includes('live-scoring') &&
      !rel.includes('cr.ts') &&
      !rel.includes('pending') &&
      !COMMISH_ALLOWED.some((allowed) => rel === allowed)
    );
  });

  it('non-contract write endpoints must NOT use process.env.MFL_USER_ID', () => {
    const violations: string[] = [];

    for (const { file, content } of writeEndpoints) {
      const rel = path.relative(SRC_ROOT, file);
      // Check for direct usage of process.env.MFL_USER_ID (not just in comments)
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comment lines
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        if (line.includes('process.env.MFL_USER_ID')) {
          violations.push(`${rel}:${i + 1}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('trade-bait endpoint uses getAuthUser for authentication', () => {
    const tradeBait = apiFiles.find(({ file }) => file.includes('trade-bait'));
    expect(tradeBait).toBeDefined();
    expect(tradeBait!.content).toContain('getAuthUser(request)');
    expect(tradeBait!.content).toContain('user.id');
  });

  it('trade-bait endpoint validates roster ownership on add', () => {
    const tradeBait = apiFiles.find(({ file }) => file.includes('trade-bait'));
    expect(tradeBait).toBeDefined();
    expect(tradeBait!.content).toContain('getRosters');
    expect(tradeBait!.content).toContain('userRoster');
    expect(tradeBait!.content).toContain('You can only add players from your own roster');
  });

  it('move-to-ir endpoint uses getAuthUser for authentication', () => {
    const moveToIr = apiFiles.find(({ file }) => file.includes('move-to-ir'));
    expect(moveToIr).toBeDefined();
    expect(moveToIr!.content).toContain('getAuthUser(request)');
    expect(moveToIr!.content).toContain('user.id');
  });

  it('move-to-ir endpoint validates roster ownership', () => {
    const moveToIr = apiFiles.find(({ file }) => file.includes('move-to-ir'));
    expect(moveToIr).toBeDefined();
    expect(moveToIr!.content).toContain('getRosters');
    expect(moveToIr!.content).toContain('userRoster');
    expect(moveToIr!.content).toContain('You can only move players from your own roster');
  });

  it('only contract endpoints are allowed to use commish credentials', () => {
    // Verify the contract writer is the only utility using commish env vars
    const contractWriter = fs.readFileSync(
      path.join(SRC_ROOT, 'utils/mfl-contract-writer.ts'),
      'utf8',
    );
    expect(contractWriter).toContain('process.env.MFL_USER_ID');
    expect(contractWriter).toContain('MFL_IS_COMMISH');
  });

  it('contract endpoints that use commish credentials must verify user IS the commissioner', () => {
    // Commish credentials can ONLY be used by the commish — not by any authenticated user.
    // Every endpoint that touches commish-level operations must check user.role.
    for (const endpoint of COMMISH_ALLOWED) {
      const file = apiFiles.find(({ file: f }) => path.relative(apiDir, f) === endpoint);
      expect(file, `${endpoint} should exist`).toBeDefined();

      const content = file!.content;
      const rel = endpoint;

      // Must authenticate the user first
      expect(content).toContain('getAuthUser(request)');

      // Must check that the logged-in user has commissioner role
      const hasRoleCheck =
        content.includes("user.role !== 'commissioner'") ||
        content.includes("user.role === 'commissioner'") ||
        content.includes('isCommissioner');

      expect(hasRoleCheck).toBe(true);

      // Must return 403 if not commissioner
      expect(content).toContain('Commissioner access required');
    }
  });
});
