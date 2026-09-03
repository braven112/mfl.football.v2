/**
 * Roger's GroupMe reply lane.
 *
 * Roger used to be a one-way megaphone — he posted deadline reminders and never
 * heard the chat answer. This suite pins the return path.
 *
 * The message that motivated the feature is the fixture below (OWNER_SHOT): an
 * owner replied to a "7 days until NFL Season Starts" reminder with three
 * sentences of fake praise for Roger's ability to count days. It contains no
 * insult at all, which is exactly why the targeting layer only decides "was
 * this aimed at Roger" and the model decides "was it a shot".
 *
 * Three things here are load-bearing rather than decorative:
 *
 *  1. CROSS-LANE DISJOINTNESS. TheLeague's GroupMe has two bots. Every message
 *     Roger claims must be one Schefter's listener rejects, and vice versa, or
 *     an owner gets answered twice. That block imports BOTH detectors and runs
 *     the same fixtures through each.
 *  2. THE POLITE-OPENER SPLIT. Schefter rejects "thanks <name>" as an ack.
 *     Roger cannot: the fixture opens with "Thanks Roger." and then spends the
 *     rest of the message mocking him. Length is what separates the two.
 *  3. THE BURN IS TRUE. buildRosterRoast may only surface a surplus that is
 *     actually in the feed, and the fact sheet may only contain numbers that
 *     came from it — Roger reads these out to sixteen people.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  detectRogerTarget,
  detectRogerMention,
  detectReplyToRoger,
  isRogerBotMessage,
  validateClapbackContent,
  namesSchefter,
  buildFactSheet,
  generateClapback,
  MAX_CLAPBACKS_PER_DAY,
  OWNER_COOLDOWN_MS,
  MIN_GAP_MS,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/lib/roger-clapback.mjs';
import {
  detectMention,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/schefter-groupme-listen.mjs';
import {
  franchiseMapKeys,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/roger-groupme-reply.mjs';
import {
  SCHEFTER_LEAGUES,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/lib/schefter-leagues.mjs';
import {
  buildRosterRoast,
  buildDraftContext,
  parseStarterLimit,
  buildStarterLimits,
  displayName,
  roastScore,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/lib/roger-roster-context.mjs';

/** The real message, verbatim. */
const OWNER_SHOT =
  'Thanks Roger. Really helpful explaining how a calendar works and then counting days. ' +
  'This is next level AI that none of us could have done as humans. ' +
  'Will you be able to show us more tricks of survival?';

const ROGER_POST_ID = 'gm_roger_1';
const ROGER_IDS = new Set([ROGER_POST_ID]);

function replyMsg(text: string, replyTo = ROGER_POST_ID) {
  return {
    id: 'm1',
    name: 'Dicks out for Harambe',
    user_id: 'u1',
    text,
    attachments: [{ type: 'reply', reply_id: replyTo, base_reply_id: replyTo }],
  };
}

// ── Targeting ───────────────────────────────────────────────────────────────

describe('detectRogerTarget — the motivating message', () => {
  it('claims the sarcastic reply as a native reply to a Roger post', () => {
    const r = detectRogerTarget(replyMsg(OWNER_SHOT), ROGER_IDS);
    expect(r.match).toBe(true);
    expect(r.variant).toBe('native-reply');
    expect(r.replyToGroupMeId).toBe(ROGER_POST_ID);
  });

  it('claims it by name even with no reply attachment', () => {
    const r = detectRogerTarget({ id: 'm2', user_id: 'u1', text: OWNER_SHOT }, new Set());
    expect(r.match).toBe(true);
    expect(r.variant).toBe('named');
  });
});

