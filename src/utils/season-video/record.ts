/**
 * Season video — plays a storyboard on a canvas in real time and, when
 * asked, records it (with its music) to a video file the visitor downloads.
 * Browser only. Nothing is uploaded: the video is made on the visitor's own
 * device, so the free tier costs us no rendering.
 *
 * MediaRecorder writes MP4 where the browser can (Safari, current Chrome and
 * Edge) and WebM elsewhere (Firefox); `pickVideoMime` decides. Recording runs
 * at playback speed, so a 45-second video takes 45 seconds, and the tab has
 * to stay in front: a hidden tab stops animation frames.
 */
import type { Scene } from './story';
import { storyDuration } from './story';
import { drawFrame, type DrawAssets } from './draw';

// H.264 by name only. A bare 'video/mp4' lets Chromium builds without an
// H.264 encoder write VP9 inside an MP4 box, which TikTok and Instagram
// refuse; WebM is the honest answer there, and the page says so.
const MIME_CANDIDATES = [
	'video/mp4;codecs=avc1.640028,mp4a.40.2',
	'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
	'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
	'video/mp4;codecs=avc1,mp4a.40.2',
	'video/mp4;codecs=avc1,opus',
	'video/webm;codecs=vp9,opus',
	'video/webm;codecs=vp8,opus',
	'video/webm',
];

/** The best format this browser can record, or null when it cannot record at all. */
export function pickVideoMime(): string | null {
	if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
	return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export const fileExtension = (mime: string) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');

const FADE_OUT_S = 1.5;

export interface PlayOptions {
	canvas: HTMLCanvasElement;
	scenes: readonly Scene[];
	assets: DrawAssets;
	teamName: string;
	/** The music bed, or null for no music. */
	musicUrl: string | null;
	record: boolean;
	onProgress?: (fraction: number) => void;
	/** Aborts playback; a recording in progress resolves with null. */
	signal?: AbortSignal;
}

let decoded = new Map<string, Promise<AudioBuffer>>();

function loadMusic(ac: AudioContext, url: string): Promise<AudioBuffer> {
	let hit = decoded.get(url);
	if (!hit) {
		hit = fetch(url)
			.then((r) => {
				if (!r.ok) throw new Error(`music ${r.status}`);
				return r.arrayBuffer();
			})
			.then((buf) => ac.decodeAudioData(buf));
		hit.catch(() => decoded.delete(url));
		decoded.set(url, hit);
	}
	return hit;
}

/** Test seam: forget decoded music. */
export function resetMusicCache() {
	decoded = new Map();
}

/**
 * Play the story once on `canvas`. Resolves with the recording when
 * `record` is set, otherwise with null when playback ends.
 */
export async function playStory(opts: PlayOptions): Promise<Blob | null> {
	const { canvas, scenes, assets, teamName, musicUrl, record, onProgress, signal } = opts;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('no canvas');
	const total = storyDuration(scenes);

	// Audio: decoded into a buffer so it starts on the exact frame the video
	// does, then routed both to the speakers and into the recording.
	let ac: AudioContext | null = null;
	let source: AudioBufferSourceNode | null = null;
	let audioStream: MediaStream | null = null;
	if (musicUrl) {
		ac = new AudioContext();
		const buffer = await loadMusic(ac, musicUrl);
		source = ac.createBufferSource();
		source.buffer = buffer;
		const gain = ac.createGain();
		source.connect(gain);
		gain.connect(ac.destination);
		const now = ac.currentTime;
		gain.gain.setValueAtTime(1, now + Math.max(0, total - FADE_OUT_S));
		gain.gain.linearRampToValueAtTime(0.0001, now + total);
		if (record) {
			const dest = ac.createMediaStreamDestination();
			gain.connect(dest);
			audioStream = dest.stream;
		}
	}

	let recorder: MediaRecorder | null = null;
	const chunks: Blob[] = [];
	let mime = '';
	if (record) {
		mime = pickVideoMime() ?? '';
		if (!mime) throw new Error('This browser cannot record video.');
		const stream = canvas.captureStream(30);
		audioStream?.getAudioTracks().forEach((t) => stream.addTrack(t));
		recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
		recorder.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) chunks.push(e.data);
		};
	}

	drawFrame(ctx, scenes, 0, assets, teamName);
	const clock = ac ? () => ac!.currentTime : () => performance.now() / 1000;
	recorder?.start(1000);
	source?.start();
	const t0 = clock();

	await new Promise<void>((resolve) => {
		const tick = () => {
			if (signal?.aborted) return resolve();
			const t = clock() - t0;
			drawFrame(ctx, scenes, Math.min(t, total), assets, teamName);
			onProgress?.(Math.min(1, t / total));
			if (t >= total) return resolve();
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	try {
		source?.stop();
	} catch {
		/* already stopped */
	}
	const done = recorder
		? new Promise<Blob | null>((resolve) => {
				recorder!.onstop = () => resolve(signal?.aborted ? null : new Blob(chunks, { type: mime.split(';')[0] }));
				recorder!.stop();
			})
		: Promise.resolve(null);
	const blob = await done;
	await ac?.close().catch(() => undefined);
	return blob;
}
