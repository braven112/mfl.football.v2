/**
 * Anthropic client for the scouting system. Uses Opus for per-franchise GM
 * reasoning depth. Strict JSON output expected from every call.
 *
 * Pattern mirrors scripts/article-utils/ai-client.mjs but with:
 *   - Opus 4.7 default (deeper reasoning per franchise)
 *   - Higher max_tokens (8K — GM briefs include 5+ targets with reasoning)
 *   - Prompt-cache-eligible system prompt slot for the shared league context
 */

const DEFAULT_MODEL = process.env.SCOUTING_MODEL || 'claude-opus-4-7';
const API_URL = 'https://api.anthropic.com/v1/messages';

function repairJSON(text) {
  let json = text;
  json = json.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
  json = json.replace(/,\s*([}\]])/g, '$1');
  const opens = (json.match(/[{[]/g) || []).length;
  const closes = (json.match(/[}\]]/g) || []).length;
  if (opens > closes) {
    const stack = [];
    for (const ch of json) {
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
    json += stack.reverse().join('');
  }
  return json;
}

/**
 * Call Anthropic and return parsed JSON.
 *
 * @param {object} opts
 * @param {string|Array} opts.system - System prompt (string or block array for caching)
 * @param {string} opts.user - User prompt
 * @param {number} [opts.maxTokens=8000]
 * @param {string} [opts.model]
 * @returns {Promise<unknown>} Parsed JSON
 */
export async function callAnthropicJSON({ system, user, maxTokens = 8000, model }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable required');
  }

  const usedModel = model || DEFAULT_MODEL;
  let lastErr = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: usedModel,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API ${res.status}: ${errText}`);
    }

    const resData = await res.json();
    const text = resData.content?.[0]?.text ?? '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      lastErr = new Error('No JSON object in response');
      if (attempt === 1) continue;
      throw lastErr;
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      try {
        return JSON.parse(repairJSON(jsonMatch[0]));
      } catch {
        lastErr = e;
        if (attempt === 1) continue;
        throw new Error(`JSON parse failed: ${e.message}`);
      }
    }
  }
  throw lastErr;
}

export const SCOUTING_MODEL = DEFAULT_MODEL;
