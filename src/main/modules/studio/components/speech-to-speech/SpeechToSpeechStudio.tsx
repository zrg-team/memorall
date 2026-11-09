import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	WorkspaceEmptyState,
	WorkspaceEmptyVisual,
} from "@/main/components/molecules/WorkspaceEmptyState";
import { useStudioStore } from "@/main/stores/studio";
import { serviceManager } from "@/services";
import { encodeWav } from "@/services/llm/utils/media-encoding";
import { logError } from "@/utils/logger";
import { v4 } from "@/utils/uuid";
import { useMicrophoneStream } from "../../hooks/use-microphone-stream";
import { usePcmStreamPlayer } from "../../hooks/use-pcm-stream-player";
import {
	isCancellation,
	respondToSpeech,
	saveStudioInput,
} from "../../services/studio-service";
import { studioModeDescriptor } from "../../studio-modes";
import { StudioComposer } from "../shared/StudioComposer";
import { StudioThread } from "../shared/StudioThread";
import { LiveLevelMeter } from "../speech/LiveLevelMeter";
import type { StudioCanvasProps } from "../studio-canvas";
import { RecordButton } from "../transcription/RecordButton";
import { SpeechTurnCard } from "./SpeechTurnCard";
import { VoiceActivityDetector } from "./voice-activity";

type ConversationPhase =
	| "idle"
	| "starting"
	| "listening"
	| "hearing"
	| "responding"
	| "speaking";

/** The reply's tail can still be in the speakers when playback reports done. */
const LISTEN_AGAIN_DELAY_MS = 200;

/**
 * Talk to a model and hear it answer. Hands-free: a turn starts when you speak
 * and ends when you pause. The microphone is ignored while the model answers,
 * or it would hear its own voice from the speakers.
 */
