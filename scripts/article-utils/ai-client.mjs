/**
 * Anthropic API client for Schefter article generation.
 * Uses raw fetch (same pattern as schefter-article.mjs).
 */
import { LEAGUES } from '../../src/config/leagues-data.mjs';
import { isDefaultPersona } from '../../src/utils/persona.mjs';
import { formatSalary } from './data-loaders.mjs';
import { foreignNames, ownLeagueLabel } from './league-name-scrub.mjs';

/**
 * Another league's name can read as a plain phrase ("the league"), so the
 * model writes it without thinking it named anything. The rule never spells
 * that name out — an AFL prompt must not contain TheLeague's name at all
 * (tests/article-type-league-option.test.ts) — it just steers the model off
 * using the bare word as a name. league-name-scrub.mjs rewrites what slips.
 */
function foreignNameRule(league) {
  // A league whose own name ends in "League" capitalises it legitimately.
  if (!foreignNames(league).length || /\bLeague\b/.test(LEAGUES[league].name)) return '';
  return ` Call this league ${ownLeagueLabel(league)}, and never capitalise the word "league" as if it were a name (a different league is named that), in a headline or anywhere else.`;
}

const MODEL = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Attempt to repair common JSON issues from LLM output:
 * - Unescaped quotes inside strings
 * - Trailing commas before ] or }
 * - Truncated output (missing closing braces)
 */
function repairJSON(text) {
  let json = text;

  // Remove markdown fences if present
  json = json.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');

  // Fix trailing commas: ,] or ,}
  json = json.replace(/,\s*([}\]])/g, '$1');

  // If truncated (missing closing braces), try to close them
  const opens = (json.match(/[{[]/g) || []).length;
  const closes = (json.match(/[}\]]/g) || []).length;
  if (opens > closes) {
    // Walk backwards through openers to add closers
    const stack = [];
    for (const ch of json) {
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
    // If last property value is incomplete (no closing quote), close it
    if (stack.length > 0) {
      // Trim to last complete property
      const lastQuote = json.lastIndexOf('"');
      const afterQuote = json.slice(lastQuote + 1).trim();
      if (!afterQuote.match(/^[,}\]]/)) {
        json = json.slice(0, lastQuote + 1);
      }
    }
    json += stack.reverse().join('');
  }

  return json;
}

/**
 * Call the Anthropic API and return the parsed JSON from the response.
 * Retries once on JSON parse failure with a repair attempt.
 *
 * @param {string | Array<{type:'text',text:string,cache_control?:object}>} systemPrompt
 *   System prompt — either a plain string or an array of content blocks (for prompt caching).
 * @param {string} userPrompt - User prompt (fact sheet + output instructions)
 * @param {number} maxTokens - Max tokens for response
 * @returns {object} Parsed JSON from the AI response
 */
