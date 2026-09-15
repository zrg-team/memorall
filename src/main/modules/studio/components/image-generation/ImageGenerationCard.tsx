import {
	Copy,
	ImageOff,
	Maximize2,
	MessageSquare,
	MessageSquarePlus,
	Sparkles,
	Repeat2,
	RotateCcw,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import type { ImageComment, StudioItem } from "@/types/studio";
import { readStoredMedia } from "@/services/llm/utils/media-persistence";
import { SaveToFilesAction } from "../shared/SaveToFilesAction";
import { StudioAction, StudioTurn } from "../shared/StudioThread";
import { StoredImage } from "../shared/StoredImage";
import { DownloadImageLink, ICON_ACTION_CLASS } from "./ImageActions";
import { commentsOf, feedbackOf } from "./image-feedback";
import {
	aspectRatioOf,
	clampImageCount,
	downloadFileName,
} from "./image-generation-options";

const secondsSince = (since: Date) =>
	Math.max(0, Math.floor((Date.now() - since.getTime()) / 1000));

/** Seconds since `since`, ticking once a second while `active`. */
export function useElapsedSeconds(since: Date, active: boolean): number {
	const [seconds, setSeconds] = useState(() => secondsSince(since));
	useEffect(() => {
		if (!active) return;
		setSeconds(secondsSince(since));
		const timer = setInterval(() => setSeconds(secondsSince(since)), 1000);
		return () => clearInterval(timer);
	}, [since, active]);
	return seconds;
}

export const generatedImagesOf = (item: StudioItem) =>
	item.parts.flatMap((part) =>
		part.type === "image" && part.image.role === "generated"
			? [part.image]
			: [],
	);

interface ImageGenerationCardProps {
	item: StudioItem;
	isNarrow: boolean;
	/**
	 * Live progress for a run this canvas started: a percent when the model
	 * reports one, null for an indeterminate wait, undefined when this canvas
	 * is not driving the item (e.g. it outlived a remount).
	 */
	progress?: number | null;
	onOpenImage: (itemId: string, index: number) => void;
	/** Open an image with its comment panel. */
	onCommentImage: (itemId: string, index: number) => void;
	onGenerateNext: (itemId: string, index: number) => void;
	/** An image is being generated, so a follow-up cannot start. */
	busy: boolean;
	onReuse: (item: StudioItem) => void;
	onRetry: (item: StudioItem) => void;
	onDelete: (item: StudioItem) => void;
}

const RunningTile: React.FC<{
	aspectRatio: string;
	progress?: number | null;
	seconds: number;
}> = ({ aspectRatio, progress, seconds }) => {
	const { t } = useTranslation("studioImage");
	const determinate = typeof progress === "number";
	return (
		<div
			className="relative w-full overflow-hidden rounded-lg border border-border/60 bg-muted/40"
			style={{ aspectRatio }}
			data-image-placeholder
		>
			<div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted/30 via-muted/70 to-muted/30" />
			<div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
				<span>{t("card.generating", { defaultValue: "Generating…" })}</span>
				<span className="tabular-nums">
					{determinate ? `${Math.round(progress)}% · ` : ""}
					{t("card.elapsed", { seconds, defaultValue: `${seconds}s` })}
				</span>
			</div>
			<div
				className="absolute inset-x-0 bottom-0 h-1 bg-foreground/10"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={determinate ? Math.round(progress) : undefined}
				aria-label={t("card.generating", { defaultValue: "Generating…" })}
			>
				{determinate ? (
					<div
						className="h-full bg-primary transition-[width] duration-300"
						style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
					/>
				) : (
					<div className="h-full w-1/3 animate-pulse bg-primary/70" />
				)}
			</div>
		</div>
	);
};

export const ImageGenerationCard: React.FC<ImageGenerationCardProps> = ({
	item,
	isNarrow,
	progress,
	onOpenImage,
	onCommentImage,
	onGenerateNext,
	busy,
	onReuse,
	onRetry,
	onDelete,
}) => {
	const { t } = useTranslation("studioImage");
	const { t: tc } = useTranslation("studio");
	const { status } = item.generation;
	const params = item.generation.params ?? {};
	const size = typeof params.size === "string" ? params.size : undefined;
	const aspectRatio = aspectRatioOf(size);
	const fixedShape = Boolean(size && size !== "auto");
	const images = generatedImagesOf(item);
	const running = status === "running";
	const seconds = useElapsedSeconds(item.createdAt, running);
	const tileCount = running ? clampImageCount(params.n) : images.length;
	const columns = isNarrow || tileCount <= 1 ? "grid-cols-1" : "grid-cols-2";

	const copyPrompt = () => {
		void navigator.clipboard?.writeText(item.content).catch(() => undefined);
	};

	const runningLabel = [
		t("card.generating", { defaultValue: "Generating…" }),
		typeof progress === "number" ? `${Math.round(progress)}%` : null,
		t("card.elapsed", { seconds, defaultValue: `${seconds}s` }),
	]
		.filter(Boolean)
		.join(" · ");

	const details = [
		size && size !== "auto" ? size.replace("x", "×") : null,
		images.length > 1 ? `×${images.length}` : null,
	].filter(Boolean);

	const feedback = feedbackOf(item);

	return (
		<StudioTurn
			item={item}
			data-image-generation-item={item.id}
			request={feedback ? <FeedbackRequest item={item} /> : item.content}
			runningLabel={runningLabel}
			details={details.map((detail) => (
				<span
					key={detail}
					className="rounded-md border border-border/40 bg-muted/50 px-2 py-0.5 tabular-nums"
				>
					{detail}
				</span>
			))}
			actions={
				<>
					<StudioAction
						icon={<Copy className="h-3.5 w-3.5" />}
						label={t("card.copyPrompt", { defaultValue: "Copy prompt" })}
						iconOnly={isNarrow}
						onClick={copyPrompt}
						data-copy-text
					/>
					{images.length === 1 ? (
						<StudioAction
							icon={<MessageSquarePlus className="h-3.5 w-3.5" />}
							label={t("comments.toggle", { defaultValue: "Comment" })}
							iconOnly={isNarrow}
							onClick={() => onCommentImage(item.id, 0)}
							data-comment-image
						/>
					) : null}
					{images.map((image, index) => (
						<SaveToFilesAction
							key={image.path}
							fileName={downloadFileName(
								item.content,
								image.mimeType,
								images.length > 1 ? String(index + 1) : undefined,
							)}
							mimeType={image.mimeType}
							content={() => readStoredMedia(image.path)}
							label={
								images.length > 1
									? t("card.saveNumbered", {
											number: index + 1,
											defaultValue: `Save image ${index + 1}`,
										})
									: undefined
							}
							iconOnly={isNarrow || images.length > 1}
							data-save-image={image.path}
						/>
					))}
					<StudioAction
						icon={<Repeat2 className="h-3.5 w-3.5" />}
						label={t("card.reuse", {
							defaultValue: "Reuse prompt and settings",
						})}
						iconOnly
						onClick={() => onReuse(item)}
						data-reuse-prompt
					/>
					{status === "failed" || status === "cancelled" ? (
						<StudioAction
							icon={<RotateCcw className="h-3.5 w-3.5" />}
							label={tc("common.retry", { defaultValue: "Retry" })}
							onClick={() => onRetry(item)}
							data-retry
						/>
					) : null}
					{running ? null : (
						<StudioAction
							icon={<Trash2 className="h-3.5 w-3.5" />}
							label={tc("common.delete", { defaultValue: "Delete" })}
							iconOnly
							destructive
							onClick={() => onDelete(item)}
							data-delete-item
						/>
					)}
				</>
			}
		>
			{running ? (
				<div
					className={cn(
						"grid w-full gap-2",
						columns,
						tileCount <= 1 && !isNarrow && "max-w-md",
					)}
				>
					{Array.from({ length: tileCount }, (_, index) => (
						<RunningTile
							// Placeholders have no identity beyond their slot.
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed-length slots
							key={index}
							aspectRatio={aspectRatio}
							progress={progress}
							seconds={seconds}
						/>
					))}
				</div>
			) : images.length > 0 ? (
				<div
					className={cn(
						"grid w-full gap-2",
						columns,
						images.length === 1 && !isNarrow && "max-w-md",
					)}
				>
					{images.map((image, index) => (
						<div
							key={image.path}
							className="group relative overflow-hidden rounded-xl border border-border/60 bg-muted/30 shadow-sm"
							data-generated-image={image.path}
						>
							<button
								type="button"
								className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								// A requested size keeps its shape while the file loads, so the
								// gallery does not jump; "auto" lets the image set its own.
								style={fixedShape ? { aspectRatio } : undefined}
								onClick={() => onOpenImage(item.id, index)}
								aria-label={t("card.open", { defaultValue: "Open image" })}
								data-open-image
							>
								<StoredImage
									path={image.path}
									mimeType={image.mimeType}
									alt={item.content}
									className={
										fixedShape
											? "block h-full w-full object-contain"
											: "block h-auto w-full"
									}
									placeholderClassName={
										fixedShape ? "h-full w-full" : "aspect-square w-full"
									}
									loading="lazy"
								/>
							</button>
							<div
								className={cn(
									"absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-background/85 p-0.5 shadow-sm backdrop-blur transition-opacity",
									isNarrow
										? "opacity-100"
										: "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
								)}
							>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className={ICON_ACTION_CLASS}
									onClick={() => onCommentImage(item.id, index)}
									aria-label={t("comments.toggle", { defaultValue: "Comment" })}
									title={t("comments.toggle", { defaultValue: "Comment" })}
									data-comment-image-tile
								>
									<MessageSquarePlus size={14} />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className={ICON_ACTION_CLASS}
									onClick={() => onOpenImage(item.id, index)}
									aria-label={t("card.open", { defaultValue: "Open image" })}
									title={t("card.open", { defaultValue: "Open image" })}
								>
									<Maximize2 size={14} />
								</Button>
								<DownloadImageLink
									path={image.path}
									mimeType={image.mimeType}
									fileName={downloadFileName(
										item.content,
										image.mimeType,
										String(index + 1),
									)}
								/>
							</div>
							<CommentsBar
								comments={commentsOf(item, image.path)}
								busy={busy}
								onOpen={() => onCommentImage(item.id, index)}
								onGenerate={() => onGenerateNext(item.id, index)}
							/>
						</div>
					))}
				</div>
			) : status === "done" ? (
				<div className="flex items-center gap-2 rounded-xl border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">
					<ImageOff size={14} />
					{t("card.noImages", {
						defaultValue: "The model returned no images.",
					})}
				</div>
			) : null}
		</StudioTurn>
	);
};

/** Pending comments on an image, and the button that turns them into the next one. */
const CommentsBar: React.FC<{
	comments: readonly ImageComment[];
	busy: boolean;
	onOpen: () => void;
	onGenerate: () => void;
}> = ({ comments, busy, onOpen, onGenerate }) => {
	const { t } = useTranslation("studioImage");
	if (comments.length === 0) return null;
	return (
		<div
			className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-2 rounded-lg bg-background/90 p-1 pl-2 shadow-sm backdrop-blur"
			data-image-comments-bar={comments.length}
		>
			<button
				type="button"
				className="flex min-w-0 items-center gap-1.5 text-xs text-foreground hover:underline"
				onClick={onOpen}
			>
				<MessageSquare size={13} className="shrink-0 text-amber-500" />
				<span className="truncate">
					{t("comments.pending", {
						count: comments.length,
						defaultValue:
							comments.length === 1
								? "1 comment"
								: `${comments.length} comments`,
					})}
				</span>
			</button>
			<Button
				type="button"
				size="sm"
				className="h-7 shrink-0 gap-1 px-2 text-xs"
				disabled={busy}
				onClick={onGenerate}
				title={
					busy
						? t("comments.busy", {
								defaultValue: "Wait for the current image to finish.",
							})
						: undefined
				}
				data-image-generate-next-tile
			>
				<Sparkles size={13} />
				{t("comments.generateShort", { defaultValue: "Generate next" })}
			</Button>
		</div>
	);
};

/** A follow-up's request: the image it started from and the notes on it. */
const FeedbackRequest: React.FC<{ item: StudioItem }> = ({ item }) => {
	const { t } = useTranslation("studioImage");
	const feedback = feedbackOf(item);
	if (!feedback) return null;
	const marked = item.parts.find(
		(part) => part.type === "image" && part.image.role === "input",
	);
	const preview =
		marked?.type === "image"
			? { path: marked.image.path, mimeType: marked.image.mimeType }
			: feedback.source;
	return (
		<div className="flex max-w-md flex-col gap-2" data-image-feedback-request>
			<div className="flex items-start gap-2.5">
				<StoredImage
					path={preview.path}
					mimeType={preview.mimeType}
					alt={t("comments.source", {
						defaultValue: "Image the feedback is on",
					})}
					className="h-20 w-20 shrink-0 rounded-md object-cover"
					placeholderClassName="h-20 w-20 rounded-md"
					loading="lazy"
				/>
				<div className="min-w-0 space-y-1">
					<p className="text-[11px] font-medium text-muted-foreground">
						{t("comments.requestTitle", {
							defaultValue: "Next version with feedback",
						})}
					</p>
					<ol className="space-y-1 text-sm">
						{feedback.comments.map((comment, index) => (
							<li key={comment.id} className="flex items-start gap-1.5">
								<span
									className={cn(
										"mt-0.5 flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[10px] font-semibold",
										comment.region
											? "bg-amber-400 text-black"
											: "bg-muted text-muted-foreground",
									)}
								>
									{index + 1}
								</span>
								<span className="min-w-0 whitespace-pre-wrap break-words">
									{comment.text}
								</span>
							</li>
						))}
					</ol>
				</div>
			</div>
		</div>
	);
};
