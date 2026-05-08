/**
 * Power Rankings — Phase 2 AI voice helpers.
 *
 * Builds the fact sheet, defines the prompt, and validates the AI's
 * structured output. The main generate-power-rankings.mjs orchestrates
 * the call to callAnthropic; this module is the deterministic surface
 * around it (so the unit tests don't need an API key).
 */

import { buildCachedSystem } from '../article-utils/ai-client.mjs';

// ─── Quality-gate constants ────────────────────────────────────────

export const HEADLINE_MAX = 100;
export const LEDE_MAX = 600;
export const BLURB_MAX = 240;

// Phrases that betray AI tells or break voice. Case-insensitive substring match.
export const BANNED_PHRASES = [
  "i'm an ai",
  'as an ai',
  "i am an ai",
  'as a language model',
  'large language model',
  "i cannot",
  'as claude',
  "i'm claude",
  'it appears that',
  'it seems that',
  'i hope this helps',
  'in conclusion',
];

// Curly/smart quotes break the schefter house style (existing rule).
const CURLY_QUOTE_RE = /[‘’“”]/;

// ─── Fact sheet builder ────────────────────────────────────────────

/**
 * Build a deterministic, structured fact sheet that the AI may reference.
 * The AI is instructed to use ONLY data from this sheet — no invention.
 *
 * @param {object} args
 * @param {object} args.issue — partial issue (rankings + awards), pre-AI.
 * @param {Map<string, object>} args.teams — franchiseId → team config.
 * @returns {string} Plaintext fact sheet.
 */
export function buildFactSheet({ issue, teams }) {
  const lines = [];
  lines.push(`POWER RANKINGS FACT SHEET — ${issue.year} Week ${issue.week}`);
  lines.push('');
  lines.push('League: TheLeague (16 dynasty franchises). Voice: Claude Schefter.');
  lines.push('');

  // ─ Rankings table ─
  lines.push('=== RANKINGS (1-16) ===');
  lines.push('Format: rank | team | trend | rolling-3wk record | rolling-3wk PPG | streak | season PPG');
  for (const r of issue.rankings) {
    const team = teams.get(r.franchiseId);
    const name = team?.nameMedium ?? team?.name ?? r.franchiseId;
    const trend = r.previousRank == null
      ? 'new'
      : r.previousRank === r.rank
        ? 'flat'
        : r.previousRank > r.rank
          ? `up ${r.previousRank - r.rank} (was #${r.previousRank})`
          : `down ${r.rank - r.previousRank} (was #${r.previousRank})`;
    const ppg = r.metrics.rolling3Ppg != null ? r.metrics.rolling3Ppg.toFixed(1) : '—';
    const seasonPpg = r.metrics.seasonPpg != null ? r.metrics.seasonPpg.toFixed(1) : '—';
    const factsForBlurb = r.factsForBlurb || {}; // optional caller enrichment
    const recStr = factsForBlurb.last3Record ? `${factsForBlurb.last3Record.wins}-${factsForBlurb.last3Record.losses}${factsForBlurb.last3Record.ties ? `-${factsForBlurb.last3Record.ties}` : ''} L3` : '—';
    const streakStr = factsForBlurb.streak && factsForBlurb.streak.length >= 2
      ? `${factsForBlurb.streak.type}${factsForBlurb.streak.length}`
      : 'no active streak';
    lines.push(`#${r.rank} | ${name} | ${trend} | ${recStr} | ${ppg} PPG L3 | ${streakStr} | ${seasonPpg} season PPG`);
  }
  lines.push('');

  // ─ Awards (deterministic context) ─
  lines.push('=== WEEKLY AWARDS (deterministic data — re-voice in Schefter style) ===');
  for (const [key, card] of Object.entries(issue.awards || {})) {
    if (!card) continue;
    const fid = card.franchiseId ?? card.homeId;
    const teamA = fid ? (teams.get(fid)?.nameMedium ?? fid) : '';
    const teamB = card.awayId ? (teams.get(card.awayId)?.nameMedium ?? card.awayId) : '';
    const recipient = teamB ? `${teamA} vs ${teamB}` : teamA;
    lines.push(`${key}: ${card.title} — ${recipient}`);
    lines.push(`  raw: ${card.blurb}`);
    if (card.metric) lines.push(`  metric: ${JSON.stringify(card.metric)}`);
  }
  lines.push('');

  // ─ Allowed name tokens (helps the model not invent) ─
  lines.push('=== ALLOWED FRANCHISE NAME TOKENS ===');
  for (const [, t] of teams) {
    const aliases = (t.aliases || []).join(', ');
    lines.push(`- ${t.name} (also: ${[t.nameMedium, t.nameShort, t.abbrev, aliases].filter(Boolean).join(', ')})`);
  }
  lines.push('');

  return lines.join('\n');
}

// ─── Prompts ───────────────────────────────────────────────────────

const TYPE_SPECIFIC_PROMPT = `

ARTICLE TYPE: Tuesday Power Rankings issue.

Your job: rewrite the issue's HEADLINE, LEDE, and a one-sentence BLURB for each of the 16 franchises in Schefter voice. Re-voice the AWARD blurbs in the same style.

VOICE RULES
- Schefter: confident, punchy, opinionated. "League sources tell me…", "Boom.", "Money is nice, but championships are better."
- One blurb per team max. Specific. Reference the team's L3 record, PPG, streak, or trend from the fact sheet.
- Lede: 2-3 sentences. Frame the week's biggest story (rise to #1, fall, hot streak, blowup).
- Headline: ≤100 chars, punchy, no period. Bias toward action verbs.

NEVER
- Invent franchise or player names. Only use names that appear in the ALLOWED FRANCHISE NAME TOKENS list.
- Use curly/smart quotes — straight ASCII only.
- Use markdown code fences.
- Hedge with "I'm an AI", "as a language model", "It appears that", "I hope this helps", "in conclusion".

LENGTH
- headline: ≤100 chars
- lede: ≤600 chars
- each blurb: ≤240 chars`;

