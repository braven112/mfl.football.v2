/**
 * The Claude model every Haiku-class call in the repo uses — Schefter's posts,
 * move stories, the quality gate, Ask Roger, the GroupMe rewrite — in one
 * place, so the next upgrade is a one-line change instead of nineteen.
 *
 * Haiku 5.5 differs from 4.5 in three ways the callers have to respect
 * (tests/claude-models-guard.test.ts pins them):
 *
 *   - It thinks by default, and thinking spends `max_tokens`. These calls
 *     write short copy under tight caps, so they send HAIKU_THINKING to keep
 *     4.5's no-thinking behaviour (and its cost per call).
 *   - `temperature`, `top_p` and `top_k` are rejected with a 400. Steer tone
 *     from the prompt.
 *   - A response can carry non-text blocks, so read the answer with
 *     responseText(), never `content[0].text`.
 *
 * Its tokenizer also counts the same text as roughly 30% more tokens, which is
 * why the short caps at each call site were raised when this landed.
 */
export const HAIKU_MODEL = 'claude-haiku-5-5';

/**
 * Opus 5.5: the eval judges, Roger's clapbacks and the League Launcher.
 * Its default effort is medium (Opus 5's was high), so callers that relied on
 * the old default send `output_config: { effort: 'high' }` explicitly.
 * Thinking cannot be disabled, and sampling parameters are rejected.
 */
export const OPUS_MODEL = 'claude-opus-5-5';

/**
 * Sonnet 5.5: the game blurbs. Sampling parameters are rejected and thinking
 * cannot be disabled, so the blurb call lowers effort instead.
 */
export const SONNET_MODEL = 'claude-sonnet-5-5';

/** Send on every HAIKU_MODEL request: short-copy calls run without thinking. */
export const HAIKU_THINKING = /** @type {const} */ ({ type: 'disabled' });

/**
 * The text of a Messages API response — every text block, joined. Takes the
 * parsed JSON body (raw fetch) or an SDK Message; '' when there is none.
 */
export function responseText(response) {
  const blocks = Array.isArray(response?.content) ? response.content : [];
  return blocks
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}
