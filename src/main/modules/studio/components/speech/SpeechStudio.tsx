import { Sparkles } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	WorkspaceEmptyState,
	WorkspaceEmptyVisual,
} from "@/main/components/molecules/WorkspaceEmptyState";
import { useStudioStore } from "@/main/stores/studio";
import type { StudioItem } from "@/types/studio";
import { logError } from "@/utils/logger";
import { usePcmStreamPlayer } from "../../hooks/use-pcm-stream-player";
import { generateSpeech, isCancellation } from "../../services/studio-service";
import { isResidentLocalProvider } from "@/services/llm/provider-registry";
import { voicesOf } from "../../studio-model-info";
import { studioModeDescriptor } from "../../studio-modes";
import { StudioThread } from "../shared/StudioThread";
import type { StudioCanvasProps } from "../studio-canvas";
import { SpeechClipCard } from "./SpeechClipCard";
import { SpeechComposer } from "./SpeechComposer";
import type { SpeechSettingsValue } from "./SpeechSettings";
import {
	DEFAULT_MUSIC_DURATION,
	DEFAULT_SPEED,
	initialVoiceFor,
	MUSIC_EXAMPLES,
	paramsOf,
	promptOf,
	readLivePlayback,
	rememberLivePlayback,
	rememberVoice,
	speechExamplesFor,
} from "./speech-studio-utils";

interface SpeechRequest {
	input: string;
	voice: string;
	speed?: number;
	instructions?: string;
	seed?: number;
	duration?: number;
}

const toSeed = (value: string): number | undefined => {
	if (value.trim() === "") return undefined;
	const seed = Number(value);
	return Number.isInteger(seed) && seed >= 0 ? seed : undefined;
};

/**
 * Text-to-speech and text-to-music studio.
 *
 * Laid out like a chat - clips oldest-first above a pinned composer - because
 * it lives next to the chat and the loop is the same: write, hear, tweak,
 * write again. Speech is played while it streams, since a local CPU model can
 * take longer than the clip itself and silence until the end feels broken.
 */