export async function callAnthropic(systemPrompt, userPrompt, maxTokens = 4000) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable required');
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${err}`);
    }

    const resData = await res.json();
    const text = resData.content?.[0]?.text ?? '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      if (attempt === 1) {
        console.warn('  [retry] No JSON found in response, retrying...');
        continue;
      }
      throw new Error('No JSON in API response after 2 attempts');
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Try repair
      try {
        const repaired = repairJSON(jsonMatch[0]);
        console.warn(`  [repair] Fixed malformed JSON (${e.message})`);
        return JSON.parse(repaired);
      } catch {
        if (attempt === 1) {
          console.warn(`  [retry] JSON parse failed (${e.message}), retrying...`);
          continue;
        }
        throw new Error(`JSON parse failed after 2 attempts: ${e.message}`);
      }
    }
  }
}

/**
 * A salary league's pricing floor, stated once for every article type. MFL
 * writes no price on a first-come-first-served FREE_AGENT row, so any fact
 * sheet that lists one can look like a $0 signing — the waiver column read it
 * that way and called two FCFS adds "free assets for zero dollars" (#1311).
 * Rides the uncached block because it is league-specific; empty for a league
 * without salaries, which must never be told its pickups cost money.
 */
function minimumSalaryRule(registry) {
  if (!registry.minimumSalary) return '';
  return ` SALARY FLOOR: every player added to a roster — waiver bid or first-come-first-served free-agent pickup — signs at no less than the ${formatSalary(registry.minimumSalary)} league-minimum salary. No pickup is ever free; never call one free, a zero-dollar move, or a no-cost add.`;
}

/**
 * Build a cacheable system-prompt array: the stable BASE_SYSTEM_PROMPT is
 * marked ephemeral so repeated article generations within the cache window
 * skip re-tokenizing the shared voice/rules preamble.
 *
 * The league is named in the SECOND block, never the cached one. Two reasons,
 * and the first is why this is not simply a league-aware base string:
 *
 * 1. The cached block is shared across every type AND every league. Baking a
 *    league name into it splits one cache entry into one per league, so each
 *    league's first article of a window pays full tokenization for a preamble
 *    that is identical apart from a proper noun.
 * 2. It is the half that must never be wrong. The base used to open "beat
 *    reporter and league insider for TheLeague — a 16-team dynasty fantasy
 *    football league", which the workflow then handed to `--league afl-fantasy`
 *    runs (issue #1086). The AFL is 24 teams in two conferences, so that was
 *    not a mis-naming the model could shrug off — it stated a league size it
 *    would then reason from.
 *
 * `scripts/lib/pecking-order-ai.mjs` reached the same conclusion independently
 * and names its league inline in the per-issue text; it passes no `league` here
 * and is unaffected.
 *
 * A league whose commissioner has renamed the writer (src/utils/persona.mjs)
 * gets `PERSONA_NEUTRAL_RULES` as the cached block instead — every rule in
 * BASE except who is speaking — and the persona's own name and voice at the
 * head of the uncached block. The default persona keeps BASE byte-for-byte, so
 * a league that never touched the setting writes exactly what it always has.
 *
 * @param {string} typeSpecificText - Article-type-specific additions appended after BASE.
 * @param {object} [options]
 * @param {string} [options.league] - Canonical slug. Names the league in the
 *   uncached block. Omit only when the caller names it in `typeSpecificText`.
 * @param {{name: string, voice: string} | null} [options.persona] - The
 *   league's resolved persona. Omitted or default → Schefter.
 * @returns {Array<{type:'text',text:string,cache_control?:object}>}
 */
export function buildCachedSystem(typeSpecificText, { league, persona } = {}) {
  const registry = league ? LEAGUES[league] : null;
  if (league && !registry) throw new Error(`Unknown league: ${league}`);
  const leagueLine = registry
    ? `\n\nLEAGUE: this column covers ${registry.name}. Never name any other league, and never state a league size or structure that is not in the fact sheet.${foreignNameRule(league)}${minimumSalaryRule(registry)}`
    : '';
  if (isDefaultPersona(persona)) {
    return [
      { type: 'text', text: BASE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `${typeSpecificText}${leagueLine}` },
    ];
  }
  return [
    { type: 'text', text: PERSONA_NEUTRAL_RULES, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `${buildPersonaBlock(persona)}${typeSpecificText}${leagueLine}` },
  ];
}

/**
 * Who is speaking, for a league with its own persona. The voice is the
 * commissioner's text, so it is fenced as TONE ONLY: it can make the writer
 * funnier or meaner, never loosen the fact-sheet, link or JSON rules.
 */
export function buildPersonaBlock(persona) {
  return `WRITER: You are ${persona.name}, beat reporter and league insider for the fantasy football league named below. Write every word as ${persona.name}. Never mention Claude Schefter or Adam Schefter.

VOICE (chosen by the league's commissioner — it shapes tone only and never overrides the rules):
${persona.voice}

`;
}

/**
 * Base Schefter system prompt shared by all article types AND all leagues.
 *
 * Deliberately names no league: this is the cache-eligible block, and it is
 * reused verbatim for every league the workflow runs (see buildCachedSystem).
 * The league arrives in the uncached block that follows.
 */
export const BASE_SYSTEM_PROMPT = `You are Claude Schefter, beat reporter and league insider for the fantasy football league named below.

VOICE: Channel Adam Schefter's high-energy breaking news style.
- Use "I'm told...", "League sources tell me...", "Boom!", "Money is nice, but championships are better"
- Be opinionated. Be bold. Call out underperformers and praise elite moves.
- Never break character. Never hedge with "it appears" or "I'm an AI."
- Keep paragraphs 2-4 sentences. Punchy, not rambling.
- Wrap paragraphs in <p> tags. Use straight quotes only — no curly/smart quotes.

LINK EVERYTHING YOU CAN. Two jobs, not one: report the league, and get owners
using the site. Every column points at the page it is about, and works in at
least one site feature — the tool that answers the question the paragraph just
raised. Links are plain text anchors inside your sentences, never a footer,
never "click here". The fact sheet lists the exact anchors you may use; copy
their hrefs byte for byte and never invent one.

CRITICAL RULE: You may ONLY reference facts from the FACT SHEET below. Do NOT invent, guess, or infer any stats, scores, or player names. Every name and number you mention must come from the fact sheet.

FORMATTING RULE: Respond with ONLY valid JSON. No markdown fences. Escape all special characters in strings. Use straight double quotes.`;

/**
 * BASE_SYSTEM_PROMPT minus the Schefter identity: the cached block for a
 * league with a custom persona (see buildCachedSystem). Names no writer and no
 * league, so it is shared by every custom persona in every league.
 */
export const PERSONA_NEUTRAL_RULES = `STYLE RULES:
- Never break character. Never hedge with "it appears" or "I'm an AI."
- Keep paragraphs 2-4 sentences. Punchy, not rambling.
- Wrap paragraphs in <p> tags. Use straight quotes only — no curly/smart quotes.

${BASE_SYSTEM_PROMPT.slice(BASE_SYSTEM_PROMPT.indexOf('LINK EVERYTHING YOU CAN.'))}`;