describe('detectRogerMention — polite openers are not always acks', () => {
  it('rejects a bare thank-you', () => {
    expect(detectRogerMention('thanks Roger').match).toBe(false);
    expect(detectRogerMention('thanks Roger!').reason).toBe('polite-ack');
  });

  it('accepts a thank-you that keeps talking (the setup for a dig)', () => {
    // Identical opener to the bare case above; only the length differs, which
    // is the entire distinction between an ack and a run-up.
    const r = detectRogerMention(OWNER_SHOT);
    expect(r.match).toBe(true);
  });

  it('rejects radio acks at any length', () => {
    expect(detectRogerMention('roger that, I will set my lineup tonight').reason).toBe('radio-ack');
    expect(detectRogerMention('roger dodger, see you sunday').reason).toBe('radio-ack');
    expect(detectRogerMention('10-4 on the deadline, thanks').reason).toBe('radio-ack');
  });

  it("still claims \"roger that's wrong\" — that one IS aimed at him", () => {
    expect(detectRogerMention("roger that's wrong, the deadline is friday").match).toBe(true);
  });

  it('requires a positional signal, not just the name somewhere', () => {
    const r = detectRogerMention(
      'we were talking about the waiver order last night and someone brought up roger',
    );
    expect(r.match).toBe(false);
    expect(r.reason).toMatch(/weak-signal/);
  });

  it('claims a bare early "roger" even when it means a person, and leans on the model', () => {
    // Same early-words signal the Schefter listener uses, so it inherits the
    // same false positive: a human named Roger, named early, is claimed. That
    // is deliberate. The cost is one API call that comes back shot:false —
    // the model is what decides whether anything was actually aimed at Roger,
    // so a miss here is silence, not a wrong post.
    const r = detectRogerMention('my buddy roger from work plays in another league too');
    expect(r.match).toBe(true);
  });
});

describe('validateClapbackContent', () => {
  it.each(['lol', '🔥🔥🔥', 'ok', 'haha', 'facts'])('rejects reaction %s', (text) => {
    expect(validateClapbackContent(text).valid).toBe(false);
  });

  it('distinguishes the two reasons — short circuits before the word list', () => {
    expect(validateClapbackContent('lol').reason).toBe('too-short');
    expect(validateClapbackContent('facts').reason).toBe('low-effort');
    expect(validateClapbackContent('🔥🔥🔥').reason).toBe('low-effort');
  });

  it('accepts a real sentence', () => {
    expect(validateClapbackContent(OWNER_SHOT).valid).toBe(true);
  });

  it('rejects a low-effort native reply before it costs an API call', () => {
    for (const text of ['lol', 'facts', '🔥🔥🔥']) {
      const r = detectRogerTarget(replyMsg(text), ROGER_IDS);
      expect(r.match).toBe(false);
      expect(r.reason).toMatch(/^reply-(?:too-short|low-effort)$/);
    }
  });
});

// ── Two bots, one chat ──────────────────────────────────────────────────────

describe('cross-lane disjointness — Roger and Schefter never both claim a message', () => {
  it('Roger takes the sarcastic reply; Schefter does not', () => {
    expect(detectRogerTarget(replyMsg(OWNER_SHOT), ROGER_IDS).match).toBe(true);
    expect(detectMention(OWNER_SHOT)!.match).toBe(false);
  });

  it('Roger yields any message naming Schefter, even as a reply to his own post', () => {
    const text = 'schefter, is roger ever going to be this useful?';
    const r = detectRogerTarget(replyMsg(text), ROGER_IDS);
    expect(r.match).toBe(false);
    expect(r.reason).toBe('yields-to-schefter');
    // ...and Schefter picks it up, so the message is still answered once.
    expect(detectMention(text)!.match).toBe(true);
  });

  it.each([
    'schefty you were wrong about that trade',
    'the claude bot is hallucinating again',
  ])('Schefter keeps %s', (text) => {
    expect(detectMention(text)!.match).toBe(true);
    expect(detectRogerTarget({ id: 'x', text }, new Set()).match).toBe(false);
  });

  it('Roger keeps the messages Schefter explicitly refuses', () => {
    for (const text of ['ask roger when the next deadline is', "roger's bot broke again"]) {
      expect(detectMention(text)!.match).toBe(false);
      expect(detectRogerTarget({ id: 'x', text }, new Set()).match).toBe(true);
    }
  });

  it('namesSchefter covers every alias the Schefter listener answers to', () => {
    expect(namesSchefter('claude schefter')).toBe(true);
    expect(namesSchefter('schefty')).toBe(true);
    expect(namesSchefter('nothing to see here')).toBe(false);
  });
});

