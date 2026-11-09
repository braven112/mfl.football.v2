/**
 * POST /api/nfl-week-voice { text } → audio/mpeg — one line of The Commish's
 * voiceover for the NFL week recap (/live/weekly-recap), spoken by ElevenLabs.
 *
 * OURS ONLY: gated like `/live/analytics` (`canViewSiteInsights`), so no
 * visitor can spend the ElevenLabs credits. Needs `ELEVENLABS_API_KEY` in the
 * environment; without it this answers 503 and the page makes the video with
 * music only. The voice is a constant here, not an env var (CLAUDE.md:
 * feature choices live in code).
 *
 * The Commish is an ORIGINAL character (Brandon let Claude pick, 2026-11-08):
 * a deadpan, overconfident studio analyst, voiced by the ElevenLabs library
 * voice "Odom - Deep, Confident, Polished".
 */
import type { APIRoute } from 'astro';
import { getAuthUser } from '../../utils/auth';
import { canViewSiteInsights } from '../../utils/site-insights';

export const prerender = false;

const COMMISH_VOICE_ID = '2rRUaEOGIGalXrcuLN55';
const MODEL_ID = 'eleven_multilingual_v2';
/** A recap line is a sentence or two; anything longer is not one. */
const MAX_CHARS = 300;

const fail = (error: string, status: number) =>
	new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
	if (!canViewSiteInsights(getAuthUser(request))) return fail('Not allowed.', 403);
	const key = process.env.ELEVENLABS_API_KEY;
	if (!key) return fail('No ElevenLabs key set.', 503);
	const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
	const text = typeof body?.text === 'string' ? body.text.trim() : '';
	if (!text || text.length > MAX_CHARS) return fail('Bad text.', 400);
	try {
		const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${COMMISH_VOICE_ID}?output_format=mp3_44100_128`, {
			method: 'POST',
			headers: { 'xi-api-key': key, 'Content-Type': 'application/json', accept: 'audio/mpeg' },
			body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 } }),
			signal: AbortSignal.timeout(30_000),
		});
		if (!res.ok) return fail(`ElevenLabs ${res.status}`, 502);
		return new Response(await res.arrayBuffer(), { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store' } });
	} catch {
		return fail('ElevenLabs did not answer.', 502);
	}
};
