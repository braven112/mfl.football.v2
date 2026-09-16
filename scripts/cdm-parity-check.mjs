/**
 * Contract Declaration Modal parity harness.
 *
 * `scripts/roster-parity-check.mjs` is Phase 0 of docs/plans/rosters-page-split.md
 * and the doc is blunt about why it exists: "This is the only thing that makes
 * the rest of the plan safe." It fingerprints the rendered roster TABLE — and
 * it has no CDM coverage at all (grep it for `cdm`; there are no hits). So the
 * ~1,340 lines of wizard that Phase 6 wants to extract, which perform real MFL
 * contract writes, currently have no way to prove an extraction kept them
 * identical. This is that missing harness.
 *
 * What it does: signs in as an owner, walks every `.ufa-action-btn` on their
 * own roster, opens the modal on each, and records what the modal RENDERS —
 * identity band, stepper, contract metrics, deadline, and every action option
 * — then steps into each flow that stays inside the modal and records that
 * screen too. Same idea as the roster harness: text, not markup, so a wrapper
 * span is not a diff but a salary is.
 *
 * WHAT IT NEVER DOES: reach the server with a write. The modal's writes are
 * real (declarations, tags, extensions, cuts), so in the default walk
 * `cdm-submit` is never clicked, the flows that write on the first tap are
 * never entered (see SAFE_FLOWS), and every known write endpoint is aborted at
 * the network layer regardless. A harness that can mutate the league is not a
 * harness.
 *
 * `--probe` covers the one thing that walk cannot: the submit handler itself.
 * It drives each flow to a submittable state and CLICKS submit, with
 * `/api/contracts/declare` and `/api/cut-player` FULFILLED in the browser from
 * a canned response instead of being sent. Nothing reaches the dev server, and
 * nothing reaches MFL — the request is intercepted before it leaves the page —
 * so what gets fingerprinted is the outgoing request (method, url, parsed
 * body) plus how the modal reacts to the answer. It runs twice, once against a
 * success response and once against a failure, so the handler's catch branch
 * is covered too. That is the verification the split plan used to describe as
 * "submit a throwaway declaration by hand", without writing to a live league.
 *
 * Usage:
 *   JWT_SECRET=x pnpm dev --port 4399 &
 *   node scripts/cdm-parity-check.mjs --out before.json
 *   # ...extract the modal...
 *   node scripts/cdm-parity-check.mjs --out after.json
 *   node scripts/cdm-parity-check.mjs --compare before.json after.json
 */

import { chromium } from 'playwright';
import { createHmac } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';

const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium';

/**
 * Action options that open another screen INSIDE the modal and write nothing
 * on the way in. Everything else is left alone on purpose:
 *   - "Watch player" toggles the watch list on the first tap (one-tap by
 *     design — MFL's watch import is incremental).
 *   - "Move to IR" / "Trade Player" leave the modal or hit MFL.
 * Matched case-insensitively against the option's rendered label.
 */
const SAFE_FLOWS = [
  'veteran extension',
  'rookie extension',
  'franchise tag',
  'team option',
  'declare contract',
  'cut player',
];

/** POSTs the harness must never let through, even if a click slips past. */
const WRITE_ENDPOINTS = [
  '**/api/contracts/**',
  '**/api/cut-player',
  '**/api/move-to-ir',
  '**/api/move-to-practice',
  '**/api/trade-bait',
  '**/api/watch-list',
  '**/api/autocut-list',
  '**/api/waiver-claim',
];

function parseArgs(argv) {
  const args = {
    url: 'http://localhost:4399',
    secret: process.env.JWT_SECRET ?? 'roster-split-verify',
    league: 'theleague',
    franchiseId: '0001',
    limit: 0, // 0 = every eligible player
    probe: false, // drive submit with the write intercepted (see header)
    out: null,
    compare: null,
    timeout: 180000,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--secret') args.secret = argv[++i];
    else if (a === '--league') args.league = argv[++i];
    else if (a === '--franchise') args.franchiseId = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--probe') args.probe = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--compare') args.compare = [argv[++i], argv[++i]];
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
  }
  return args;
}

