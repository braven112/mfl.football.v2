/**
 * Does this request want markdown rather than HTML? True only when the Accept
 * header names `text/markdown` and ranks it at least as high as `text/html`.
 * A browser never sends it, so a page answering markdown here serves the same
 * content to AI agents that ask for it, without guessing from the user agent.
 */
export function prefersMarkdown(accept: string | null | undefined): boolean {
	if (!accept) return false;
	const q = (type: string): number => {
		for (const part of accept.split(',')) {
			const [media, ...params] = part.trim().toLowerCase().split(';');
			if (media.trim() !== type) continue;
			const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
			const value = qParam ? Number(qParam.slice(2)) : 1;
			return Number.isFinite(value) ? value : 0;
		}
		return -1;
	};
	const md = q('text/markdown');
	return md > 0 && md >= q('text/html');
}