export function getSystemPrompt() {
  return buildCachedSystem(TYPE_SPECIFIC_PROMPT);
}

export function getUserPrompt(factSheet) {
  return `Rewrite the power rankings issue using ONLY data from the fact sheet below.

${factSheet}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown fences:
{
  "headline": "Punchy headline (~60 chars)",
  "lede": "2-3 sentence lede in Schefter's voice.",
  "blurbs": {
    "<franchiseId>": "One sentence about that franchise (≤240 chars)",
    ...
  },
  "awardBlurbs": {
    "statOfWeek": "Schefter rewrite of the stat-of-week blurb (or null to keep raw)",
    "benchBlunder": "...",
    "heaterOfWeek": "...",
    "coolerOfWeek": "...",
    "matchupOfWeek": "..."
  }
}

REQUIREMENTS
- Provide a blurb for ALL 16 franchiseIds present in the fact sheet rankings table.
- Each blurb must contain a recognizable token for THAT franchise (e.g., the nameMedium).
- Do not invent stats or names not present in the fact sheet.`;
}

// ─── Validation ────────────────────────────────────────────────────

/**
 * Validate a single blurb. Returns array of error strings (empty = ok).
 *
 * @param {string} text
 * @param {{ franchise?: object, maxLength?: number }} opts
 *   - franchise: team config; the blurb must mention one of its name tokens.
 *   - maxLength: override the default cap.
 */
export function validateBlurb(text, { franchise = null, maxLength = BLURB_MAX } = {}) {
  const errors = [];
  if (!text || typeof text !== 'string') {
    return ['empty'];
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) return ['empty'];
  if (trimmed.length > maxLength) errors.push(`too long (${trimmed.length} > ${maxLength})`);

  const lower = trimmed.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      errors.push(`banned phrase: "${phrase}"`);
    }
  }
  if (CURLY_QUOTE_RE.test(trimmed)) errors.push('curly quote');
  if (trimmed.includes('```')) errors.push('markdown fence');

  if (franchise) {
    const tokens = [
      franchise.name,
      franchise.nameMedium,
      franchise.nameShort,
      franchise.abbrev,
      ...(franchise.aliases || []),
    ].filter(Boolean);
    const found = tokens.some(tok => tok && trimmed.includes(tok));
    if (!found) errors.push('does not name this franchise');
  }

  return errors;
}

/**
 * Apply AI output to the issue, falling back per-blurb to the templated
 * version when validation fails. Returns a new issue object — does not mutate.
 *
 * @param {object} issue — pre-AI issue (with templated headline/lede/blurbs).
 * @param {object} aiOutput — parsed { headline, lede, blurbs, awardBlurbs }.
 * @param {Map<string, object>} teams — franchiseId → team config.
 * @returns {{ issue: object, report: object }}
 */
export function applyAIVoice(issue, aiOutput, teams) {
  const report = {
    headline: 'templated',
    lede: 'templated',
    blurbs: { applied: 0, fallback: 0, fails: [] },
    awardBlurbs: { applied: 0, fallback: 0, fails: [] },
  };
  const out = { ...issue };

  // Headline
  if (aiOutput?.headline) {
    const errs = validateBlurb(aiOutput.headline, { maxLength: HEADLINE_MAX });
    if (errs.length === 0) {
      out.headline = aiOutput.headline.trim();
      report.headline = 'ai';
    } else {
      report.headline = 'fallback';
      report.headlineFails = errs;
    }
  }

  // Lede
  if (aiOutput?.lede) {
    const errs = validateBlurb(aiOutput.lede, { maxLength: LEDE_MAX });
    if (errs.length === 0) {
      out.lede = aiOutput.lede.trim();
      report.lede = 'ai';
    } else {
      report.lede = 'fallback';
      report.ledeFails = errs;
    }
  }

  // Per-team blurbs
  out.rankings = (issue.rankings || []).map(r => {
    const aiBlurb = aiOutput?.blurbs?.[r.franchiseId];
    if (!aiBlurb) {
      report.blurbs.fallback++;
      return r;
    }
    const errs = validateBlurb(aiBlurb, { franchise: teams.get(r.franchiseId), maxLength: BLURB_MAX });
    if (errs.length === 0) {
      report.blurbs.applied++;
      return { ...r, blurb: aiBlurb.trim() };
    }
    report.blurbs.fallback++;
    report.blurbs.fails.push({ franchiseId: r.franchiseId, errors: errs });
    return r;
  });

  // Award blurbs (no franchise-mention requirement; matchupOfWeek mentions two teams)
  if (issue.awards) {
    out.awards = { ...issue.awards };
    for (const [key, card] of Object.entries(issue.awards)) {
      if (!card) continue;
      const aiBlurb = aiOutput?.awardBlurbs?.[key];
      if (!aiBlurb) {
        report.awardBlurbs.fallback++;
        continue;
      }
      const errs = validateBlurb(aiBlurb, { maxLength: BLURB_MAX });
      if (errs.length === 0) {
        out.awards[key] = { ...card, blurb: aiBlurb.trim() };
        report.awardBlurbs.applied++;
      } else {
        report.awardBlurbs.fallback++;
        report.awardBlurbs.fails.push({ key, errors: errs });
      }
    }
  }

  return { issue: out, report };
}
