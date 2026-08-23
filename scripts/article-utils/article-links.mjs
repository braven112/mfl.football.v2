/**
 * Article links — every Schefter article points at the page it is about.
 *
 * THE BUG THIS EXISTS FOR. The 2026 schedule-release column ran eight
 * paragraphs about a schedule the reader could not open. The whole point of
 * release day is the schedule release PAGE — the locked reveal, week by week —
 * and the column never once linked to it. It was not an oversight in that one
 * article type either: a `grep '<a '` across the entire published feed
 * (396 posts, every article type, two leagues) returned ZERO. Schefter had
 * never linked to anything, ever.
 *
 * So the fix is not "add a link to schedule-release". It is a pipeline stage
 * every article type passes through, plus the mechanical guarantee that a new
 * article type cannot be written without declaring where it points.
 *
 * THREE LAYERS, because the AI is one of them and the AI is not reliable:
 *
 *  1. DECLARE — each article type exports `relatedLinks(enrichment, {league})`.
 *     `schefter-weekly-articles.mjs` calls it UNCONDITIONALLY, which is what
 *     makes `tests/article-type-interface.test.ts` (it derives the required
 *     exports by reading the pipeline source) fail every type that omits it.
 *     A new article type therefore cannot ship linkless.
 *  2. ASK — `linkDirective()` appends the exact anchor HTML to the fact sheet,
 *     so the model weaves links into prose rather than tacking on a footer.
 *  3. ENFORCE — `applyArticleLinks()` runs on the built post and does not
 *     trust step 2: it repairs or strips any href the model invented, and if
 *     the PRIMARY link is still missing it injects a call-to-action paragraph
 *     high in the article. Publishing a linkless article is not reachable.
 *
 * WHY hrefs ARE ROOT-RELATIVE AND LEAGUE-PREFIXED (`/theleague/standings`).
 * Article `content` is raw HTML rendered through `set:html`, so it never goes
 * through the `resolveLeaguePath()` treatment a normal `<a>` in a component
 * gets — whatever string is in the JSON is the href. Prefixed root-relative is
 * the one form that resolves on every host we serve: directly on the shared
 * host and on localhost/preview, and via the `vercel.json` 301 on each
 * league's apex domain. An absolute `leagueUrl()` would be correct in
 * production and would bounce a reader on a preview deploy over to the live
 * site, so absolutes are reserved for text that leaves the site (the GroupMe
 * promo). This is not "concatenating an origin with a path" — no origin is
 * involved; `ensureLeaguePrefix` is the registry's own path builder.
 */

import { LEAGUES, ensureLeaguePrefix, buildHostToSlugMap } from '../../src/config/leagues-data.mjs';

/**
 * Hosts this site actually serves, from the registry — every league's apex
 * domains. Used to decide whether an absolute URL is ours (collapse it to a
 * path) or somebody else's (not a valid article link).
 */
const OWN_HOSTS = new Set(Object.keys(buildHostToSlugMap()).map((h) => h.toLowerCase()));
const isOwnHost = (hostname) => OWN_HOSTS.has(String(hostname).toLowerCase());

/**
 * Every page an article may point at, and which leagues actually have it.
 *
 * Paths are stored UNPREFIXED and get the league's prefix at build time, so
 * one entry serves both leagues. `leagues` is explicit rather than derived
 * because this file runs in node with no view of src/pages —
 * `tests/article-links.test.ts` checks the map BOTH ways against the real
 * routes: a listed league that lacks the page fails (a dead link inside an
 * article nobody re-reads), and an UNLISTED league that has the page fails
 * too (a feature the AFL quietly gained that Schefter is still not allowed
 * to mention). Adding a page to one league and not the other is the normal
 * case here, so the map has to be told.
 *
 * `label` is the default anchor text, written as a noun phrase that reads
 * mid-sentence ("…is on the standings"), because that is how these get used:
 * a link is a place in a sentence, not a button.
 */
const BOTH = ['theleague', 'afl-fantasy'];

