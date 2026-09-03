/**
 * Roger clapback delivery — the native reply and the @-mention.
 *
 * A comeback that lands as bare text 15 minutes after the joke reads, to the
 * other 23 owners, as Roger heckling nobody. Two GroupMe attachments carry the
 * context: `reply` quotes the original inline, `mentions` pings the owner.
 *
 * The fragile half is `loci` — [start, length] offsets into the message body.
 * They are positional, so ANY rewrite of the text after they are measured
 * silently slides the highlight off the name and onto whatever moved into those
 * bytes. That is the regression these tests exist to catch: the offsets are
 * asserted by slicing the delivered text with them, never by restating the
 * arithmetic, so a change to the label or the prefix has to keep the slice
 * pointing at the name or fail here.
 */

import { describe, it, expect } from 'vitest';
import {
  mentionLabel,
  buildClapbackDelivery,
} from '../scripts/lib/roger-clapback.mjs';
import {
  buildReplyAttachment,
  buildMentionAttachment,
  postToGroupMe,
} from '../scripts/lib/groupme.mjs';

/** Pull the mentions attachment out of a delivery, or undefined. */
function mentionOf(attachments: any[]) {
  return attachments.find((a) => a?.type === 'mentions');
}
function replyOf(attachments: any[]) {
  return attachments.find((a) => a?.type === 'reply');
}

describe('mentionLabel', () => {
  it('keeps a plain nickname intact', () => {
    expect(mentionLabel('DDang')).toBe('DDang');
    expect(mentionLabel('Vitside')).toBe('Vitside');
  });

  it('drops a parenthetical team suffix', () => {
    // Real AFL nickname.
    expect(mentionLabel('Nigel Dee (Titsburgh Feelers)')).toBe('Nigel Dee');
  });

  it('drops a slash-joined alias', () => {
    expect(mentionLabel('Smokane FC/The Commish')).toBe('Smokane FC');
    expect(mentionLabel('Team Minty Fresh / Michio')).toBe('Team Minty Fresh');
  });

  it('does NOT split on a comma — some team names contain one', () => {
    expect(mentionLabel('Suh Girls, One Cup')).toBe('Suh Girls, One Cup');
  });

  it('collapses runs of whitespace', () => {
    expect(mentionLabel('  Ross   Lawrence  ')).toBe('Ross Lawrence');
  });

  it('falls back to the full nickname rather than emitting a bare @', () => {
    // Trimming at the leading "(" would leave an empty label.
    expect(mentionLabel('(Kev)')).toBe('(Kev)');
  });

  it('returns null for nothing to address', () => {
    expect(mentionLabel('')).toBeNull();
    expect(mentionLabel('   ')).toBeNull();
    expect(mentionLabel(undefined as any)).toBeNull();
  });
});

describe('buildClapbackDelivery — mention offsets', () => {
  const base = {
    replyText: 'Four quarterbacks. The league lets you start one.',
    ownerName: 'Nigel Dee (Titsburgh Feelers)',
    ownerUserId: '84883733',
    replyToMessageId: 'm-42',
  };

  it('prepends the mention and points loci at it', () => {
    const { text, attachments } = buildClapbackDelivery(base);
    expect(text).toBe('@Nigel Dee Four quarterbacks. The league lets you start one.');

    const [start, length] = mentionOf(attachments).loci[0];
    // Assert by slicing the DELIVERED text, not by restating the numbers.
    expect(text.slice(start, start + length)).toBe('@Nigel Dee');
  });

  it('binds the ping to the user id, not the trimmed label', () => {
    const { attachments } = buildClapbackDelivery(base);
    expect(mentionOf(attachments).user_ids).toEqual(['84883733']);
  });

  it('attaches a native reply pointing at the message that earned it', () => {
    const { attachments } = buildClapbackDelivery(base);
    expect(replyOf(attachments)).toEqual({
      type: 'reply',
      reply_id: 'm-42',
      base_reply_id: 'm-42',
    });
  });

  it('absorbs an address the model wrote itself instead of stacking a second', () => {
    const { text, attachments } = buildClapbackDelivery({
      ...base,
      replyText: 'Nigel Dee, four quarterbacks and one lineup slot.',
    });
    expect(text).toBe('@Nigel Dee four quarterbacks and one lineup slot.');
    // Exactly one address, and the offsets still land on it.
    expect(text.match(/Nigel Dee/g)).toHaveLength(1);
    const [start, length] = mentionOf(attachments).loci[0];
    expect(text.slice(start, start + length)).toBe('@Nigel Dee');
  });

  it('absorbs an address the model already wrote with an @', () => {
    const { text } = buildClapbackDelivery({
      ...base,
      replyText: '@Nigel Dee four quarterbacks.',
    });
    expect(text).toBe('@Nigel Dee four quarterbacks.');
  });

  it('keeps offsets valid through the sanitizer that runs on the way out', async () => {
    // The real hazard: postToGroupMe edits the text AFTER the loci are measured.
    // Assert against the bytes that actually reach GroupMe, not the builder's
    // output — measuring the builder alone would pass even if the send path
    // shifted every offset by one.
    const { text, attachments } = buildClapbackDelivery({
      ...base,
      replyText: 'Read the rules at https://afl.football/rules.',
    });

    let sentBody: any = null;
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: any) => {
      sentBody = JSON.parse(init.body);
      return { status: 202 };
    }) as any;
    try {
      await postToGroupMe({ botId: 'bot-1', text, attachments });
    } finally {
      globalThis.fetch = original;
    }

    // The sanitizer did fire — otherwise this test proves nothing.
    expect(sentBody.text).not.toContain('/rules.');
    const mention = sentBody.attachments.find((a: any) => a.type === 'mentions');
    const [start, length] = mention.loci[0];
    expect(sentBody.text.slice(start, start + length)).toBe('@Nigel Dee');
  });

  it('handles a nickname that is mostly punctuation without a bare @', () => {
    const { text, attachments } = buildClapbackDelivery({
      ...base,
      ownerName: 'Champ Champ or you can call me daddy',
    });
    const [start, length] = mentionOf(attachments).loci[0];
    expect(text.slice(start, start + length)).toBe('@Champ Champ or you can call me daddy');
  });
});

