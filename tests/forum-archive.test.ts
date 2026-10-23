/**
 * The forum archive: phpBB export → archive → search → Ask Schefter report.
 *
 * The rules pinned here are the ones Brandon set (2026-10-22): Schefter
 * REPORTS what the board says, verbatim, linked to the exact post — the model
 * may pick searches and posts but cannot put a post on the page it never
 * retrieved, and anything in its own words is a separate `take`. And nothing
 * private in the export (emails, passwords, IPs, PMs) may reach the archive.
 *
 * The fixture below is synthetic; the real archive is members-only and is
 * never committed (the repo is public).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseInsertValues, readTables } from '../src/utils/forum-archive/sql-dump.mjs';
import { phpbbToMarkdown } from '../src/utils/forum-archive/phpbb-markup.mjs';
import { buildForumArchive, chunkForumArchive } from '../src/utils/forum-archive/build-archive.mjs';
import { assemble } from '../src/utils/forum-archive/forum-archive-store';
import { searchPosts, searchTopics, snippet, parseQuery } from '../src/utils/forum-archive/search';
import { renderArchiveMarkdown } from '../src/utils/forum-archive/archive-markdown';
import { buildArchiveMarkdown } from '../src/utils/forum-archive/archive-download';
import { askSchefter, buildReport, keywordReport } from '../src/utils/forum-archive/ask-schefter';
import { sanitizeIndex, sanitizePosts } from '../src/utils/forum-archive/archive-validate';

const SQL = `
CREATE TABLE \`phpbb3_forums\` (
  \`forum_id\` mediumint(8) NOT NULL,
  \`parent_id\` mediumint(8) NOT NULL,
  \`forum_name\` varchar(255) NOT NULL
) ENGINE=InnoDB;
INSERT INTO \`phpbb3_forums\` VALUES (1,0,'The League Message Board'),(2,1,'League Rules &amp; Salary Cap'),(3,0,'Archive'),(4,3,'2012'),(5,4,'Contracts');
CREATE TABLE \`phpbb3_users\` (
  \`user_id\` int(10) NOT NULL,
  \`username\` varchar(255) NOT NULL,
  \`user_email\` varchar(100) NOT NULL,
  \`user_password\` varchar(255) NOT NULL
) ENGINE=InnoDB;
INSERT INTO \`phpbb3_users\` VALUES (2,'commish','secret-email@example.com','$2y$hash'),(3,'Devil Dogs','dd@example.com','$2y$hash2');
CREATE TABLE \`phpbb3_topics\` (
  \`topic_id\` int(10) NOT NULL,
  \`forum_id\` mediumint(8) NOT NULL,
  \`topic_title\` varchar(255) NOT NULL,
  \`topic_moved_id\` int(10) NOT NULL,
  \`topic_visibility\` tinyint(3) NOT NULL
) ENGINE=InnoDB;
INSERT INTO \`phpbb3_topics\` VALUES (10,2,'Taxi squad proposal',0,1);
INSERT INTO \`phpbb3_topics\` VALUES (11,5,'2012 contract deadlines',0,1),(12,2,'Hidden topic',0,0);
CREATE TABLE \`phpbb3_posts\` (
  \`post_id\` int(10) NOT NULL,
  \`topic_id\` int(10) NOT NULL,
  \`poster_id\` int(10) NOT NULL,
  \`poster_ip\` varchar(40) NOT NULL,
  \`post_time\` int(11) NOT NULL,
  \`post_username\` varchar(255) NOT NULL,
  \`post_subject\` varchar(255) NOT NULL,
  \`post_text\` mediumtext NOT NULL,
  \`post_visibility\` tinyint(3) NOT NULL
) ENGINE=InnoDB;
INSERT INTO \`phpbb3_posts\` VALUES (100,10,2,'76.28.132.20',1330000000,'','Taxi squad proposal','<t>Should we add a taxi squad? It\\'s time; rookies need a home.</t>',1);
INSERT INTO \`phpbb3_posts\` VALUES (101,10,3,'10.0.0.1',1330100000,'','Re: Taxi squad proposal','<r><QUOTE author="commish"><s>[quote="commish"]</s>Should we add a taxi squad?<e>[/quote]</e></QUOTE>\\nNo. Practice squads are for <B><s>[b]</s>real<e>[/b]</e></B> football.<br/>\\nSee <URL url="http://example.com/a?b=1&amp;c=2"><s>[url]</s>this<e>[/url]</e></URL></r>',1);
INSERT INTO \`phpbb3_posts\` VALUES (102,11,2,'1.1.1.1',1335000000,'','2012 contract deadlines','<t>Contracts are due March 1st.</t>',1),(103,10,2,'1.1.1.1',1330200000,'','deleted','<t>soft deleted taxi</t>',2),(104,12,2,'1.1.1.1',1330300000,'','hidden','<t>hidden taxi</t>',1);
CREATE TABLE \`phpbb3_privmsgs\` (
  \`msg_id\` int(10) NOT NULL,
  \`message_text\` mediumtext NOT NULL
) ENGINE=InnoDB;
INSERT INTO \`phpbb3_privmsgs\` VALUES (1,'private taxi squad plotting');
`;

const archive = buildForumArchive(SQL, { now: new Date('2026-10-22T00:00:00Z') });
const pointer = {
  version: 'abc123',
  builtAt: archive.builtAt,
  importedAt: archive.builtAt,
  chunkCount: 1,
  topicCount: archive.topics.length,
  postCount: archive.posts.length,
};
const loaded = assemble(pointer, archive, archive.posts);

describe('sql dump reader', () => {
  it('handles MySQL escapes, doubled quotes, NULL and numbers', () => {
    expect(parseInsertValues(`(1,'it\\'s','a''b',NULL,'x\\ny'),(2,'',3.5,'(,)','\\\\')`)).toEqual([
      [1, "it's", "a'b", null, 'x\ny'],
      [2, '', 3.5, '(,)', '\\'],
    ]);
  });

  it('reads multi-statement and multi-row inserts by column name', () => {
    const t = readTables(SQL, ['phpbb3_topics', 'phpbb3_missing']);
    expect(t.phpbb3_topics.map((r) => r.topic_id)).toEqual([10, 11, 12]);
    expect(t.phpbb3_topics[0].topic_title).toBe('Taxi squad proposal');
    expect(t.phpbb3_missing).toEqual([]);
  });
});

describe('building the archive', () => {
  it('keeps only visible posts in visible topics', () => {
    expect(archive.posts.map((p) => p.id)).toEqual([100, 101, 102]);
    expect(archive.topics.map((t) => t.id).sort()).toEqual([10, 11]);
  });

  it('never carries emails, passwords, IPs or private messages', () => {
    const text = JSON.stringify(archive);
    for (const secret of ['secret-email', 'example.com"', '$2y$', '76.28.132.20', '10.0.0.1', 'private taxi squad plotting']) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(archive.posts[0]).sort()).toEqual(['author', 'body', 'id', 'subject', 'time', 'topicId']);
  });

  it('names authors by forum username and builds forum paths', () => {
    expect(archive.posts.find((p) => p.id === 101)?.author).toBe('Devil Dogs');
    const contracts = archive.forums.find((f) => f.id === 5);
    expect(contracts?.path).toEqual(['Archive', '2012', 'Contracts']);
    expect(archive.forums.find((f) => f.id === 2)?.name).toBe('League Rules & Salary Cap');
  });

  it('converts phpBB markup to the archive markdown subset', () => {
    expect(archive.posts.find((p) => p.id === 101)?.body).toBe(
      '> **commish wrote:**\n> Should we add a taxi squad?\n\nNo. Practice squads are for **real** football.\nSee [this](http://example.com/a?b=1&c=2)',
    );
    expect(phpbbToMarkdown('<r><IMG src="javascript:alert(1)"><s>[img]</s>x<e>[/img]</e></IMG> ok</r>')).toBe('ok');
    expect(phpbbToMarkdown('<r><LIST><s>[list]</s><LI><s>[*]</s>one<e>[/*]</e></LI><LI><s>[*]</s>two</LI><e>[/list]</e></LIST></r>')).toBe('• one\n• two');
    expect(phpbbToMarkdown('<r><QUOTE author="a"><QUOTE author="b">inner</QUOTE>outer</QUOTE></r>')).toBe(
      '> **a wrote:**\n> > **b wrote:**\n> > inner\n>\n> outer',
    );
  });

  it('chunks by whole topics and points each topic at its chunk', () => {
    const { index, chunks } = chunkForumArchive(archive, 10);
    expect(chunks.length).toBe(2);
    for (const t of index.topics) {
      expect(chunks[t.chunk!].every((p) => p.topicId === t.id)).toBe(true);
    }
  });
});

describe('search', () => {
  it('matches at word starts, drops stopwords, honours phrases', () => {
    expect(parseQuery('have we ever talked about "taxi squad" rules')).toEqual({ terms: ['talked', 'rules'], phrases: ['taxi squad'] });
    expect(searchPosts(loaded, 'squad').map((h) => h.post.id).sort()).toEqual([100, 101]);
    expect(searchPosts(loaded, 'quad')).toEqual([]);
    expect(searchPosts(loaded, '"practice squads"').map((h) => h.post.id)).toEqual([101]);
  });

  it('filters by section (with sub-forums) and year', () => {
    expect(searchTopics(loaded, 'contracts', { forumId: 3 }).map((t) => t.topic.id)).toEqual([11]);
    expect(searchTopics(loaded, 'taxi', { forumId: 3 })).toEqual([]);
    expect(searchPosts(loaded, 'taxi', { year: 2011 })).toEqual([]);
  });

  it('snippets mark the matched words without altering the text', () => {
    const parts = snippet(archive.posts[0].body, 'taxi');
    expect(parts.map((p) => p.text).join('')).toBe("Should we add a taxi squad? It's time; rookies need a home.");
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['taxi']);
  });

  it("excerpts the author's own words before the post they quote", () => {
    const reply = archive.posts.find((p) => p.id === 101)!.body;
    expect(snippet(reply, 'squad').map((p) => p.text).join('')).toMatch(/^No\. Practice squads/);
    // Only the quote matches → the quote is what is shown.
    expect(snippet(reply, 'add').map((p) => p.text).join('')).toContain('Should we add a taxi squad?');
  });
});

describe('rendering', () => {
  it('escapes everything and only links http(s)', () => {
    const html = renderArchiveMarkdown('<script>x</script> [a](javascript:alert(1)) [b](https://ok.example/x)\n> quoted **bold**');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('<a href="https://ok.example/x" rel="nofollow noopener noreferrer" target="_blank">b</a>');
    expect(html).toContain('<blockquote><p>quoted <strong>bold</strong></p></blockquote>');
  });

  it('the download names every thread and post id and frames itself as history', () => {
    const md = buildArchiveMarkdown(loaded, {
      absoluteUrl: (p) => `https://site.example${p}`,
      timeZone: 'America/Los_Angeles',
      leagueName: 'The League',
    });
    expect(md).toContain('It is HISTORY');
    expect(md).toContain('## Taxi squad proposal');
    expect(md).toContain('(post 101)');
    expect(md).toContain('https://site.example/theleague/contracts/forum-archive/t/10');
    expect(md).not.toContain('10.0.0.1');
  });
});

describe('Ask Schefter reports, never summarises', () => {
  it('drops picks no search returned, and keeps one card per thread', async () => {
    const calls: any[] = [];
    const client = {
      messages: {
        create: async (body: any) => {
          calls.push(body);
          if (calls.length === 1) {
            return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_forum', input: { query: 'taxi squad' } }] };
          }
          return {
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 't2', name: 'file_report', input: { post_ids: [101, 999, 100, 102], take: '  I think it never passed.  ' } }],
          };
        },
      },
    };
    const report = await askSchefter(loaded, 'did we ever discuss a taxi squad?', { timeZone: 'America/Los_Angeles', client });
    // 999 was never returned; 102 was never returned by the search either.
    expect(report.cards.map((c) => [c.topicId, c.postId, c.morePosts])).toEqual([[10, 101, 1]]);
    expect(report.postCount).toBe(2);
    expect(report.searched).toEqual(['taxi squad']);
    expect(report.take).toBe('I think it never passed.');
    expect(report.keywordOnly).toBe(false);
    // The quoted text is the post's own words.
    expect(report.cards[0].excerpt.map((p) => p.text).join('')).toContain('Practice squads are for real football.');
    // Haiku is asked with thinking off and the system prompt cached.
    expect(calls[0].thinking).toEqual({ type: 'disabled' });
    expect(calls[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('an empty report is a valid report', () => {
    const report = buildReport(loaded, [], new Map(), { timeZone: 'UTC', searched: ['nope'], take: '', keywordOnly: false });
    expect(report).toMatchObject({ cards: [], postCount: 0, threadCount: 0, take: null, yearFrom: null });
  });

  it('falls back to a plain keyword search with no take', () => {
    const report = keywordReport(loaded, 'have we ever talked about a taxi squad?', 'UTC');
    expect(report.searched).toEqual(['taxi squad']);
    expect(report.keywordOnly).toBe(true);
    expect(report.take).toBeNull();
    expect(report.cards.map((c) => c.topicId)).toEqual([10]);
  });
});

describe('import validation', () => {
  it('accepts the built archive and rejects malformed rows', () => {
    const { index, chunks } = chunkForumArchive(archive);
    expect(sanitizeIndex(index)?.topics.length).toBe(2);
    expect(sanitizePosts(chunks[0])?.length).toBe(3);
    expect(sanitizePosts([{ id: 'x' }])).toBeNull();
    expect(sanitizeIndex({ forums: [], topics: [] })).toBeNull();
    expect(sanitizePosts([{ ...archive.posts[0], poster_ip: '1.2.3.4' }])?.[0]).not.toHaveProperty('poster_ip');
  });
});

describe('the archive never lands in the repo', () => {
  it('gitignores archive exports', () => {
    const gitignore = readFileSync(join(__dirname, '..', '.gitignore'), 'utf8');
    expect(gitignore).toContain('*forum-archive*.json');
  });
});

describe('the download is admin-only unless shared by name', () => {
  const sessionRequest = async (franchiseId: string, role: 'owner' | 'commissioner' | 'admin', leagueSlug = 'theleague') => {
    const { createSessionToken: sign } = await import('../src/utils/session');
    const { getLeagueBySlug } = await import('../src/config/leagues');
    return new Request('https://example.test/', {
      headers: {
        cookie: `session_token=${sign({ userId: 'u', username: 'o', franchiseId, leagueId: getLeagueBySlug(leagueSlug)!.id, role })}`,
      },
    });
  };

  it('lets an admin download and keeps a plain owner to reading', async () => {
    const { forumArchiveAccess } = await import('../src/utils/forum-archive/archive-access');
    const admin = forumArchiveAccess(await sessionRequest('0001', 'admin'));
    expect(admin.download).toBe(true);
    const owner = forumArchiveAccess(await sessionRequest('0002', 'owner'));
    expect(owner.member).toBe(true);
    expect(owner.download).toBe(false);
  });

  it('lets a named franchise download, and only in TheLeague', async () => {
    const access = await import('../src/utils/forum-archive/archive-access');
    const list = access.FORUM_ARCHIVE_DOWNLOAD_FRANCHISES as string[];
    list.push('0011');
    try {
      expect(access.forumArchiveAccess(await sessionRequest('0011', 'owner')).download).toBe(true);
      // Both leagues have a franchise 0011: the AFL's is not the one named.
      expect(access.forumArchiveAccess(await sessionRequest('0011', 'owner', 'afl-fantasy')).download).toBe(false);
    } finally {
      list.splice(list.indexOf('0011'), 1);
    }
  });

  it('gates the endpoint and the page section on the download flag', () => {
    const endpoint = readFileSync(join(__dirname, '../src/pages/api/forum-archive/download.ts'), 'utf8');
    expect(endpoint).toMatch(/if \(!access\.download\)/);
    const page = readFileSync(join(__dirname, '../src/pages/theleague/contracts/forum-archive/index.astro'), 'utf8');
    expect(page).toMatch(/\{access\.download && \(\s*<section class="ui-card fa-card fa-download"/);
  });
});