describe('isRogerBotMessage', () => {
  it('matches the Roger bot by name', () => {
    expect(isRogerBotMessage({ sender_type: 'bot', name: 'Ask Roger', id: 'a' })).toBe(true);
  });

  it('never matches Schefter — Roger must not answer replies to another bot', () => {
    expect(isRogerBotMessage({ sender_type: 'bot', name: 'Claude Schefter' })).toBe(false);
    expect(isRogerBotMessage({ sender_type: 'bot', name: 'Schefty' })).toBe(false);
  });

  it('never matches a human', () => {
    expect(isRogerBotMessage({ sender_type: 'user', name: 'Roger Goodell' })).toBe(false);
  });

  it('matches by explicit sender id when one is passed', () => {
    expect(
      isRogerBotMessage({ sender_type: 'user', name: 'whatever', user_id: 'sender-9' }, 'sender-9'),
    ).toBe(true);
  });

  it('takes the sender id per call, not from the environment', () => {
    // TheLeague and the AFL run separate Roger bots in separate groups. A
    // module-level env read would apply one league's id to the other's
    // messages, so the id has to arrive as an argument.
    const msg = { sender_type: 'user', name: 'whatever', user_id: 'afl-roger' };
    expect(isRogerBotMessage(msg, 'afl-roger')).toBe(true);
    expect(isRogerBotMessage(msg, 'theleague-roger')).toBe(false);
    expect(isRogerBotMessage(msg)).toBe(false);
  });
});

describe('franchiseMapKeys — the AFL cannot read TheLeague franchise ids', () => {
  it('scopes the AFL to its own key with NO legacy fallback', () => {
    // The bare `groupme:user:<id>` key is written by groupme-storage.ts against
    // TheLeague's team config. Both leagues have a franchise "0001", so falling
    // back to it in the AFL resolves a TheLeague franchise id against AFL
    // feeds — a roster belonging to a different person in a different league.
    expect(franchiseMapKeys('afl', 'u1')).toEqual(['groupme:afl:user:u1']);
  });

  it('keeps the legacy bare key for TheLeague so existing mappings still work', () => {
    expect(franchiseMapKeys('theleague', 'u1')).toEqual([
      'groupme:theleague:user:u1',
      'groupme:user:u1',
    ]);
  });

  it('prefers the scoped key over the legacy one', () => {
    expect(franchiseMapKeys('theleague', 'u1')[0]).toBe('groupme:theleague:user:u1');
  });
});

describe('detectReplyToRoger', () => {
  it('resolves reply_id and base_reply_id alike', () => {
    expect(detectReplyToRoger(replyMsg('hi there friend'), ROGER_IDS)).toBe(ROGER_POST_ID);
    const chained = {
      attachments: [{ type: 'reply', reply_id: 'other', base_reply_id: ROGER_POST_ID }],
    };
    expect(detectReplyToRoger(chained, ROGER_IDS)).toBe(ROGER_POST_ID);
  });

  it('ignores replies to posts that are not Roger', () => {
    expect(detectReplyToRoger(replyMsg('hi there friend', 'schefter_post'), ROGER_IDS)).toBeNull();
  });

  it('ignores messages with no attachments', () => {
    expect(detectReplyToRoger({ text: 'hello' }, ROGER_IDS)).toBeNull();
  });
});

// ── The burn has to be true ─────────────────────────────────────────────────

describe('parseStarterLimit', () => {
  it('reads a fixed requirement as a hard cap', () => {
    expect(parseStarterLimit('1')).toEqual({ min: 1, max: 1, hardCap: true });
  });

  it('reads a flex range as soft', () => {
    expect(parseStarterLimit('1-4')).toEqual({ min: 1, max: 4, hardCap: false });
  });

  it('returns null on junk rather than guessing a limit', () => {
    expect(parseStarterLimit('')).toBeNull();
    expect(parseStarterLimit('lots')).toBeNull();
  });
});

