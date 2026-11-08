/**
 * The league story intake — the questions a new custom-site league answers at
 * onboarding (Brandon, 2026-11-08: "a template that I can share with leagues
 * that they can fill out and send to us when onboarding", on the site next to
 * the logo specs and the logo maker).
 *
 * ONE list feeds three things, so they can never drift apart:
 *   - the form at /league-story (one box per question),
 *   - the "use your AI instead" prompt the same page copies to the clipboard,
 *   - the admin read-out at /live/league-stories.
 *
 * The questions came out of the first two passes (TheLeague, then the AFL):
 * friend groups and hometowns were the richest lore, "we don't have one" is an
 * answer worth having because it tells the reporter what NOT to invent, and a
 * league's champions and records are pulled from its platform, so they are
 * never asked for here. The same set lives as a shareable doc, "Tell Us Your
 * League's Story" (https://claude.ai/artifact/AhrXvTkzBFqPwdR5AiUNDE); change
 * both together.
 *
 * Question ids are STORED with every submission. Renaming one orphans the
 * answers already saved under it, so add new ids rather than reusing old ones.
 */

export interface StoryQuestion {
  id: string;
  label: string;
  /** Shown under the label; a nudge, never a requirement. */
  hint?: string;
  /** A bigger box, for the answers that run to a list. */
  long?: boolean;
}

export interface StorySection {
  id: string;
  title: string;
  intro?: string;
  questions: StoryQuestion[];
}

