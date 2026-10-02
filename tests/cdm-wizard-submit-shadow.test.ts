import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The wizard's submit handler was once named `submitDeclaration`, shadowing
 * the import from contract-actions-client. Its "API call" then recursed into
 * itself until the stack overflowed, one level caught the RangeError and
 * returned undefined, and the level above showed owners "Cannot read
 * properties of undefined (reading 'cancelled')" — no contract ever filed.
 */
describe('cdm-wizard does not shadow submitDeclaration', () => {
  const src = readFileSync('src/utils/cdm-wizard.ts', 'utf8');

  it('imports submitDeclaration from the shared client', () => {
    expect(src).toMatch(/import\s*\{[^}]*\bsubmitDeclaration\b[^}]*\}\s*from\s*'\.\/contract-actions-client'/);
  });

  it('never declares a local binding with the same name', () => {
    expect(src).not.toMatch(/\b(?:const|let|var|function)\s+submitDeclaration\b/);
  });
});
