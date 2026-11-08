/**
 * League story intake (/league-story → /api/league-story → /live/league-stories).
 * Pins what a submission keeps (the league, a follow-up email, answers to KNOWN
 * questions only), that question ids stay unique (they are stored), that the AI
 * prompt carries every question, and that the endpoint and admin page check
 * their limits and gate before anything is stored or shown.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { STORY_QUESTION_IDS, STORY_SECTIONS, storyAiPrompt } from '../src/data/league-story-questions';
import { cleanSubmission, MAX_ANSWER_CHARS } from '../src/utils/league-story/submissions';

const now = new Date('2026-11-08T17:00:00Z');

describe('the questions', () => {
  it('ids are unique, since every saved answer is keyed by one', () => {
    expect(new Set(STORY_QUESTION_IDS).size).toBe(STORY_QUESTION_IDS.length);
  });
  it('the AI prompt carries every question, numbered by section', () => {
    const prompt = storyAiPrompt();
    for (const s of STORY_SECTIONS) for (const q of s.questions) expect(prompt).toContain(q.label);
    expect(prompt).toContain('1.1 ');
    expect(prompt).toContain('We don’t have one.');
  });
});

describe('cleanSubmission', () => {
  it('keeps the league, the email and answers to known questions only', () => {
    const s = cleanSubmission(
      { league: '  The League ', name: 'Brandon', platform: 'MyFantasyLeague', answers: { 'one-sentence': ' Purest form ', 'made-up': 'x', motto: '   ' } },
      'a@b.co',
      now,
    );
    expect(s).toEqual({
      league: 'The League',
      name: 'Brandon',
      email: 'a@b.co',
      platform: 'MyFantasyLeague',
      answers: { 'one-sentence': 'Purest form' },
      pasted: null,
      at: '2026-11-08T17:00:00.000Z',
    });
  });
  it('takes a paste from the league’s own AI on its own', () => {
    expect(cleanSubmission({ league: 'AFL', pasted: '1.1 The AFL…' }, 'a@b.co', now)?.pasted).toBe('1.1 The AFL…');
  });
  it('refuses a submission with no league name or nothing answered', () => {
    expect(cleanSubmission({ league: '', answers: { motto: 'x' } }, 'a@b.co', now)).toBeNull();
    expect(cleanSubmission({ league: 'AFL', answers: {} }, 'a@b.co', now)).toBeNull();
    expect(cleanSubmission({ league: 'AFL', answers: ['x'] }, 'a@b.co', now)).toBeNull();
  });
  it('caps each answer and strips control characters', () => {
    const s = cleanSubmission({ league: 'AFL', answers: { motto: `a\u0007b${'x'.repeat(9000)}` } }, 'a@b.co', now)!;
    expect(s.answers.motto.length).toBe(MAX_ANSWER_CHARS);
    expect(s.answers.motto.startsWith('ab')).toBe(true);
  });
});

describe('wiring', () => {
  it('the endpoint checks both caller limits, the honeypot, the email and the daily cap before it saves', () => {
    const src = readFileSync('src/pages/api/league-story.ts', 'utf8');
    const save = src.indexOf('saveSubmission(submission)');
    for (const marker of ["'league-story-hop'", "'league-story'", 'body.website', 'normalizeEmail(body.email)', "'league-story-all'"]) {
      expect(src.indexOf(marker)).toBeGreaterThan(-1);
      expect(src.indexOf(marker)).toBeLessThan(save);
    }
  });
  it('the admin list is the one-viewer site-insights gate, and stays out of search', () => {
    const page = readFileSync('src/pages/live/league-stories.astro', 'utf8');
    expect(page.indexOf('canViewSiteInsights(authUser)')).toBeGreaterThan(-1);
    expect(page.indexOf('canViewSiteInsights(authUser)')).toBeLessThan(page.indexOf('listSubmissions()'));
    expect(readFileSync('src/data/page-directory.json', 'utf8')).not.toContain('/live/league-stories');
  });
  it('the form is one of the onboarding steps on /get-started', () => {
    const hub = readFileSync('src/pages/get-started.astro', 'utf8');
    for (const step of ["'/league-story'", "'/team-logo'", "'/brand/specs'"]) expect(hub).toContain(step);
  });
});