export const DESTINATIONS = {
  // ── What articles are usually ABOUT ──
  'schedule-release': { path: '/schedule-release', label: 'the schedule release page', leagues: BOTH },
  'schedule-strength': { path: '/schedule-strength', label: 'the Gauntlet rankings', leagues: BOTH },
  standings: { path: '/standings', label: 'the standings', leagues: BOTH },
  rosters: { path: '/rosters', label: 'the rosters', leagues: BOTH },
  players: { path: '/players', label: 'the free agent board', leagues: BOTH },
  playoffs: { path: '/playoffs', label: 'the playoff bracket', leagues: BOTH },
  'live-scoring': { path: '/live-scoring', label: 'the live scoreboard', leagues: BOTH },
  lineup: { path: '/lineup', label: 'your lineup', leagues: BOTH },
  'pecking-order': { path: '/pecking-order', label: 'the pecking order', leagues: BOTH },
  rivalries: { path: '/rivalries', label: 'the rivalry pages', leagues: BOTH },
  franchises: { path: '/franchises', label: 'the franchise histories', leagues: BOTH },
  'draft-predictor': { path: '/draft-predictor', label: 'the draft order', leagues: BOTH },
  calendar: { path: '/calendar', label: 'the league calendar', leagues: BOTH },

  // ── Site features worth a plug ──
  'trade-builder': { path: '/trade-builder', label: 'the trade builder', leagues: BOTH },
  'import-rankings': { path: '/import-rankings', label: 'Import Rankings', leagues: BOTH },
  'custom-rankings': { path: '/cr', label: 'your custom rankings board', leagues: BOTH },
  rules: { path: '/rules', label: 'the constitution', leagues: BOTH },
  'rules-chat': { path: '/rules-chat', label: 'Roger, the rules bot', leagues: BOTH },
  'schefter-tip': { path: '/schefter/tip', label: 'the rumor mill tip line', leagues: BOTH },
  'whats-new': { path: '/whats-new', label: "What's New", leagues: BOTH },
  notifications: { path: '/notifications', label: 'push notifications', leagues: BOTH },

  // ── TheLeague only (a contract dynasty league; the AFL has no cap) ──
  contracts: { path: '/contracts', label: 'the contract board', leagues: ['theleague'] },
  'contracts-manage': { path: '/contracts/manage', label: 'your contract declarations', leagues: ['theleague'] },
  calculator: { path: '/calculator', label: 'the contract calculator', leagues: ['theleague'] },
  mvp: { path: '/mvp', label: 'the MVP tracker', leagues: ['theleague'] },
  'dead-money': { path: '/dead-money', label: 'the dead money report', leagues: ['theleague'] },
  'projected-free-agents': { path: '/projected-free-agents', label: "next year's free agent class", leagues: ['theleague'] },
  'draft-room': { path: '/draft-room', label: 'the draft room', leagues: ['theleague'] },
  'mock-draft': { path: '/mock-draft', label: 'the mock draft room', leagues: ['theleague'] },
  salary: { path: '/salary', label: 'the salary benchmarks', leagues: ['theleague'] },
  stats: { path: '/stats', label: 'the stats hub', leagues: ['theleague'] },
  'league-summary': { path: '/league-summary', label: 'the league summary', leagues: ['theleague'] },
  'throwback-settings': { path: '/throwback-settings', label: 'your throwback era', leagues: ['theleague'] },
  suggestions: { path: '/suggestions', label: 'the suggestion board', leagues: ['theleague'] },

  // Same path, genuinely different pages: TheLeague's /activity tracks when
  // owners last visited the site, the AFL's is the transaction log. One label
  // would have Schefter promise the wrong page in one of the two leagues, so
  // the label is per-league here rather than the destination being split.
  activity: {
    path: '/activity',
    label: 'the activity tracker',
    labels: { 'afl-fantasy': 'the transaction log' },
    leagues: BOTH,
  },

  // ── AFL only ──
  keepers: { path: '/keepers', label: 'your keeper declarations', leagues: ['afl-fantasy'] },
  'keeper-analysis': { path: '/keeper-analysis', label: 'the keeper hindsight grades', leagues: ['afl-fantasy'] },
  records: { path: '/records', label: 'the record book', leagues: ['afl-fantasy'] },
};

