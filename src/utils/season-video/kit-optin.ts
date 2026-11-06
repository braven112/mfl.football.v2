/**
 * Season video — the opt-in email box after a video is made (Brandon,
 * 2026-11-05: "build that into it", tag "Season video").
 *
 * None of the video's sources gives us an email (MFL sign-in, a Sleeper
 * username, an ESPN league id), so the only address we hold is one the
 * visitor types AND ticks the consent box for. It goes straight into Kit,
 * the list for opted-in people only, tagged "Season video" plus the league
 * platform the season came from, so a later History or season-pass pitch
 * knows who it is talking to.
 *
 * Kit's v4 API, with the account's API key in `KIT_API_KEY` (Vercel env).
 * Tags are found by name, and created the first time, so nothing needs
 * setting up in Kit by hand. SERVER ONLY.
 */

export const KIT_TAG = 'Season video';
export const PLATFORM_TAGS = { mfl: 'Platform: MFL', sleeper: 'Platform: Sleeper', espn: 'Platform: ESPN' } as const;
export type OptInPlatform = keyof typeof PLATFORM_TAGS;

const KIT = 'https://api.kit.com/v4';
const TIMEOUT_MS = 8000;

/** A plausible email, short enough to be one. Kit has the final say. */
export function normalizeEmail(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const email = value.trim().toLowerCase();
	if (email.length < 6 || email.length > 254) return null;
	return /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/.test(email) ? email : null;
}

export function platformOf(value: unknown): OptInPlatform | null {
	return value === 'mfl' || value === 'sleeper' || value === 'espn' ? value : null;
}

export type KitFetch = (path: string, init: { method: 'GET' | 'POST'; body?: unknown }) => Promise<{ status: number; json: unknown }>;

export function kitFetcher(apiKey: string): KitFetch {
	return async (path, init) => {
		const res = await fetch(`${KIT}${path}`, {
			method: init.method,
			headers: { 'X-Kit-Api-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		return { status: res.status, json: await res.json().catch(() => null) };
	};
}

const tagIds = new Map<string, number>();

/** The id of the tag with this name, creating it the first time. */
async function tagId(kit: KitFetch, name: string): Promise<number | null> {
	const known = tagIds.get(name);
	if (known) return known;
	// POST returns the existing tag when the name is taken (Kit v4), so one call does both.
	const res = await kit('/tags', { method: 'POST', body: { name } });
	const id = (res.json as { tag?: { id?: number } } | null)?.tag?.id;
	if ((res.status === 200 || res.status === 201) && typeof id === 'number') {
		tagIds.set(name, id);
		return id;
	}
	return null;
}

/** Add an opted-in subscriber and tag them. True when Kit took the address. */
export async function subscribeToKit(kit: KitFetch, email: string, platform: OptInPlatform | null): Promise<boolean> {
	const sub = await kit('/subscribers', { method: 'POST', body: { email_address: email, state: 'active' } });
	if (sub.status !== 200 && sub.status !== 201) return false;
	const names = [KIT_TAG, ...(platform ? [PLATFORM_TAGS[platform]] : [])];
	for (const name of names) {
		const id = await tagId(kit, name);
		if (id) await kit(`/tags/${id}/subscribers`, { method: 'POST', body: { email_address: email } });
	}
	return true;
}
