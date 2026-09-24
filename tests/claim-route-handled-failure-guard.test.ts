import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expectClean, scanForbidden } from './helpers/scan-guard';
import { handledFailure } from '../src/utils/api-response';

/**
 * Claim routes never answer a handled failure with a 5xx.
 *
 * 2026-09-24: an AFL owner claiming a locked (recently dropped) player saw only
 * "Claim failed (HTTP 502)". `/api/waiver-claim` had caught MFL's refusal and
 * answered a JSON 502 with the reason in it — and the edge replaces the body of
 * every origin 5xx with its own page, so the reason never reached the modal
 * (docs/claude/insights/domains/deployment.md, "The edge eats origin 5xx").
 * The hotfix (#1209) covered the locked case only; the same routes had nine
 * more 5xx failure paths. They now all go through `handledFailure`
 * (src/utils/api-response.ts), which sends a 5xx as 200 + `{ success: false }`.
 *
 * Scope: the two claim routes, because their failure text is an instruction
 * the owner acts on inside a first-come window. ~66 other API routes return a
 * 5xx somewhere; that is a known gap, not a claim that they are fine.
 */
const ROUTES = ['src/pages/api/waiver-claim.ts', 'src/pages/api/waiver-claims.ts'];

describe('claim route handled-failure guard', () => {
  it('no claim route writes a literal 5xx status', () => {
    const result = scanForbidden({
      roots: ROUTES,
      forbidden: [{ name: 'literal 5xx status', pattern: /\bstatus:\s*5\d\d\b/ }],
      allowlist: [],
    });
    expectClean(
      result,
      'A claim route must send a handled failure through handledFailure, never a raw 5xx — the edge replaces the body (docs/claude/insights/domains/deployment.md).',
    );
  });

  it.each(ROUTES)('%s builds `fail` on handledFailure', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/const fail = [^;]*?handledFailure\(/s);
    // Every other `new Response(` in the file is a success reply.
    const others = [...src.matchAll(/new Response\([\s\S]*?\{\s*status:\s*(\d+)/g)].map((m) => m[1]);
    expect(others.every((s) => s === '200')).toBe(true);
  });
});

describe('handledFailure', () => {
  it('sends a 5xx as 200 and keeps the message and intended status in the body', async () => {
    const res = handledFailure('MFL refused it.', 502, { confirmUrl: 'https://example.test' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: false,
      message: 'MFL refused it.',
      confirmUrl: 'https://example.test',
      status: 502,
    });
  });

  it('passes a 4xx through unchanged', async () => {
    const res = handledFailure('Locked.', 409, { locked: ['0530'] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, message: 'Locked.', locked: ['0530'] });
  });
});
