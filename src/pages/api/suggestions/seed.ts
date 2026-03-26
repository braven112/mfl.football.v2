/**
 * Suggestion Box — Seed Data (Admin-only, one-time use)
 *
 * POST /api/suggestions/seed
 *
 * Seeds 3 starter ideas so The Board isn't empty on launch.
 * Only works for admin users. Skips seeding if ideas already exist.
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import type { Idea, Comment } from '../../../types/suggestions';
import { getAllIdeas, saveIdea, saveComment, generateId } from '../../../utils/suggestions-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ADMIN_FRANCHISE_IDS = ['0001'];

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId || !ADMIN_FRANCHISE_IDS.includes(user.franchiseId)) {
    return json({ error: 'Admin only' }, 403);
  }

  // Don't seed if ideas already exist
  const existing = await getAllIdeas();
  if (existing.length > 0) {
    return json({ message: `Already have ${existing.length} ideas, skipping seed.` });
  }

  const now = new Date();
  const ago = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();

  const seeds: { idea: Idea; comments: Comment[] }[] = [
    {
      idea: {
        id: generateId('idea'),
        title: 'Add a 3rd round to the rookie draft',
        body: 'Right now we only have 2 rounds in the rookie draft. With 28-man rosters and the amount of talent that falls to round 3 in real NFL drafts, I think adding a 3rd round would give rebuilding teams more shots at finding value. The extra picks would also make trades more interesting since there would be more draft capital floating around.',
        category: 'rule-change',
        author: { franchiseId: '0004', teamName: 'Dead Cap Walking' },
        images: [],
        reactions: { '👍': ['0002', '0005'], '🤔': ['0003'] },
        status: 'open',
        pinned: false,
        locked: false,
        archived: false,
        commentCount: 2,
        lastActivityAt: ago(1),
        createdAt: ago(12),
      },
      comments: [
        {
          id: generateId('cmt'),
          ideaId: '', // set below
          body: 'I like this. More draft picks = more trading. Would the 3rd round picks also be tradeable the year before like 1st and 2nd rounders?',
          author: { franchiseId: '0002', teamName: 'Da Dangsters' },
          images: [],
          reactions: { '👍': ['0004'] },
          createdAt: ago(8),
        },
        {
          id: generateId('cmt'),
          ideaId: '', // set below
          body: 'I could go either way. Worried it just means more roster churn with guys who never make it out of taxi. But I do like the extra trade capital argument.',
          author: { franchiseId: '0006', teamName: 'Music City Mafia' },
          images: [],
          reactions: {},
          createdAt: ago(3),
        },
      ],
    },
    {
      idea: {
        id: generateId('idea'),
        title: 'Mobile-friendly lineup submission',
        body: '',
        category: 'website',
        websiteFields: {
          type: 'feature',
          pageOrFeature: 'Submit Lineup page',
          problem: 'The Submit Lineup page works on desktop but the drag-and-drop is basically unusable on mobile. I end up having to go to MFL directly on my phone which defeats the purpose of the site.',
          desiredBehavior: 'A mobile-optimized lineup page where I can tap players to move them between starter and bench slots without needing drag-and-drop. Maybe a simple tap-to-select, tap-slot-to-place flow.',
        },
        author: { franchiseId: '0005', teamName: 'The Mariachi Ninjas' },
        images: [],
        reactions: { '🔥': ['0001', '0002', '0003', '0004', '0006'] },
        status: 'under-review',
        pinned: false,
        locked: false,
        archived: false,
        commentCount: 1,
        lastActivityAt: ago(4),
        createdAt: ago(24),
      },
      comments: [
        {
          id: generateId('cmt'),
          ideaId: '', // set below
          body: 'Yes please. Sunday morning lineup changes from my phone are a nightmare right now.',
          author: { franchiseId: '0003', teamName: 'Maverick' },
          images: [],
          reactions: { '💯': ['0005'] },
          createdAt: ago(18),
        },
      ],
    },
    {
      idea: {
        id: generateId('idea'),
        title: 'Annual awards ceremony / end-of-year recap',
        body: 'What if we did an end-of-season awards post? Categories like Best Trade, Worst Draft Pick, Biggest Sleeper Hit, Most Cursed Injury Luck, etc. Could be voted on by the league and announced on the site. Gives us something to argue about during the offseason besides extension math.',
        category: 'general',
        author: { franchiseId: '0002', teamName: 'Da Dangsters' },
        images: [],
        reactions: { '🍺': ['0001', '0003', '0004', '0005', '0006'] },
        status: 'approved',
        pinned: true,
        locked: false,
        archived: false,
        commentCount: 1,
        lastActivityAt: ago(2),
        createdAt: ago(48),
      },
      comments: [
        {
          id: generateId('cmt'),
          ideaId: '', // set below
          body: 'This is happening. I already have half the categories written up. Expect a post with the voting form before the draft.',
          author: { franchiseId: '0001', teamName: 'Pacific Pigskins' },
          images: [],
          reactions: { '🎉': ['0002', '0003', '0004', '0005', '0006'] },
          createdAt: ago(2),
        },
      ],
    },
  ];

  const results: string[] = [];

  for (const { idea, comments } of seeds) {
    const ok = await saveIdea(idea);
    if (ok) {
      results.push(`Idea: ${idea.title}`);
      for (const comment of comments) {
        comment.ideaId = idea.id;
        await saveComment(idea.id, comment);
      }
    }
  }

  return json({ message: 'Seeded successfully', results }, 201);
};