export const SpeechStudio: React.FC<StudioCanvasProps> = ({
	mode,
	model,
	modelInfo,
	items,
	ensureModelReady,
	isNarrow,
}) => {
	const { t } = useTranslation("studioSpeech");
	const deleteItem = useStudioStore((store) => store.deleteItem);
	const isMusic = mode === "text-to-audio";

	const voices = useMemo(() => voicesOf(modelInfo), [modelInfo]);
	// Optional request fields: sent when filled in, ignored by models that do
	// not use them.
	const showInstructions = !isMusic;
	const showSeed = !isMusic;

	const [text, setText] = useState("");
	const [voice, setVoice] = useState(() => initialVoiceFor(model, voices));
	const [settings, setSettings] = useState<SpeechSettingsValue>({
		speed: DEFAULT_SPEED,
		instructions: "",
		seed: "",
	});
	const [duration, setDuration] = useState(DEFAULT_MUSIC_DURATION);
	const [running, setRunning] = useState(false);
	const [livePlayback, setLivePlayback] = useState(readLivePlayback);
	const [announcement, setAnnouncement] = useState("");

	const controllerRef = useRef<AbortController | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const mountedRef = useRef(true);
	const liveRef = useRef(livePlayback);
	liveRef.current = livePlayback;

	const player = usePcmStreamPlayer();
	// Chunks arrive through a callback captured when generation started; read the
	// latest `enqueue` so chunks after the first go through the analyser too.
	const enqueueRef = useRef(player.enqueue);
	enqueueRef.current = player.enqueue;
	const stopPlayback = player.stop;

	// A different model has different voices; keep the remembered one for it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `voices` follows the model.
	useEffect(() => {
		setVoice(initialVoiceFor(model, voices));
	}, [model.modelId, model.provider, voices]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			// The generation itself keeps going and still lands in history; only
			// its live audio stops, because nothing on screen could stop it.
			mountedRef.current = false;
		};
	}, []);

	const run = useCallback(
		async (request: SpeechRequest) => {
			if (controllerRef.current) return;
			const controller = new AbortController();
			controllerRef.current = controller;
			setRunning(true);
			setAnnouncement("");
			stopPlayback();
			try {
				const ready = await ensureModelReady();
				if (controller.signal.aborted) return;
				await generateSpeech({
					mode: isMusic ? "text-to-audio" : "text-to-speech",
					model: ready,
					input: request.input,
					voice: request.voice,
					speed: request.speed,
					instructions: request.instructions,
					seed: request.seed,
					duration: request.duration,
					signal: controller.signal,
					onDelta: (event) => {
						if (!mountedRef.current || !liveRef.current) return;
						enqueueRef.current(event.audio, event.sample_rate);
					},
				});
				if (mountedRef.current) {
					setAnnouncement(
						t("announce.done", { defaultValue: "Generation finished" }),
					);
				}
			} catch (error) {
				if (!mountedRef.current) return;
				if (isCancellation(error)) {
					setAnnouncement(
						t("announce.stopped", { defaultValue: "Generation stopped" }),
					);
				} else {
					logError("Speech generation failed:", error);
					setAnnouncement(
						t("announce.failed", { defaultValue: "Generation failed" }),
					);
				}
			} finally {
				if (controllerRef.current === controller) controllerRef.current = null;
				if (mountedRef.current) setRunning(false);
			}
		},
		[ensureModelReady, isMusic, stopPlayback, t],
	);

	const generate = () => {
		const input = text.trim();
		if (!input) return;
		// Sent like a chat message: the box clears, and the turn's Reuse action
		// brings the text back to try another voice or speed.
		setText("");
		if (isMusic) {
			void run({ input, voice: "default", duration });
			return;
		}
		void run({
			input,
			// A single-speaker model has no voices and ignores the name.
			voice: voice.trim() || "default",
			speed: settings.speed,
			instructions:
				showInstructions && settings.instructions.trim()
					? settings.instructions.trim()
					: undefined,
			seed: showSeed ? toSeed(settings.seed) : undefined,
		});
	};

	const stop = () => {
		controllerRef.current?.abort();
		stopPlayback();
	};

	const retry = (item: StudioItem) => {
		const params = paramsOf(item);
		void run({
			input: promptOf(item),
			voice: params.voice ?? (isMusic ? "default" : voice),
			speed: params.speed,
			instructions: params.instructions,
			seed: params.seed,
			duration: params.duration,
		});
	};

	const reuse = (item: StudioItem) => {
		const params = paramsOf(item);
		setText(promptOf(item));
		if (isMusic && params.duration) setDuration(params.duration);
		if (!isMusic) {
			if (params.voice) {
				setVoice(params.voice);
			}
			setSettings((current) => ({
				speed: params.speed ?? DEFAULT_SPEED,
				instructions: params.instructions ?? current.instructions,
				seed: params.seed !== undefined ? String(params.seed) : current.seed,
			}));
		}
		textareaRef.current?.focus();
	};

	const changeVoice = (next: string) => {
		setVoice(next);
		rememberVoice(model, next);
	};

	const changeLivePlayback = (enabled: boolean) => {
		setLivePlayback(enabled);
		rememberLivePlayback(enabled);
		if (!enabled) stopPlayback();
	};

	const fillExample = (example: string) => {
		setText(example);
		textareaRef.current?.focus();
	};

	const examples = isMusic ? MUSIC_EXAMPLES : speechExamplesFor(modelInfo);

	return (
		<div
			className="relative flex h-full min-h-0 flex-col"
			data-studio-canvas={mode}
			data-speech-running={running ? "true" : "false"}
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
						title={
							isMusic
								? t("empty.musicTitle", { defaultValue: "Create audio" })
								: t("empty.speechTitle", {
										defaultValue: "Turn text into speech",
									})
						}
						description={
							isMusic
								? t("empty.music", {
										defaultValue: "Describe a short piece of audio or music.",
									})
								: t("empty.speech", {
										defaultValue:
											"Type something below, choose a voice and press Generate. You will hear it while it is being made.",
									})
						}
						suggestions={examples.map((example) => ({
							key: example,
							label: example,
							icon: Sparkles,
							attributes: { "data-example-prompt": "" },
							onSelect: () => fillExample(example),
						}))}
						columns={2}
					/>
				) : (
					items.map((item) => (
						<SpeechClipCard
							key={item.id}
							item={item}
							isMusic={isMusic}
							isNarrow={isNarrow}
							busy={running}
							onReuse={reuse}
							onRetry={retry}
							onDelete={(target) => void deleteItem(mode, target.id)}
						/>
					))
				)}
			</StudioThread>

			<SpeechComposer
				isMusic={isMusic}
				isNarrow={isNarrow}
				text={text}
				onTextChange={setText}
				voices={voices}
				voice={voice}
				onVoiceChange={changeVoice}
				// On-device models list every voice they have; one that lists none
				// has a single speaker. Hosted APIs take a voice name they document.
				duration={duration}
				onDurationChange={setDuration}
				asksVoiceName={
					voices.length === 0 && !isResidentLocalProvider(model.provider)
				}
				settings={settings}
				onSettingsChange={(patch) =>
					setSettings((current) => ({ ...current, ...patch }))
				}
				showInstructions={showInstructions}
				showSeed={showSeed}
				// Hosted APIs reject long input; local models just take longer.
				enforceLimit={!isResidentLocalProvider(model.provider)}
				running={running}
				onGenerate={generate}
				onStop={stop}
				livePlayback={livePlayback}
				onLivePlaybackChange={changeLivePlayback}
				playing={player.playing}
				analyser={player.analyser}
				examples={items.length > 0 ? MUSIC_EXAMPLES : undefined}
				textareaRef={textareaRef}
			/>

			<div
				className="sr-only"
				aria-live="polite"
				role="status"
				data-speech-announcer
			>
				{announcement}
			</div>
		</div>
	);
};
