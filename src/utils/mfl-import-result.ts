/**
 * Reading MFL's answer to an `import?TYPE=…` write.
 *
 * MFL answers a REFUSED or IGNORED import with **HTTP 200**, so the status code
 * says nothing. Worse, `!/error/i.test(body)` says nothing either: a login page,
 * a permission notice and a league home page are all 200 and contain no
 * "error". That exact check is how the AFL waiver claim reported
 * "Round 1 submitted" for a write MFL never stored, and it is written up in
 * docs/claude/insights/domains/mfl-api.md (2026-08, waiver-order probe):
 *
 *   > Require an affirmative signal; treat an HTML body as failure, since MFL
 *   > answers imports with XML.
 *
 * So this module inverts the default: nothing is accepted unless MFL says so.
 * `<status>OK</status>` is the affirmative signal, and it is the ONLY one — an
 * unrecognized body is reported with its first 200 characters so the next
 * surprise is diagnosable instead of silent (same doc: "Never discard MFL's
 * response body on the success path").
 *
 * NOTE this is deliberately NOT a success check for whether the write did what
 * you wanted — MFL will answer OK and quietly no-op a field it does not accept
 * (the `franchises`/`waiverSortOrder` case in the same doc). An affirmative
 * response is a floor, not proof; callers that can read the result back should
 * still do so.
 */

export interface MflImportResult {
  /** True only when MFL affirmatively acknowledged the write. */
  accepted: boolean;
  /** MFL's own message when it refused, else null. */
  error: string | null;
  /**
   * Short, loggable reason when `accepted` is false and MFL gave no `<error>` —
   * e.g. an HTML body (a login/permission page) or an unrecognized payload.
   */
  reason: string | null;
}

/** Cheap sniff for "this is a web page, not an API answer". */
const looksLikeHtml = (text: string): boolean =>
  /^\s*(<!doctype\s+html|<html[\s>])/i.test(text) || /<\/html>/i.test(text);

/**
 * Classify an import response body.
 *
 * @param text - The raw response body.
 * @param httpStatus - The HTTP status, so a genuine transport failure is
 *   reported as one rather than as an unrecognized payload.
 */
export function readMflImportResult(text: string, httpStatus = 200): MflImportResult {
  const body = (text ?? '').trim();

  if (httpStatus < 200 || httpStatus >= 300) {
    return { accepted: false, error: null, reason: `HTTP ${httpStatus}` };
  }

  // MFL's refusals: <error>message</error>, sometimes <error $t="…"> in JSON.
  const explicit = body.match(/<error[^>]*>([\s\S]*?)<\/error>/i)?.[1]?.trim();
  if (explicit) return { accepted: false, error: explicit, reason: null };
  if (/<error\b/i.test(body)) {
    return { accepted: false, error: null, reason: 'MFL returned an error element.' };
  }

  // A page, not an API answer — almost always the signed-out login page or a
  // permission notice, which is a silent auth failure.
  if (looksLikeHtml(body)) {
    return { accepted: false, error: null, reason: 'MFL returned an HTML page, not an API response.' };
  }

  if (/<status\b[^>]*>\s*OK\s*<\/status>/i.test(body)) {
    return { accepted: true, error: null, reason: null };
  }

  return {
    accepted: false,
    error: null,
    reason: body ? `Unrecognized MFL response: ${body.slice(0, 200)}` : 'MFL returned an empty response.',
  };
}