/** Does this league actually have this page? */
export function hasDestination(league, key) {
  return Boolean(DESTINATIONS[key]?.leagues?.includes(league));
}

/**
 * Build one link for a league, or null when this league has no such page.
 *
 * NULL RATHER THAN THROW, because the whole point of the feature-plug tier is
 * that an article type lists more features than any one league has. The AFL
 * has no salary cap, so a cap-flavoured plug simply drops out there instead
 * of forcing every `relatedLinks` into a pile of per-league conditionals.
 * `primaryLink` is the exception — see below.
 *
 * @param {string} league Registry slug.
 * @param {string} key Key into DESTINATIONS.
 * @param {{ primary?: boolean, promo?: boolean, label?: string, cta?: string }} [opts]
 *   `label` overrides the anchor text for this article (the standings read
 *   differently in a recap than in a preview); `cta` is the sentence used if
 *   the model drops the link and the enforcement stage has to inject it;
 *   `promo` marks a site-feature plug rather than the article's subject.
 * @returns {object | null}
 */
export function articleLink(league, key, { primary = false, promo = false, label, cta } = {}) {
  if (!LEAGUES[league]) throw new Error(`articleLink: unknown league "${league}"`);
  const destination = DESTINATIONS[key];
  // An unknown KEY is always a bug — a typo'd key would otherwise vanish
  // silently and the article would just quietly stop linking.
  if (!destination) throw new Error(`articleLink: unknown destination "${key}"`);
  if (!hasDestination(league, key)) return null;
  const text = label ?? destination.labels?.[league] ?? destination.label;
  return {
    key,
    href: ensureLeaguePrefix(LEAGUES[league], destination.path),
    label: text,
    primary,
    promo,
    cta: cta ?? `The full breakdown is on ${text}.`,
  };
}

/**
 * The one link the article is fundamentally about.
 *
 * Throws where `articleLink` returns null: a primary link is the article's
 * whole reason for pointing anywhere, so a league that lacks the page has no
 * business running this article type and should fail loudly rather than
 * publish a column with nothing to click.
 */
export function primaryLink(league, key, opts = {}) {
  const link = articleLink(league, key, { ...opts, primary: true });
  if (!link) throw new Error(`primaryLink: ${league} has no "${key}" page`);
  return link;
}

/**
 * A site-feature plug — a page the article isn't about but should send people
 * to when the subject comes up naturally.
 *
 * This is the tier that exists because Schefter's job is not only to report
 * the league but to get owners USING the site. It is deliberately soft: the
 * enforcement stage never injects one, because a plug the model could not fit
 * into a sentence reads as an ad, and an ad is worse than no link.
 */
export function featureLink(league, key, opts = {}) {
  return articleLink(league, key, { ...opts, promo: true });
}

/** Drop the nulls a league's missing pages leave behind. */
export function linkList(...links) {
  return links.flat().filter(Boolean);
}

/** `<a href="…">text</a>` for a link, with the anchor text it should carry. */
export function renderAnchor(link, text = link.label) {
  return `<a href="${link.href}">${text}</a>`;
}

// ── The prompt half ────────────────────────────────────────────────────────

/**
 * The block appended to every fact sheet.
 *
 * Written as copy-this-verbatim anchors rather than "link to the standings",
 * because a model asked to build a URL builds a plausible one — and a
 * plausible fantasy-football URL (`/theleague/schedule`, `/scheduleRelease`)
 * 404s exactly as hard as a nonsense one. The enforcement stage strips
 * anything not on this list, so an invented href costs the sentence its link
 * rather than shipping a dead one.
 *
 * THREE TIERS, and they are not the same instruction:
 *  - PRIMARY is mandatory. The article is about it; it gets injected if the
 *    model ignores this.
 *  - SUBJECT links are strongly encouraged where the subject comes up.
 *  - FEATURE PLUGS are a standing goal, not a quota. Schefter's beat is the
 *    league, but his other job is getting owners to actually use the site, so
 *    every column should try to carry one. It is phrased as "when it fits"
 *    and never enforced, because a plug the model had to wedge in reads as an
 *    ad — and readers stop clicking a columnist who sounds like an ad.
 */