describe('roastScore — hard caps outrank flex piles', () => {
  it('doubles a hard-capped surplus', () => {
    // 4 QBs where exactly 1 may start: 3 surplus, doubled = 6.
    expect(roastScore({ count: 4, limit: { min: 1, max: 1, hardCap: true } })).toBe(6);
  });

  it('does not double a flex-range surplus', () => {
    // 10 WRs against a 1-4 range: 6 surplus, undoubled = 6. The doubling is
    // what lets a smaller-but-certain QB pile tie a much larger WR one.
    expect(roastScore({ count: 10, limit: { min: 1, max: 4, hardCap: false } })).toBe(6);
  });

  it('scores a legal roster at zero', () => {
    expect(roastScore({ count: 1, limit: { min: 1, max: 1, hardCap: true } })).toBe(0);
  });
});

const LEAGUE_FEED = {
  league: {
    starters: {
      count: '9',
      position: [
        { name: 'QB', limit: '1' },
        { name: 'RB', limit: '1-4' },
        { name: 'WR', limit: '1-4' },
        { name: 'TE', limit: '1-4' },
      ],
    },
  },
};

const PLAYERS_FEED = {
  players: {
    player: [
      { id: '1', name: 'McCarthy, J.J.', position: 'QB' },
      { id: '2', name: 'Allen, Josh', position: 'QB' },
      { id: '3', name: 'Rodgers, Aaron', position: 'QB' },
      { id: '4', name: 'Stafford, Matthew', position: 'QB' },
      { id: '5', name: 'Hall, Breece', position: 'RB' },
      { id: '6', name: 'Evans, Mike', position: 'WR' },
      { id: '7', name: 'Love, Jordan', position: 'QB' },
    ],
  },
};

const ROSTERS_FEED = {
  rosters: {
    franchise: [
      {
        id: '0012',
        player: [
          { id: '1', status: 'ROSTER' },
          { id: '2', status: 'ROSTER' },
          { id: '3', status: 'ROSTER' },
          { id: '4', status: 'ROSTER' },
          { id: '5', status: 'ROSTER' },
          { id: '6', status: 'ROSTER' },
        ],
      },
      { id: '0013', player: [{ id: '7', status: 'ROSTER' }] },
    ],
  },
};

describe('buildRosterRoast', () => {
  const roast = buildRosterRoast({
    franchiseId: '0012',
    rostersFeed: ROSTERS_FEED,
    playersFeed: PLAYERS_FEED,
    leagueFeed: LEAGUE_FEED,
  });

  it('surfaces the quarterback pile in a start-one league', () => {
    expect(roast!.topRoast!.position).toBe('QB');
    expect(roast!.topRoast!.count).toBe(4);
    expect(roast!.topRoast!.startMax).toBe(1);
    expect(roast!.topRoast!.hardCap).toBe(true);
    expect(roast!.topRoast!.surplus).toBe(3);
  });

  it('names the actual quarterbacks, first name first', () => {
    expect(roast!.topRoast!.names).toEqual([
      'J.J. McCarthy',
      'Josh Allen',
      'Aaron Rodgers',
      'Matthew Stafford',
    ]);
  });

  it('reports league context so "most in the league" is checkable', () => {
    expect(roast!.leagueContext!.leagueMax).toBe(4);
    expect(roast!.leagueContext!.isLeagueMax).toBe(true);
    expect(roast!.leagueContext!.tiedAtMax).toBe(1);
  });

  it('returns no roast for a legal roster rather than inventing one', () => {
    const clean = buildRosterRoast({
      franchiseId: '0013',
      rostersFeed: ROSTERS_FEED,
      playersFeed: PLAYERS_FEED,
      leagueFeed: LEAGUE_FEED,
    });
    expect(clean!.topRoast).toBeNull();
  });

  it('returns null for a franchise that is not in the feed', () => {
    expect(
      buildRosterRoast({
        franchiseId: '9999',
        rostersFeed: ROSTERS_FEED,
        playersFeed: PLAYERS_FEED,
        leagueFeed: LEAGUE_FEED,
      }),
    ).toBeNull();
  });

  it('degrades to count-only when the league feed has no starter limits', () => {
    const noLimits = buildRosterRoast({
      franchiseId: '0012',
      rostersFeed: ROSTERS_FEED,
      playersFeed: PLAYERS_FEED,
      leagueFeed: {},
    });
    // No limits means no provable surplus, so there is nothing to swing at.
    expect(noLimits!.topRoast).toBeNull();
    expect(noLimits!.rosterSize).toBe(6);
  });

  it('ignores dropped players — they are not the owner\'s to be mocked for', () => {
    const withDrop = {
      rosters: {
        franchise: [
          {
            id: '0012',
            player: [
              { id: '1', status: 'ROSTER' },
              { id: '2', status: 'FREE_AGENT' },
            ],
          },
        ],
      },
    };
    const r = buildRosterRoast({
      franchiseId: '0012',
      rostersFeed: withDrop,
      playersFeed: PLAYERS_FEED,
      leagueFeed: LEAGUE_FEED,
    });
    expect(r!.rosterSize).toBe(1);
  });
});

