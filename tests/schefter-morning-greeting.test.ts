/**
 * Morning greeting — once-per-PT-day cold-open from the classic-news /
 * sports-columnist playbook on the first Schefter post of the morning.
 *
 * Window:    07:00–10:59 PT (slightly wider than the busy-morning catch-up
 *            window so a 10:30am post still lands a greeting).
 * Frequency: once per PT day. Stamped in Redis under MORNING_GREETING_DATE_KEY
 *            after the post commits — failed cycles don't burn the slot.
 * Scope:     primary beat only. Secondary beats in the same cycle (busy-
 *            morning trade catch-up) skip the greeting so we don't double
 *            up two cold-opens in one cycle.
 *
 * Voice library (per the user's "classic news / sports references" ask):
 * - Beat-reporter: "Morning, league.", "Top of the morning.", "Pour yourself a cup."
 * - Bryant Gumbel / Today: "Up and at 'em.", "Bright and early."
 * - SportsCenter / SVP: "Welcome to your morning."
 * - Howard Cosell echo: "Good morning to everyone except the [Franchise]."
 *   (gated to scopes that already permit naming a single franchise)
 *
 * The directive is instructed to MERGE with BUSY_MORNING_CONTEXT when both
 * fire, producing one combined opener instead of two stacked ledes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const SCANNER_SRC = read('scripts/schefter-rumor-scan.mjs');

describe('morning-greeting constants + Redis key', () => {
  it('declares MORNING_GREETING_END_HOUR = 11 (07:00–10:59 PT window)', () => {
    expect(SCANNER_SRC).toMatch(/const\s+MORNING_GREETING_END_HOUR\s*=\s*11/);
  });

  it('declares the Redis date key under the schefter:morning_greeting namespace', () => {
    expect(SCANNER_SRC).toMatch(
      /MORNING_GREETING_DATE_KEY\s*=\s*['"]schefter:morning_greeting:last_used_date['"]/,
    );
  });
});

describe('isMorningGreetingWindow predicate', () => {
  function isMorningGreetingWindow(ptHour: number): boolean {
    const QUIET_HOUR_END = 7;
    const MORNING_GREETING_END_HOUR = 11;
    return ptHour >= QUIET_HOUR_END && ptHour < MORNING_GREETING_END_HOUR;
  }

  it('rejects pre-7am quiet hours', () => {
    expect(isMorningGreetingWindow(0)).toBe(false);
    expect(isMorningGreetingWindow(5)).toBe(false);
    expect(isMorningGreetingWindow(6)).toBe(false);
  });

  it('accepts the full 07:00–10:59 window', () => {
    expect(isMorningGreetingWindow(7)).toBe(true);
    expect(isMorningGreetingWindow(8)).toBe(true);
    expect(isMorningGreetingWindow(9)).toBe(true);
    expect(isMorningGreetingWindow(10)).toBe(true);
  });

  it('rejects 11:00 onward (greeting window closed)', () => {
    expect(isMorningGreetingWindow(11)).toBe(false);
    expect(isMorningGreetingWindow(15)).toBe(false);
    expect(isMorningGreetingWindow(22)).toBe(false);
  });

  it('extends past the busy-morning window so a 10:30am post still gets greeted', () => {
    // BUSY_MORNING_END_HOUR is 10; greeting window goes to 11 so the 10:00–10:59
    // hour is greeting-eligible but not busy-morning-eligible.
    function isBusyMorningWindow(ptHour: number): boolean {
      return ptHour >= 7 && ptHour < 10;
    }
    expect(isMorningGreetingWindow(10)).toBe(true);
    expect(isBusyMorningWindow(10)).toBe(false);
  });
});

describe('once-per-day Redis gate', () => {
  it('reads lastMorningGreetingDate from MORNING_GREETING_DATE_KEY', () => {
    expect(SCANNER_SRC).toMatch(/redis\.get\(MORNING_GREETING_DATE_KEY\)/);
  });

  it('flips morningGreeting=true only when stored date !== todayPt', () => {
    expect(SCANNER_SRC).toMatch(/morningGreeting\s*=\s*lastMorningGreetingDate\s*!==\s*todayPt/);
  });

  it('only checks Redis when the window is open (avoids unnecessary calls)', () => {
    expect(SCANNER_SRC).toMatch(/if \(isMorningGreetingWindow\(now\)\)/);
  });

  it('stamps the date in Redis only after a successful post commit', () => {
    // The set call lives inside the same try/catch as last_post_ts and the
    // Roger riff stamp — failed cycles don't write.
    expect(SCANNER_SRC).toMatch(
      /if \(morningGreeting\) \{\s*\n?\s*await redis\.set\(MORNING_GREETING_DATE_KEY,\s*todayPt,\s*\{\s*ex:\s*48\s*\*\s*60\s*\*\s*60\s*\}\s*\)/,
    );
  });

  it('uses 48h TTL to mirror the Roger riff pattern (clock-skew tolerant)', () => {
    expect(SCANNER_SRC).toMatch(
      /MORNING_GREETING_DATE_KEY[\s\S]{0,80}48\s*\*\s*60\s*\*\s*60/,
    );
  });
});

describe('greeting fires only on the primary beat', () => {
  it('passes morningGreeting only when i === 0', () => {
    expect(SCANNER_SRC).toMatch(/morningGreeting:\s*i === 0 && morningGreeting/);
  });
});

describe('MORNING_GREETING_CONTEXT directive in the LLM prompt', () => {
  it('generateAiBody accepts a morningGreeting option', () => {
    expect(SCANNER_SRC).toMatch(
      /async function generateAiBody\([^)]*morningGreeting\s*=\s*false[^)]*\)/,
    );
  });

  it('builds a MORNING_GREETING_CONTEXT directive when the flag is set', () => {
    expect(SCANNER_SRC).toMatch(/morningGreetingDirective\s*=/);
    expect(SCANNER_SRC).toMatch(/MORNING_GREETING_CONTEXT:/);
  });

  it('lists beat-reporter / column openers (Morning league, Top of the morning, Pour yourself a cup)', () => {
    expect(SCANNER_SRC).toMatch(/Morning, league\./);
    expect(SCANNER_SRC).toMatch(/Top of the morning\./);
    expect(SCANNER_SRC).toMatch(/Pour yourself a cup\./);
  });

  it('lists the Bryant Gumbel / Today Show patterns', () => {
    expect(SCANNER_SRC).toMatch(/Up and at 'em\./);
    expect(SCANNER_SRC).toMatch(/Bright and early\./);
  });

  it('lists the SportsCenter / SVP cold-opens', () => {
    expect(SCANNER_SRC).toMatch(/Welcome to your morning\./);
    expect(SCANNER_SRC).toMatch(/Set your coffee down\./);
  });

  it('includes the Howard Cosell echo gated to single-franchise scopes', () => {
    expect(SCANNER_SRC).toMatch(
      /Good morning to everyone except the \[Franchise\]/,
    );
    expect(SCANNER_SRC).toMatch(/franchise-multi-source/);
    expect(SCANNER_SRC).toMatch(/franchise-explicit-pick/);
    expect(SCANNER_SRC).toMatch(/trade-bait/);
  });

  it('forbids the Cosell pattern on anonymous scopes (privacy guard)', () => {
    expect(SCANNER_SRC).toMatch(/NEVER use the Cosell pattern with anonymous/);
  });

  it('instructs the LLM to MERGE with BUSY_MORNING_CONTEXT (one combined opener)', () => {
    expect(SCANNER_SRC).toMatch(/If BUSY_MORNING_CONTEXT also fires, MERGE the two/);
    expect(SCANNER_SRC).toMatch(/never two separate ledes/);
  });

  it('caps the greeting at a tone marker, not the whole post', () => {
    expect(SCANNER_SRC).toMatch(/SHORT \(2–6 words\)/);
    expect(SCANNER_SRC).toMatch(/total length 1–2 sentences/);
  });

  it('splices the directive into both single and mailbag userMessage paths', () => {
    const occurrences = SCANNER_SRC.match(/\$\{morningGreetingDirective\}/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it('places greeting BEFORE busy-morning + corroboration directives in the prompt order', () => {
    // Order matters: greeting opens the message, busy-morning + corroboration
    // qualify the body. The single-mode userMessage template must list
    // morningGreetingDirective before busyMorningDirective and corroborationDirective.
    const userMessageTemplate = SCANNER_SRC.match(
      /Synthesize these tips into ONE rumor-mill post[\s\S]*?TIPS:/,
    )?.[0] ?? '';
    const greetIdx = userMessageTemplate.indexOf('morningGreetingDirective');
    const busyIdx = userMessageTemplate.indexOf('busyMorningDirective');
    const corrIdx = userMessageTemplate.indexOf('corroborationDirective');
    expect(greetIdx).toBeGreaterThan(-1);
    expect(busyIdx).toBeGreaterThan(-1);
    expect(corrIdx).toBeGreaterThan(-1);
    expect(greetIdx).toBeLessThan(busyIdx);
    expect(greetIdx).toBeLessThan(corrIdx);
  });
});