export const STORY_SECTIONS: StorySection[] = [
  {
    id: 'basics',
    title: 'The basics',
    questions: [
      { id: 'name-story', label: 'What is the league called? Is there a story behind the name, or an old name?' },
      { id: 'started', label: 'What year did it start, and on what platform? Has it moved since?' },
      { id: 'format', label: 'What kind of league is it (redraft, keeper, dynasty, salary cap, best ball)? How many teams?' },
      { id: 'one-sentence', label: 'What is your league about, in one sentence?', hint: 'How would you explain it to a new owner?' },
      { id: 'motto', label: 'Is there a motto or tagline the league uses?' },
    ],
  },
  {
    id: 'origin',
    title: 'How it began',
    questions: [
      { id: 'founders', label: 'Who started it, and where?' },
      { id: 'first-owners', label: 'How did the first owners know each other (school, work, family, a forum, a bar)?' },
      { id: 'why', label: 'Why was it started? Was it modeled on anything: the NFL, another league, a group of friends?' },
      { id: 'first-season', label: 'Who won the first season? Anything memorable about it?' },
      { id: 'originals', label: 'Which owners have been there since the beginning?' },
      { id: 'changes', label: 'Has the league changed shape over time (more teams, a second division or conference, new rules)? When and why?' },
    ],
  },
  {
    id: 'people',
    title: 'The people',
    questions: [
      {
        id: 'owners',
        label: 'The owners, one per line',
        hint: 'Name or nickname, team names over the years, when they joined, where they’re from or how they joined, and one line about them. Add any former owner who still comes up.',
        long: true,
      },
      { id: 'circles', label: 'What are the friend groups inside the league (coworkers, a hometown crew, college friends)? Who brought in whom?' },
      { id: 'characters', label: 'Who’s the trash talker? The one who never answers a trade offer? The one who always overpays?' },
      { id: 'commissioner', label: 'Who is the commissioner, and what’s their reputation?' },
      { id: 'famous', label: 'Has anyone in the league been famous, even briefly? May the reporter mention it?' },
      { id: 'former', label: 'Which former owners are worth remembering, and how?' },
      { id: 'honor', label: 'Has the league lost someone it wants to honor? Tell us how you’d like that handled, including “please never bring it up.”' },
      { id: 'removed', label: 'Has anyone been removed from the league? Should the reporter mention it at all?' },
    ],
  },
  {
    id: 'eras',
    title: 'Eras and big moments',
    intro: 'We pull every champion and record from your league’s platform. What we can’t pull is what those seasons meant.',
    questions: [
      { id: 'eras', label: 'Does the league talk about “eras” (the early years, a dynasty, the year the rules changed)? Do they have names?' },
      { id: 'dynasty', label: 'Has anyone built a dynasty? How did it end?' },
      { id: 'drought', label: 'Who has the longest championship drought, and do they hear about it?' },
      { id: 'greatest-final', label: 'What was the greatest championship game, or the most painful loss?' },
      { id: 'upsets', label: 'Has a great regular-season team fallen short, or an unlikely team won it all?' },
      { id: 'villain', label: 'Has the league ever had a villain? What changed after they left?' },
      { id: 'records', label: 'Any records the league cares about that a stats page wouldn’t show?' },
    ],
  },
  {
    id: 'rivalries',
    title: 'Rivalries and trades',
    questions: [
      { id: 'rivals', label: 'Which owners are rivals, and how did it start?' },
      { id: 'rivalry-trophy', label: 'Is there a rivalry game or trophy?' },
      { id: 'lopsided-trade', label: 'What’s the most lopsided trade in league history? Does the loser still hear about it?' },
      { id: 'veto', label: 'Has a trade ever been vetoed or reversed?' },
      { id: 'grudge', label: 'Is there a grudge the league brings up every season?' },
    ],
  },
  {
    id: 'traditions',
    title: 'Traditions',
    questions: [
      { id: 'draft', label: 'How do you draft: online, by email, in person? Has that changed over the years?' },
      { id: 'prize', label: 'What does the champion win (money, a trophy, a belt, a name on a plaque)? Are there other pots or side games?' },
      { id: 'last-place', label: 'What happens to last place?' },
      { id: 'awards', label: 'Any yearly awards besides the title?' },
      { id: 'inside-jokes', label: 'What are the inside jokes or running bits every owner would recognize?' },
      { id: 'chat', label: 'Where does the league talk (GroupMe, group text, Discord, email)? What gets the chat going?' },
    ],
  },
  {
    id: 'reporter',
    title: 'Your league’s reporter',
    intro: 'Your site comes with an AI reporter who writes about your league all season. These answers set its voice.',
    questions: [
      { id: 'voice', label: 'How should the reporter sound: a straight-news insider, a roast comic, an old-school columnist, a hype man?' },
      { id: 'roast', label: 'How hard can the reporter roast: gentle ribbing, full trash talk, or nothing is sacred?' },
      { id: 'persona', label: 'Does the league already have a newsletter writer or a persona? Share the name and a sample.' },
      { id: 'off-limits', label: 'What is off-limits (jobs, family, health, money, a specific event)?' },
      { id: 'names', label: 'Should the reporter use first names, nicknames, or team names only?' },
      { id: 'sample-line', label: 'Write one or two lines your league would love to read about itself.' },
    ],
  },
  {
    id: 'look',
    title: 'Look and feel',
    questions: [
      { id: 'colors-logo', label: 'League colors, crest or logo? Describe them, or tell us you’d like us to design them.' },
      { id: 'homepage-phrase', label: 'Is there a phrase that belongs at the top of your homepage?' },
      { id: 'trophy-page', label: 'What should the trophy page be called (Trophy Room, Hall of Champions, something of your own)?' },
      { id: 'pictures', label: 'Any picture the league would recognize instantly (the trophy, a draft-day photo, a mascot)?' },
    ],
  },
];

/** Every question id, in form order. */
export const STORY_QUESTION_IDS: string[] = STORY_SECTIONS.flatMap((s) => s.questions.map((q) => q.id));

/**
 * The text the "use your AI instead" button copies: the whole questionnaire,
 * worded so an assistant that already knows the league (or is handed its
 * constitution and old chats) can answer it, and so its answers come back in
 * an order a person can read without our form.
 */
export function storyAiPrompt(): string {
  const lines: string[] = [
    'Help me fill in an onboarding questionnaire about my fantasy football league. Our league is getting a custom website with an AI reporter, and these answers teach it our league’s story.',
    '',
    'Use what you know about our league from this conversation and anything I attach (our constitution, old emails or chats). Ask me about anything you can’t answer. Keep each answer short: a name, a year and one sentence is plenty. If the league doesn’t have something, answer “We don’t have one.” Don’t make anything up.',
    '',
    'Answer under the same numbered headings:',
  ];
  STORY_SECTIONS.forEach((s, si) => {
    lines.push('', `${si + 1}. ${s.title}`);
    s.questions.forEach((q, qi) => {
      lines.push(`${si + 1}.${qi + 1} ${q.label}${q.hint ? ` (${q.hint})` : ''}`);
    });
  });
  return lines.join('\n');
}