describe('buildClapbackDelivery — degradation', () => {
  it('posts unadorned text when the owner has no user id', () => {
    // A bare "@Name" that notifies nobody is worse than no mention: it looks
    // like Roger tried and the owner missed it.
    const { text, attachments } = buildClapbackDelivery({
      replyText: 'Four quarterbacks.',
      ownerName: 'Nigel Dee',
      ownerUserId: '',
      replyToMessageId: 'm-1',
    });
    expect(text).toBe('Four quarterbacks.');
    expect(mentionOf(attachments)).toBeUndefined();
    // The reply attachment does NOT depend on the mention.
    expect(replyOf(attachments)).toBeTruthy();
  });

  it('still mentions when there is no message to reply to', () => {
    const { text, attachments } = buildClapbackDelivery({
      replyText: 'Four quarterbacks.',
      ownerName: 'Nigel Dee',
      ownerUserId: '99',
      replyToMessageId: undefined,
    });
    expect(text).toBe('@Nigel Dee Four quarterbacks.');
    expect(replyOf(attachments)).toBeUndefined();
    expect(mentionOf(attachments)).toBeTruthy();
  });

  it('produces no attachments at all when neither is possible', () => {
    const { attachments } = buildClapbackDelivery({
      replyText: 'Four quarterbacks.',
      ownerName: null,
      ownerUserId: null,
      replyToMessageId: null,
    });
    expect(attachments).toEqual([]);
  });
});

describe('attachment builders reject unusable input', () => {
  it('buildReplyAttachment needs a real id', () => {
    expect(buildReplyAttachment('')).toBeNull();
    expect(buildReplyAttachment(undefined as any)).toBeNull();
    expect(buildReplyAttachment(123 as any)).toBeNull();
  });

  it('buildMentionAttachment drops entries with no user or no range', () => {
    expect(buildMentionAttachment([])).toBeNull();
    expect(buildMentionAttachment([{ userId: '', start: 0, length: 5 } as any])).toBeNull();
    expect(buildMentionAttachment([{ userId: '1', start: 0, length: 0 } as any])).toBeNull();
    expect(buildMentionAttachment([{ userId: '1', start: -1, length: 5 } as any])).toBeNull();
  });
});

describe('postToGroupMe — attachment wiring', () => {
  it('sends attachments in the bot post body', async () => {
    let captured: any = null;
    const fakeFetch = async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return { status: 202 };
    };
    const original = globalThis.fetch;
    globalThis.fetch = fakeFetch as any;
    try {
      await postToGroupMe({
        botId: 'bot-1',
        text: '@Nigel Dee Four quarterbacks.',
        attachments: [{ type: 'reply', reply_id: 'm-1', base_reply_id: 'm-1' }],
      });
    } finally {
      globalThis.fetch = original;
    }
    expect(captured.bot_id).toBe('bot-1');
    expect(captured.attachments).toEqual([
      { type: 'reply', reply_id: 'm-1', base_reply_id: 'm-1' },
    ]);
  });

  it('OMITS the key entirely for a plain post — every existing caller is one', async () => {
    let captured: any = null;
    const fakeFetch = async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return { status: 202 };
    };
    const original = globalThis.fetch;
    globalThis.fetch = fakeFetch as any;
    try {
      await postToGroupMe({ botId: 'bot-1', text: 'Deadline is Sunday.' });
    } finally {
      globalThis.fetch = original;
    }
    expect(captured).not.toHaveProperty('attachments');
  });

  it('hands attachments to the dry-run callback so a rehearsal shows them', async () => {
    let seen: any = null;
    await postToGroupMe({
      botId: 'bot-1',
      text: 'hi',
      attachments: [{ type: 'reply', reply_id: 'm-1', base_reply_id: 'm-1' }],
      dryRun: true,
      onDryRun: (_text: string, attachments: any) => {
        seen = attachments;
      },
    });
    expect(seen).toHaveLength(1);
  });
});
