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
/** The music's level under a voiceover (1 = full). */
export const MUSIC_UNDER_VOICE = 0.3;
/** Video bitrate for the recorded file. Was 8 Mbps (~40 MB for 40 s). */
export const VIDEO_BITS_PER_SECOND = 3_000_000;

export interface PlayOptions {
	canvas: HTMLCanvasElement;
	scenes: readonly Scene[];
	assets: DrawAssets;
	teamName: string;
	/** The music bed, or null for no music. */
	musicUrl: string | null;
	record: boolean;
	/**
	 * A voiceover clip per scene (an audio URL, or null for none), each started
	 * as its scene starts. Music ducks under it. Only the NFL week recap
	 * (/live/weekly-recap) sends one today.
	 */
	narration?: readonly (string | null)[];
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
	const { canvas, scenes, assets, teamName, musicUrl, record, narration, onProgress, signal } = opts;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('no canvas');
	const total = storyDuration(scenes);

	// Audio: decoded into a buffer so it starts on the exact frame the video
	// does, then routed both to the speakers and into the recording.
	let ac: AudioContext | null = null;
	let source: AudioBufferSourceNode | null = null;
	let audioStream: MediaStream | null = null;
	let dest: MediaStreamAudioDestinationNode | null = null;
	const voiced = (narration ?? []).some(Boolean);
	if (musicUrl || voiced) {
		ac = new AudioContext();
		if (record) {
			dest = ac.createMediaStreamDestination();
			audioStream = dest.stream;
		}
	}
	if (ac && musicUrl) {
		const buffer = await loadMusic(ac, musicUrl);
		source = ac.createBufferSource();
		source.buffer = buffer;
		const gain = ac.createGain();
		source.connect(gain);
		gain.connect(ac.destination);
		if (dest) gain.connect(dest);
		const now = ac.currentTime;
		// Under a voiceover the bed sits low enough to hear every word.
		const level = voiced ? MUSIC_UNDER_VOICE : 1;
		gain.gain.setValueAtTime(level, now);
		gain.gain.setValueAtTime(level, now + Math.max(0, total - FADE_OUT_S));
		gain.gain.linearRampToValueAtTime(0.0001, now + total);
	}
	// Each clip is decoded up front, so it starts on its scene's first frame.
	const clips: { buffer: AudioBuffer; at: number }[] = [];
	if (ac && voiced) {
		let at = 0;
		const starts = scenes.map((s) => {
			const t = at;
			at += s.duration;
			return t;
		});
		const decodedClips = await Promise.all(
			(narration ?? []).map((url) => (url ? loadMusic(ac!, url).catch(() => null) : Promise.resolve(null))),
		);
		decodedClips.forEach((buffer, i) => {
			if (buffer && i < starts.length) clips.push({ buffer, at: starts[i] });
		});
	}

	let recorder: MediaRecorder | null = null;
	const chunks: Blob[] = [];
	let mime = '';
	if (record) {
		mime = pickVideoMime() ?? '';
		if (!mime) throw new Error('This browser cannot record video.');
		const stream = canvas.captureStream(30);
		audioStream?.getAudioTracks().forEach((t) => stream.addTrack(t));
		// ~3 Mbps keeps a 40-second video near 15 MB, under GroupMe's ~50 MB and
		// iMessage/RCS's ~100 MB; the cards are flat colour, so it stays sharp
		// (Brandon, 2026-11-05: smaller file, he tests the quality).
		recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITS_PER_SECOND, audioBitsPerSecond: 128_000 });
		recorder.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) chunks.push(e.data);
		};
	}

	drawFrame(ctx, scenes, 0, assets, teamName);
	const clock = ac ? () => ac!.currentTime : () => performance.now() / 1000;
	recorder?.start(1000);
	const voiceSources = clips.map(({ buffer, at }) => {
		const node = ac!.createBufferSource();
		node.buffer = buffer;
		node.connect(ac!.destination);
		if (dest) node.connect(dest);
		node.start(ac!.currentTime + at);
		return node;
	});
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

	for (const node of [source, ...voiceSources]) {
		try {
			node?.stop();
		} catch {
			/* already stopped */
		}
	}
	const done = recorder
		? new Promise<Blob | null>((resolve) => {
				recorder!.onstop = () => resolve(signal?.aborted ? null : new Blob(chunks, { type: mime.split(';')[0] }));
				recorder!.stop();
			})
		: Promise.resolve(null);
	const blob = await done;
	await ac?.close().catch(() => undefined);
	if (!blob) return null;
	// A recording has no length in its header until it is remuxed (finalize.ts).
	const { finalizeRecording } = await import('./finalize');
	return finalizeRecording(blob);
}
