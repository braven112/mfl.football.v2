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

// Posts scoring below this (1-10 scale) are suppressed from GroupMe.
// Edit this value to tune strictness — 6 is the default sweet spot.
export const QUALITY_THRESHOLD = 6;

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

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

Specificity rubric (HARD — overrides voice when content is missing):
A GroupMe ping wakes every owner. The post MUST carry at least one piece of concrete signal a reader could act on or repeat to a friend. At least ONE of the following must be present:
  - a named franchise or owner (e.g. "the Geeks", "Wabbit")
  - a named player
  - a specific topic with concrete detail — a position being shopped ("a tight end", "a power back"), a contract or comp-pick situation, a lineup/IR move, a draft-pick conversation, an auction bid, a pending offer
  - a division-level beat that pairs the division frame with topical content ("a team in the Northwest is shopping a tight end") — division + topic must BOTH be present

Posts that combine an atmospheric frame ("roster friction", "something brewing", "working through some issues", "moving on", "the file just got another page") with NO concrete signal are CONTENT-FREE. Cap the score at 4 regardless of voice quality.

The off-topic-launder kit ("not strictly league business", "not all about fantasy football", "throwing elbows", "having a moment", "fired up", "in a mood", "hissy fit") is ONLY allowed to ship when it attaches to source-side framing — a named GroupMe tipster, a tipster codename, a tipsterDivision reverse-lens, or an intra-division beef frame. Off-topic-launder kit + no source-side framing + no concrete signal = score 3.

A useful gut check: if a reader could only summarize this post as "Schefter said something happened somewhere" — suppress.

Context fields (when provided): scope identifies which redaction lane the post came from. "commish" and "style-book" / Schefter-target lanes are allowed to run lighter on franchise/player specificity (the institutional / self-referential frame IS the signal). "division" and "league-wide" lanes MUST carry the topical detail per the specificity rubric — those scopes have no franchise to lean on.

Score 1-10:
- 10: Worth interrupting the chat for.
- 7-9: Solid, send it.
- 4-6: Flat, off-voice, or borderline. Don't ping the chat.
- 1-3: Hallucinated, contradictory, off-topic, or content-free. Definitely suppress.

Respond with JSON only: {"score": <int 1-10>, "reason": "<one short sentence>"}`;

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

export async function scoreSchefterPost(
  { headline, body, analysis = null, tier = null, scope = null, topic = null },
  { apiKey, model = DEFAULT_MODEL, fetchFn = fetch } = {},
) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');

  const userPayload = { headline, body, analysis, tier };
  if (scope) userPayload.scope = scope;
  if (topic) userPayload.topic = topic;

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
        content: `Score this post:\n\n${JSON.stringify(userPayload, null, 2)}`,
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
//
// `post` may carry optional `scope` and `topic` fields. They're passed through
// to the scorer so it can calibrate the specificity check (commish / style-book
// scopes get more leeway; division / league-wide scopes don't).
export async function checkGroupMeQuality(post, { apiKey, model, threshold, log = console.log, warn = console.warn } = {}) {
  if (!apiKey) {
    log('  [quality-gate] no ANTHROPIC_API_KEY — allowing GroupMe send');
    return { allow: true, score: null, reason: 'no-api-key', error: null };
  }
  const t = threshold ?? QUALITY_THRESHOLD;
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