export function linkDirective(links) {
  if (!links?.length) return '';
  const primary = links.filter((l) => l.primary);
  const promos = links.filter((l) => l.promo && !l.primary);
  const subject = links.filter((l) => !l.primary && !l.promo);
  const lines = [];
  lines.push('');
  lines.push('LINKS — Schefter always points at the thing he is talking about.');
  lines.push('Copy these anchors character for character into the paragraph text:');
  if (primary.length) {
    lines.push('');
    lines.push('  THE MAIN EVENT (must appear in the FIRST or SECOND paragraph, and again at the end):');
    for (const l of primary) lines.push(`    ${renderAnchor(l)}`);
  }
  if (subject.length) {
    lines.push('');
    lines.push('  LINK THESE TOO, wherever the subject comes up naturally:');
    for (const l of subject) lines.push(`    ${renderAnchor(l)}`);
  }
  if (promos.length) {
    lines.push('');
    lines.push('  SITE FEATURES — plug at least ONE of these, in a sentence that earns it:');
    for (const l of promos) lines.push(`    ${renderAnchor(l)}`);
    lines.push('');
    lines.push('  Getting owners to USE the site is part of the beat. The move is to');
    lines.push('  finish a thought with the tool that answers it — "if you think that cap');
    lines.push('  sheet is fixable, <a …>the trade builder</a> disagrees" — not to append');
    lines.push('  a paragraph of housekeeping. Pick the one or two that genuinely fit the');
    lines.push('  story you just told and skip the rest; a forced plug is worse than none.');
  }
  lines.push('');
  lines.push('  Link rules:');
  lines.push('  - Never invent an href. Never write a bare URL, a markdown link, or "click here".');
  lines.push('  - The anchor text above is a default — reword it to fit your sentence if you');
  lines.push('    like, but keep the href byte-identical.');
  lines.push('  - Work each link into a real sentence. A link is a place to send someone,');
  lines.push('    not a footer.');
  lines.push('  - Use each link once or twice. More than that reads like SEO spam.');
  lines.push('  - Never link the same page twice in one paragraph.');
  return lines.join('\n');
}

/** Fact sheet + link directive, which is what the pipeline hands getUserPrompt. */
export function withLinkDirective(factSheet, links) {
  const directive = linkDirective(links);
  return directive ? `${factSheet}\n${directive}` : factSheet;
}

// ── The enforcement half ───────────────────────────────────────────────────

/**
 * Anchor matcher for the REPAIR pass.
 *
 * The attribute run is `(?:[^>"']|"[^"]*"|'[^']*')*`, not `[^>]*`, because a
 * `>` inside a quoted attribute value is legal HTML — `<a title="a > b"
 * href="/x">` — and `[^>]*` stops at the wrong character, mis-parsing the tag.
 * The closing tag allows `</a >`.
 *
 * THIS REGEX IS NOT THE SECURITY BOUNDARY, and must not be treated as one. A
 * regex cannot parse HTML, so `neutralizeForeignHrefs` below is what actually
 * guarantees no unapproved href survives; this one exists to produce clean
 * output in the ordinary case. CodeQL flagged the original `[^>]*` version as
 * a bad HTML filter (high severity) and it was right — three separate inputs
 * carried an unapproved href straight through it into `set:html`: an anchor
 * with no closing tag, one closed with `</a >`, and one with a `>` inside a
 * quoted attribute.
 */
const ANCHOR_RE = /<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi;
const HREF_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
/** Every `href=` in a string, wherever it sits and however the tag is formed. */
const HREF_ANYWHERE_RE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/**
 * Reduce whatever the model wrote to a comparable path.
 *
 * Absolute URLs collapse to their pathname so a model that helpfully wrote out
 * `https://www.theleague.us/standings` is repaired rather than stripped; the
 * trailing slash goes because `/standings/` and `/standings` are the same page
 * and only one of them would match.
 */
