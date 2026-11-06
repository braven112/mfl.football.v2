/**
 * Season video — the "Got an idea for the next video?" box (Brandon,
 * 2026-11-05: launch the video on its own and "capture as many ideas and
 * feedback as people have", above all from the Reddit launch).
 *
 * One Redis list, newest first, read on `/live/video-ideas` (one viewer, the
 * site-insights gate) and exported as CSV from there. An idea carries what the
 * visitor typed, an email only if they chose to give one for a reply, and the
 * video it came from (story, look, platform) so an idea can be read in
 * context. Nothing else: no IP, no team, no league.
 *
 * Bounded three ways so a bot cannot fill Redis: per caller and site-wide per
 * day (abuse-limits.ts), and a hard ceiling on the list's length. SERVER ONLY.
 */
import { getRedis } from '../redis-client';

export const IDEAS_KEY = 'season-video:ideas';
export const MAX_IDEA_CHARS = 1000;
/** The list stops taking ideas past this many; read and clear it long before. */
export const MAX_IDEAS = 5000;

export interface VideoIdea {
	text: string;
	email: string | null;
	kind: string | null;
	look: string | null;
	platform: string | null;
	at: string;
}

const tag = (v: unknown, max = 24): string | null => (typeof v === 'string' && /^[a-z-]{1,24}$/.test(v) ? v.slice(0, max) : null);

/** The idea as we'd keep it, or null when there's nothing worth keeping. */
export function cleanIdea(
	input: { text?: unknown; email?: string | null; kind?: unknown; look?: unknown; platform?: unknown },
	now = new Date(),
): VideoIdea | null {
	if (typeof input.text !== 'string') return null;
	// Collapse runs of blank lines and strip control characters; keep the words.
	const text = input.text
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
		.slice(0, MAX_IDEA_CHARS);
	if (text.length < 3) return null;
	return { text, email: input.email ?? null, kind: tag(input.kind), look: tag(input.look), platform: tag(input.platform), at: now.toISOString() };
}

/** Keep one idea. False when storage is down or the list is full. */
export async function saveIdea(idea: VideoIdea): Promise<boolean> {
	const redis = await getRedis();
	if (!redis) return false;
	if ((await redis.llen(IDEAS_KEY)) >= MAX_IDEAS) return false;
	await redis.lpush(IDEAS_KEY, JSON.stringify(idea));
	return true;
}

/** The newest ideas first, or null when storage is down. */
export async function listIdeas(limit = MAX_IDEAS): Promise<VideoIdea[] | null> {
	const redis = await getRedis();
	if (!redis) return null;
	const rows = await redis.lrange<unknown>(IDEAS_KEY, 0, limit - 1);
	return rows.flatMap((r) => {
		try {
			const v = (typeof r === 'string' ? JSON.parse(r) : r) as VideoIdea;
			return v && typeof v.text === 'string' ? [v] : [];
		} catch {
			return [];
		}
	});
}

const csvCell = (v: string | null) => {
	const s = v ?? '';
	// A leading = + - @ makes a spreadsheet run the cell as a formula.
	const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
	return `"${safe.replace(/"/g, '""')}"`;
};

export function ideasCsv(ideas: readonly VideoIdea[]): string {
	const head = ['When', 'Idea', 'Email', 'Story', 'Look', 'Platform'];
	const rows = ideas.map((i) => [i.at, i.text, i.email, i.kind, i.look, i.platform].map(csvCell).join(','));
	return [head.join(','), ...rows].join('\r\n') + '\r\n';
}
