/**
 * Season video — fetch a team logo server-side and return it as a data: URL.
 *
 * SERVER ONLY. The browser draws logos onto a canvas it then records, and one
 * cross-origin image taints the canvas, so logos travel as data: URLs. The
 * URL is owner-set (an MFL franchise icon, a Sleeper team avatar), so it goes
 * through `validatePublicUrl`, must answer with an image type, and must fit
 * `MAX_LOGO_BYTES`.
 */
import { validatePublicUrl } from '../url-guard';
import { MAX_LOGO_BYTES, type FetchLogo } from './mfl-source';

const LOGO_TIMEOUT_MS = 4000;

export const fetchLogoAsDataUrl: FetchLogo = async (url) => {
	if (await validatePublicUrl(url)) return null;
	const res = await fetch(url, { signal: AbortSignal.timeout(LOGO_TIMEOUT_MS), redirect: 'follow' });
	if (!res.ok) return null;
	const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	if (!/^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/.test(type)) return null;
	const declared = Number(res.headers.get('content-length') ?? 0);
	if (declared > MAX_LOGO_BYTES) return null;
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.byteLength > MAX_LOGO_BYTES) return null;
	return `data:${sniffImageType(buf) ?? type};base64,${buf.toString('base64')}`;
};

/** The type the bytes say they are. Some CDNs label every avatar image/png. */
export function sniffImageType(buf: Uint8Array): string | null {
	const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => buf[i + k] === b);
	if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
	if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
	if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
	if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
	return null;
}
