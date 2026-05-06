// Quality gate for Schefter GroupMe sends.
//
// The website feed is forgiving — a flat post is buried by the next scroll.
// GroupMe pings the whole league in real time, so a low-quality post is
// disproportionately costly there. This module scores an LLM-generated post
// before the scanner fires the GroupMe webhook; the caller skips the send
// when the score falls below threshold.
//
// Failure mode: if the scorer errors (network, 529, malformed JSON), default
// to allowing the send. Suppressing legitimate posts because Anthropic is
// rate-limited is worse than letting an occasional flat post through.

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_THRESHOLD = 6;

const SCORING_PROMPT = `You score a single Schefter Report post for whether it's worth pinging an entire fantasy football GroupMe chat about.

Schefter voice rubric:
- Confident, opinionated insider tone ("I'm told…", "League sources tell me…", "Boom!")
- Punchy and specific. References real teams/players when given.
- Avoids hedging, generic platitudes, or AI tells ("It's important to note…", "As an AI…").
- Body length 1-4 sentences. No essay-length filler.

Coherence rubric:
- Headline and body agree.
- No internal contradictions.
- No obviously hallucinated facts (impossible matchups, made-up rules, broken franchise references).
- Reads like one human posted it, not a stitched-together summary.

Score 1-10:
- 10: Worth interrupting the chat for.
- 7-9: Solid, send it.
- 4-6: Flat, off-voice, or borderline. Don't ping the chat.
- 1-3: Hallucinated, contradictory, or off-topic. Definitely suppress.

Respond with JSON only: {"score": <int 1-10>, "reason": "<one short sentence>"}`;

export function getThreshold(env = process.env) {
  const raw = parseInt(env.SCHEFTER_QUALITY_THRESHOLD || '', 10);
  return Number.isFinite(raw) && raw >= 1 && raw <= 10 ? raw : DEFAULT_THRESHOLD;
}

export function parseScorerResponse(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON object in scorer response');
  const parsed = JSON.parse(match[0]);
  const score = Number(parsed.score);
  if (!Number.isFinite(score) || score < 1 || score > 10) {
    throw new Error(`invalid score in scorer response: ${match[0]}`);
  }
  return { score, reason: String(parsed.reason || '').slice(0, 240) };
}

export async function scoreSchefterPost({ headline, body, analysis = null, tier = null }, { apiKey, model = DEFAULT_MODEL, fetchFn = fetch } = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');

  const res = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 150,
      system: SCORING_PROMPT,
      messages: [{
        role: 'user',
        content: `Score this post:\n\n${JSON.stringify({ headline, body, analysis, tier }, null, 2)}`,
      }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return parseScorerResponse(data?.content?.[0]?.text ?? '');
}

// Decide whether to fire the GroupMe send. Returns { allow, score, reason, error }.
// Always returns allow=true on scorer failure — see header comment.
export async function checkGroupMeQuality(post, { apiKey, model, threshold, log = console.log, warn = console.warn } = {}) {
  if (!apiKey) {
    log('  [quality-gate] no ANTHROPIC_API_KEY — allowing GroupMe send');
    return { allow: true, score: null, reason: 'no-api-key', error: null };
  }
  const t = threshold ?? getThreshold();
  try {
    const { score, reason } = await scoreSchefterPost(post, { apiKey, model });
    const allow = score >= t;
    log(`  [quality-gate] ${score}/10 ${allow ? 'ALLOW' : 'SUPPRESS'} — ${reason}`);
    return { allow, score, reason, error: null };
  } catch (err) {
    warn(`  [quality-gate] scorer error, allowing send: ${err.message}`);
    return { allow: true, score: null, reason: null, error: err.message };
  }
}
