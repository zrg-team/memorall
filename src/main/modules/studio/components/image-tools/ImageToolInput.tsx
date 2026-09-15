import { ImagePlus, SlidersHorizontal, X } from "lucide-react";
import type React from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import type { ImageToolTask } from "@/services/llm/interfaces/model-category";
import {
	COMPOSER_CONTROL,
	COMPOSER_ICON_CONTROL,
	StudioComposer,
} from "../shared/StudioComposer";
import {
	formatScore,
	MAX_DETECTION_THRESHOLD,
	MIN_DETECTION_THRESHOLD,
} from "./detection-geometry";
import { ImageToolTaskSelector } from "./ImageToolTaskTabs";

export interface StagedImage {
	file: File;
	/** Object URL for the preview; null where the browser cannot make one. */
	url: string | null;
	width?: number;
	height?: number;
}

export const formatBytes = (bytes: number) =>
	bytes < 1024 * 1024
		? `${Math.max(1, Math.round(bytes / 1024))} KB`
		: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

interface ImageToolInputProps {
	staged: StagedImage | null;
	onChoose: () => void;
	onClear: () => void;
	task: ImageToolTask;
	onTaskChange: (task: ImageToolTask) => void;
	supports: (task: ImageToolTask) => boolean;
	threshold: number;
	onThresholdChange: (value: number) => void;
	running: boolean;
	onRun: () => void;
	onStop: () => void;
	error: string | null;
	/** Above the card: the switch-model hint. */
	above?: React.ReactNode;
	isNarrow: boolean;
}

const ThresholdSlider: React.FC<{
	id: string;
	threshold: number;
	onThresholdChange: (value: number) => void;
	className?: string;
}> = ({ id, threshold, onThresholdChange, className }) => (
	<input
		id={id}
		type="range"
		min={MIN_DETECTION_THRESHOLD}
		max={MAX_DETECTION_THRESHOLD}
		step={0.05}
		value={threshold}
		onChange={(event) => onThresholdChange(Number(event.target.value))}
		className={cn("h-1.5 min-w-0 cursor-pointer accent-primary", className)}
		aria-valuetext={formatScore(threshold)}
		data-threshold-slider
	/>
);

/**
 * The composer pinned under the results - chat's composer, holding the staged
 * image, with the task and its options in the toolbar and Run as send.
 */
export const ImageToolInput: React.FC<ImageToolInputProps> = ({
	staged,
	onChoose,
	onClear,
	task,
	onTaskChange,
	supports,
	threshold,
	onThresholdChange,
	running,
	onRun,
	onStop,
	error,
	above,
	isNarrow,
}) => {
	const { t } = useTranslation("studioTools");
	const { t: tc } = useTranslation("studio");
	const thresholdId = useId();
	const chooseLabel = staged
		? t("input.replace", { defaultValue: "Choose another image" })
		: t("input.choose", { defaultValue: "Choose image" });
	const thresholdLabel = t("input.threshold", { defaultValue: "Confidence" });

	return (
		<StudioComposer
			data-image-tool-input
			above={above}
			running={running}
			canSubmit={Boolean(staged) && supports(task)}
			onSubmit={onRun}
			onStop={onStop}
			submitLabel={t("input.run", { defaultValue: "Run" })}
			stopLabel={tc("common.stop", { defaultValue: "Stop" })}
			submitProps={{ "data-image-tool-run": true }}
			stopProps={{ "data-image-tool-stop": true }}
			tools={
				<>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className={
							isNarrow || staged
								? COMPOSER_ICON_CONTROL
								: cn(COMPOSER_CONTROL, "gap-1.5 px-2")
						}
						onClick={onChoose}
						aria-label={chooseLabel}
						title={chooseLabel}
						data-choose-image
					>
						<ImagePlus size={14} />
						{isNarrow || staged ? null : <span>{chooseLabel}</span>}
					</Button>
					<ImageToolTaskSelector
						active={task}
						supported={supports}
						onSelect={onTaskChange}
						isNarrow={isNarrow}
					/>
					{task === "object-detection" ? (
						isNarrow ? (
							<Popover>
								<PopoverTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className={cn(COMPOSER_CONTROL, "shrink-0 gap-1 px-2")}
										aria-label={`${thresholdLabel} ${formatScore(threshold)}`}
										title={thresholdLabel}
										data-threshold
									>
										<SlidersHorizontal size={14} />
										<span className="tabular-nums">
											{formatScore(threshold)}
										</span>
									</Button>
								</PopoverTrigger>
								<PopoverContent
									align="start"
									side="top"
									className="flex w-60 max-w-[calc(100vw-1.5rem)] items-center gap-2 p-3"
								>
									<label
										htmlFor={thresholdId}
										className="shrink-0 text-xs font-medium"
									>
										{thresholdLabel}
									</label>
									<ThresholdSlider
										id={thresholdId}
										threshold={threshold}
										onThresholdChange={onThresholdChange}
										className="flex-1"
									/>
									<span className="w-9 shrink-0 text-right text-xs tabular-nums">
										{formatScore(threshold)}
									</span>
								</PopoverContent>
							</Popover>
						) : (
							<div
								className="flex h-8 shrink-0 items-center gap-2 rounded-xl px-2 text-xs text-muted-foreground"
								data-threshold
							>
								<label htmlFor={thresholdId} className="shrink-0">
									{thresholdLabel}
								</label>
								<ThresholdSlider
									id={thresholdId}
									threshold={threshold}
									onThresholdChange={onThresholdChange}
									className="w-20"
								/>
								<span className="w-8 shrink-0 text-right tabular-nums text-foreground">
									{formatScore(threshold)}
								</span>
							</div>
						)
					) : null}
				</>
			}
		>
			{staged ? (
				<div className="flex min-h-[72px] min-w-0 items-center gap-2.5 px-3 py-2 sm:px-4">
					{staged.url ? (
						<img
							src={staged.url}
							alt={staged.file.name}
							className="h-9 w-9 shrink-0 rounded-md border border-border/60 object-cover"
						/>
					) : (
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
							<ImagePlus size={16} />
						</div>
					)}
					<div className="min-w-0 flex-1" data-staged-image={staged.file.name}>
						<p
							className="truncate text-sm font-medium"
							title={staged.file.name}
						>
							{staged.file.name}
						</p>
						<p className="truncate text-[11px] text-muted-foreground tabular-nums">
							{staged.width && staged.height
								? `${staged.width}×${staged.height} · `
								: ""}
							{formatBytes(staged.file.size)}
						</p>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-7 w-7 shrink-0 text-muted-foreground"
						onClick={onClear}
						disabled={running}
						aria-label={t("input.clear", { defaultValue: "Remove image" })}
						title={t("input.clear", { defaultValue: "Remove image" })}
					>
						<X size={14} />
					</Button>
				</div>
			) : (
				<button
					type="button"
					onClick={onChoose}
					className="block min-h-[72px] w-full truncate px-3 py-2.5 text-left text-[15px] leading-6 text-muted-foreground focus-visible:outline-none sm:px-4"
					data-image-drop-hint
				>
					{isNarrow
						? `${t("input.choose", { defaultValue: "Choose image" })} ${t(
								"input.dropShort",
								{ defaultValue: "or drop / paste" },
							)}`
						: t("input.dropZone", {
								defaultValue:
									"Drop an image, paste one with Ctrl+V, or click to choose.",
							})}
				</button>
			)}
			{error ? (
				<p
					className="px-3 pb-2 text-[11px] text-destructive sm:px-4"
					role="alert"
					data-image-input-error
				>
					{error}
				</p>
			) : null}
		</StudioComposer>
	);
};
