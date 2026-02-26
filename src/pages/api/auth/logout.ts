import type { APIRoute } from 'astro';

export const POST: APIRoute = async () => {
  // Clear session cookie by setting it expired
  // Do NOT clear theleague_team_pref - team preference persists after logout
  const expiredCookie = 'session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax';

  return new Response(
    JSON.stringify({ success: true }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': expiredCookie,
      },
    }
  );
};
