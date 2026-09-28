/**
 * The league's news persona — who writes the automated columns.
 *
 * Every league used to get "Claude Schefter" because the name and voice were
 * written into the shared article prompt. A league on the standard package can
 * now rename him and rewrite his voice, and the COMMISSIONER owns that choice:
 * it is edited on the league's Schefter ops page and stored in Redis, not in
 * code, so changing it never needs a deploy.
 *
 * Resolution, most specific first:
 *   1. The commissioner's saved override (Redis, `personaKey(slug)`).
 *   2. The registry's `persona` default for the league, if it declares one.
 *   3. `DEFAULT_PERSONA` — Schefter.
 *
 * A league that has never saved anything therefore writes EXACTLY what it
 * wrote before this module existed: `isDefaultPersona` is what lets the prompt
 * builder keep the original, byte-identical system prompt for Schefter.
 *
 * Pure functions only — no Redis client in here. The API route (src/) and the
 * article runner (scripts/) each read the key with their own client and hand
 * the raw value to `resolvePersona`.
 */

/** Schefter, exactly as the shared article prompt has always written him. */
export const DEFAULT_PERSONA = Object.freeze({
  name: 'Claude Schefter',
  avatarUrl: '',
  voice: [
    `Channel Adam Schefter's high-energy breaking news style.`,
    `Use "I'm told...", "League sources tell me...", "Boom!", "Money is nice, but championships are better".`,
    'Be opinionated. Be bold. Call out underperformers and praise elite moves.',
  ].join('\n'),
});

/**
 * Field limits. The voice lands in a system prompt, so it is capped — long
 * enough for a real character sketch, short enough that it cannot crowd out
 * the fact-sheet and link rules that follow it.
 */
export const PERSONA_LIMITS = Object.freeze({
  name: 40,
  avatarUrl: 500,
  voice: 1200,
});

/**
 * Redis key for a league's saved persona. Keyed by the registry SLUG, never a
 * franchise or league number alone: this is league-wide state, and the slug is
 * the one identifier every surface (API route, article runner) already holds.
 *
 * @param {string} slug
 */
export function personaKey(slug) {
  return `persona:${slug}`;
}

/** @param {unknown} value */
function cleanLine(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .trim();
}

/**
 * Validate a commissioner's submission.
 *
 * Returns `{ ok: true, persona }` with the cleaned value, or
 * `{ ok: false, errors }`. An empty avatar is allowed (Slack and the site fall
 * back to their default icon); an empty name or voice is not — a blank voice
 * would leave the model with no character at all.
 *
 * @param {unknown} input
 * @returns {{ ok: true, persona: { name: string, avatarUrl: string, voice: string } } | { ok: false, errors: string[] }}
 */