function leagueBySlug(slug) {
  const league = getLeagueBySlug(slug);
  if (!league) throw new Error(`Unknown league slug: ${slug}`);
  return league;
}

function forgeSessionToken(secret, { franchiseId, leagueId }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    userId: 'MFL_PARITY',
    username: 'ParityHarness',
    franchiseId,
    leagueId,
    role: 'owner',
    issuedAt: now,
    expiresAt: now + 86400,
    iat: now,
    exp: now + 86400,
  };
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

/**
 * Runs in the browser. Describes what the modal is showing right now.
 *
 * Deliberately text-only and null-for-hidden: a section the current flow does
 * not use must read the same on both sides of a refactor whether it is
 * `display:none`, `hidden`, or absent.
 */
const CAPTURE_MODAL = () => {
  const txt = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || el.hidden) return null;
    return el.textContent.replace(/\s+/g, ' ').trim() || null;
  };
  const sectionShown = (id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && !el.hidden;
  };

  const modal = document.getElementById('contract-declaration-modal');
  if (!modal) return { open: false };
  const open = modal.classList.contains('active') || getComputedStyle(modal).display !== 'none';
  if (!open) return { open: false };

  const options = [...document.querySelectorAll('#cdm-action-options .cdm-action-option')].map((o) => ({
    label: o.querySelector('.cdm-action-option__label')?.textContent?.replace(/\s+/g, ' ').trim() || null,
    desc: o.querySelector('.cdm-action-option__desc')?.textContent?.replace(/\s+/g, ' ').trim() || null,
    disabled: o.disabled === true || o.classList.contains('cdm-action-option--disabled'),
  }));

  const years = [...document.querySelectorAll('#cdm-year-options button')].map((b) => ({
    text: b.textContent.replace(/\s+/g, ' ').trim() || null,
    disabled: b.disabled === true,
    selected: b.classList.contains('selected') || b.getAttribute('aria-pressed') === 'true',
  }));

  const submit = document.getElementById('cdm-submit');
  const stepDot = (n) => {
    const el = document.getElementById(`cdm-step-dot-${n}`);
    if (!el) return null;
    return {
      active: el.classList.contains('active'),
      completed: el.classList.contains('completed'),
    };
  };

  return {
    open: true,
    mode: modal.dataset.cdmMode ?? null,
    band: {
      name: txt('cdm-player-name'),
      age: txt('cdm-age-pill'),
      meta: txt('cdm-meta-text'),
      sub: txt('cdm-sub-text'),
    },
    stepper: { label: txt('cdm-stepper-label'), type: txt('cdm-type-label') },
    stepDots: [stepDot(1), stepDot(2), stepDot(3)],
    metrics: {
      salary: txt('cdm-current-salary'),
      years: txt('cdm-current-years'),
      designation: txt('cdm-current-designation'),
    },
    deadline: txt('cdm-deadline-text'),
    sections: {
      action: sectionShown('cdm-action-section'),
      year: sectionShown('cdm-year-section'),
      tag: sectionShown('cdm-tag-section'),
      cut: sectionShown('cdm-cut-section'),
      extension: sectionShown('cdm-extension-section'),
      review: sectionShown('cdm-review-panel'),
      formula: sectionShown('cdm-formula-section'),
    },
    actionOptions: options,
    yearOptions: years,
    tag: { current: txt('cdm-tag-current'), next: txt('cdm-tag-new'), basis: txt('cdm-tag-basis-text') },
    cut: {
      currentHit: txt('cdm-cut-current-hit'),
      futureHit: txt('cdm-cut-future-hit'),
      savings: txt('cdm-cut-savings'),
      note: txt('cdm-cut-note'),
    },
    extension: {
      current: txt('cdm-ext-current'),
      next: txt('cdm-ext-new'),
      yearsCurrent: txt('cdm-ext-years-current'),
      yearsNext: txt('cdm-ext-years-new'),
    },
    submit: submit
      ? { label: submit.textContent.replace(/\s+/g, ' ').trim() || null, disabled: submit.disabled === true }
      : null,
    error: txt('cdm-error'),
  };
};

/**
 * The two endpoints --probe answers locally. Everything else in
 * WRITE_ENDPOINTS stays aborted even in probe mode.
 */
