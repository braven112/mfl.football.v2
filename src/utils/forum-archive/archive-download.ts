/**
 * The owners' download: the whole forum archive as one Markdown file, laid
 * out for an AI to read — owners upload it to Claude or any other assistant
 * and ask their own questions. Every post carries its id, author, date and a
 * link back to the thread page, so an answer can cite it.
 */
import type { LoadedArchive } from './forum-archive-store';
import type { ArchiveForum } from './types';
import { forumArchiveTopicPath } from './archive-paths';

export function formatArchiveDate(unixSeconds: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric' })
    .format(new Date(unixSeconds * 1000));
}

/** Forums in reading order: the live board first, then the archive by year. */
export function orderedForums(forums: ArchiveForum[]): ArchiveForum[] {
  const yearOf = (f: ArchiveForum) => {
    const y = f.path.map((p) => /\b(20\d\d)\b/.exec(p)?.[1]).find(Boolean);
    return y ? Number(y) : 0;
  };
  return [...forums].sort((a, b) => {
    const ya = yearOf(a);
    const yb = yearOf(b);
    if (!ya !== !yb) return ya ? 1 : -1;
    if (ya !== yb) return yb - ya;
    return a.path.join(' / ').localeCompare(b.path.join(' / '));
  });
}

export interface DownloadOptions {
  /** Turns a site path into an absolute URL (leagueUrl). */
  absoluteUrl: (path: string) => string;
  timeZone: string;
  leagueName: string;
}

export function buildArchiveMarkdown(archive: LoadedArchive, opts: DownloadOptions): string {
  const { posts, topics, forums } = archive;
  const years = posts.map((p) => new Date(p.time * 1000).getUTCFullYear());
  const first = Math.min(...years);
  const last = Math.max(...years);
  const date = (t: number) => formatArchiveDate(t, opts.timeZone);

  const out: string[] = [
    `# ${opts.leagueName} message board archive (${first}–${last})`,
    '',
    `Every public post from ${opts.leagueName}'s old phpBB message board: ${topics.length.toLocaleString('en-US')} threads and ${posts.length.toLocaleString('en-US')} posts.`,
    '',
    'How to read this file:',
    '- It is HISTORY. Threads record what owners discussed, proposed and argued about — not necessarily what the league adopted. The current rules are the league Constitution, not this file.',
    '- Threads are grouped by forum section, newest section first. Each post is headed with its author (the old forum username), date and post id.',
    '- When you answer from this file, cite the post ids you used, e.g. (post 1529), and say what year it was.',
    '- Each thread header ends with a link to that thread on the league site (members only).',
    '',
  ];

  const topicsByForum = new Map<number, typeof topics>();
  for (const t of topics) {
    const list = topicsByForum.get(t.forumId);
    if (list) list.push(t);
    else topicsByForum.set(t.forumId, [t]);
  }

  for (const forum of orderedForums(forums)) {
    const list = (topicsByForum.get(forum.id) ?? []).slice().sort((a, b) => a.startedAt - b.startedAt);
    if (!list.length) continue;
    out.push(`# Section: ${forum.path.join(' › ')}`, '');
    for (const topic of list) {
      out.push(
        `## ${topic.title}`,
        `Thread ${topic.id} · started by ${topic.author} on ${date(topic.startedAt)} · ${topic.postCount} post${topic.postCount === 1 ? '' : 's'} · ${opts.absoluteUrl(forumArchiveTopicPath(topic.id))}`,
        '',
      );
      for (const post of archive.postsByTopic.get(topic.id) ?? []) {
        out.push(`### ${post.author} — ${date(post.time)} (post ${post.id})`, '', post.body || '(empty post)', '');
      }
    }
  }
  return `${out.join('\n').trim()}\n`;
}
