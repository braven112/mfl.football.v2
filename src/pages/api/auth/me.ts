import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../utils/auth';

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);

  if (user) {
    return new Response(
      JSON.stringify({
        authenticated: true,
        user: {
          userId: user.id,
          username: user.name,
          franchiseId: user.franchiseId,
          leagueId: user.leagueId,
          role: user.role,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ authenticated: false }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};
