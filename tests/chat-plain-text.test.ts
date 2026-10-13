/**
 * No HTML reaches a group chat — see src/utils/chat-plain-text.mjs.
 *
 * TheLeague's 2026 Week 5 Pecking Order came back from the model with every
 * blurb wrapped in `<p>…</p>`, and the GroupMe announcement printed the tags
 * in front of every owner. The AFL's post the same morning was clean only
 * because its run happened not to. These tests pin the send-path strip, the
 * Pecking Order's own normalisation, and the committed issues.
 */
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  hasChatHtml,
  toChatPlainText,
  toChatPlainTextWithMentions,
} from '../src/utils/chat-plain-text.mjs';
import { postToGroupMe } from '../scripts/lib/groupme.mjs';
import { toSlackText } from '../scripts/lib/chat.mjs';
import { buildSpeculationGroupMeText } from '../scripts/lib/speculation-groupme.mjs';
import { applyAIVoice } from '../scripts/lib/pecking-order-ai.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('toChatPlainText', () => {
  it('unwraps the exact shape that shipped (TheLeague Week 5 blurb)', () => {
    const blurb =
      '<p>Pigskins dropped 147.57, the highest score in the league this week. Boom, that is an absolute monster performance.</p>';
    expect(toChatPlainText(blurb)).toBe(
      'Pigskins dropped 147.57, the highest score in the league this week. Boom, that is an absolute monster performance.',
    );
  });

  it('turns paragraphs and <br> into line breaks', () => {
    expect(toChatPlainText('<p>One.</p><p>Two.</p>')).toBe('One.\n\nTwo.');
    expect(toChatPlainText('One.<br>Two.<br/>Three.')).toBe('One.\nTwo.\nThree.');
  });

  it('keeps link text, adds an absolute href, drops a relative one', () => {
    expect(toChatPlainText('Check the <a href="/matchups">matchup preview</a> now.')).toBe(
      'Check the matchup preview now.',
    );
    expect(toChatPlainText('See <a href="https://www.theleague.us/rosters">rosters</a>')).toBe(
      'See rosters https://www.theleague.us/rosters',
    );
  });

  it('strips inline formatting and decodes entities to straight quotes', () => {
    expect(toChatPlainText('<strong>Boom.</strong> It&#8217;s &quot;done&quot; &amp; dusted')).toBe(
      `Boom. It's "done" & dusted`,
    );
  });

  it('leaves ordinary chat prose alone, byte for byte', () => {
    for (const text of [
      '🐔 THE PECKING ORDER — Week 5\n#1 Mariachi Ninjas — "fine"',
      'love this team <3',
      'if a < b and c > d',
      'Q&A tonight',
      'https://www.afl-fantasy.com/pecking-order',
    ]) {
      expect(hasChatHtml(text)).toBe(false);
      expect(toChatPlainText(text)).toBe(text);
    }
  });

  it('re-bases mention loci around the stripped text', () => {
    const text = '<p>Hey </p>@Brandon<p> set your lineup</p>';
    const start = text.indexOf('@Brandon');
    const { text: out, attachments } = toChatPlainTextWithMentions(text, [
      { type: 'mentions', user_ids: ['1'], loci: [[start, 8]] },
    ]);
    const [s, len] = attachments[0].loci[0];
    expect(out.slice(s, s + len)).toBe('@Brandon');
    expect(out).not.toMatch(/<\/?p>/);
  });
});

describe('every chat send path strips HTML', () => {
  it('postToGroupMe sends plain text (dry run shows the exact bytes)', async () => {
    let sent = '';
    await postToGroupMe({
      botId: 'x',
      text: '#1 Dream — "<p>Running down the Dream remains #1.</p>"',
      dryRun: true,
      onDryRun: (t: string) => {
        sent = t;
      },
    });
    expect(sent).toBe('#1 Dream — "Running down the Dream remains #1."');
  });

  it('Slack text is converted before it is escaped', () => {
    expect(toSlackText('<p>Boom.</p>')).toBe('Boom.');
  });

  it('the speculation post is plain text', () => {
    expect(
      buildSpeculationGroupMeText({ body: '<p>Sources say.</p>', ctaUrl: 'https://www.theleague.us/x' }),
    ).not.toMatch(/<\/?p>/);
  });

  it('is wired into every bot-post primitive', () => {
    for (const file of [
      'scripts/lib/groupme.mjs',
      'scripts/lib/speculation-groupme.mjs',
      'scripts/lib/chat.mjs',
      'src/utils/groupme-client.ts',
    ]) {
      expect(readFileSync(path.join(root, file), 'utf8'), file).toMatch(/toChatPlainText/);
    }
  });

  it('no other file posts to a chat API directly', () => {
    // A new send primitive has to go through the strip; pin the set of files
    // that hold a chat POST endpoint so one cannot appear unnoticed.
    const allowed = new Set([
      'scripts/lib/groupme.mjs',
      'scripts/lib/speculation-groupme.mjs',
      'scripts/lib/chat.mjs',
      'scripts/lib/groupme-groups.mjs', // comment only — it reads groups
      'src/utils/groupme-client.ts',
    ]);
    const hits = execSync(
      "grep -rlE 'bots/post|chat\\.postMessage' src scripts --include='*.ts' --include='*.mjs' --include='*.js' || true",
      { cwd: root, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);
    for (const hit of hits) expect(allowed, `${hit} posts to a chat without the HTML strip`).toContain(hit);
  });
});

describe('Pecking Order fields are plain text', () => {
  it('applyAIVoice unwraps <p>-wrapped model output', () => {
    const teams = new Map([['0001', { name: 'Pacific Pigskins', nameMedium: 'Pigskins' }]]);
    const issue = {
      headline: 'h',
      lede: 'l',
      rankings: [{ franchiseId: '0001', rank: 1, blurb: 'raw' }],
      awards: { statOfWeek: { blurb: 'raw' } },
    };
    const { issue: out } = applyAIVoice(
      issue,
      {
        headline: 'Pigskins Rule',
        lede: '<p>Pigskins are good.</p><p>Very good.</p>',
        blurbs: { '0001': '<p>Pigskins dropped 147.57.</p>' },
        awardBlurbs: { statOfWeek: '<p>Boom. Pigskins.</p>' },
      },
      teams,
    );
    expect(out.rankings[0].blurb).toBe('Pigskins dropped 147.57.');
    expect(out.awards.statOfWeek.blurb).toBe('Boom. Pigskins.');
    expect(out.lede).toBe('Pigskins are good.\n\nVery good.');
  });

  it('no committed issue carries HTML in a field the page prints as text', () => {
    const offenders: string[] = [];
    for (const league of readdirSync(path.join(root, 'data'))) {
      const dir = path.join(root, 'data', league, 'pecking-order');
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
        const issue = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
        const fields: Array<[string, unknown]> = [
          ['headline', issue.headline],
          ['lede', issue.lede],
          ...(issue.rankings ?? []).map((r: { franchiseId: string; blurb: unknown }) => [`blurb ${r.franchiseId}`, r.blurb] as [string, unknown]),
          ...Object.entries(issue.awards ?? {}).map(([k, c]) => [`award ${k}`, (c as { blurb?: unknown } | null)?.blurb] as [string, unknown]),
        ];
        for (const [name, v] of fields) if (hasChatHtml(v as string)) offenders.push(`${league}/${f} ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
