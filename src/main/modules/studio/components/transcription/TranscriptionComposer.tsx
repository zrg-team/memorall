import { AlertTriangle, FileAudio, Languages, Upload, X } from "lucide-react";
import { forwardRef, useId, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import type { useAudioRecorder } from "../../hooks/use-audio-recorder";
import { COMPOSER_CONTROL, StudioComposer } from "../shared/StudioComposer";
import { RecordButton } from "./RecordButton";
import { formatClock } from "./transcript-format";
import {
	AUDIO_ACCEPT,
	TRANSCRIPTION_LANGUAGES,
	type TranscriptionTask,
} from "./transcription-options";

export interface ComposerRun {
	/** What is being transcribed, e.g. "interview.mp3 · 4.2 MB". */
	label: string;
	phase: "preparing" | "transcribing";
}

export interface ComposerError {
	message: string;
	/** Present when the input was kept and can be sent again. */
	onRetry?: () => void;
}

export interface TranscriptionComposerHandle {
	/** Opens the file picker (the empty state's "Upload" suggestion). */
	openFilePicker: () => void;
}

interface TranscriptionComposerProps {
	recorder: ReturnType<typeof useAudioRecorder>;
	run: ComposerRun | null;
	error: ComposerError | null;
	onDismissError: () => void;
	onStopRecording: () => void;
	onFile: (file: File) => void;
	onStopRun: () => void;
	language: string;
	onLanguageChange: (language: string) => void;
	task: TranscriptionTask;
	onTaskChange: (task: TranscriptionTask) => void;
	multilingual: boolean;
	canTranslate: boolean;
	isNarrow: boolean;
}

/**
 * Everything that starts a transcription, in chat's composer dock: the mic
 * (or the recording / run in progress) where chat has its textarea, and the
 * upload button and the two options in the toolbar. There is no send button:
 * stopping a recording or choosing a file starts the run.
 */
export const TranscriptionComposer = forwardRef<
	TranscriptionComposerHandle,
	TranscriptionComposerProps
>(
	(
		{
			recorder,
			run,
			error,
			onDismissError,
			onStopRecording,
			onFile,
			onStopRun,
			language,
			onLanguageChange,
			task,
			onTaskChange,
			multilingual,
			canTranslate,
			isNarrow,
		},
		ref,
	) => {
		const { t } = useTranslation("studioTranscription");
		const fileInputRef = useRef<HTMLInputElement>(null);
		const languageSelectId = useId();
		const recording = recorder.state === "recording";
		const busy = run !== null;

		const openPicker = () => fileInputRef.current?.click();

		useImperativeHandle(ref, () => ({ openFilePicker: openPicker }));

		const recorderNotice =
			recorder.state === "denied" ? (
				<p
					className="flex items-start gap-1.5 text-xs text-destructive"
					role="alert"
					data-recorder-notice="denied"
				>
					<AlertTriangle size={13} className="mt-0.5 shrink-0" />
					<span>
						{t("record.denied", {
							defaultValue:
								"Microphone access is blocked. Open the site settings (the icon next to the address bar), allow the microphone, then press the button again.",
						})}
					</span>
				</p>
			) : recorder.state === "unsupported" ? (
				<p
					className="text-xs text-muted-foreground"
					data-recorder-notice="unsupported"
				>
					{t("record.unsupported", {
						defaultValue:
							"Recording is not available here. Upload a file instead.",
					})}
				</p>
			) : null;

		const errorNotice = error ? (
			<div
				role="alert"
				className="flex min-w-0 items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
				data-transcription-error
			>
				<AlertTriangle size={13} className="mt-0.5 shrink-0" />
				<span className="min-w-0 flex-1 break-words">{error.message}</span>
				{error.onRetry ? (
					<button
						type="button"
						className="shrink-0 font-medium underline-offset-2 hover:underline"
						onClick={error.onRetry}
					>
						{t("progress.tryAgain", { defaultValue: "Try again" })}
					</button>
				) : null}
				<button
					type="button"
					className="shrink-0 text-destructive/80 hover:text-destructive"
					onClick={onDismissError}
					aria-label={t("progress.dismiss", { defaultValue: "Dismiss" })}
				>
					<X size={13} />
				</button>
			</div>
		) : null;

		const above =
			errorNotice || recorderNotice ? (
				<div className="flex flex-col gap-2 px-1">
					{errorNotice}
					{recorderNotice}
				</div>
			) : null;

		// The card body: what chat's textarea is, at the textarea's height.
		const body = run ? (
			<div
				className="flex min-h-[72px] min-w-0 flex-col justify-center gap-1.5 px-3 py-2 sm:px-4"
				data-transcription-run={run.phase}
			>
				<div className="flex min-w-0 items-center gap-2 text-sm">
					<FileAudio
						size={15}
						className="shrink-0 text-muted-foreground"
						aria-hidden
					/>
					<span className="min-w-0 flex-1 truncate" title={run.label}>
						{run.label}
					</span>
					<span className="shrink-0 text-xs text-muted-foreground">
						{run.phase === "preparing"
							? t("progress.preparing", { defaultValue: "Preparing…" })
							: t("progress.transcribing", { defaultValue: "Transcribing…" })}
					</span>
				</div>
				{/* Indeterminate: neither local nor hosted models report progress. */}
				<div
					role="progressbar"
					aria-label={t("progress.transcribing", {
						defaultValue: "Transcribing…",
					})}
					className="h-1 w-full overflow-hidden rounded-full bg-muted"
				>
					<div className="h-full w-full rounded-full bg-primary/70 motion-safe:animate-pulse" />
				</div>
			</div>
		) : (
			<div className="flex min-h-[72px] min-w-0 items-center gap-2 px-3 sm:px-4">
				<RecordButton
					state={recorder.state}
					level={recorder.level}
					size="compact"
					onStart={() => void recorder.start()}
					onStop={onStopRecording}
				/>
				{recording ? (
					<div
						className="flex min-w-0 flex-1 items-center gap-2"
						data-recording-controls
					>
						<span className="flex items-center gap-1.5 text-sm tabular-nums">
							<span
								aria-hidden
								className="h-2 w-2 rounded-full bg-destructive motion-safe:animate-pulse"
							/>
							<span data-recording-elapsed>
								{formatClock(recorder.elapsedMs / 1000)}
							</span>
						</span>
						<div className="ml-auto flex shrink-0 items-center gap-1">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className={cn(COMPOSER_CONTROL, "px-2")}
								onClick={recorder.cancel}
								data-recording-cancel
							>
								<X size={14} />
								{t("record.cancel", { defaultValue: "Discard" })}
							</Button>
							<Button
								type="button"
								size="sm"
								className="h-8 rounded-xl px-3 text-xs"
								onClick={onStopRecording}
								data-recording-stop
							>
								{t("record.stopShort", { defaultValue: "Transcribe" })}
							</Button>
						</div>
					</div>
				) : (
					<span className="min-w-0 flex-1 truncate text-[15px] text-muted-foreground">
						{recorder.state === "requesting"
							? t("record.requesting", {
									defaultValue: "Waiting for microphone permission…",
								})
							: t("record.hint", { defaultValue: "Tap to record" })}
					</span>
				)}
			</div>
		);

		const tools = (
			<>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className={cn(COMPOSER_CONTROL, "min-w-0 shrink-0 gap-1.5 px-2")}
					onClick={openPicker}
					disabled={busy || recording}
					aria-label={t("upload.button", { defaultValue: "Upload audio" })}
					title={t("upload.limit", {
						defaultValue: "Audio or video, up to 100 MB",
					})}
					data-transcription-upload
				>
					<Upload size={14} />
					{isNarrow ? null : (
						<span className="truncate">
							{t("upload.button", { defaultValue: "Upload audio" })}
						</span>
					)}
				</Button>
				{multilingual ? (
					<label
						htmlFor={languageSelectId}
						className={cn(
							COMPOSER_CONTROL,
							"flex min-w-0 shrink items-center gap-1 px-2 hover:bg-accent",
						)}
						data-transcription-options
					>
						<Languages size={14} aria-hidden className="shrink-0" />
						<span className="sr-only">
							{t("options.language", { defaultValue: "Language" })}
						</span>
						<select
							id={languageSelectId}
							value={language}
							onChange={(event) => onLanguageChange(event.target.value)}
							disabled={busy}
							data-transcription-language
							className="h-full min-w-0 max-w-[9rem] cursor-pointer truncate bg-transparent text-xs text-inherit focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
						>
							<option value="auto">
								{t("options.auto", { defaultValue: "Auto-detect" })}
							</option>
							{TRANSCRIPTION_LANGUAGES.map((entry) => (
								<option key={entry.code} value={entry.code}>
									{entry.name}
								</option>
							))}
						</select>
					</label>
				) : (
					<span
						className="min-w-0 truncate px-1 text-[11px] text-muted-foreground"
						title={t("options.englishOnly", {
							defaultValue: "This model understands English only.",
						})}
						data-english-only
					>
						{t("options.englishOnly", {
							defaultValue: "This model understands English only.",
						})}
					</span>
				)}
				{canTranslate ? (
					<fieldset
						className={cn(
							COMPOSER_CONTROL,
							"flex shrink-0 items-center gap-0.5 p-0.5 hover:text-muted-foreground disabled:opacity-50",
						)}
						data-transcription-task
						disabled={busy}
					>
						<legend className="sr-only">
							{t("options.task", { defaultValue: "Task" })}
						</legend>
						{(["transcribe", "translate"] as const).map((value) => (
							<button
								key={value}
								type="button"
								aria-pressed={task === value}
								onClick={() => onTaskChange(value)}
								data-task-option={value}
								className={cn(
									"h-full rounded-lg px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									task === value
										? "bg-accent font-medium text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{value === "transcribe"
									? t("options.transcribe", { defaultValue: "Transcribe" })
									: isNarrow
										? t("options.translateShort", {
												defaultValue: "To English",
											})
										: t("options.translate", {
												defaultValue: "Translate to English",
											})}
							</button>
						))}
					</fieldset>
				) : null}
			</>
		);

		return (
			<StudioComposer
				data-transcription-composer
				above={above}
				tools={tools}
				running={busy}
				onStop={onStopRun}
				hideSubmit
				stopLabel={t("progress.stop", { defaultValue: "Stop" })}
				stopProps={{ "data-transcription-stop": true }}
			>
				<input
					ref={fileInputRef}
					type="file"
					accept={AUDIO_ACCEPT}
					className="sr-only"
					tabIndex={-1}
					aria-hidden
					data-transcription-file-input
					onChange={(event) => {
						const file = event.target.files?.[0];
						// Reset so choosing the same file again still fires a change.
						event.target.value = "";
						if (file) onFile(file);
					}}
				/>
				{body}
			</StudioComposer>
		);
	},
);
TranscriptionComposer.displayName = "TranscriptionComposer";
