import { RotateCcw, Trash2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ImageToolTask } from "@/services/llm/interfaces/model-category";
import type { StudioContentPart, StudioItem } from "@/types/studio";
import { readStoredMedia } from "@/services/llm/utils/media-persistence";
import { SaveToFilesAction } from "../shared/SaveToFilesAction";
import { StoredImage } from "../shared/StoredImage";
import {
	STUDIO_ACTION_CLASS,
	StudioAction,
	StudioTurn,
} from "../shared/StudioThread";
import {
	CopyTextButton,
	DownloadImageLink,
} from "../image-generation/ImageActions";
import { useElapsedSeconds } from "../image-generation/ImageGenerationCard";
import { downloadFileName } from "../image-generation/image-generation-options";
import { formatScore } from "./detection-geometry";
import { TASK_META, useTaskText } from "./ImageToolTaskTabs";
import { CHECKERBOARD_STYLE, CompareSlider } from "./results/CompareSlider";
import { DetectionResult } from "./results/DetectionResult";

type ImagePart = Extract<StudioContentPart, { type: "image" }>["image"];

export const taskOfItem = (item: StudioItem): ImageToolTask | undefined =>
	item.generation.imageTask ??
	(typeof item.generation.params?.task === "string"
		? (item.generation.params.task as ImageToolTask)
		: undefined);

export const inputImageOf = (item: StudioItem): ImagePart | undefined =>
	item.parts.find(
		(part): part is Extract<StudioContentPart, { type: "image" }> =>
			part.type === "image" && part.image.role === "input",
	)?.image;

const outputImageOf = (item: StudioItem, role: ImagePart["role"]) =>
	item.parts.find(
		(part): part is Extract<StudioContentPart, { type: "image" }> =>
			part.type === "image" && part.image.role === role,
	)?.image;