const PROBE_ENDPOINTS = ['**/api/contracts/declare', '**/api/cut-player'];

/** The canned answers. Both branches of the handler get exercised. */
const PROBE_RESPONSES = {
  ok: { status: 200, body: { success: true, ok: true } },
  fail: { status: 400, body: { success: false, error: 'PROBE_REJECTED', message: 'PROBE_REJECTED' } },
};

/**
 * Drives one flow to a submittable state and clicks submit.
 *
 * Returns what the page TRIED to send and how it reacted — never what the
 * server did, because the request never gets there.
 */
async function probeFlow(page, playerId, label, sent) {
  const entered = await page.evaluate((wanted) => {
    const opt = [...document.querySelectorAll('#cdm-action-options .cdm-action-option')].find(
      (o) => o.querySelector('.cdm-action-option__label')?.textContent?.trim() === wanted,
    );
    if (!opt || opt.disabled) return false;
    opt.click();
    return true;
  }, label);
  if (!entered) return null;
  await page.waitForTimeout(250);

  // A year picker gates submit on the flows that have one. Always the first
  // option, so the captured request body is deterministic.
  await page.evaluate(() => {
    const first = document.querySelector('#cdm-year-options .cdm-year-btn');
    if (first && !first.disabled) first.click();
  });
  await page.waitForTimeout(150);

  sent.length = 0;
  const clicked = await page.evaluate(() => {
    // The cut flow submits from its own action option and needs two taps —
    // the first only arms the confirmation.
    const cut = document.querySelector('.cdm-action-option--cut-real');
    if (cut && getComputedStyle(cut).display !== 'none' && !cut.disabled) {
      cut.click();
      cut.click();
      return 'cut';
    }
    const submit = document.getElementById('cdm-submit');
    if (!submit || submit.disabled || getComputedStyle(submit).display === 'none') return null;
    submit.click();
    return 'submit';
  });
  if (!clicked) return null;

  // Long enough for the fulfilled response to land, short enough to capture
  // before the handler's own 1.5s close/reload timer fires.
  await waitForRequest(page, sent);
  const captured = { via: clicked, request: sent[0] ?? null, after: await settleAfterSubmit(page) };
  // Past the handler's 1.5s close/reload timer, so the caller's navigation is
  // not racing it.
  await page.waitForTimeout(1400);
  return captured;
}

/**
 * The openers that reach the submit handler WITHOUT going through the step-1
 * action sheet. They matter because the dispatcher branches on exactly that:
 * an action-select flow applies locally (sandbox), while these do not.
 *
 * The yrs-chip openers (`.yrs-chip--eligible` / `.yrs-chip--pending`) belong
 * in this list and are deliberately absent — see the note in
 * docs/plans/rosters-page-split.md. They are the only route to
 * `/api/contracts/declare`, and no player on the current roster is in a
 * declarable state, so the page renders 25 inert `.yrs-chip`s and zero
 * eligible ones. Add them here the moment a declaration window is open.
 */
const DIRECT_OPENERS = [
  { label: 'team-option cell', selector: '.salary-cell--team-option-eligible[data-player-id]' },
];

/** Submits opened straight from a cell, one per matching element. */
async function probeDirectOpeners(page, url, args, sent) {
  const out = {};
  for (const opener of DIRECT_OPENERS) {
    await gotoStable(page, url, args.timeout);
    await page.waitForTimeout(2500);
    const opened = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.click();
      return el.dataset.playerId ?? true;
    }, opener.selector);
    if (!opened) continue;
    await page.waitForTimeout(300);

    sent.length = 0;
    const clicked = await page.evaluate(() => {
      const submit = document.getElementById('cdm-submit');
      if (!submit || submit.disabled || getComputedStyle(submit).display === 'none') return false;
      submit.click();
      return true;
    });
    if (!clicked) continue;
    await waitForRequest(page, sent);
    out[opener.label] = {
      playerId: opened,
      request: sent[0] ?? null,
      after: await settleAfterSubmit(page),
    };
    await page.waitForTimeout(1400);
  }
  return out;
}

