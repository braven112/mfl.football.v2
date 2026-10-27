/**
 * The small page the phone's browser lands on during the GroupMe sign-in
 * (src/utils/live/groupme-owner-auth.ts). It only ever says what happened and
 * sends the owner back to the app. MFL Football's black and red.
 */

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function signInPage(title: string, body: string, status = 200, headers: Record<string, string> = {}): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#14161a;color:#f4f4f5;font:16px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box}
main{max-width:420px;text-align:center}
h1{font-size:22px;margin:0 0 12px;color:#ef5350}
</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // The callback URL carries the token: never hand it on as a referrer.
      'Referrer-Policy': 'no-referrer',
      ...headers,
    },
  });
}
