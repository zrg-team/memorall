import { useCallback, useEffect, useRef, useState } from "react";
import { platform } from "@/platform/current";
import type { RecorderState } from "./use-audio-recorder";

/** Frames are delivered in batches of about this length. */
const BATCH_SECONDS = 0.1;
const WORKLET_NAME = "memorall-pcm-capture";

export type MicrophoneListener = (
	samples: Float32Array,
	sampleRate: number,
) => void;

const concatFrames = (frames: Float32Array[], length: number) => {
	const merged = new Float32Array(length);
	let offset = 0;
	for (const frame of frames) {
		merged.set(frame, offset);
		offset += frame.length;
	}
	return merged;
};

const inputLevel = (samples: Float32Array) => {
	let sum = 0;
	for (const sample of samples) sum += sample * sample;
	return Math.min(1, Math.sqrt(sum / samples.length) * 4);
};

/** Microphone capture as raw mono PCM, for callers that act while you speak. */
export function useMicrophoneStream() {
	const [state, setState] = useState<RecorderState>(() =>
		typeof navigator !== "undefined" &&
		typeof navigator.mediaDevices?.getUserMedia === "function" &&
		typeof AudioWorkletNode !== "undefined"
			? "idle"
			: "unsupported",
	);
	const [level, setLevel] = useState(0);
	const stopRef = useRef<(() => void) | null>(null);

	const stop = useCallback(() => {
		stopRef.current?.();
		stopRef.current = null;
		setLevel(0);
		setState((current) => (current === "recording" ? "idle" : current));
	}, []);

	/** Resolves to whether the microphone is now running. */
	const start = useCallback(
		async (listener: MicrophoneListener): Promise<boolean> => {
			if (stopRef.current) return true;
			setState("requesting");
			let stream: MediaStream | null = null;
			let context: AudioContext | null = null;
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: {
						channelCount: 1,
						echoCancellation: true,
						noiseSuppression: true,
					},
				});
				context = new AudioContext();
				// A worklet module must come from a packaged file: extension pages
				// do not allow blob: scripts.
				await context.audioWorklet.addModule(
					platform.assets.url("audio/pcm-capture-worklet.js"),
				);
				const source = context.createMediaStreamSource(stream);
				const node = new AudioWorkletNode(context, WORKLET_NAME);
				const { sampleRate } = context;
				const batchSize = Math.round(sampleRate * BATCH_SECONDS);
				let frames: Float32Array[] = [];
				let pending = 0;
				node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
					frames.push(data);
					pending += data.length;
					if (pending < batchSize) return;
					const batch = concatFrames(frames, pending);
					frames = [];
					pending = 0;
					setLevel(inputLevel(batch));
					listener(batch, sampleRate);
				};
				source.connect(node);
				// The node outputs silence, but only runs while connected.
				node.connect(context.destination);

				const activeStream = stream;
				const activeContext = context;
				stopRef.current = () => {
					node.port.onmessage = null;
					source.disconnect();
					node.disconnect();
					for (const track of activeStream.getTracks()) track.stop();
					void activeContext.close().catch(() => undefined);
				};
				setState("recording");
				return true;
			} catch (error) {
				for (const track of stream?.getTracks() ?? []) track.stop();
				void context?.close().catch(() => undefined);
				const denied =
					error instanceof DOMException &&
					(error.name === "NotAllowedError" || error.name === "SecurityError");
				setState(denied ? "denied" : "idle");
				return false;
			}
		},
		[],
	);

	useEffect(() => stop, [stop]);

	return { state, level, start, stop };
}
