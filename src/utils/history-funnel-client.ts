/**
 * Browser side of the video → History funnel (history-funnel.ts). Fire and
 * forget: a failed count must never touch the page, so every path is caught.
 *
 *   import { trackFunnel } from '../utils/history-funnel-client';
 *   trackFunnel('video_made', 'espn');
 */
import type { FunnelEvent, FunnelPlatform } from './history-funnel';

const VISITOR_KEY = 'historyFunnel.visitor';

function newId(): string {
	if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function visitorId(): string {
	try {
		let id = localStorage.getItem(VISITOR_KEY);
		if (!id) {
			id = newId();
			localStorage.setItem(VISITOR_KEY, id);
		}
		return id;
	} catch {
		return newId();
	}
}

export function trackFunnel(event: FunnelEvent, platform: FunnelPlatform): void {
	try {
		void fetch('/api/history-funnel', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ event, platform, visitor: visitorId() }),
			keepalive: true,
		}).catch(() => {});
	} catch {
		/* never let a count break the page */
	}
}
