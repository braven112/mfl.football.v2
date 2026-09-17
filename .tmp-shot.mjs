import { chromium } from 'playwright';
const [out, url, token, sel] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1100 } });
if (token && token !== '-') await ctx.addCookies([{ name: 'session_token', value: token, domain: 'localhost', path: '/' }]);
const p = await ctx.newPage();
await p.route(/mflfootballv2\.vercel\.app/, (r) => { const u = new URL(r.request().url());
  try { return r.fulfill({ path: 'public' + u.pathname }); } catch { return r.abort(); } });
await p.route(/(espncdn|myfantasyleague)\.com/, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml',
  body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#ccc"/></svg>' }));
await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
await p.waitForTimeout(3000);
const el = sel ? await p.$(sel) : null;
if (el) await el.screenshot({ path: out }); else await p.screenshot({ path: out });
await b.close();
console.log('ok');
