import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  // Validate request method and content type
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { groupId, text } = await request.json();

    console.log('Received request:', { groupId, text });

    // Validate inputs
    if (!groupId || !text || typeof text !== 'string' || text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid groupId or text' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const accessToken = import.meta.env.GROUPME_ACCESS_TOKEN;
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'GroupMe access token not configured' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    console.log('Sending to GroupMe:', { groupId, accessToken: accessToken.substring(0, 5) + '...' });

    // Send message to GroupMe API
    const response = await fetch(
      `https://api.groupme.com/v3/groups/${groupId}/messages?token=${accessToken}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            text: text.trim(),
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('GroupMe API error:', errorData);
      return new Response(
        JSON.stringify({
          error: `Failed to send message: ${response.status}`,
          details: errorData,
        }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify({ success: true, message: data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error sending GroupMe message:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