/**
 * `page.goto` that survives the handler's own navigation.
 *
 * The cut success path runs `setTimeout(() => location.reload(), 1500)`, so a
 * probe that captures at 600ms and navigates immediately races that reload and
 * loses with `net::ERR_ABORTED`. Waiting the timer out first and retrying once
 * is the whole fix.
 */
/**
 * Waits for the page to actually ISSUE the request, not just to look settled.
 *
 * `settleAfterSubmit` alone is not enough for this: its condition is also
 * satisfied by "the modal is no longer active", which on some flows is true
 * the instant submit is clicked — so `sent[0]` got read before the fetch had
 * been issued and the captured request came back null. In a before/after
 * comparison that reads as a scattered, direction-less set of diffs on
 * `probes.*.request`, which is exactly what a flaky harness looks like and
 * exactly what a real regression does not.
 *
 * Flows that legitimately issue nothing (an action-select flow applies
 * locally) just spend the timeout and record `null`, which is the right
 * answer for them.
 */
async function waitForRequest(page, sent, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (sent.length) return;
    await page.waitForTimeout(50);
  }
}

/**
 * Waits for the submit to visibly RESOLVE rather than for a fixed delay.
 *
 * A fixed wait races the handler's own 1.5s close/reload timer from both
 * sides: too short and the response has not landed, too long and the page has
 * navigated out from under the capture. Waiting for the outcome to appear
 * makes the fingerprint deterministic instead of timing-dependent.
 */
async function settleAfterSubmit(page) {
  const shown = (el) => el && !el.hidden && getComputedStyle(el).display !== 'none';
  try {
    await page.waitForFunction(() => {
      const vis = (id) => {
        const el = document.getElementById(id);
        return el && !el.hidden && getComputedStyle(el).display !== 'none';
      };
      const modal = document.getElementById('contract-declaration-modal');
      return vis('cdm-success') || vis('cdm-error') || !modal?.classList.contains('active');
    }, { timeout: 2500 });
  } catch { /* no visible outcome — captured as-is, which is itself a fingerprint */ }
  void shown;
  try {
    return await page.evaluate(CAPTURE_MODAL);
  } catch (err) {
    // The handler navigated (the cut path reloads). Let it land, then capture
    // the page it left behind rather than crashing the run.
    if (!String(err).includes('Execution context was destroyed')) throw err;
    await page.waitForLoadState('load').catch(() => {});
    return { open: false, navigatedAway: true };
  }
}

async function gotoStable(page, url, timeout) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'load', timeout });
      return;
    } catch (err) {
      if (!String(err).includes('ERR_ABORTED') || attempt === 2) throw err;
      await page.waitForTimeout(1200);
    }
  }
}

async function closeModal(page) {
  await page.evaluate(() => {
    document.querySelector('#contract-declaration-modal .cdm-close')?.click();
  });
  await page.waitForTimeout(120);
}