function normalizeHref(raw) {
  if (!raw) return null;
  let href = String(raw).trim().replace(/&amp;/gi, '&');
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(href)) {
    try {
      const url = new URL(href, 'https://placeholder.invalid');
      // Only OUR OWN hosts collapse to a path. Dropping the host from any
      // absolute URL means an external link whose path happens to collide with
      // a destination (`https://example.com/theleague/rosters`) is silently
      // rewritten into an internal one — a link that now points somewhere the
      // author never wrote, with nothing logged. An unrecognised host returns
      // null instead, so it falls through to the strip-and-notice path.
      if (!isOwnHost(url.hostname)) return null;
      href = url.pathname;
    } catch {
      return null;
    }
  }
  if (!href.startsWith('/')) return null;
  const [pathOnly] = href.split(/[?#]/);
  return pathOnly.length > 1 ? pathOnly.replace(/\/+$/, '') : pathOnly;
}

/**
 * Every spelling of an allowed link, mapped to its canonical href.
 *
 * The unprefixed form is deliberately an accepted alias: the model sees
 * `/theleague/standings` in the directive but the site's own nav renders
 * `/standings` on the apex domain, and a model that has both in context
 * reaches for the short one often enough to matter. That is a repair, not a
 * leak — the alias only ever maps back to this league's own canonical href.
 */
function buildHrefIndex(links, league) {
  const registry = LEAGUES[league];
  const index = new Map();
  for (const link of links) {
    index.set(link.href, link);
    const destination = DESTINATIONS[link.key];
    if (destination) index.set(destination.path, link);
    if (registry) {
      // `/theleague/standings` when the link itself was built for a league on
      // the shared host, and vice versa — both spellings resolve here.
      const bare = destination?.path ?? link.href;
      index.set(ensureLeaguePrefix(registry, bare), link);
    }
  }
  return index;
}

/**
 * Repair or strip every anchor in one HTML paragraph.
 *
 * An unrecognised href is UNWRAPPED, not deleted: the sentence the model wrote
 * is still true and still reads, it just stops promising a page that does not
 * exist. Deleting the anchor's text instead would silently drop a clause out
 * of the middle of a paragraph.
 */
function sanitizeParagraph(html, index, notices) {
  // `?? ''` like the sibling `linksPresent`: a malformed model response can
  // put a null into `content[]`, and String(null) writes the literal text
  // "null" back into the article.
  const repaired = String(html ?? '').replace(ANCHOR_RE, (whole, attrs, text) => {
    const match = HREF_RE.exec(attrs ?? '');
    const raw = match ? (match[1] ?? match[2] ?? match[3]) : null;
    const normalized = normalizeHref(raw);
    const link = normalized ? index.get(normalized) : null;
    if (!link) {
      notices.push(`stripped invented link href="${raw ?? ''}"`);
      return text;
    }
    // Rebuild rather than pass through: drops any target/onclick/style the
    // model decorated it with, and normalises the alias spellings above onto
    // the one canonical href.
    return renderAnchor(link, text);
  });
  return neutralizeForeignHrefs(repaired, index, notices);
}

/**
 * THE ACTUAL GUARANTEE: no href the allow-list doesn't contain survives.
 *
 * Deliberately does not parse tags at all. It sweeps for the substring
 * `href=` wherever it appears and deletes any attribute whose value isn't
 * approved — so markup the repair pass could not parse (an unclosed anchor, a
 * `</a >`, a `>` inside a quoted attribute, or something nobody has thought of
 * yet) still cannot ship a live link to a page we did not approve. Removing
 * the attribute rather than the tag is what makes it parser-independent: an
 * `<a>` with no href navigates nowhere.
 *
 * The leftover bare `<a>` is then unwrapped best-effort. That part IS
 * regex-parsing and may leave a stray tag on pathological input — which is
 * cosmetic, because the navigation is already gone.
 */
function neutralizeForeignHrefs(html, index, notices) {
  let touched = false;
  const stripped = html.replace(HREF_ANYWHERE_RE, (whole, dq, sq, bare) => {
    const raw = dq ?? sq ?? bare;
    if (index.get(normalizeHref(raw) ?? '')) return whole;
    notices.push(`neutralized unparseable anchor carrying href="${raw ?? ''}"`);
    touched = true;
    return '';
  });
  if (!touched) return html;
  // Cosmetic only: drop the now-inert anchor tags so the prose reads normally.
  return stripped.replace(/<a\b[^>]*>/gi, '').replace(/<\/a\s*>/gi, '');
}

/** Which of `links` already appear in a list of HTML strings. */
function linksPresent(paragraphs, index) {
  const found = new Set();
  for (const html of paragraphs) {
    for (const m of String(html ?? '').matchAll(ANCHOR_RE)) {
      const hrefMatch = HREF_RE.exec(m[1] ?? '');
      const raw = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3]) : null;
      const link = index.get(normalizeHref(raw) ?? '');
      if (link) found.add(link.href);
    }
  }
  return found;
}