describe('buildDraftContext — autodraft attribution', () => {
  const DRAFT_FEED = {
    draftResults: {
      draftUnit: {
        unit: 'LEAGUE',
        draftPick: [
          { franchise: '0012', player: '1', comments: '[Pick made from Pre-Draft List] ' },
          { franchise: '0012', player: '2', comments: '' },
          { franchise: '0013', player: '7', comments: '' },
        ],
      },
    },
  };

  it('separates picks the clock made from picks the owner made', () => {
    const d = buildDraftContext({
      franchiseId: '0012',
      draftFeed: DRAFT_FEED,
      playersFeed: PLAYERS_FEED,
      position: 'QB',
    });
    expect(d.drafted).toBe(2);
    expect(d.autodrafted).toBe(1);
    expect(d.names).toEqual(['J.J. McCarthy', 'Josh Allen']);
  });

  it('does not attribute another franchise\'s picks', () => {
    const d = buildDraftContext({
      franchiseId: '0013',
      draftFeed: DRAFT_FEED,
      playersFeed: PLAYERS_FEED,
      position: 'QB',
    });
    expect(d.drafted).toBe(1);
    expect(d.autodrafted).toBe(0);
  });
});

describe('helpers', () => {
  it('flips MFL "Last, First" into speech order', () => {
    expect(displayName('Allen, Josh')).toBe('Josh Allen');
    expect(displayName('Bills, Buffalo')).toBe('Buffalo Bills');
  });

  it('builds starter limits from the league feed', () => {
    const limits = buildStarterLimits(LEAGUE_FEED);
    expect(limits.get('QB')).toEqual({ min: 1, max: 1, hardCap: true });
    expect(limits.get('WR')).toEqual({ min: 1, max: 4, hardCap: false });
  });
});

// ── Fact sheet ──────────────────────────────────────────────────────────────

describe('buildFactSheet', () => {
  const roast = buildRosterRoast({
    franchiseId: '0012',
    rostersFeed: ROSTERS_FEED,
    playersFeed: PLAYERS_FEED,
    leagueFeed: LEAGUE_FEED,
  });

  it('states the countable gap the joke rests on', () => {
    const sheet = buildFactSheet({ teamName: 'Vitside Mafia', roast, draft: null });
    expect(sheet).toContain('Carrying 4 QBs');
    expect(sheet).toContain('START 1');
    expect(sheet).toContain('Josh Allen');
    expect(sheet).toContain('Vitside Mafia');
  });

  it('tells the model to swing without specifics when there are no facts', () => {
    const sheet = buildFactSheet({ teamName: 'Some Team', roast: null, draft: null });
    expect(sheet).toContain('none available');
    expect(sheet).not.toMatch(/Carrying \d/);
  });

  it('surfaces autodraft attribution when the feed supports it', () => {
    const sheet = buildFactSheet({
      teamName: 'Vitside Mafia',
      roast,
      draft: { position: 'QB', drafted: 2, autodrafted: 1, names: ['J.J. McCarthy', 'Josh Allen'] },
    });
    expect(sheet).toContain('AUTODRAFT clock');
  });

  it('omits the autodraft line when nothing was autodrafted', () => {
    const sheet = buildFactSheet({
      teamName: 'Vitside Mafia',
      roast,
      draft: { position: 'QB', drafted: 2, autodrafted: 0, names: ['J.J. McCarthy', 'Josh Allen'] },
    });
    expect(sheet).not.toContain('AUTODRAFT clock');
  });
});

