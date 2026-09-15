import { useCallback, useEffect, useRef, useState } from "react";
import {
	base64ToBytes,
	pcm16ToFloat32,
} from "@/services/llm/utils/media-encoding";

/**
 * Plays speech while it is still being synthesized.
 *
 * Each streamed PCM chunk is scheduled right after the previous one on a single
 * AudioContext timeline, so a slow CPU model is heard as it goes instead of
 * after the whole clip is done. A small lead-in absorbs jitter between chunks.
 */
export function usePcmStreamPlayer() {
	const contextRef = useRef<AudioContext | null>(null);
	const nextStartRef = useRef(0);
	const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
	// A ref as well as state: chunks are enqueued from stream callbacks that
	// closed over an earlier render, before the state update landed.
	const analyserRef = useRef<AnalyserNode | null>(null);
	const [playing, setPlaying] = useState(false);
	const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

	const ensureContext = useCallback(() => {
		if (!contextRef.current || contextRef.current.state === "closed") {
			const context = new AudioContext();
			const node = context.createAnalyser();
			node.fftSize = 256;
			node.connect(context.destination);
			contextRef.current = context;
			analyserRef.current = node;
			setAnalyser(node);
			nextStartRef.current = 0;
		}
		return contextRef.current;
	}, []);

	const stop = useCallback(() => {
		for (const source of sourcesRef.current) {
			try {
				source.stop();
			} catch {
				// Already finished.
			}
		}
		sourcesRef.current = [];
		nextStartRef.current = 0;
		setPlaying(false);
	}, []);

	/** Queue one base64 s16le chunk. */
	const enqueue = useCallback(
		(audio: string, sampleRate: number) => {
			const context = ensureContext();
			if (context.state === "suspended") void context.resume();
			const samples = pcm16ToFloat32(base64ToBytes(audio));
			if (samples.length === 0) return;

			const buffer = context.createBuffer(1, samples.length, sampleRate);
			buffer.getChannelData(0).set(samples);
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(analyserRef.current ?? context.destination);

			const startAt = Math.max(
				context.currentTime + 0.05,
				nextStartRef.current,
			);
			source.start(startAt);
			nextStartRef.current = startAt + buffer.duration;
			sourcesRef.current.push(source);
			setPlaying(true);

			source.onended = () => {
				sourcesRef.current = sourcesRef.current.filter(
					(item) => item !== source,
				);
				if (sourcesRef.current.length === 0) setPlaying(false);
			};
		},
		[ensureContext],
	);

	useEffect(
		() => () => {
			stop();
			void contextRef.current?.close().catch(() => undefined);
			contextRef.current = null;
			analyserRef.current = null;
		},
		[stop],
	);

	return { enqueue, stop, playing, analyser };
}
