import { Mic, Upload } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	WorkspaceEmptyState,
	WorkspaceEmptyVisual,
	type WorkspaceSuggestion,
} from "@/main/components/molecules/WorkspaceEmptyState";
import { useStudioStore } from "@/main/stores/studio";
import type { MediaPayload } from "@/types/openai-media";
import type { StudioItem } from "@/types/studio";
import { useAudioRecorder } from "../../hooks/use-audio-recorder";
import {
	isCancellation,
	saveStudioInput,
	transcribeAudio,
} from "../../services/studio-service";
import { StudioThread } from "../shared/StudioThread";
import type { StudioCanvasProps } from "../studio-canvas";
import { TranscriptCard } from "./TranscriptCard";
import {
	type ComposerError,
	type ComposerRun,
	TranscriptionComposer,
	type TranscriptionComposerHandle,
} from "./TranscriptionComposer";
import { formatBytes, formatClock, readTranscript } from "./transcript-format";
import {
	isAcceptedAudio,
	isMultilingualModel,
	MAX_UPLOAD_BYTES,
	supportsTranslation,
	type TranscriptionTask,
} from "./transcription-options";

interface ActiveRun extends ComposerRun {
	controller: AbortController;
	/** Partial transcript from `onDelta`, shown before the store catches up. */
	liveText?: string;
}

interface PreparedInput {
	file: Extract<MediaPayload, { kind: "file" }>;
	fileName?: string;
	durationMs?: number;
	language?: string;
	task?: TranscriptionTask;
}

interface RunRequest {
	label: string;
	prepare: () => Promise<PreparedInput>;
	/** A failed or stopped item this run supersedes; removed once the new one is recorded. */
	replaces?: StudioItem;
	/** Offered when the run fails before an item exists, so the input is not lost. */
	retry?: () => void;
}

const abortError = () =>
	new DOMException("The transcription was stopped.", "AbortError");

/**
 * Length of an uploaded file, for the card header and single-cue subtitles.
 * Best effort: unknown formats and environments without object URLs just
 * leave it blank.
 */
function probeDuration(file: Blob): Promise<number | undefined> {
	if (
		typeof URL.createObjectURL !== "function" ||
		typeof Audio === "undefined"
	) {
		return Promise.resolve(undefined);
	}
	const audio = new Audio();
	// A type the browser cannot play never fires loadedmetadata; skip the wait.
	if (file.type && !audio.canPlayType(file.type))
		return Promise.resolve(undefined);
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const finish = (value: number | undefined) => {
			clearTimeout(timer);
			audio.removeAttribute("src");
			URL.revokeObjectURL(url);
			resolve(value);
		};
		const timer = setTimeout(() => finish(undefined), 4000);
		audio.preload = "metadata";
		audio.onloadedmetadata = () =>
			finish(
				Number.isFinite(audio.duration) && audio.duration > 0
					? Math.round(audio.duration * 1000)
					: undefined,
			);
		audio.onerror = () => finish(undefined);
		audio.src = url;
	});
}

/**
 * Speech to text: record or upload, then read, correct and export the
 * transcript. Laid out like a chat: each clip is the user's message and its
 * transcript the reply, with the mic and the upload button in the composer
 * dock under the thread.
 */