// ── Generator failure modes ─────────────────────────────────────────────────

describe('generateClapback — silence is the safe failure', () => {
  const OLD_KEY = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = OLD_KEY;
  });

  function fakeApi(text: string) {
    return async () => ({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text }] }),
    });
  }

  it('returns the reply when the model says it was a shot', async () => {
    const r = await generateClapback({
      ownerText: OWNER_SHOT,
      ownerName: 'Harambe',
      factSheet: 'ROSTER FACTS: none',
      fetchImpl: fakeApi('{"shot": true, "reply": "I count days. I also count quarterbacks."}'),
    });
    expect(r.shot).toBe(true);
    expect(r.reply).toBe('I count days. I also count quarterbacks.');
  });

  it('stays silent when the model declines to swing', async () => {
    const r = await generateClapback({
      ownerText: 'roger, when is the trade deadline?',
      factSheet: '',
      fetchImpl: fakeApi('{"shot": false, "reply": ""}'),
    });
    expect(r.shot).toBe(false);
    expect(r.reason).toBe('model-declined');
  });

  it('skips a thinking block and reads the text block', async () => {
    const r = await generateClapback({
      ownerText: OWNER_SHOT,
      factSheet: '',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          content: [
            { type: 'thinking', thinking: '' },
            { type: 'text', text: '{"shot": true, "reply": "Four quarterbacks."}' },
          ],
        }),
      }),
    });
    expect(r.reply).toBe('Four quarterbacks.');
  });

  it('drops a reply that blew past the brief instead of posting a wall of text', async () => {
    const long = 'x'.repeat(500);
    const r = await generateClapback({
      ownerText: OWNER_SHOT,
      factSheet: '',
      fetchImpl: fakeApi(`{"shot": true, "reply": "${long}"}`),
    });
    expect(r.shot).toBe(false);
    expect(r.reason).toMatch(/too-long/);
  });

  it.each([
    ['unparseable body', fakeApi('not json at all')],
    ['empty reply', fakeApi('{"shot": true, "reply": "   "}')],
  ])('stays silent on %s', async (_label, impl) => {
    const r = await generateClapback({ ownerText: OWNER_SHOT, factSheet: '', fetchImpl: impl });
    expect(r.shot).toBe(false);
  });

  it('stays silent on a non-2xx response', async () => {
    const r = await generateClapback({
      ownerText: OWNER_SHOT,
      factSheet: '',
      fetchImpl: async () => ({ ok: false, status: 529, text: async () => 'overloaded' }),
    });
    expect(r.shot).toBe(false);
    expect(r.reason).toMatch(/api-529/);
  });

  it('stays silent when the network throws', async () => {
    const r = await generateClapback({
      ownerText: OWNER_SHOT,
      factSheet: '',
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(r.shot).toBe(false);
    expect(r.reason).toMatch(/fetch-failed/);
  });

  it('stays silent with no API key rather than throwing mid-scan', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await generateClapback({ ownerText: OWNER_SHOT, factSheet: '' });
    expect(r).toEqual({ shot: false, reason: 'no-api-key' });
  });
});

// ── Rails ───────────────────────────────────────────────────────────────────