export const SpeechToSpeechStudio: React.FC<StudioCanvasProps> = ({
	mode,
	model,
	items,
	ensureModelReady,
	isNarrow,
}) => {
	const { t } = useTranslation("studio");
	const deleteItem = useStudioStore((store) => store.deleteItem);
	const microphone = useMicrophoneStream();
	const player = usePcmStreamPlayer();
	const [phase, setPhaseState] = useState<ConversationPhase>("idle");
	const [error, setError] = useState<string | null>(null);

	const phaseRef = useRef<ConversationPhase>("idle");
	const sessionRef = useRef<string | null>(null);
	const controllerRef = useRef<AbortController | null>(null);
	const detectorRef = useRef(new VoiceActivityDetector());

	// Microphone callbacks outlive the render that started them.
	const latestRef = useRef({
		model,
		ensureModelReady,
		enqueue: player.enqueue,
	});
	latestRef.current = { model, ensureModelReady, enqueue: player.enqueue };

	const setPhase = useCallback((next: ConversationPhase) => {
		phaseRef.current = next;
		setPhaseState(next);
	}, []);

	const respond = useCallback(
		async (samples: Float32Array, sampleRate: number) => {
			const session = sessionRef.current;
			if (!session || samples.length === 0) return;
			setPhase("responding");
			setError(null);
			const controller = new AbortController();
			controllerRef.current = controller;
			try {
				const ready = await latestRef.current.ensureModelReady();
				const file = await saveStudioInput(
					new Blob([encodeWav(samples, sampleRate).slice().buffer], {
						type: "audio/wav",
					}),
					"audio",
				);
				await respondToSpeech({
					model: ready,
					session,
					file,
					durationMs: Math.round((samples.length / sampleRate) * 1000),
					signal: controller.signal,
					onAudio: (event) => {
						if (controller.signal.aborted) return;
						latestRef.current.enqueue(event.audio, event.sample_rate);
					},
				});
			} catch (reason) {
				if (!isCancellation(reason) && sessionRef.current === session) {
					logError("Spoken response failed:", reason);
					setError(reason instanceof Error ? reason.message : String(reason));
				}
			} finally {
				if (controllerRef.current === controller) controllerRef.current = null;
				if (sessionRef.current === session) setPhase("speaking");
			}
		},
		[setPhase],
	);

	const handleSamples = useCallback(
		(samples: Float32Array, sampleRate: number) => {
			const current = phaseRef.current;
			if (current !== "listening" && current !== "hearing") return;
			const event = detectorRef.current.push(samples, sampleRate);
			if (event === "speech-start") setPhase("hearing");
			if (event === "turn-end") {
				void respond(detectorRef.current.takeTurn(), sampleRate);
			}
		},
		[respond, setPhase],
	);

	const startMicrophone = microphone.start;
	const stopMicrophone = microphone.stop;
	const stopPlayback = player.stop;

	const start = async () => {
		setError(null);
		setPhase("starting");
		try {
			await ensureModelReady();
			detectorRef.current.reset();
			sessionRef.current = v4();
			if (!(await startMicrophone(handleSamples))) {
				sessionRef.current = null;
				setPhase("idle");
				return;
			}
			setPhase("listening");
		} catch (reason) {
			sessionRef.current = null;
			setPhase("idle");
			setError(reason instanceof Error ? reason.message : String(reason));
		}
	};

	const end = useCallback(() => {
		const session = sessionRef.current;
		sessionRef.current = null;
		stopMicrophone();
		controllerRef.current?.abort();
		controllerRef.current = null;
		stopPlayback();
		setPhase("idle");
		if (session) {
			const { model: active } = latestRef.current;
			void serviceManager.llmService
				.closeRealtimeSessionFor(active.serviceName, {
					model: active.modelId,
					session,
				})
				.catch(() => undefined);
		}
	}, [setPhase, stopMicrophone, stopPlayback]);

	const stopReply = () => {
		controllerRef.current?.abort();
		stopPlayback();
	};

	// A session belongs to one model.
	// biome-ignore lint/correctness/useExhaustiveDependencies: ends when the model changes.
	useEffect(() => end, [end, model.serviceName, model.modelId]);

	useEffect(() => {
		if (phase !== "speaking" || player.playing) return;
		const timer = window.setTimeout(() => {
			detectorRef.current.reset();
			setPhase("listening");
		}, LISTEN_AGAIN_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [phase, player.playing, setPhase]);

	const active = phase !== "idle" && phase !== "starting";
	const answering = phase === "responding" || phase === "speaking";
	const blocked = microphone.state === "denied";

	const status = blocked
		? t("speechToSpeech.denied", {
				defaultValue:
					"Microphone access is blocked. Allow it in your browser settings.",
			})
		: {
				idle: t("speechToSpeech.idle", {
					defaultValue: "Press the microphone and start talking.",
				}),
				starting: t("speechToSpeech.starting", {
					defaultValue: "Getting ready…",
				}),
				listening: t("speechToSpeech.listening", {
					defaultValue: "Listening…",
				}),
				hearing: t("speechToSpeech.hearing", {
					defaultValue: "Hearing you…",
				}),
				responding: t("speechToSpeech.responding", {
					defaultValue: "Answering…",
				}),
				speaking: t("speechToSpeech.speaking", {
					defaultValue: "Speaking…",
				}),
			}[phase];

	return (
		<div
			className="relative flex h-full min-h-0 flex-col"
			data-studio-canvas={mode}
			data-speech-to-speech-phase={phase}
		>
			<StudioThread empty={items.length === 0} isNarrow={isNarrow}>
				{items.length === 0 ? (
					<WorkspaceEmptyState
						compact={isNarrow}
						visual={
							<WorkspaceEmptyVisual
								icon={studioModeDescriptor(mode).icon}
								compact={isNarrow}
							/>
						}
						title={t("speechToSpeech.emptyTitle", {
							defaultValue: "Talk with your model",
						})}
						description={t("speechToSpeech.empty", {
							defaultValue:
								"Start a conversation and speak naturally. The model answers out loud when you pause.",
						})}
						suggestions={[]}
					/>
				) : (
					items.map((item) => (
						<SpeechTurnCard
							key={item.id}
							item={item}
							onDelete={(target) => void deleteItem(mode, target.id)}
						/>
					))
				)}
			</StudioThread>

			<StudioComposer
				hideSubmit
				running={answering}
				onStop={stopReply}
				stopLabel={t("speechToSpeech.stopReply", {
					defaultValue: "Stop the reply",
				})}
				stopProps={{ "data-speech-to-speech-stop": true }}
				data-speech-to-speech-composer
			>
				<div className="flex items-center gap-3 px-3 py-2">
					<RecordButton
						state={
							phase === "starting"
								? "requesting"
								: active
									? "recording"
									: microphone.state
						}
						level={
							phase === "listening" || phase === "hearing"
								? microphone.level
								: 0
						}
						size="compact"
						disabled={phase === "starting"}
						startLabel={t("speechToSpeech.start", {
							defaultValue: "Start the conversation",
						})}
						stopLabel={t("speechToSpeech.end", {
							defaultValue: "End the conversation",
						})}
						onStart={() => void start()}
						onStop={end}
					/>
					<div className="min-w-0 flex-1">
						<p
							className="truncate text-sm text-muted-foreground"
							role="status"
							aria-live="polite"
							data-speech-to-speech-status
						>
							{status}
						</p>
						{error ? (
							<p
								className="mt-0.5 break-words text-xs text-destructive"
								role="alert"
								data-speech-to-speech-error
							>
								{error}
							</p>
						) : null}
					</div>
					<LiveLevelMeter analyser={player.analyser} active={player.playing} />
				</div>
			</StudioComposer>
		</div>
	);
};