async function run(args) {
  const league = leagueBySlug(args.league);
  const token = forgeSessionToken(args.secret, { franchiseId: args.franchiseId, leagueId: league.id });
  const origin = new URL(args.url);

  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await context.addCookies([
    { name: 'session_token', value: token, domain: origin.hostname, path: '/' },
  ]);

  // A decodable placeholder, not an empty 200: headshots carry an inline
  // onerror cascade that reassigns this.src, and an undecodable body makes the
  // captured state a race against how far that cascade walked. Same trap the
  // roster harness documents.
  await context.route(/espncdn\.com|myfantasyleague\.com|mflfootballv2\.vercel\.app/, (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }),
  );
  for (const pattern of WRITE_ENDPOINTS) {
    await context.route(pattern, (route) =>
      route.request().method() === 'GET' ? route.continue() : route.abort(),
    );
  }

  // Playwright matches routes in REVERSE registration order, so these are
  // registered last in order to win over the aborting handlers above. They
  // answer from PROBE_RESPONSES; the request is recorded and dropped, never
  // forwarded, so neither the dev server nor MFL sees a write.
  const sent = [];
  if (args.probe) {
    for (const pattern of PROBE_ENDPOINTS) {
      await context.route(pattern, async (route) => {
        const req = route.request();
        if (req.method() === 'GET') return route.continue();
        let body = null;
        try { body = JSON.parse(req.postData() ?? 'null'); } catch { body = req.postData() ?? null; }
        sent.push({ method: req.method(), url: new URL(req.url()).pathname, body });
        const canned = PROBE_RESPONSES[args.probeResponse];
        return route.fulfill({
          status: canned.status,
          contentType: 'application/json',
          body: JSON.stringify(canned.body),
        });
      });
    }
  }

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const url = `${args.url}/${args.league}/rosters`;
  process.stdout.write(`→ ${url}\n`);
  await page.goto(url, { waitUntil: 'load', timeout: args.timeout });
  await page.waitForTimeout(3000);

  const triggers = await page.evaluate(() =>
    [...document.querySelectorAll('.ufa-action-btn[data-player-id]')].map((b) => ({
      playerId: b.dataset.playerId,
      name: b.dataset.playerName || null,
    })),
  );
  const chosen = args.limit > 0 ? triggers.slice(0, args.limit) : triggers;
  process.stdout.write(`  ${triggers.length} eligible players, walking ${chosen.length}\n`);

  const players = [];
  for (const t of chosen) {
    await page.evaluate((id) => {
      document.querySelector(`.ufa-action-btn[data-player-id="${id}"]`)?.click();
    }, t.playerId);
    await page.waitForTimeout(250);

    const entry = { playerId: t.playerId, name: t.name, step1: await page.evaluate(CAPTURE_MODAL), flows: {} };

    if (entry.step1.open) {
      const labels = entry.step1.actionOptions
        .map((o) => o.label)
        .filter((l) => l && SAFE_FLOWS.some((s) => l.toLowerCase().includes(s)));

      for (const label of labels) {
        const entered = await page.evaluate((wanted) => {
          const opt = [...document.querySelectorAll('#cdm-action-options .cdm-action-option')].find(
            (o) => o.querySelector('.cdm-action-option__label')?.textContent?.trim() === wanted,
          );
          if (!opt || opt.disabled) return false;
          opt.click();
          return true;
        }, label);
        if (!entered) continue;
        await page.waitForTimeout(250);
        entry.flows[label] = await page.evaluate(CAPTURE_MODAL);

        // Back out to step 1 for the next flow; re-open if Back is gone.
        const wentBack = await page.evaluate(() => {
          const back = document.getElementById('cdm-back-btn');
          if (!back || back.hidden || getComputedStyle(back).display === 'none') return false;
          back.click();
          return true;
        });
        await page.waitForTimeout(200);
        if (!wentBack) {
          await closeModal(page);
          await page.evaluate((id) => {
            document.querySelector(`.ufa-action-btn[data-player-id="${id}"]`)?.click();
          }, t.playerId);
          await page.waitForTimeout(250);
        }
      }
    }

    if (args.probe && entry.step1.open) {
      entry.probes = {};
      const labels = entry.step1.actionOptions
        .map((o) => o.label)
        .filter((l) => l && SAFE_FLOWS.some((sf) => l.toLowerCase().includes(sf)));
      for (const label of labels) {
        // Each submit is driven from a FRESH page: the handler's success path
        // sets a close/reload timer and rewrites the table, so reusing the
        // same DOM would make the next probe depend on the last one.
        await gotoStable(page, url, args.timeout);
        await page.waitForTimeout(2500);
        const opened = await page.evaluate((id) => {
          const btn = document.querySelector(`.ufa-action-btn[data-player-id="${id}"]`);
          if (!btn) return false;
          btn.click();
          return true;
        }, t.playerId);
        if (!opened) continue;
        await page.waitForTimeout(250);
        const probe = await probeFlow(page, t.playerId, label, sent);
        if (probe) entry.probes[label] = probe;
      }
      await gotoStable(page, url, args.timeout);
      await page.waitForTimeout(2500);
    }

    players.push(entry);
    await closeModal(page);
    process.stdout.write(
      `  ✓ ${String(t.name ?? t.playerId).padEnd(24)} ${entry.step1.open ? entry.step1.mode : 'DID NOT OPEN'}` +
        ` — ${Object.keys(entry.flows).length} flow(s)` +
        (args.probe ? `, ${Object.keys(entry.probes ?? {}).length} probe(s)` : '') + '\n',
    );
  }

  const direct = args.probe ? await probeDirectOpeners(page, url, args, sent) : null;

  await browser.close();
  return {
    direct,
    league: args.league,
    franchiseId: args.franchiseId,
    probeResponse: args.probe ? args.probeResponse : null,
    players,
    pageErrors,
  };
}

