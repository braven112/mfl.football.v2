/**
 * Parity test — the TS `detectAttackOnSchefter` in src/utils/ and the JS
 * version in scripts/schefter-groupme-listen.mjs must agree on every input.
 * The API route (web tip path) uses the TS copy; the GroupMe listener (chat
 * path) uses the JS copy. Drift between them means one channel logs Style
 * Book entries the other doesn't.
 *
 * Any new pejorative, subject pattern, negation token, or disambiguation
 * rule added to one side must be mirrored on the other — this test will
 * fail until both are in sync.
 */
import { describe, it, expect } from 'vitest';
import {
  detectAttackOnSchefter as tsDetect,
  mentionsSchefter as tsMentions,
} from '../src/utils/schefter-attack-detection';
import {
  detectAttackOnSchefter as jsDetect,
  mentionsSchefter as jsMentions,
  // @ts-ignore — .mjs via allowJs
} from '../scripts/schefter-groupme-listen.mjs';

// Full input matrix. Each case must produce identical attack / keyword /
// reason across the two implementations.
const CASES: string[] = [
  // Canonical
  'Claude Schefter is a lil bitch',
  'schefty sucks',
  'the bot is a hack',
  'schefter is trash',
  'claude is wrong again',
  // Negation
  "schefter isn't wrong about this",
  "that's not bad for the bot",
  // No subject
  'this trade is trash',
  'the waiver wire is garbage',
  // No pejorative
  'hey schefter any rumors?',
  'the bot posted a great one',
  // Case / punctuation
  'SCHEFTER, you are GARBAGE!!!',
  'wow claude, you really are a CLOWN.',
  // Roger disambiguation — both should reject
  'the bot is wrong, ask Roger to fix it',
  "roger's bot is lame",
  'ask roger why the bot is broken',
  // Roger named BUT Schefter also explicitly named — both should accept
  'schefter is a hack even though Roger is fine',
  "Claude is terrible and ask Roger doesn't care",
  // Edge: short
  '',
  'bad',
  'nope',
  // Edge: all whitespace
  '     ',
  // Edge: the bot alone (no Roger context) — both should accept if pejorative present
  'that bot is worthless',
  'this bot is a fraud',
];

describe('detectAttackOnSchefter — TS vs JS parity', () => {
  for (const input of CASES) {
    it(`parity: ${JSON.stringify(input).slice(0, 60)}`, () => {
      const ts = tsDetect(input);
      const js = jsDetect(input);
      // Compare the "attack" bit first — the most important contract.
      expect(ts.attack).toBe(js.attack);
      if (ts.attack && js.attack) {
        expect(ts.keyword).toBe(js.keyword);
      }
      // Reasons should agree too; if they ever diverge we want to know.
      expect(ts.reason).toBe(js.reason);
    });
  }
});

// `mentionsSchefter` is the lighter subject-only check used to route
// off-topic, no-pejorative jokes (e.g. "Claude was seen at a resort") into
// the self-deprecating lane. Same Roger disambiguation, no pejorative
// requirement. Parity must hold or the web/GroupMe paths diverge.
const MENTIONS_CASES: Array<[string, boolean]> = [
  // Plain Schefter mentions — true
  ['Rumor has it Claude and Vit were at a resort', true],
  ['hey schefter, any rumors?', true],
  ['Schefty out here filing reports again', true],
  ['the bot is working overtime', true],
  ['this bot makes me laugh', true],
  // No subject — false
  ['rumor about an owner', false],
  ['the waiver wire is a mess', false],
  // Roger disambiguation — generic bot + Roger named, no explicit Schefter ref
  ['the bot is broken, ask Roger', false],
  ["roger's bot just posted", false],
  // Roger named but Schefter explicitly named — true
  ['schefter is on fire even though Roger is fine', true],
  ['Claude has thoughts and ask Roger does too', true],
  // Edge cases
  ['', false],
  ['   ', false],
  ['hey', false],
];

describe('mentionsSchefter — TS vs JS parity', () => {
  for (const [input, expected] of MENTIONS_CASES) {
    it(`parity: ${JSON.stringify(input).slice(0, 60)} → ${expected}`, () => {
      const ts = tsMentions(input);
      const js = jsMentions(input);
      expect(ts).toBe(js);
      expect(ts).toBe(expected);
    });
  }
});
