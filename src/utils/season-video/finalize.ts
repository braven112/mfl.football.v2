/**
 * Season video — rewrite a MediaRecorder recording into a normal, finished
 * file before the visitor downloads or shares it.
 *
 * MediaRecorder writes a STREAMING file: Chrome's MP4 is fragmented and its
 * WebM has no duration, because the recorder cannot know the length when it
 * starts. Players cope, but message apps read the header to show a length,
 * and a text thread showed Brandon's 40-second video as "0.03 seconds"
 * (2026-11-05). Remuxing copies the same encoded frames into a regular file
 * with the real duration in its header. Nothing is re-encoded, so it takes a
 * moment, not another 40 seconds.
 *
 * Fails open: any error returns the recording as it was, so a visitor never
 * loses a video to this step.
 */
import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Conversion,
	Input,
	Mp4OutputFormat,
	Output,
	WebMOutputFormat,
} from 'mediabunny';

export async function finalizeRecording(blob: Blob): Promise<Blob> {
	const isMp4 = blob.type.startsWith('video/mp4');
	try {
		const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
		const target = new BufferTarget();
		const output = new Output({
			format: isMp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
			target,
		});
		const conversion = await Conversion.init({ input, output, showWarnings: false });
		if (!conversion.isValid || conversion.discardedTracks.length > 0) return blob;
		await conversion.execute();
		if (!target.buffer || target.buffer.byteLength === 0) return blob;
		return new Blob([target.buffer], { type: isMp4 ? 'video/mp4' : 'video/webm' });
	} catch {
		return blob;
	}
}
