import {
	ArrowUpRight,
	Captions,
	Check,
	ChevronDown,
	Layers,
	ScanSearch,
	Scissors,
	Shapes,
	Tags,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import {
	IMAGE_TOOL_TASKS,
	type ImageToolTask,
} from "@/services/llm/interfaces/model-category";
import { COMPOSER_CONTROL } from "../shared/StudioComposer";

export const TASK_META: Record<
	ImageToolTask,
	{ icon: LucideIcon; label: string; can: string; description: string }
> = {
	"background-removal": {
		icon: Scissors,
		label: "Remove background",
		can: "remove backgrounds",
		description: "Cut the subject out onto a transparent background.",
	},
	"image-segmentation": {
		icon: Shapes,
		label: "Segment",
		can: "segment images",
		description: "Split an image into labelled regions.",
	},
	"depth-estimation": {
		icon: Layers,
		label: "Depth",
		can: "estimate depth",
		description: "See how far each part of a photo is from the camera.",
	},
	"object-detection": {
		icon: ScanSearch,
		label: "Detect objects",
		can: "detect objects",
		description: "Find and label the objects in an image.",
	},
	"image-to-text": {
		icon: Captions,
		label: "Caption & OCR",
		can: "describe images or read their text",
		description: "Describe an image, or read the text in it with an OCR model.",
	},
	"image-classification": {
		icon: Tags,
		label: "Classify",
		can: "classify images",
		description: "Tell what an image shows, with confidence scores.",
	},
};

/** Translated task strings, with the English copy as the fallback. */
export function useTaskText() {
	const { t } = useTranslation("studioTools");
	return (task: ImageToolTask, field: "label" | "can" | "description") =>
		t(`tasks.${task}.${field}`, { defaultValue: TASK_META[task][field] });
}

interface ImageToolTaskSelectorProps {
	active: ImageToolTask;
	supported: (task: ImageToolTask) => boolean;
	onSelect: (task: ImageToolTask) => void;
	isNarrow: boolean;
}

/**
 * The task picker in the composer toolbar, a chip like chat's agent picker.
 *
 * Every task stays listed even when the current model cannot run it: the
 * list is how people discover the other tools, and choosing one explains how
 * to get it instead of hiding the option.
 */
export const ImageToolTaskSelector: React.FC<ImageToolTaskSelectorProps> = ({
	active,
	supported,
	onSelect,
	isNarrow,
}) => {
	const { t } = useTranslation("studioTools");
	const taskText = useTaskText();
	const [open, setOpen] = useState(false);
	const ActiveIcon = TASK_META[active].icon;
	const legend = t("tasks.label", { defaultValue: "Tool" });
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className={cn(COMPOSER_CONTROL, "min-w-0 gap-1 bg-muted/40 px-2")}
					title={`${legend}: ${taskText(active, "description")}`}
					data-image-tool-task-trigger={active}
					data-supported={supported(active)}
				>
					<ActiveIcon size={14} className="shrink-0" />
					<span
						className={cn(
							"min-w-0 truncate",
							isNarrow ? "max-w-20" : "max-w-32",
						)}
					>
						{taskText(active, "label")}
					</span>
					<ChevronDown size={10} className="shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="top"
				className="w-64 max-w-[calc(100vw-1.5rem)] p-1"
			>
				<fieldset className="m-0 min-w-0 border-0 p-0" data-image-tool-tasks>
					<legend className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
						{legend}
					</legend>
					{IMAGE_TOOL_TASKS.map((task) => {
						const Icon = TASK_META[task].icon;
						const isActive = task === active;
						const isSupported = supported(task);
						return (
							<button
								key={task}
								type="button"
								aria-pressed={isActive}
								onClick={() => {
									onSelect(task);
									setOpen(false);
								}}
								title={taskText(task, "description")}
								className={cn(
									"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
									isActive && "bg-accent/60 text-accent-foreground",
									!isSupported && !isActive && "text-muted-foreground",
								)}
								data-image-tool-task={task}
								data-supported={isSupported}
							>
								<Icon size={14} className="shrink-0" />
								<span className="min-w-0 flex-1 truncate">
									{taskText(task, "label")}
								</span>
								{isActive ? (
									<Check size={13} className="shrink-0 text-primary" />
								) : null}
							</button>
						);
					})}
				</fieldset>
			</PopoverContent>
		</Popover>
	);
};

/** Inline nudge shown when the chosen task needs a different model. */
export const SwitchModelHint: React.FC<{
	task: ImageToolTask;
	className?: string;
}> = ({ task, className }) => {
	const { t } = useTranslation("studioTools");
	const taskText = useTaskText();
	const navigate = useNavigate();
	const can = taskText(task, "can");
	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs",
				className,
			)}
			data-switch-model-hint={task}
		>
			<span className="min-w-0 flex-1">
				{t("hint.switchModel", {
					task: can,
					defaultValue: `Switch to a model that can ${can}.`,
				})}
			</span>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="h-7 gap-1 px-2 text-xs"
				onClick={() => navigate("/llm?category=image-tools")}
				data-switch-model
			>
				{t("hint.chooseModel", { defaultValue: "Choose a model" })}
				<ArrowUpRight size={12} />
			</Button>
		</div>
	);
};