export const TranscriptionStudio: React.FC<StudioCanvasProps> = ({
	mode,
	model,
	modelInfo,
	items,
	ensureModelReady,
	isNarrow,
}) => {
	const { t } = useTranslation("studioTranscription");
	const recorder = useAudioRecorder();
	const [language, setLanguage] = useState("auto");
	const [task, setTask] = useState<TranscriptionTask>("transcribe");
	const [run, setRun] = useState<ActiveRun | null>(null);
	const runRef = useRef<AbortController | null>(null);
	const [error, setError] = useState<ComposerError | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const [dragging, setDragging] = useState(false);
	const dragDepthRef = useRef(0);
	const composerRef = useRef<TranscriptionComposerHandle>(null);

	const multilingual = isMultilingualModel(modelInfo);
	const canTranslate = supportsTranslation(modelInfo);
	// Options the model cannot honour are not sent, even if picked earlier.
	const effectiveLanguage =
		multilingual && language !== "auto" ? language : undefined;
	const effectiveTask = canTranslate ? task : undefined;

	useEffect(() => {
		if (recorder.state === "recording") {
			setAnnouncement(
				t("announce.recording", { defaultValue: "Recording started" }),
			);
		} else if (recorder.state === "denied") {
			setAnnouncement(
				t("announce.denied", { defaultValue: "Microphone access is blocked" }),
			);
		}
	}, [recorder.state, t]);

	const execute = async (request: RunRequest) => {
		if (runRef.current) return;
		const controller = new AbortController();
		runRef.current = controller;
		setError(null);
		setRun({ controller, label: request.label, phase: "preparing" });
		setAnnouncement(
			t("announce.transcribing", { defaultValue: "Transcribing" }),
		);
		let recorded = false;
		try {
			const ready = await ensureModelReady();
			if (controller.signal.aborted) throw abortError();
			const prepared = await request.prepare();
			if (controller.signal.aborted) throw abortError();
			setRun((current) =>
				current?.controller === controller
					? { ...current, phase: "transcribing" }
					: current,
			);
			const pending = transcribeAudio({
				model: ready,
				...prepared,
				signal: controller.signal,
				onDelta: (textSoFar) =>
					setRun((current) =>
						current?.controller === controller
							? { ...current, liveText: textSoFar }
							: current,
					),
			});
			// From here the service owns the outcome: failures land on the card.
			recorded = true;
			if (request.replaces) {
				void useStudioStore.getState().deleteItem(mode, request.replaces.id);
			}
			await pending;
			setAnnouncement(t("announce.done", { defaultValue: "Transcript ready" }));
		} catch (reason) {
			if (isCancellation(reason) || controller.signal.aborted) {
				setAnnouncement(
					t("announce.stopped", { defaultValue: "Transcription stopped" }),
				);
			} else {
				setAnnouncement(
					t("announce.failed", { defaultValue: "Transcription failed" }),
				);
				if (!recorded) {
					const message =
						reason instanceof Error ? reason.message : String(reason);
					setError({
						message: t("progress.failedToStart", {
							error: message,
							defaultValue: `Could not start: ${message}`,
						}),
						onRetry: request.retry,
					});
				}
			}
		} finally {
			// Leaving the canvas does not abort: the service keeps writing the
			// card, so switching tabs mid-transcript loses nothing.
			if (runRef.current === controller) {
				runRef.current = null;
				setRun(null);
			}
		}
	};

	const transcribeBlob = (
		blob: Blob,
		meta: { label: string; name?: string; durationMs?: number },
	) => {
		const options = { language: effectiveLanguage, task: effectiveTask };
		const request: RunRequest = {
			label: meta.label,
			prepare: async () => {
				const [file, probed] = await Promise.all([
					saveStudioInput(blob, "audio"),
					meta.durationMs === undefined ? probeDuration(blob) : meta.durationMs,
				]);
				return {
					file,
					fileName: meta.name,
					durationMs: probed,
					...options,
				};
			},
		};
		request.retry = () => void execute(request);
		void execute(request);
	};

	const handleFile = (file: File) => {
		if (runRef.current || recorder.state === "recording") return;
		const size = formatBytes(file.size);
		if (!isAcceptedAudio(file)) {
			setError({
				message: t("upload.unsupported", {
					name: file.name,
					defaultValue: `${file.name} is not an audio or video file.`,
				}),
			});
			return;
		}
		if (file.size > MAX_UPLOAD_BYTES) {
			setError({
				message: t("upload.tooLarge", {
					name: file.name,
					size,
					defaultValue: `${file.name} is ${size}. Files up to 100 MB are supported.`,
				}),
			});
			return;
		}
		transcribeBlob(file, { label: `${file.name} · ${size}`, name: file.name });
	};

	const stopRecording = async () => {
		const durationMs = recorder.elapsedMs;
		const blob = await recorder.stop();
		if (!blob || blob.size === 0) {
			setError({
				message: t("record.empty", {
					defaultValue: "Nothing was recorded. Try again.",
				}),
			});
			return;
		}
		const clock = formatClock(durationMs / 1000);
		transcribeBlob(blob, {
			label: `${t("card.recording", { defaultValue: "Recording" })} · ${clock}`,
			durationMs: durationMs > 0 ? durationMs : undefined,
		});
	};

	const retryItem = (item: StudioItem) => {
		const audio = readTranscript(item).audio;
		if (!audio) return;
		const params = (item.generation.params ?? {}) as {
			language?: unknown;
			task?: unknown;
		};
		void execute({
			label: audio.name || t("card.recording", { defaultValue: "Recording" }),
			// Keep a finished transcript when re-running it; a failed one is just noise.
			replaces: item.generation.status === "done" ? undefined : item,
			prepare: async () => ({
				file: { kind: "file", path: audio.path, mimeType: audio.mimeType },
				fileName: audio.name,
				durationMs: audio.durationMs,
				language:
					multilingual && typeof params.language === "string"
						? params.language
						: undefined,
				task: canTranslate
					? params.task === "translate"
						? "translate"
						: "transcribe"
					: undefined,
			}),
		});
	};

	const stopRun = () => runRef.current?.abort();

	const activeItemId = run
		? [...items].reverse().find((item) => item.generation.status === "running")
				?.id
		: undefined;

	const hasFiles = (event: React.DragEvent) =>
		Array.from(event.dataTransfer?.types ?? []).includes("Files");

	const idle = run === null && recorder.state !== "recording";
	const suggestions: WorkspaceSuggestion[] = [
		...(recorder.state === "unsupported"
			? []
			: [
					{
						key: "record",
						label: t("empty.record", {
							defaultValue: "Record from microphone",
						}),
						icon: Mic,
						attributes: { "data-transcription-suggestion": "record" },
						onSelect: () => {
							if (idle && recorder.state !== "requesting")
								void recorder.start();
						},
					},
				]),
		{
			key: "upload",
			label: t("empty.upload", { defaultValue: "Upload an audio file" }),
			icon: Upload,
			attributes: { "data-transcription-suggestion": "upload" },
			onSelect: () => {
				if (idle) composerRef.current?.openFilePicker();
			},
		},
	];

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a file drop target and an Escape shortcut; the upload and record buttons are the keyboard paths.
		<div
			className="relative flex h-full min-h-0 flex-col"
			data-studio-canvas={mode}
			onKeyDown={(event) => {
				if (event.key === "Escape" && recorder.state === "recording") {
					event.preventDefault();
					recorder.cancel();
				}
			}}
			onDragEnter={(event) => {
				if (!hasFiles(event)) return;
				event.preventDefault();
				dragDepthRef.current += 1;
				setDragging(true);
			}}
			onDragOver={(event) => {
				if (hasFiles(event)) event.preventDefault();
			}}
			onDragLeave={() => {
				dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
				if (dragDepthRef.current === 0) setDragging(false);
			}}
			onDrop={(event) => {
				event.preventDefault();
				dragDepthRef.current = 0;
				setDragging(false);
				const file = event.dataTransfer?.files?.[0];
				if (file) handleFile(file);
			}}
		>
			<div
				className="sr-only"
				aria-live="polite"
				aria-atomic
				data-transcription-announcer
			>
				{announcement}
			</div>

			<StudioThread empty={items.length === 0} isNarrow={isNarrow}>
				{items.length === 0 ? (
					<WorkspaceEmptyState
						compact={isNarrow}
						visual={<WorkspaceEmptyVisual icon={Mic} compact={isNarrow} />}
						title={t("empty.title", { defaultValue: "Record or upload audio" })}
						description={t("empty.description", {
							defaultValue:
								"Get a transcript with timestamps. Click a timestamp to hear that moment.",
						})}
						suggestions={suggestions}
						columns={2}
					>
						<p
							className="text-center text-xs text-muted-foreground"
							data-transcription-dropzone
						>
							{t("upload.drop", {
								defaultValue: "Drop an audio or video file here",
							})}
							{" · "}
							{t("upload.limit", {
								defaultValue: "Audio or video, up to 100 MB",
							})}
						</p>
					</WorkspaceEmptyState>
				) : (
					items.map((item) => (
						<TranscriptCard
							key={item.id}
							mode={mode}
							item={item}
							liveText={item.id === activeItemId ? run?.liveText : undefined}
							onStop={item.id === activeItemId ? stopRun : undefined}
							onRetry={retryItem}
							busy={run !== null}
							isNarrow={isNarrow}
						/>
					))
				)}
			</StudioThread>

			<TranscriptionComposer
				ref={composerRef}
				recorder={recorder}
				run={run ? { label: run.label, phase: run.phase } : null}
				error={error}
				onDismissError={() => setError(null)}
				onStopRecording={() => void stopRecording()}
				onFile={handleFile}
				onStopRun={stopRun}
				language={language}
				onLanguageChange={setLanguage}
				task={task}
				onTaskChange={setTask}
				multilingual={multilingual}
				canTranslate={canTranslate}
				isNarrow={isNarrow}
			/>

			{dragging ? (
				<div
					className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-background/90 text-sm font-medium"
					data-transcription-drop-overlay
				>
					<Upload size={20} className="text-primary" aria-hidden />
					{run
						? t("upload.busy", {
								defaultValue: "Wait for the current transcript to finish",
							})
						: t("upload.dropOverlay", { defaultValue: "Drop to transcribe" })}
				</div>
			) : null}
		</div>
	);
};
