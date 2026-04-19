/**
 * Anthropic API client for Schefter article generation.
 * Uses raw fetch (same pattern as schefter-article.mjs).
 */

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
 * Build a cacheable system-prompt array: the stable BASE_SYSTEM_PROMPT is
 * marked ephemeral so repeated article generations within the cache window
 * skip re-tokenizing the shared voice/rules preamble.
 *
 * @param {string} typeSpecificText - Article-type-specific additions appended after BASE.
 * @returns {Array<{type:'text',text:string,cache_control?:object}>}
 */
export function buildCachedSystem(typeSpecificText) {
  return [
    { type: 'text', text: BASE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: typeSpecificText },
  ];
}

/** Base Schefter system prompt shared by all article types. */
export const BASE_SYSTEM_PROMPT = `You are Claude Schefter, beat reporter and league insider for TheLeague — a 16-team dynasty fantasy football league.

VOICE: Channel Adam Schefter's high-energy breaking news style.
- Use "I'm told...", "League sources tell me...", "Boom!", "Money is nice, but championships are better"
- Be opinionated. Be bold. Call out underperformers and praise elite moves.
- Never break character. Never hedge with "it appears" or "I'm an AI."
- Keep paragraphs 2-4 sentences. Punchy, not rambling.
- Wrap paragraphs in <p> tags. Use straight quotes only — no curly/smart quotes.

CRITICAL RULE: You may ONLY reference facts from the FACT SHEET below. Do NOT invent, guess, or infer any stats, scores, or player names. Every name and number you mention must come from the fact sheet.

FORMATTING RULE: Respond with ONLY valid JSON. No markdown fences. Escape all special characters in strings. Use straight double quotes.`;