export function validatePersona(input) {
  const errors = [];
  const raw = input && typeof input === 'object' ? /** @type {Record<string, unknown>} */ (input) : {};

  const name = cleanLine(raw.name).replace(/\s+/g, ' ');
  const avatarUrl = cleanLine(raw.avatarUrl);
  // Newlines are kept in the voice (it is written as a list of traits);
  // other control characters are not.
  const voice = String(raw.voice ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!name) errors.push('Name is required.');
  else if (name.length > PERSONA_LIMITS.name) errors.push(`Name must be ${PERSONA_LIMITS.name} characters or fewer.`);

  if (!voice) errors.push('Voice is required.');
  else if (voice.length > PERSONA_LIMITS.voice) errors.push(`Voice must be ${PERSONA_LIMITS.voice} characters or fewer.`);

  if (avatarUrl) {
    if (avatarUrl.length > PERSONA_LIMITS.avatarUrl) {
      errors.push(`Avatar URL must be ${PERSONA_LIMITS.avatarUrl} characters or fewer.`);
    } else {
      let parsed = null;
      try {
        parsed = new URL(avatarUrl);
      } catch {
        /* reported below */
      }
      // https only: Slack refuses a plain-http icon_url, and the site is https.
      if (!parsed || parsed.protocol !== 'https:') errors.push('Avatar URL must be a full https:// link.');
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, persona: { name, avatarUrl, voice } };
}

/**
 * Parse whatever a Redis client returned for the key (string or object).
 *
 * @param {unknown} stored
 * @returns {Record<string, unknown> | null}
 */
function parseStored(stored) {
  if (stored == null) return null;
  if (typeof stored === 'object') return /** @type {Record<string, unknown>} */ (stored);
  if (typeof stored !== 'string') return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * The persona a league writes with.
 *
 * A stored value that no longer validates (hand-edited, or saved under older
 * limits) is ignored rather than trusted — the league falls back to its
 * default instead of feeding an unchecked string to the model.
 *
 * @param {{ persona?: object } | Record<string, unknown> | null | undefined} registryEntry  The league's registry entry.
 * @param {unknown} [stored]  Raw value read from `personaKey(slug)`.
 * @returns {{ name: string, avatarUrl: string, voice: string, source: 'league' | 'registry' | 'default' }}
 */
export function resolvePersona(registryEntry, stored) {
  const saved = parseStored(stored);
  if (saved) {
    const checked = validatePersona(saved);
    if (checked.ok) return { ...checked.persona, source: 'league' };
  }
  if (registryEntry?.persona) {
    const checked = validatePersona({ ...DEFAULT_PERSONA, ...registryEntry.persona });
    if (checked.ok) return { ...checked.persona, source: 'registry' };
  }
  return { ...DEFAULT_PERSONA, source: 'default' };
}

/**
 * True when the persona writes exactly as Schefter always has, so the prompt
 * builder can keep the original system prompt. Avatar is not part of the
 * prompt and does not count.
 *
 * @param {{ name?: string, voice?: string, avatarUrl?: string } | null | undefined} persona
 */
export function isDefaultPersona(persona) {
  if (!persona) return true;
  return persona.name === DEFAULT_PERSONA.name && persona.voice === DEFAULT_PERSONA.voice;
}

/**
 * Every owner-facing label derived from a persona, so pages never spell
 * "Schefter" themselves. For the default persona each one reproduces the
 * site's existing wording exactly ("The Schefter Report", "Tip Schefter").
 * `surname` is the last word of the name — what a masthead or a nav label
 * uses ("Schefter", "Bunker").
 *
 * @param {{ name: string, avatarUrl?: string } | null | undefined} persona
 */
export function personaLabels(persona) {
  const name = persona?.name || DEFAULT_PERSONA.name;
  const words = name.trim().split(/\s+/);
  const surname = words[words.length - 1] || name;
  return {
    name,
    surname,
    report: `The ${surname} Report`,
    reportShort: `${surname} Report`,
    tip: `Tip ${surname}`,
    column: `${/^[aeiou]/i.test(name) ? 'An' : 'A'} ${name} weekly column`,
    avatar: persona?.avatarUrl || DEFAULT_AVATAR,
  };
}

/** Schefter's avatar, used by any persona that has not set its own. */
export const DEFAULT_AVATAR = '/assets/claude-schefter-avatar.webp';

/** The feed author id the league's persona writes as. */
export const PERSONA_AUTHOR_ID = 'claude';

/**
 * A post's byline with the league's persona applied. Only the persona's own
 * author id is renamed — ESPN wire items, Roger and guest writers keep theirs.
 * The default persona leaves the byline exactly as the feed author table has it.
 *
 * @param {{ id: string, name: string, handle?: string }} author  Resolved feed author.
 * @param {string} avatar  That author's resolved avatar path.
 * @param {{ name: string, voice?: string, avatarUrl?: string } | null | undefined} persona
 * @returns {{ name: string, avatar: string, handle: string }}
 */
export function personaByline(author, avatar, persona) {
  const base = { name: author?.name ?? '', avatar, handle: author?.handle ?? '' };
  if (!persona || author?.id !== PERSONA_AUTHOR_ID || isDefaultPersona(persona)) {
    return persona?.avatarUrl && author?.id === PERSONA_AUTHOR_ID ? { ...base, avatar: persona.avatarUrl } : base;
  }
  const { surname } = personaLabels(persona);
  return {
    name: persona.name,
    avatar: persona.avatarUrl || avatar,
    handle: `@${surname.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
  };
}
