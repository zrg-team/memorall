import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState =
	| "idle"
	| "requesting"
	| "recording"
	| "denied"
	| "unsupported";

const PREFERRED_TYPES = [
	"audio/webm;codecs=opus",
	"audio/webm",
	"audio/ogg;codecs=opus",
	"audio/mp4",
];

const pickMimeType = (): string | undefined =>
	typeof MediaRecorder === "undefined"
		? undefined
		: PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));

/**
 * Microphone capture with a live input level.
 *
 * Returns the recording as a Blob on `stop()`. The level (0-1, RMS of the
 * analyser) drives the pulsing mic button so the user can see they are heard
 * before the transcript arrives.
 */
export function useAudioRecorder() {
	const [state, setState] = useState<RecorderState>(() =>
		typeof navigator !== "undefined" &&
		typeof navigator.mediaDevices?.getUserMedia === "function" &&
		typeof MediaRecorder !== "undefined"
			? "idle"
			: "unsupported",
	);
	const [level, setLevel] = useState(0);
	const [elapsedMs, setElapsedMs] = useState(0);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const frameRef = useRef<number | null>(null);
	const contextRef = useRef<AudioContext | null>(null);
	const startedAtRef = useRef(0);
	const resolveStopRef = useRef<((blob: Blob | null) => void) | null>(null);

	const cleanup = useCallback(() => {
		if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
		streamRef.current?.getTracks().forEach((track) => track.stop());
		streamRef.current = null;
		void contextRef.current?.close().catch(() => undefined);
		contextRef.current = null;
		setLevel(0);
	}, []);

	const start = useCallback(async () => {
		if (state === "unsupported" || recorderRef.current) return;
		setState("requesting");
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			streamRef.current = stream;

			const context = new AudioContext();
			const analyser = context.createAnalyser();
			analyser.fftSize = 512;
			context.createMediaStreamSource(stream).connect(analyser);
			contextRef.current = context;
			const samples = new Float32Array(analyser.fftSize);
			const tick = () => {
				analyser.getFloatTimeDomainData(samples);
				let sum = 0;
				for (const sample of samples) sum += sample * sample;
				setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
				setElapsedMs(Date.now() - startedAtRef.current);
				frameRef.current = requestAnimationFrame(tick);
			};

			const mimeType = pickMimeType();
			const recorder = new MediaRecorder(
				stream,
				mimeType ? { mimeType } : undefined,
			);
			chunksRef.current = [];
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) chunksRef.current.push(event.data);
			};
			recorder.onstop = () => {
				const blob = chunksRef.current.length
					? new Blob(chunksRef.current, {
							type: recorder.mimeType || "audio/webm",
						})
					: null;
				recorderRef.current = null;
				cleanup();
				setState("idle");
				resolveStopRef.current?.(blob);
				resolveStopRef.current = null;
			};
			recorderRef.current = recorder;
			startedAtRef.current = Date.now();
			setElapsedMs(0);
			recorder.start(250);
			frameRef.current = requestAnimationFrame(tick);
			setState("recording");
		} catch (error) {
			cleanup();
			const denied =
				error instanceof DOMException &&
				(error.name === "NotAllowedError" || error.name === "SecurityError");
			setState(denied ? "denied" : "idle");
		}
	}, [cleanup, state]);

	const stop = useCallback((): Promise<Blob | null> => {
		const recorder = recorderRef.current;
		if (!recorder) return Promise.resolve(null);
		return new Promise((resolve) => {
			resolveStopRef.current = resolve;
			recorder.stop();
		});
	}, []);

	const cancel = useCallback(() => {
		resolveStopRef.current = null;
		const recorder = recorderRef.current;
		if (recorder) {
			recorder.onstop = null;
			recorder.stop();
			recorderRef.current = null;
		}
		cleanup();
		setState((current) => (current === "unsupported" ? current : "idle"));
	}, [cleanup]);

	useEffect(() => cancel, [cancel]);

	return { state, level, elapsedMs, start, stop, cancel };
}
