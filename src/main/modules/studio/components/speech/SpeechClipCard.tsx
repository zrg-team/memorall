import { Check, Copy, CornerUpLeft, RotateCw, Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { StudioItem } from "@/types/studio";
import { readStoredMedia } from "@/services/llm/utils/media-persistence";
import { AudioClipPlayer } from "../shared/AudioClipPlayer";
import { SaveToFilesAction } from "../shared/SaveToFilesAction";
import { StudioAction, StudioTurn } from "../shared/StudioThread";
import { downloadFileName } from "../image-generation/image-generation-options";
import {
	DEFAULT_SPEED,
	formatSpeed,
	outputAudioOf,
	paramsOf,
	promptOf,
} from "./speech-studio-utils";

interface SpeechClipCardProps {
	item: StudioItem;
	isMusic: boolean;
	isNarrow: boolean;
	/** Another generation is in flight; retrying now would queue behind it. */
	busy: boolean;
	onReuse: (item: StudioItem) => void;
	onRetry: (item: StudioItem) => void;
	onDelete: (item: StudioItem) => void;
}

const DETAIL_CLASS =
	"max-w-[12rem] truncate rounded-md border border-border/40 bg-muted/50 px-2 py-0.5";

const WAVE_HEIGHTS = [
	30, 55, 80, 45, 95, 60, 35, 70, 90, 50, 65, 40, 85, 55, 30, 75, 45, 60,
];

/** Placeholder waveform while a clip is being made, so the reply has its final shape. */
const PendingWaveform: React.FC = () => (
	<div
		className="flex h-9 items-center gap-[3px]"
		aria-hidden
		data-pending-waveform
	>
		{WAVE_HEIGHTS.map((height, index) => (
			<span
				// biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative bars.
				key={index}
				className="w-[3px] animate-pulse rounded-full bg-muted-foreground/25 motion-reduce:animate-none"
				style={{ height: `${height}%`, animationDelay: `${index * 70}ms` }}
			/>
		))}
	</div>
);

/**
 * One generated clip laid out as a chat exchange: the script as the user's
 * message, the audio as the reply, and what to do next in the reply's footer.
 *
 * Copy and reuse come first because iterating on a line ("same text, other
 * voice") is the main loop in a TTS playground.
 */
export const SpeechClipCard: React.FC<SpeechClipCardProps> = ({
	item,
	isMusic,
	isNarrow,
	busy,
	onReuse,
	onRetry,
	onDelete,
}) => {
	const { t } = useTranslation("studioSpeech");
	const { t: tStudio } = useTranslation("studio");
	const prompt = promptOf(item);
	const params = paramsOf(item);
	const audio = outputAudioOf(item);
	const status = item.generation.status;
	const running = status === "running";
	const retryable = status === "failed" || status === "cancelled";

	const [expanded, setExpanded] = useState(false);
	const [clamped, setClamped] = useState(false);
	const [copied, setCopied] = useState(false);
	const textRef = useRef<HTMLParagraphElement>(null);

	// Measure instead of guessing from length: six lines of Vietnamese in a
	// 360px panel and in a wide window hold very different amounts of text.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes.
	useLayoutEffect(() => {
		const element = textRef.current;
		if (!element || expanded) return;
		setClamped(element.scrollHeight > element.clientHeight + 1);
	}, [prompt, expanded, isNarrow]);

	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 1500);
		return () => window.clearTimeout(timer);
	}, [copied]);

	// Voice ids are what the model accepts: a name, or a file path for models
	// that ship speaker embeddings; show the readable tail.
	const voiceName =
		isMusic || !params.voice || params.voice === "default"
			? null
			: (params.voice
					.split("/")
					.pop()
					?.replace(/\.bin$/i, "") ?? params.voice);
	const speedChanged =
		!isMusic && params.speed !== undefined && params.speed !== DEFAULT_SPEED;

	const copy = () => {
		void navigator.clipboard
			?.writeText(prompt)
			.then(() => setCopied(true))
			.catch(() => undefined);
	};

	const copyLabel = copied
		? tStudio("common.copied", { defaultValue: "Copied" })
		: t("card.copy", { defaultValue: "Copy text" });

	return (
		<StudioTurn
			item={item}
			data-speech-clip={item.id}
			data-speech-clip-status={status}
			runningLabel={
				isMusic
					? t("card.composing", { defaultValue: "Composing…" })
					: t("card.generating", { defaultValue: "Generating…" })
			}
			request={
				<div className="flex min-w-0 flex-col gap-1">
					<p
						ref={textRef}
						className={cn(
							"whitespace-pre-wrap break-words",
							!expanded && "line-clamp-6",
						)}
						data-speech-clip-text
					>
						{prompt}
					</p>
					{clamped || expanded ? (
						<button
							type="button"
							className="self-start rounded text-[11px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => setExpanded((value) => !value)}
							aria-expanded={expanded}
						>
							{expanded
								? t("card.showLess", { defaultValue: "Show less" })
								: t("card.showMore", { defaultValue: "Show more" })}
						</button>
					) : null}
				</div>
			}
			details={
				<>
					{voiceName ? (
						<span
							className={DETAIL_CLASS}
							title={params.voice}
							data-speech-clip-voice
						>
							{voiceName}
						</span>
					) : null}
					{speedChanged && params.speed !== undefined ? (
						<span
							className={cn(DETAIL_CLASS, "tabular-nums")}
							data-speech-clip-speed
						>
							{formatSpeed(params.speed)}
						</span>
					) : null}
				</>
			}
			actions={
				<>
					<StudioAction
						icon={
							copied ? (
								<Check className="h-3.5 w-3.5" />
							) : (
								<Copy className="h-3.5 w-3.5" />
							)
						}
						label={copyLabel}
						iconOnly={isNarrow}
						onClick={copy}
						data-speech-clip-copy
					/>
					{status === "done" && audio ? (
						<SaveToFilesAction
							fileName={downloadFileName(
								promptOf(item),
								audio.mimeType,
								undefined,
								isMusic ? "music" : "speech",
							)}
							mimeType={audio.mimeType}
							content={() => readStoredMedia(audio.path)}
							iconOnly={isNarrow}
							data-speech-clip-save
						/>
					) : null}
					<StudioAction
						icon={<CornerUpLeft className="h-3.5 w-3.5" />}
						label={t("card.reuse", { defaultValue: "Reuse text" })}
						iconOnly
						onClick={() => onReuse(item)}
						data-speech-clip-reuse
					/>
					{retryable ? (
						<StudioAction
							icon={<RotateCw className="h-3.5 w-3.5" />}
							label={tStudio("common.retry", { defaultValue: "Retry" })}
							disabled={busy}
							onClick={() => onRetry(item)}
							data-speech-clip-retry
						/>
					) : null}
					{status === "done" ? (
						<StudioAction
							icon={<RotateCw className="h-3.5 w-3.5" />}
							label={t("card.regenerate", { defaultValue: "Generate again" })}
							iconOnly
							disabled={busy}
							onClick={() => onRetry(item)}
							data-speech-clip-regenerate
						/>
					) : null}
					{running ? null : (
						<StudioAction
							icon={<Trash2 className="h-3.5 w-3.5" />}
							label={tStudio("common.delete", { defaultValue: "Delete" })}
							iconOnly
							destructive
							onClick={() => onDelete(item)}
							data-speech-clip-delete
						/>
					)}
				</>
			}
		>
			{running ? <PendingWaveform /> : null}
			{status === "done" && audio ? (
				<AudioClipPlayer
					path={audio.path}
					mimeType={audio.mimeType}
					durationMs={audio.durationMs}
					className="w-full max-w-md"
					downloadName={
						prompt.slice(0, 40).replace(/[^\p{L}\p{N}]+/gu, "-") || "speech"
					}
				/>
			) : null}
		</StudioTurn>
	);
};