describe('rails', () => {
  it('caps Roger well below the point of being a nuisance', () => {
    expect(MAX_CLAPBACKS_PER_DAY).toBeLessThanOrEqual(5);
    expect(MAX_CLAPBACKS_PER_DAY).toBeGreaterThan(0);
  });

  it('stops one owner from dragging Roger into a back-and-forth', () => {
    expect(OWNER_COOLDOWN_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  it('answers a pile-on once, not once per pile-r', () => {
    expect(MIN_GAP_MS).toBeGreaterThanOrEqual(10 * 60 * 1000);
    expect(MIN_GAP_MS).toBeLessThan(OWNER_COOLDOWN_MS);
  });
});

// ── AFL first ───────────────────────────────────────────────────────────────

describe('league rollout — the AFL gets Roger first', () => {
  const byNav = (nav: string) => SCHEFTER_LEAGUES.find((l: any) => l.slug === nav);

  it('turns the reply lane on for the AFL and leaves TheLeague off', () => {
    expect(byNav('afl').features.rogerReplies).toBe(true);
    expect(byNav('theleague').features.rogerReplies).toBe(false);
  });

  it('keeps the lane independent of Schefter\'s mention ingest', () => {
    // groupmeListen is Schefter's tip pipeline and its Redis keys are all
    // TheLeague-scoped, so it stays TheLeague-only. Roger's lane keys off its
    // own league-scoped prefix and therefore rolls out the other way round.
    expect(byNav('afl').features.groupmeListen).toBe(false);
    expect(byNav('afl').features.rogerReplies).toBe(true);
  });

  it('reads each league\'s group id from its own registry entry', () => {
    // Not a shared module-level env read: two leagues, two groups.
    expect(Object.hasOwn(byNav('afl'), 'groupMeGroupId')).toBe(true);
    expect(Object.hasOwn(byNav('theleague'), 'groupMeGroupId')).toBe(true);
  });

  it('still requires Roger to actually post in a league before he can reply', () => {
    for (const league of SCHEFTER_LEAGUES) {
      if (league.features.rogerReplies) expect(league.features.eventReminders).toBe(true);
    }
  });
});

describe('AFL roster shape — the QB joke has to survive the move', () => {
  // The AFL is a different league: 24 franchises, 16-man rosters (vs 16 and 25),
  // and a two-unit conference draft. The burn only works if it ALSO starts
  // exactly one quarterback — pinned here because a rules change that made the
  // AFL superflex would silently turn every clapback into a false statement.
  const leagueFeed = JSON.parse(
    readFileSync('data/afl-fantasy/mfl-feeds/2026/league.json', 'utf8'),
  );

  it('starts exactly one QB, as a fixed requirement', () => {
    const limits = buildStarterLimits(leagueFeed);
    expect(limits.get('QB')).toEqual({ min: 1, max: 1, hardCap: true });
  });

  it('finds a real surplus on a real AFL roster', () => {
    const rostersFeed = JSON.parse(
      readFileSync('data/afl-fantasy/mfl-feeds/2026/rosters.json', 'utf8'),
    );
    const playersFeed = JSON.parse(
      readFileSync('data/afl-fantasy/mfl-feeds/2026/players.json', 'utf8'),
    );
    const roast = buildRosterRoast({
      franchiseId: '0008',
      rostersFeed,
      playersFeed,
      leagueFeed,
    });
    expect(roast!.topRoast!.position).toBe('QB');
    expect(roast!.topRoast!.count).toBeGreaterThanOrEqual(4);
    expect(roast!.topRoast!.startMax).toBe(1);
  });

  it('reads BOTH conference draft units, not just the first', () => {
    // AFL draftResults nests draftUnit as an ARRAY (CONFERENCE00/CONFERENCE01).
    // TheLeague's is a single object. Treating the array as an object would
    // silently drop every pick made in the other conference.
    const draftFeed = JSON.parse(
      readFileSync('data/afl-fantasy/mfl-feeds/2026/draftResults.json', 'utf8'),
    );
    const playersFeed = JSON.parse(
      readFileSync('data/afl-fantasy/mfl-feeds/2026/players.json', 'utf8'),
    );
    expect(Array.isArray(draftFeed.draftResults.draftUnit)).toBe(true);

    // 0008 drafts in one conference, 0015 in the other; both must resolve.
    const a = buildDraftContext({
      franchiseId: '0008',
      draftFeed,
      playersFeed,
      position: 'QB',
    });
    const b = buildDraftContext({
      franchiseId: '0015',
      draftFeed,
      playersFeed,
      position: 'QB',
    });
    expect(a.drafted).toBeGreaterThan(0);
    expect(b.drafted).toBeGreaterThan(0);
    expect(b.autodrafted).toBeGreaterThan(0);
  });
});