// ------------------------------------------------------------- compare ----

function flatten(value, prefix, out) {
  if (value === null || typeof value !== 'object') {
    out.set(prefix, value === undefined ? null : value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

function compare(beforePath, afterPath) {
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  const a = flatten(before.players, '', new Map());
  const b = flatten(after.players, '', new Map());

  const diffs = [];
  for (const [key, valueA] of a) {
    if (!b.has(key)) diffs.push({ key, before: valueA, after: '<missing>' });
    else if (JSON.stringify(b.get(key)) !== JSON.stringify(valueA)) {
      diffs.push({ key, before: valueA, after: b.get(key) });
    }
  }
  for (const key of b.keys()) if (!a.has(key)) diffs.push({ key, before: '<missing>', after: b.get(key) });

  process.stdout.write(`compared ${a.size} captured values\n`);
  if (!diffs.length) {
    process.stdout.write('✓ identical — the modal renders the same before and after\n');
    return 0;
  }
  process.stdout.write(`✗ ${diffs.length} difference(s)\n`);
  for (const d of diffs.slice(0, 50)) {
    process.stdout.write(`  ${d.key}\n    before: ${JSON.stringify(d.before)}\n    after:  ${JSON.stringify(d.after)}\n`);
  }
  if (diffs.length > 50) process.stdout.write(`  …and ${diffs.length - 50} more\n`);
  return 1;
}

const args = parseArgs(process.argv);
if (args.compare) {
  process.exit(compare(args.compare[0], args.compare[1]));
} else if (args.probe) {
  // Both branches of the handler: what it sends, and what it does with a
  // success and with a rejection. Nothing is written either way.
  const runs = {};
  for (const which of ['ok', 'fail']) {
    process.stdout.write(`\n=== probe: ${which} response ===\n`);
    runs[which] = await run({ ...args, probeResponse: which });
  }
  const captured = ['ok', 'fail'].reduce(
    (n, k) => n + flatten(runs[k].players, '', new Map()).size, 0,
  );
  const probes = ['ok', 'fail'].reduce(
    (n, k) => n + runs[k].players.reduce((m, p) => m + Object.keys(p.probes ?? {}).length, 0), 0,
  );
  const errs = ['ok', 'fail'].flatMap((k) => runs[k].pageErrors);
  process.stdout.write(`\n${probes} submits driven, ${captured} captured values\n`);
  if (errs.length) {
    process.stdout.write(`! ${errs.length} page error(s):\n`);
    for (const e of errs.slice(0, 5)) process.stdout.write(`  ${e}\n`);
  }
  if (args.out) {
    // Shaped like a normal run so --compare needs no probe-specific branch.
    writeFileSync(args.out, JSON.stringify({ probe: true, players: runs }, null, 2));
    const directCount = ['ok', 'fail'].reduce(
      (n, k) => n + Object.keys(runs[k].direct ?? {}).length, 0,
    );
    process.stdout.write(`  (${directCount} of those opened straight from a cell)\n`);
    process.stdout.write(`wrote ${args.out}\n`);
  }
  process.exit(errs.length ? 1 : 0);
} else {
  const result = await run(args);
  const captured = flatten(result.players, '', new Map()).size;
  const opened = result.players.filter((p) => p.step1.open).length;
  const flows = result.players.reduce((n, p) => n + Object.keys(p.flows).length, 0);
  process.stdout.write(
    `\n${opened}/${result.players.length} modals opened, ${flows} flow screens, ${captured} captured values\n`,
  );
  if (result.pageErrors.length) {
    process.stdout.write(`! ${result.pageErrors.length} page error(s):\n`);
    for (const e of result.pageErrors.slice(0, 5)) process.stdout.write(`  ${e}\n`);
  }
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(result, null, 2));
    process.stdout.write(`wrote ${args.out}\n`);
  }
  process.exit(result.pageErrors.length ? 1 : 0);
}