const DepthView: React.FC<{
	input: ImagePart;
	depth: ImagePart;
	alt: string;
	isNarrow: boolean;
}> = ({ input, depth, alt, isNarrow }) => {
	const { t } = useTranslation("studioTools");
	const [view, setView] = useState<"both" | "original" | "depth">(
		isNarrow ? "depth" : "both",
	);
	const views = [
		{
			id: "original",
			label: t("result.original", { defaultValue: "Original" }),
		},
		{ id: "depth", label: t("result.depthMap", { defaultValue: "Depth map" }) },
		{
			id: "both",
			label: t("result.sideBySide", { defaultValue: "Side by side" }),
		},
	] as const;
	const imageClass =
		"block h-auto max-h-[28rem] w-full rounded-lg border border-border/60 object-contain";
	return (
		<div className="flex flex-col gap-2" data-depth-result data-view={view}>
			<fieldset className="m-0 flex min-w-0 gap-1 border-0 p-0">
				<legend className="sr-only">
					{t("result.view", { defaultValue: "View" })}
				</legend>
				{views.map((option) => (
					<button
						key={option.id}
						type="button"
						aria-pressed={view === option.id}
						onClick={() => setView(option.id)}
						className={cn(
							"rounded-md px-2 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							view === option.id
								? "bg-accent text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
						data-depth-view={option.id}
					>
						{option.label}
					</button>
				))}
			</fieldset>
			<div
				className={cn(
					"grid gap-2",
					view === "both" ? "grid-cols-2" : "grid-cols-1",
				)}
			>
				{view !== "depth" ? (
					<StoredImage
						path={input.path}
						mimeType={input.mimeType}
						alt={alt}
						className={imageClass}
						placeholderClassName="h-40"
					/>
				) : null}
				{view !== "original" ? (
					<StoredImage
						path={depth.path}
						mimeType={depth.mimeType}
						alt={t("result.depthAlt", {
							name: alt,
							defaultValue: `Depth map of ${alt}`,
						})}
						className={imageClass}
						placeholderClassName="h-40"
					/>
				) : null}
			</div>
		</div>
	);
};

interface ImageToolCardProps {
	item: StudioItem;
	isNarrow: boolean;
	onRetry: (item: StudioItem) => void;
	onDelete: (item: StudioItem) => void;
}

export const ImageToolCard: React.FC<ImageToolCardProps> = ({
	item,
	isNarrow,
	onRetry,
	onDelete,
}) => {
	const { t } = useTranslation("studioTools");
	const { t: tc } = useTranslation("studio");
	const taskText = useTaskText();
	const task = taskOfItem(item);
	const { status } = item.generation;
	const running = status === "running";
	const seconds = useElapsedSeconds(item.createdAt, running);
	const input = inputImageOf(item);
	const cutout = outputImageOf(item, "cutout");
	const depth = outputImageOf(item, "depth");
	const detections =
		item.parts.find(
			(part): part is Extract<StudioContentPart, { type: "detections" }> =>
				part.type === "detections",
		)?.detections ?? [];
	const caption = item.parts.find(
		(part): part is Extract<StudioContentPart, { type: "text" }> =>
			part.type === "text" && part.role === "caption",
	)?.text;
	const labels =
		item.parts.find(
			(part): part is Extract<StudioContentPart, { type: "labels" }> =>
				part.type === "labels",
		)?.labels ?? [];
	const masks = item.parts.flatMap((part) =>
		part.type === "image" && part.image.role === "mask" ? [part.image] : [],
	);
	const isTextTask = task === "image-to-text";
	const alt = item.content || taskText(task ?? "background-removal", "label");
	const threshold =
		typeof item.generation.params?.threshold === "number"
			? item.generation.params.threshold
			: undefined;
	const Icon = task ? TASK_META[task].icon : null;

	// Running, failed and stopped states are drawn by the turn itself; the
	// input image is already in the request bubble.
	let body: React.ReactNode = null;
	if (status !== "done") {
		body = null;
	} else if (task === "background-removal" && input && cutout) {
		body = <CompareSlider before={input} after={cutout} alt={alt} />;
	} else if (task === "depth-estimation" && input && depth) {
		body = (
			<DepthView input={input} depth={depth} alt={alt} isNarrow={isNarrow} />
		);
	} else if (task === "object-detection" && input) {
		// The threshold sits in the footer chips.
		body = <DetectionResult image={input} detections={detections} alt={alt} />;
	} else if (task === "image-segmentation" && input) {
		body = (
			<div className="space-y-2" data-tool-segments>
				<StoredImage
					path={input.path}
					mimeType={input.mimeType}
					alt={alt}
					className="block max-h-64 w-auto max-w-full rounded-lg border border-border/60"
				/>
				{masks.length > 0 ? (
					<ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
						{masks.map((mask) => (
							<li
								key={mask.path}
								className="overflow-hidden rounded-lg border border-border/60 bg-muted/20"
							>
								<StoredImage
									path={mask.path}
									mimeType={mask.mimeType}
									alt={mask.label ?? alt}
									className="block h-24 w-full object-contain"
								/>
								<p className="truncate px-2 py-1 text-[11px] text-muted-foreground">
									{mask.label ??
										t("result.segment", { defaultValue: "Segment" })}
								</p>
							</li>
						))}
					</ul>
				) : (
					<p className="text-xs text-muted-foreground">
						{t("result.noSegments", { defaultValue: "No regions were found." })}
					</p>
				)}
			</div>
		);
	} else if (task === "image-classification") {
		body = (
			<ul className="w-full max-w-md space-y-1.5" data-tool-labels>
				{labels.map((entry) => (
					<li key={entry.label} className="space-y-0.5">
						<div className="flex items-baseline justify-between gap-2 text-xs">
							<span className="truncate">{entry.label}</span>
							<span className="tabular-nums text-muted-foreground">
								{Math.round(entry.score * 100)}%
							</span>
						</div>
						<div className="h-1 overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-primary"
								style={{ width: `${Math.round(entry.score * 100)}%` }}
							/>
						</div>
					</li>
				))}
			</ul>
		);
	} else if (isTextTask) {
		body = caption ? (
			<p
				className="whitespace-pre-line break-words text-sm leading-relaxed"
				data-tool-text={task}
			>
				{caption}
			</p>
		) : (
			<p className="text-xs text-muted-foreground">
				{t("result.noText", { defaultValue: "No text was found." })}
			</p>
		);
	} else {
		// A result whose output is missing (older runner, partial write).
		const output = cutout ?? depth ?? input;
		body = output ? (
			<div
				className="w-fit max-w-full overflow-hidden rounded-lg border border-border/60"
				style={cutout ? CHECKERBOARD_STYLE : undefined}
			>
				<StoredImage
					path={output.path}
					mimeType={output.mimeType}
					alt={alt}
					className="block max-h-[28rem] w-auto max-w-full"
				/>
			</div>
		) : null;
	}

	const downloadable = status === "done" ? (cutout ?? depth) : undefined;
	const showFileName = !isTextTask && Boolean(item.content) && Boolean(task);

	const request = (
		<span className="flex min-w-0 items-center gap-2.5">
			{input ? (
				<StoredImage
					path={input.path}
					mimeType={input.mimeType}
					alt={alt}
					className="h-12 w-12 shrink-0 rounded-lg border border-border/60 object-cover"
					placeholderClassName="h-12 w-12 rounded-lg"
					data-request-image
				/>
			) : null}
			<span className="flex min-w-0 flex-col">
				<span className="flex min-w-0 items-center gap-1.5 font-medium">
					{Icon ? (
						<Icon size={13} className="shrink-0 text-muted-foreground" />
					) : null}
					<span className="truncate">
						{task ? taskText(task, "label") : item.content}
					</span>
				</span>
				{showFileName ? (
					<span
						className="truncate text-xs text-muted-foreground"
						title={item.content}
					>
						{item.content}
					</span>
				) : null}
			</span>
		</span>
	);

	return (
		<StudioTurn
			item={item}
			data-image-tool-item={item.id}
			data-task={task}
			request={request}
			runningLabel={`${tc("common.running", { defaultValue: "Working…" })} · ${t(
				"result.elapsed",
				{ seconds, defaultValue: `${seconds}s` },
			)}`}
			details={
				task === "object-detection" && typeof threshold === "number" ? (
					<span
						className="rounded-md border border-border/40 bg-muted/50 px-2 py-0.5 tabular-nums"
						data-threshold-chip
					>
						{t("result.threshold", {
							value: formatScore(threshold),
							defaultValue: `Threshold ${formatScore(threshold)}`,
						})}
					</span>
				) : null
			}
			actions={
				<>
					{downloadable ? (
						<DownloadImageLink
							path={downloadable.path}
							mimeType={downloadable.mimeType}
							fileName={downloadFileName(
								item.content,
								downloadable.mimeType,
								downloadable.role === "cutout" ? "cutout" : "depth",
							)}
							label={
								downloadable.role === "cutout"
									? t("result.downloadPng", { defaultValue: "Download PNG" })
									: undefined
							}
							showLabel={!isNarrow}
							className={cn(STUDIO_ACTION_CLASS, "w-auto")}
						/>
					) : null}
					{downloadable ? (
						<SaveToFilesAction
							fileName={downloadFileName(
								item.content,
								downloadable.mimeType,
								downloadable.role === "cutout" ? "cutout" : "depth",
							)}
							mimeType={downloadable.mimeType}
							content={() => readStoredMedia(downloadable.path)}
							iconOnly={isNarrow}
							data-image-tool-save
						/>
					) : null}
					{status === "done" && isTextTask && caption ? (
						<SaveToFilesAction
							fileName={downloadFileName(
								item.content,
								"text/plain",
								"caption",
								"caption",
							)}
							mimeType="text/plain"
							content={caption}
							iconOnly={isNarrow}
							data-image-tool-save
						/>
					) : null}
					{status === "done" && isTextTask && caption ? (
						<CopyTextButton
							text={caption}
							showLabel={!isNarrow}
							className={cn(STUDIO_ACTION_CLASS, "w-auto")}
						/>
					) : null}
					{status === "failed" || status === "cancelled" ? (
						<StudioAction
							icon={<RotateCcw className="h-3.5 w-3.5" />}
							label={tc("common.retry", { defaultValue: "Retry" })}
							onClick={() => onRetry(item)}
							disabled={!input}
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
			{body}
		</StudioTurn>
	);
};
