/**
 * Custom-site demo leads (docs/plans/custom-site-demo.md, phase 3).
 *
 * A prospect fills the questionnaire on demo.mfl.football; the demo issues
 * their private link on the spot and relays the lead to the PRODUCTION site,
 * which stores it, pushes the owner, and lists it on an admin page. The two
 * deployments hold different databases and different secrets, so they talk
 * only through signed messages: `DEMO_LEAD_RELAY_SECRET`, set on both (the
 * demo keeps it — the scrub leaves `DEMO_*` alone).
 *
 * Plain JS: shared by the demo's API routes, production's receiver, and tests.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const RELAY_SECRET_ENV = 'DEMO_LEAD_RELAY_SECRET';
export const SIGNATURE_HEADER = 'x-demo-signature';
/** A signed message older (or newer) than this is refused — no replays. */
export const SIGNATURE_MAX_SKEW_SECONDS = 300;

// ── The questionnaire ───────────────────────────────────────────────────────

export const LEAGUE_FORMATS = ['dynasty', 'keeper', 'redraft', 'bestball'];
export const DRAFT_TYPES = ['auction', 'snake', 'both'];
export const PLATFORMS = ['mfl', 'sleeper', 'espn', 'yahoo', 'fleaflicker', 'other'];

/** Field → [max length, required]. Anything not listed is dropped. */
const TEXT_FIELDS = {
  name: [80, true],
  email: [120, true],
  leagueName: [120, true],
  leagueId: [20, false],
  scoring: [400, false],
  wishlist: [1500, false],
  heardFrom: [200, false],
};

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/;

/**
 * @typedef {{
 *   name: string, email: string, leagueName: string, leagueId: string,
 *   scoring: string, wishlist: string, heardFrom: string,
 *   platform: string, format: string, draftType: string, teams: number | null,
 *   salaryCap: boolean, contracts: boolean, conferences: boolean,
 * }} QuestionnaireLead
 */

/**
 * Clean and check a submitted questionnaire. Returns `{ lead }` or
 * `{ errors }` (field → message). Never throws on hostile input.
 *
 * @param {unknown} input
 * @returns {{ lead: QuestionnaireLead } | { errors: Record<string, string> }}
 */
export function validateQuestionnaire(input) {
  const src = input && typeof input === 'object' ? input : {};
  /** @type {Record<string, string>} */
  const errors = {};
  /** @type {Record<string, any>} */
  const lead = {};

  for (const [field, [max, required]] of Object.entries(TEXT_FIELDS)) {
    const value = typeof src[field] === 'string' ? src[field].trim().slice(0, max) : '';
    if (required && !value) errors[field] = 'Required.';
    lead[field] = value;
  }
  if (lead.email && !EMAIL.test(lead.email)) errors.email = 'Enter a valid email address.';

  const pick = (field, allowed) => {
    const value = String(src[field] ?? '').toLowerCase();
    if (!allowed.includes(value)) errors[field] = 'Choose one.';
    return value;
  };
  lead.platform = pick('platform', PLATFORMS);
  lead.format = pick('format', LEAGUE_FORMATS);
  lead.draftType = pick('draftType', DRAFT_TYPES);

  const teams = Number(src.teams);
  if (!Number.isInteger(teams) || teams < 4 || teams > 256) errors.teams = 'Enter a team count from 4 to 256.';
  lead.teams = Number.isInteger(teams) ? teams : null;

  const yes = (field) => src[field] === true || src[field] === 'yes' || src[field] === 'on';
  lead.salaryCap = yes('salaryCap');
  lead.contracts = yes('contracts');
  lead.conferences = yes('conferences');

  return Object.keys(errors).length ? { errors } : { lead: /** @type {QuestionnaireLead} */ (lead) };
}

/** The honeypot field: invisible to people, filled by form bots. */
export const HONEYPOT_FIELD = 'website';

export function isBotSubmission(input) {
  return Boolean(input && typeof input === 'object' && String(input[HONEYPOT_FIELD] ?? '').trim());
}

// ── Matching a lead to a demo ───────────────────────────────────────────────

/**
 * Which demo best fits the league they described. `wanted` is the one we
 * would build for them; `path` is the one that exists today (only the dynasty
 * demo is built — the others fall back to it until they ship).
 */
export function matchDemo(lead, available = ['dynasty']) {
  let wanted = 'dynasty';
  if (lead.teams >= 30 || lead.conferences) wanted = 'bigleague';
  else if (lead.format === 'redraft' || lead.format === 'bestball') wanted = 'redraft';
  else if (lead.format === 'keeper' && !lead.salaryCap && !lead.contracts) wanted = 'keeper';
  const path = available.includes(wanted) ? wanted : available[0];
  return { wanted, path };
}

// ── Signed messages between the deployments ─────────────────────────────────

const hmac = (secret, message) => createHmac('sha256', secret).update(message).digest('hex');

/** `t=<unix seconds>,v1=<hex hmac of "t.body">` */
export function signRelayBody(body, secret, now = Math.floor(Date.now() / 1000)) {
  if (!secret) throw new Error(`${RELAY_SECRET_ENV} is not set`);
  return `t=${now},v1=${hmac(secret, `${now}.${body}`)}`;
}

/** True only for a fresh signature over exactly this body with this secret. */
export function verifyRelaySignature(body, header, secret, now = Math.floor(Date.now() / 1000)) {
  if (!secret || typeof header !== 'string') return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(now - t) > SIGNATURE_MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(hmac(secret, `${t}.${body}`), 'hex');
  const given = Buffer.from(String(parts.v1 ?? ''), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function newLeadId() {
  return `lead_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}
