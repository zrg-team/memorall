import {
	Check,
	CircleStop,
	Copy,
	Download,
	FileAudio,
	MessageSquare,
	Mic,
	Pencil,
	RotateCcw,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import { Textarea } from "@/main/components/ui/textarea";
import { useStudioStore } from "@/main/stores/studio";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import type { MediaCategory } from "@/services/llm/interfaces/model-category";
import type { StudioItem } from "@/types/studio";
import { SaveToFilesAction } from "../shared/SaveToFilesAction";
import { StudioAction, StudioTurn } from "../shared/StudioThread";
import { TranscriptAudio, type TranscriptAudioHandle } from "./TranscriptAudio";
import {
	activeSegmentIndex,
	EXPORT_MIME_TYPES,
	exportBaseName,
	exportTranscript,
	formatClock,
	readTranscript,
	type TranscriptExportFormat,
	withTranscriptText,
} from "./transcript-format";
import { languageLabel } from "./transcription-options";

/** Past this many rows/lines the body collapses behind "Show more". */
const COLLAPSED_ROWS = 12;
const COLLAPSED_CHARS = 700;

export const CHAT_INSERT_TEXT_EVENT = "memorall:chat:insert-text";

interface TranscriptCardProps {
	mode: MediaCategory;
	item: StudioItem;
	/** Text streamed for the run this card belongs to, ahead of the store. */
	liveText?: string;
	/** Stops the run; set only on the card of the transcription in progress. */
	onStop?: () => void;
	onRetry: (item: StudioItem) => void;
	/** Another transcription is running, so retry must wait. */
	busy: boolean;
	isNarrow: boolean;
}

function downloadText(content: string, fileName: string, mimeType: string) {
	const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	anchor.rel = "noopener";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	// Revoking synchronously can cancel the download in Chromium.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * One transcription as a chat exchange: the clip is the user's message, the
 * transcript (timestamped when the model returned segments) is the reply, and
 * what to do with it sits in the reply's footer.
 */
export const TranscriptCard: React.FC<TranscriptCardProps> = ({
	mode,
	item,
	liveText,
	onStop,
	onRetry,
	busy,
	isNarrow,
}) => {
	const { t } = useTranslation("studioTranscription");
	const { t: tStudio } = useTranslation("studio");
	const view = readTranscript(item);
	const { status } = item.generation;
	const running = status === "running";
	const params = (item.generation.params ?? {}) as {
		language?: string;
		task?: string;
	};
	const text =
		running && liveText !== undefined && liveText.length >= view.text.length
			? liveText
			: view.text;
	const showSegments = !running && view.segments.length > 0 && !view.edited;

	const playerRef = useRef<TranscriptAudioHandle>(null);
	const [position, setPosition] = useState<{
		seconds: number;
		playing: boolean;
	}>({
		seconds: 0,
		playing: false,
	});
	const [expanded, setExpanded] = useState(false);
	const [copied, setCopied] = useState(false);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");

	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);

	const long = showSegments
		? view.segments.length > COLLAPSED_ROWS
		: text.length > COLLAPSED_CHARS || text.split("\n").length > COLLAPSED_ROWS;
	const collapsed = long && !expanded && !running;
	// Only highlight once the user has played something, so a fresh card is calm.
	const activeIndex =
		showSegments && (position.playing || position.seconds > 0)
			? activeSegmentIndex(view.segments, position.seconds)
			: -1;

	const title =
		view.audio?.name || t("card.recording", { defaultValue: "Recording" });
	const language = languageLabel(view.language ?? params.language);
	const durationMs = view.audio?.durationMs;
	const hasText = text.trim().length > 0;
	const settled = !running;

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
		} catch {
			// Clipboard can be denied (unfocused document); nothing useful to show.
		}
	};

	const exportAs = (format: TranscriptExportFormat) => {
		const content = exportTranscript(
			{ text, segments: view.segments, durationMs, edited: view.edited },
			format,
		);
		downloadText(
			content,
			`${exportBaseName(view.audio?.name)}.${format}`,
			EXPORT_MIME_TYPES[format],
		);
	};

	const saveEdit = () => {
		const next = draft.trim();
		setEditing(false);
		if (next === text.trim()) return;
		void useStudioStore.getState().updateItem(mode, item.id, {
			content: next,
			parts: withTranscriptText(item.parts, next),
		});
	};

	const sendToChat = () => {
		useWorkspaceModeStore.getState().setMode("chat");
		// Let the chat panel mount before it hears the event.
		setTimeout(() => {
			window.dispatchEvent(
				new CustomEvent(CHAT_INSERT_TEXT_EVENT, { detail: { text } }),
			);
		}, 0);
	};

	const chip = "rounded-md border border-border/40 bg-muted/50 px-2 py-0.5";

	const request = (
		<div
			className="flex w-[18rem] min-w-0 max-w-full flex-col gap-2 whitespace-normal"
			data-transcript-request
		>
			<div className="flex min-w-0 items-center gap-2">
				{view.audio?.name ? (
					<FileAudio
						size={15}
						className="shrink-0 text-muted-foreground"
						aria-hidden
					/>
				) : (
					<Mic
						size={15}
						className="shrink-0 text-muted-foreground"
						aria-hidden
					/>
				)}
				<h3
					className="min-w-0 flex-1 truncate text-sm font-medium"
					title={title}
				>
					{title}
				</h3>
				{durationMs ? (
					<span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
						{formatClock(durationMs / 1000)}
					</span>
				) : null}
			</div>
			{view.audio ? (
				<TranscriptAudio
					ref={playerRef}
					path={view.audio.path}
					mimeType={view.audio.mimeType}
					durationMs={durationMs}
					onPosition={(seconds, playing) => setPosition({ seconds, playing })}
				/>
			) : null}
		</div>
	);

	const details = (
		<>
			{language ? (
				<span className={chip} data-transcript-language>
					{language}
				</span>
			) : null}
			{params.task === "translate" ? (
				<span className={chip} data-transcript-translated>
					{t("card.translated", { defaultValue: "→ EN" })}
				</span>
			) : null}
		</>
	);

	const actions = (
		<>
			{running && onStop ? (
				<StudioAction
					icon={<CircleStop className="h-3.5 w-3.5" />}
					label={tStudio("common.stop", { defaultValue: "Stop" })}
					onClick={onStop}
					data-transcript-action="stop"
				/>
			) : null}
			{settled && hasText && !editing ? (
				<>
					<StudioAction
						icon={
							copied ? (
								<Check className="h-3.5 w-3.5 text-primary" />
							) : (
								<Copy className="h-3.5 w-3.5" />
							)
						}
						label={
							copied
								? tStudio("common.copied", { defaultValue: "Copied" })
								: tStudio("common.copy", { defaultValue: "Copy" })
						}
						iconOnly={isNarrow}
						onClick={() => void copy()}
						data-transcript-action="copy"
					/>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<StudioAction
								icon={<Download className="h-3.5 w-3.5" />}
								label={t("card.export", { defaultValue: "Export" })}
								iconOnly={isNarrow}
								data-transcript-action="export"
							/>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start">
							<DropdownMenuItem
								onSelect={() => exportAs("txt")}
								data-export-format="txt"
							>
								{t("card.exportTxt", { defaultValue: "Text (.txt)" })}
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => exportAs("srt")}
								data-export-format="srt"
							>
								{t("card.exportSrt", { defaultValue: "Subtitles (.srt)" })}
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => exportAs("vtt")}
								data-export-format="vtt"
							>
								{t("card.exportVtt", { defaultValue: "WebVTT (.vtt)" })}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<SaveToFilesAction
						fileName={`${exportBaseName(view.audio?.name)}.txt`}
						mimeType={EXPORT_MIME_TYPES.txt}
						content={() =>
							Promise.resolve(
								exportTranscript(
									{
										text,
										segments: view.segments,
										durationMs,
										edited: view.edited,
									},
									"txt",
								),
							)
						}
						iconOnly={isNarrow}
						data-transcript-action="save"
					/>
					<StudioAction
						icon={<MessageSquare className="h-3.5 w-3.5" />}
						label={t("card.sendToChat", { defaultValue: "Send to chat" })}
						iconOnly={isNarrow}
						onClick={sendToChat}
						data-transcript-action="send-to-chat"
					/>
					<StudioAction
						icon={<Pencil className="h-3.5 w-3.5" />}
						label={t("card.edit", { defaultValue: "Edit transcript" })}
						iconOnly
						onClick={() => {
							setDraft(text);
							setEditing(true);
						}}
						data-transcript-action="edit"
					/>
				</>
			) : null}
			{settled && view.audio && !editing ? (
				<StudioAction
					icon={<RotateCcw className="h-3.5 w-3.5" />}
					label={tStudio("common.retry", { defaultValue: "Retry" })}
					// A failed run's main action keeps its label; re-running a
					// finished transcript is secondary.
					iconOnly={status === "done" || isNarrow}
					onClick={() => onRetry(item)}
					disabled={busy}
					data-transcript-action="retry"
				/>
			) : null}
			{!editing ? (
				<StudioAction
					icon={<Trash2 className="h-3.5 w-3.5" />}
					label={tStudio("common.delete", { defaultValue: "Delete" })}
					iconOnly
					destructive
					onClick={() => {
						if (running) onStop?.();
						void useStudioStore.getState().deleteItem(mode, item.id);
					}}
					data-transcript-action="delete"
				/>
			) : null}
		</>
	);

	return (
		<StudioTurn
			item={item}
			request={request}
			actions={actions}
			details={details}
			runningLabel={
				hasText
					? t("progress.transcribing", { defaultValue: "Transcribing…" })
					: t("card.listening", { defaultValue: "Listening to the audio…" })
			}
			data-transcript-card={item.id}
			data-transcript-status={status}
		>
			<div className="flex min-w-0 flex-col gap-2">
				{editing ? (
					<div className="flex flex-col gap-2">
						<Textarea
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							rows={Math.min(14, Math.max(4, Math.ceil(draft.length / 48)))}
							autoFocus
							aria-label={t("card.edit", { defaultValue: "Edit transcript" })}
							className="text-sm"
							data-transcript-editor
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									setEditing(false);
								} else if (
									event.key === "Enter" &&
									(event.metaKey || event.ctrlKey)
								) {
									event.preventDefault();
									saveEdit();
								}
							}}
						/>
						{view.segments.length > 0 ? (
							<p className="text-[11px] text-muted-foreground">
								{t("card.editHint", {
									defaultValue:
										"Edited text replaces the timestamped view and subtitle timings.",
								})}
							</p>
						) : null}
						<div className="flex justify-end gap-2">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-8"
								onClick={() => setEditing(false)}
							>
								{t("card.cancel", { defaultValue: "Cancel" })}
							</Button>
							<Button
								type="button"
								size="sm"
								className="h-8"
								onClick={saveEdit}
								data-transcript-save
							>
								{t("card.save", { defaultValue: "Save" })}
							</Button>
						</div>
					</div>
				) : showSegments ? (
					<ol className="flex flex-col gap-0.5" data-transcript-segments>
						{(collapsed
							? view.segments.slice(0, COLLAPSED_ROWS)
							: view.segments
						).map((segment, index) => {
							const active = index === activeIndex;
							const stamp = formatClock(segment.start);
							return (
								<li
									key={`${segment.id}-${segment.start}`}
									className={cn(
										"-mx-1 flex min-w-0 items-baseline gap-2 rounded px-1 py-0.5 text-sm leading-relaxed transition-colors",
										active && "bg-primary/10",
									)}
									data-segment-active={active || undefined}
									aria-current={active ? "true" : undefined}
								>
									<button
										type="button"
										className={cn(
											"shrink-0 rounded font-mono text-[11px] tabular-nums hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
											active ? "text-primary" : "text-muted-foreground",
										)}
										onClick={() => playerRef.current?.playFrom(segment.start)}
										aria-label={t("card.playFrom", {
											time: stamp,
											defaultValue: `Play from ${stamp}`,
										})}
										data-segment-seek={segment.start}
										disabled={!view.audio}
									>
										[{stamp}]
									</button>
									<span className="min-w-0 break-words">
										{segment.text.trim()}
									</span>
								</li>
							);
						})}
					</ol>
				) : hasText ? (
					<p
						className={cn(
							"whitespace-pre-wrap break-words text-sm leading-relaxed",
							collapsed && "line-clamp-12",
						)}
						data-transcript-text
					>
						{text}
						{running ? (
							<span
								aria-hidden
								className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-foreground motion-safe:animate-pulse"
								data-transcript-caret
							/>
						) : null}
					</p>
				) : status === "done" ? (
					<p className="text-sm text-muted-foreground">
						{t("card.noSpeech", { defaultValue: "No speech was detected." })}
					</p>
				) : null}

				{long && !editing && !running ? (
					<button
						type="button"
						className="self-start text-xs font-medium text-primary hover:underline"
						onClick={() => setExpanded((value) => !value)}
						aria-expanded={expanded}
						data-transcript-toggle
					>
						{expanded
							? t("card.showLess", { defaultValue: "Show less" })
							: t("card.showMore", { defaultValue: "Show more" })}
					</button>
				) : null}
			</div>
		</StudioTurn>
	);
};
