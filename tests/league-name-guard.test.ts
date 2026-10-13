/**
 * No league ever publishes another league's name.
 *
 * The AFL's Week 5 Gauntlet shipped headlined "Week 5 Wall: The League Hits
 * the Gauntlet" — TheLeague's name, written by the model as a phrase. The owner
 * asked for that to be impossible, so this suite pins three things:
 *  1. the rule itself (src/utils/league-name-guard.mjs);
 *  2. that every door a post leaves by runs it — the feed committers, the
 *     GroupMe senders, push, and the AI article lane's retry-then-fix;
 *  3. that every feed and archive on disk is clean today.
 * A new publish path that skips the guard fails section 2, not production.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  foreignLeagueNames,
  findForeignLeagueNames,
  findForeignLeagueNamesInPost,
  scrubLeagueNames,
  scrubPostLeagueNames,
  scrubChatText,
  scrubFeedText,
  leagueForFeedPath,
  leagueForGroupMeBot,
} from '../src/utils/league-name-guard.mjs';
import { buildCachedSystem } from '../scripts/article-utils/ai-client.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

// Resolved from the registry, never a slug literal.
type Reg = { name: string; domains?: string[]; schefterFeedPath?: string; schefter?: { env?: Record<string, string> } };
const REG = LEAGUES as unknown as Record<string, Reg>;
const SLUGS = Object.keys(REG);
const PHRASE_LEAGUE = SLUGS.find((s) => /^The\s/.test(REG[s].name))!;
const PHRASE = REG[PHRASE_LEAGUE].name;
const ACRONYM_LEAGUE = SLUGS.find((s) => /^[A-Z]{2,}$/.test(REG[s].name))!;
const ACRONYM = REG[ACRONYM_LEAGUE].name;

describe('the rule', () => {
  it("rewrites the AFL's Week 5 Gauntlet headline that shipped", () => {
    expect(scrubLeagueNames(`Week 5 Wall: ${PHRASE} Hits the Gauntlet`, ACRONYM_LEAGUE)).toBe(
      `Week 5 Wall: The ${ACRONYM} Hits the Gauntlet`,
    );
  });

  it("covers every other league's name, share-card name and domains, from the registry", () => {
    for (const slug of SLUGS) {
      const names = foreignLeagueNames(slug);
      for (const other of SLUGS) {
        if (other === slug) continue;
        if (REG[other].name !== REG[slug].name) expect(names).toContain(REG[other].name);
        for (const d of REG[other].domains ?? []) expect(names).toContain(d);
      }
      expect(names).not.toContain(REG[slug].name);
    }
  });

  it('consumes a leading article so a name never doubles one', () => {
    expect(scrubLeagueNames(`Unlike the ${ACRONYM}, we`, PHRASE_LEAGUE)).toBe(`Unlike ${PHRASE}, we`);
  });

  it('lower-cases the article mid-sentence and catches the run-together spelling', () => {
    const glued = PHRASE.replace(/\s+/g, '');
    expect(scrubLeagueNames(`Nobody in ${PHRASE} and ${glued}'s rivals`, ACRONYM_LEAGUE)).toBe(
      `Nobody in the ${ACRONYM} and the ${ACRONYM}'s rivals`,
    );
  });

  it('keeps mid-sentence casing across inline tags, resets at block tags, and leaves markup alone', () => {
    expect(scrubLeagueNames(`<p>Nobody in <strong>${PHRASE}</strong> is safe</p>`, ACRONYM_LEAGUE)).toBe(
      `<p>Nobody in <strong>the ${ACRONYM}</strong> is safe</p>`,
    );
    expect(scrubLeagueNames(`<p>Done</p><p>${PHRASE} rolls</p>`, ACRONYM_LEAGUE)).toBe(
      `<p>Done</p><p>The ${ACRONYM} rolls</p>`,
    );
    const attr = `<a title="${PHRASE}">x</a>`;
    expect(scrubLeagueNames(attr, ACRONYM_LEAGUE)).toBe(attr);
  });

  it('never touches a league\'s own name or the lower-case phrase "the league"', () => {
    expect(scrubLeagueNames(`${PHRASE} Hits the Gauntlet`, PHRASE_LEAGUE)).toBe(`${PHRASE} Hits the Gauntlet`);
    expect(findForeignLeagueNames('the league-wide wall', ACRONYM_LEAGUE)).toEqual([]);
  });

  it('finds and scrubs every reader-facing field, both post shapes', () => {
    const post = {
      headline: `${PHRASE} Hits the Wall`,
      body: 'clean',
      content: [`<p>${PHRASE} is tough.</p>`],
      intro: [`<p>${PHRASE} graded.</p>`],
      grades: [{ grade: 'A', headline: `Best in ${PHRASE}`, body: '<p>ok</p>' }],
    };
    expect(findForeignLeagueNamesInPost(post, ACRONYM_LEAGUE)).toEqual([PHRASE]);
    expect(scrubPostLeagueNames(post, ACRONYM_LEAGUE).sort()).toEqual(['content', 'grades', 'headline', 'intro']);
    expect(findForeignLeagueNamesInPost(post, ACRONYM_LEAGUE)).toEqual([]);
    expect(post.grades[0].headline).toBe(`Best in the ${ACRONYM}`);
  });

  it('re-bases GroupMe mention offsets so a tag still lands on its name', () => {
    const text = `@Bob ${PHRASE} is here @Al`;
    const at = text.indexOf('@Al');
    const { text: out, attachments } = scrubChatText(text, ACRONYM_LEAGUE, [
      { type: 'mentions', user_ids: ['1', '2'], loci: [[at, 3], [0, 4]] },
    ]);
    const [[start, len]] = (attachments[0] as { loci: number[][] }).loci;
    expect(out.slice(start, start + len)).toBe('@Al');
    expect(out).not.toContain(PHRASE);
  });

  it('leaves a clean feed byte-identical', () => {
    const text = JSON.stringify({ posts: [{ id: 'a', headline: 'clean' }] }, null, 2) + '\n';
    expect(scrubFeedText(text, ACRONYM_LEAGUE).text).toBe(text);
  });

  it('knows each league by its feed path and by its GroupMe bot', () => {
    for (const slug of SLUGS) {
      const feed = REG[slug].schefterFeedPath;
      if (feed) expect(leagueForFeedPath(feed)).toBe(slug);
      const envName = REG[slug].schefter?.env?.schefterBot;
      if (envName) expect(leagueForGroupMeBot('bot-x', { [envName]: 'bot-x' })).toBe(slug);
    }
    expect(leagueForGroupMeBot('nobody', {})).toBeNull();
  });

  it('steers the model off the bare word without spelling the other name into the prompt', () => {
    const text = (slug: string) => buildCachedSystem('X', { league: slug }).at(-1)!.text;
    expect(text(ACRONYM_LEAGUE)).toContain('never capitalise the word "league"');
    expect(text(ACRONYM_LEAGUE)).not.toContain(PHRASE);
    expect(text(PHRASE_LEAGUE)).not.toContain('never capitalise the word "league"');
  });
});

describe('every door runs it', () => {
  it('the AI article lane regenerates once on a hit, then scrubs', () => {
    const src = read('scripts/schefter-weekly-articles.mjs');
    expect(src).toMatch(/findForeignLeagueNamesInPost\(post, league\)/);
    expect(src).toMatch(/CORRECTION:/);
    expect(src).toMatch(/scrubPostLeagueNames\(post, league\)/);
  });

  it('appendToFeed scrubs every post it writes', () => {
    expect(read('scripts/article-utils/feed-writer.mjs')).toMatch(/scrubPostLeagueNames\(post, league\)/);
  });

  it('commit-feed-and-push scrubs every merged feed it commits', () => {
    expect(read('scripts/commit-feed-and-push.mjs')).toMatch(/writeFileSync\(c\.path, guardLeagueNames\(c\.path, merged\)\)/);
  });

  it('the commit-push action scrubs every feed before git add', () => {
    const action = read('.github/actions/commit-push/action.yml');
    const guard = action.indexOf('node scripts/guard-feed-league-names.mjs');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(action.indexOf('git add $INPUT_ADD_PATHS'));
  });

  it('no workflow commits a feed except through those two doors', () => {
    const feeds = SLUGS.map((s) => REG[s].schefterFeedPath).filter(Boolean) as string[];
    const covers = (spec: string, feed: string) => {
      const clean = spec.replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
      if (!clean || clean.startsWith('-')) return false;
      if (clean === '.' || clean === feed || feed.startsWith(`${clean}/`)) return true;
      return clean.includes('*') && path.matchesGlob(feed, clean);
    };
    const offenders: string[] = [];
    const dir = path.join(ROOT, '.github/workflows');
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      read(`.github/workflows/${file}`).split('\n').forEach((line, i) => {
        const m = line.match(/^\s*(?:-\s*)?(?:run:\s*)?git add\s+(.+)$/);
        if (!m) return;
        const specs = m[1].replace(/\s*(?:2>|\|\||&&).*$/, '').split(/\s+/);
        for (const feed of feeds) if (specs.some((s) => covers(s, feed))) offenders.push(`${file}:${i + 1} adds ${feed}`);
      });
    }
    expect(offenders, 'commit feeds via scripts/commit-feed-and-push.mjs or ./.github/actions/commit-push').toEqual([]);
  });

  it('every GroupMe bot sender scrubs its text', () => {
    // groupme-client.ts postAsBot carries text an OWNER typed (/api/groupme/send),
    // which is theirs to word — the guard is for text we generate.
    const OWNER_TEXT = new Set(['src/utils/groupme-client.ts']);
    const senders: string[] = [];
    const walk = (rel: string) => {
      for (const ent of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
        const p = `${rel}/${ent.name}`;
        if (ent.isDirectory()) { if (ent.name !== 'node_modules') walk(p); continue; }
        if (!/\.(m?js|ts)$/.test(ent.name)) continue;
        const code = read(p).split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
        if (code.some((l) => l.includes('bots/post'))) senders.push(p);
      }
    };
    walk('scripts');
    walk('src');
    expect(senders.length).toBeGreaterThan(0);
    const unguarded = senders.filter((p) => !OWNER_TEXT.has(p) && !/scrubChatText\(/.test(read(p)));
    expect(unguarded).toEqual([]);
  });

  it('push, AI replies and Roger answers scrub before they publish', () => {
    expect(read('src/utils/push-sender.ts')).toMatch(/scrubLeagueNames\(payload\.title, league\.slug\)/);
    expect(read('src/pages/api/schefter-replies/[postId]/ai-reply.ts')).toMatch(/scrubLeagueNames\(aiText, league\.slug\)/);
    expect(read('src/utils/rules-qa-handlers.ts')).toMatch(/scrubLeagueNames\(answer, answerLeague\.slug\)/);
  });
});

describe('what is on disk today', () => {
  for (const slug of SLUGS) {
    const feed = REG[slug].schefterFeedPath;
    if (!feed || !existsSync(path.join(ROOT, feed))) continue;
    const files = [feed];
    const archiveDir = path.join(path.dirname(feed), 'schefter-archive');
    if (existsSync(path.join(ROOT, archiveDir))) {
      for (const f of readdirSync(path.join(ROOT, archiveDir))) if (f.endsWith('.json')) files.push(`${archiveDir}/${f}`);
    }
    for (const file of files) {
      it(`${file} names no other league`, () => {
        const data = JSON.parse(read(file));
        const posts: Array<{ id?: string }> = Array.isArray(data) ? data : data.posts ?? [];
        const leaks = posts
          .map((p) => ({ id: p.id, names: findForeignLeagueNamesInPost(p, slug) }))
          .filter((x) => x.names.length);
        expect(leaks).toEqual([]);
      });
    }
  }
});
