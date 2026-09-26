/**
 * Isolation for the custom-site demo (docs/plans/custom-site-demo.md).
 *
 * The demo is a `demo`-branch deployment in the SAME Vercel project as the real
 * site, so it inherits every Preview variable — production's MFL, GroupMe,
 * VAPID and GitHub credentials, and production's Redis. Relying on someone to
 * blank each of those in the dashboard fails open: next year's new secret
 * reaches the demo silently. So the demo removes them itself, at boot, and
 * refuses the outbound hosts they would be used against.
 *
 * The rules themselves live in `demo-isolation-core.mjs`, shared with the demo
 * build's preload. This file adds the server half — the MFL stand-in and the
 * fetch wrapper; `ensure-demo-isolation.ts` applies it to the live process.
 */

import { isMflWrite } from './mfl-fetch';
import { DEMO_FETCH_MARK, isDemoFetch, isDemoRefusedHost, isMflHost, scrubDemoEnvironment } from './demo-isolation-core.mjs';

export { isDemoFetch };

export {
  DEMO_ENV_MAPPINGS,
  DEMO_FORBIDDEN_ENV_PATTERNS,
  isDemoRefusedHost,
  isForbiddenDemoEnvName,
  isMflHost,
  scrubDemoEnvironment,
} from './demo-isolation-core.mjs';

/** Thrown by the demo fetch guard for a host the demo may never reach. */
export class DemoOutboundRefusedError extends Error {
  readonly host: string;

  constructor(host: string) {
    super(`Demo deployment refused an outbound call to ${host}. See src/utils/demo-isolation.ts.`);
    this.name = 'DemoOutboundRefusedError';
    this.host = host;
  }
}

export const DEMO_MFL_UNAVAILABLE_MESSAGE =
  'This is the demo site. It has no connection to MyFantasyLeague.';

/**
 * The demo's stand-in for MyFantasyLeague.
 *
 * Phase 1 answers every request with an MFL-shaped error, at HTTP 200 the way
 * MFL itself reports errors (docs/claude/rules/lineups.md), so pages take
 * their existing "couldn't read MFL" path. Later phases answer `/export` from
 * the synthetic league and record writes as simulated successes — this is the
 * seam they fill in. It never touches the network, whatever the request.
 */
export function demoMflResponse(url: URL, method: string): Response {
  const wantsJson = url.searchParams.get('JSON') === '1';
  const write = isMflWrite(method, url.href);
  const reason = write
    ? `${DEMO_MFL_UNAVAILABLE_MESSAGE} Nothing was sent.`
    : DEMO_MFL_UNAVAILABLE_MESSAGE;
  const headers = { 'X-Demo-Mfl': write ? 'write' : 'read' };
  if (wantsJson) {
    return Response.json({ error: { $t: reason } }, { status: 200, headers });
  }
  return new Response(`<?xml version="1.0" encoding="ISO-8859-1"?>\n<error>${reason}</error>`, {
    status: 200,
    headers: { ...headers, 'Content-Type': 'text/xml; charset=ISO-8859-1' },
  });
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof URL) return input;
    if (typeof input === 'string') return new URL(input);
    return new URL(input.url);
  } catch {
    // A relative URL has no host to judge — and no server-side call to MFL is
    // relative. Let the real fetch reject it as it would anyway.
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof input === 'object' && 'method' in input && typeof input.method === 'string') {
    return input.method;
  }
  return 'GET';
}


/**
 * Wrap a fetch so MFL goes to the stand-in and refused hosts throw. Everything
 * else (the demo's own Redis, ESPN, ranking sources) passes through.
 */
/** Answers an MFL request on the demo. Defaults to a plain "no MFL here" reply. */
export type DemoMflAnswer = (url: URL, method: string, body: string | undefined) => Promise<Response> | Response;

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | undefined> {
  if (typeof init?.body === 'string') return init.body;
  if (init?.body instanceof URLSearchParams) return init.body.toString();
  if (typeof input === 'object' && 'text' in input && typeof input.text === 'function') {
    try {
      return await input.clone().text();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Who answers MFL requests on this demo process. Starts as the plain "no MFL
 * here" reply — fail closed — and is upgraded to the stand-in by
 * src/middleware.ts on a demo BUILD (behind a compile-time flag, so no other
 * build carries the stand-in or its generated-league loaders).
 */
//
// Kept on globalThis, beside the fetch guard it configures, because this module
// is instantiated more than once in one process — astro.config.ts loads it
// outside Vite, the server loads it inside — and the guard installed by the
// first instance must see the answer set through the second.
const ANSWER_KEY = Symbol.for('mfl.football.demoMflAnswer');
type AnswerHolder = { [ANSWER_KEY]?: DemoMflAnswer };
const fallbackAnswer: DemoMflAnswer = (url, method) => demoMflResponse(url, method);
const installedAnswer: DemoMflAnswer = (url, method, body) =>
  ((globalThis as AnswerHolder)[ANSWER_KEY] ?? fallbackAnswer)(url, method, body);

export function setDemoMflAnswer(answer: DemoMflAnswer): void {
  (globalThis as AnswerHolder)[ANSWER_KEY] = answer;
}

export function createDemoFetch(realFetch: typeof fetch, answerMfl?: DemoMflAnswer): typeof fetch {
  const demoFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url) {
      if (isMflHost(url.hostname)) {
        return (answerMfl ?? installedAnswer)(url, requestMethod(input, init), await requestBody(input, init));
      }
      if (isDemoRefusedHost(url.hostname)) throw new DemoOutboundRefusedError(url.hostname);
    }
    return realFetch(input, init);
  };
  return Object.assign(demoFetch, { [DEMO_FETCH_MARK]: true }) as typeof fetch;
}


/**
 * Apply demo isolation to a process: scrub, then guard fetch. Idempotent — the
 * middleware and astro.config.ts both import it, and a second wrap would be
 * harmless but pointless.
 */
export function applyDemoIsolation(
  env: NodeJS.ProcessEnv,
  target: { fetch: typeof fetch },
  answerMfl?: DemoMflAnswer,
): { removed: string[] } {
  const removed = scrubDemoEnvironment(env);
  if (!isDemoFetch(target.fetch)) target.fetch = createDemoFetch(target.fetch.bind(target), answerMfl);
  return { removed };
}
