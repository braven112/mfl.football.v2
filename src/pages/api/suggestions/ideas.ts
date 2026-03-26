/**
 * Suggestion Box — Ideas List & Create
 *
 * GET  /api/suggestions/ideas — List all non-archived ideas
 * POST /api/suggestions/ideas — Create a new idea
 */

import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';
import type { Idea, CreateIdeaRequest, IdeaCategory } from '../../../types/suggestions';
import {
  getAllIdeas,
  saveIdea,
  generateId,
  checkRateLimit,
  resolveTeamName,
} from '../../../utils/suggestions-storage';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) return json({ error: 'Authentication required' }, 401);

  const ideas = await getAllIdeas();
  // Exclude archived for non-admin (admin can see via query param)
  const url = new URL(request.url);
  const showArchived = url.searchParams.get('archived') === '1';
  const filtered = showArchived ? ideas : ideas.filter(i => !i.archived);

  return json({ ideas: filtered });
};

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user?.franchiseId) return json({ error: 'Authentication required' }, 401);

  let body: CreateIdeaRequest;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  console.log('[suggestions] POST idea body keys:', Object.keys(body), 'imageUrls:', body.imageUrls?.length ?? 0);

  const title = body.title?.trim();
  const bodyText = body.body?.trim();
  const validCategories: IdeaCategory[] = ['rule-change', 'website', 'general'];
  const category = validCategories.includes(body.category) ? body.category : 'general';

  if (!title || title.length < 5) {
    return json({ error: 'Title must be at least 5 characters' }, 400);
  }
  if (title.length > 200) {
    return json({ error: 'Title must be under 200 characters' }, 400);
  }

  // Website suggestions validate structured fields; others validate body
  if (category === 'website' && body.websiteFields) {
    const ws = body.websiteFields;
    if (!ws.pageOrFeature?.trim() || ws.pageOrFeature.trim().length < 2) {
      return json({ error: 'Page/Feature must be at least 2 characters' }, 400);
    }
    if (!ws.problem?.trim() || ws.problem.trim().length < 10) {
      return json({ error: 'Problem description must be at least 10 characters' }, 400);
    }
    if (!ws.desiredBehavior?.trim() || ws.desiredBehavior.trim().length < 10) {
      return json({ error: 'Desired behavior must be at least 10 characters' }, 400);
    }
    if (!['bug', 'feature'].includes(ws.type)) {
      return json({ error: 'Website type must be "bug" or "feature"' }, 400);
    }
  } else {
    if (!bodyText || bodyText.length < 10) {
      return json({ error: 'Description must be at least 10 characters' }, 400);
    }
    if (bodyText.length > 5000) {
      return json({ error: 'Description must be under 5000 characters' }, 400);
    }
  }

  // Rate limit
  const { allowed } = await checkRateLimit(user.franchiseId);
  if (!allowed) {
    return json({ error: 'Slow down — you\'re limited to 10 posts per hour.' }, 429);
  }

  const teamName = await resolveTeamName(user.franchiseId);
  const now = new Date().toISOString();

  const idea: Idea = {
    id: generateId('idea'),
    title,
    body: bodyText ?? '',
    category,
    ...(category === 'website' && body.websiteFields ? {
      websiteFields: {
        type: body.websiteFields.type,
        pageOrFeature: body.websiteFields.pageOrFeature.trim(),
        problem: body.websiteFields.problem.trim(),
        desiredBehavior: body.websiteFields.desiredBehavior.trim(),
      },
    } : {}),
    author: { franchiseId: user.franchiseId, teamName },
    images: (body.imageUrls ?? []).map(url => ({ url })),
    reactions: {},
    status: 'open',
    pinned: false,
    locked: false,
    archived: false,
    commentCount: 0,
    lastActivityAt: now,
    createdAt: now,
  };

  console.log('[suggestions] Saving idea with', idea.images.length, 'images:', idea.images.map(i => i.url));

  const ok = await saveIdea(idea);
  if (!ok) return json({ error: 'Failed to save idea' }, 500);

  return json({ idea }, 201);
};