/** The paragraph injected when the model dropped a link it was told to use. */
function ctaParagraph(link) {
  return `<p>${renderAnchor(link, link.cta)}</p>`;
}

/**
 * The body fields an article post can carry.
 *
 * `content` is the flat-paragraph shape most types use; the grade-card types
 * (`draft-grades`, `team-grades`) put their prose in `intro` plus a `body`
 * string per grade. Sanitising only `content` would have left the grade cards
 * as the one place a hallucinated href could still ship.
 */
function bodyFields(post) {
  const fields = [];
  if (Array.isArray(post.content)) fields.push({ get: () => post.content, set: (v) => { post.content = v; } });
  if (Array.isArray(post.intro)) fields.push({ get: () => post.intro, set: (v) => { post.intro = v; } });
  return fields;
}

/**
 * The excerpt. `post.body` is a STRING, not an array, and the feed card renders
 * it through `set:html` (SchefterPostCard.astro) exactly like the article body
 * — so an href invented there ships unvalidated. It is sanitized but NOT
 * counted toward the primary-link check: the excerpt is a teaser on a card
 * that is itself a link to the article, so a link inside it satisfies nothing.
 */
function sanitizeExcerpt(post, index, notices) {
  if (typeof post.body !== 'string' || !post.body.includes('<a')) return;
  post.body = sanitizeParagraph(post.body, index, notices);
}

/**
 * Guarantee the article links where it was told to, and nowhere else.
 *
 * Mutates and returns the post. `notices` describes every repair so the
 * pipeline can log it — a run that keeps reporting "injected primary link"
 * means the prompt is losing an argument with the model and the directive
 * needs rewording, which is invisible if the fix is silent.
 *
 * @param {object} post Built post (mutated in place).
 * @param {Array} links Output of the type's `relatedLinks`.
 * @param {{ league?: string }} [opts]
 * @returns {{ post: object, notices: string[] }}
 */
export function applyArticleLinks(post, links, { league = 'theleague' } = {}) {
  const notices = [];
  if (!post || !Array.isArray(links) || links.length === 0) return { post, notices };

  const index = buildHrefIndex(links, league);

  // 1. Repair/strip anchors everywhere prose lives.
  for (const field of bodyFields(post)) {
    field.set(field.get().map((html) => sanitizeParagraph(html, index, notices)));
  }
  if (Array.isArray(post.grades)) {
    post.grades = post.grades.map((g) =>
      typeof g?.body === 'string' ? { ...g, body: sanitizeParagraph(g.body, index, notices) } : g,
    );
  }
  sanitizeExcerpt(post, index, notices);

  // 2. The primary link is not optional. Inject high in the article — the
  //    point of the link is that the reader goes there, and a link below eight
  //    paragraphs of column is a link nobody clicks.
  const target = bodyFields(post)[0];
  if (!target) return { post, notices };
  const present = linksPresent(
    [...target.get(), ...(post.grades ?? []).map((g) => g?.body)],
    index,
  );
  const missing = links.filter((l) => l.primary && !present.has(l.href));
  if (missing.length) {
    const paragraphs = [...target.get()];
    // After the opening paragraph, so the column still opens in Schefter's
    // voice rather than with a signpost.
    const at = Math.min(1, paragraphs.length);
    paragraphs.splice(at, 0, ...missing.map(ctaParagraph));
    target.set(paragraphs);
    for (const l of missing) notices.push(`injected missing primary link ${l.href}`);
  }

  return { post, notices };
}
