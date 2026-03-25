/**
 * Fetch with timeout protection.
 *
 * Wraps native fetch with AbortSignal.timeout() to prevent
 * serverless functions from hanging on slow external APIs.
 */

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Fetch with a timeout. On timeout, throws an AbortError
 * that callers should handle gracefully.
 */
export function fetchWithTimeout(
  url: string | URL | Request,
  init?: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init ?? {};
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  if (fetchInit.signal) {
    fetchInit.signal = AbortSignal.any([timeoutSignal, fetchInit.signal]);
  } else {
    fetchInit.signal = timeoutSignal;
  }

  return fetch(url, fetchInit);
}
