import { Wand2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	WorkspaceEmptyState,
	WorkspaceEmptyVisual,
} from "@/main/components/molecules/WorkspaceEmptyState";
import { useStudioStore } from "@/main/stores/studio";
import {
	IMAGE_TOOL_TASKS,
	type ImageToolTask,
} from "@/services/llm/interfaces/model-category";
import type { MediaPayload } from "@/types/openai-media";
import type { StudioItem } from "@/types/studio";
import { logError } from "@/utils/logger";
import {
	isCancellation,
	runImageTool,
	saveStudioInput,
} from "../../services/studio-service";
import { imageTaskOf } from "../../studio-model-info";
import { StudioThread } from "../shared/StudioThread";
import type { StudioCanvasProps } from "../studio-canvas";
import {
	DEFAULT_DETECTION_THRESHOLD,
	MAX_INPUT_BYTES,
} from "./detection-geometry";
import { ImageToolCard, inputImageOf, taskOfItem } from "./ImageToolCard";
import {
	formatBytes,
	ImageToolInput,
	type StagedImage,
} from "./ImageToolInput";
import { SwitchModelHint, TASK_META, useTaskText } from "./ImageToolTaskTabs";

type FilePayload = Extract<MediaPayload, { kind: "file" }>;

interface ToolRequest {
	task: ImageToolTask;
	/** A file still to be saved, or an input already in the documents store. */
	source: { file: File } | { saved: FilePayload; fileName?: string };
	threshold?: number;
}

const isEditableTarget = (target: EventTarget | null) =>
	target instanceof HTMLElement &&
	(target.isContentEditable ||
		/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

const createPreviewUrl = (file: File) => {
	try {
		return typeof URL.createObjectURL === "function"
			? URL.createObjectURL(file)
			: null;
	} catch {
		return null;
	}
};

const revokePreviewUrl = (url: string | null | undefined) => {
	if (url && typeof URL.revokeObjectURL === "function")
		URL.revokeObjectURL(url);
};

export const ImageToolsStudio: React.FC<StudioCanvasProps> = ({
	mode,
	model,
	modelInfo,
	items,
	ensureModelReady,
	isNarrow,
}) => {
	const { t } = useTranslation("studioTools");
	const taskText = useTaskText();
	const deleteItem = useStudioStore((store) => store.deleteItem);

	const modelTasks = useMemo(() => {
		const declared = imageTaskOf(modelInfo);
		return declared ? [declared] : [];
	}, [modelInfo]);
	// A model that does not report its task may try any of them rather than
	// having every tab locked.
	const supports = useCallback(
		(task: ImageToolTask) =>
			modelTasks.length === 0 || modelTasks.includes(task),
		[modelTasks],
	);

	const [task, setTask] = useState<ImageToolTask>(
		() => modelTasks[0] ?? IMAGE_TOOL_TASKS[0],
	);
	const [threshold, setThreshold] = useState(DEFAULT_DETECTION_THRESHOLD);
	const [staged, setStaged] = useState<StagedImage | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [running, setRunning] = useState(false);
	const [dragging, setDragging] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	// Saving is the slow part of re-running on the same image; do it once per file.
	const savedInputs = useRef(new WeakMap<File, FilePayload>());
	const stagedUrl = useRef<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Picking a model for another task in the shell should land on that task.
	useEffect(() => {
		setTask((current) =>
			modelTasks.length === 0 || modelTasks.includes(current)
				? current
				: (modelTasks[0] ?? current),
		);
	}, [modelTasks]);

	useEffect(() => () => revokePreviewUrl(stagedUrl.current), []);

	const run = useCallback(
		async (request: ToolRequest) => {
			if (abortRef.current || !supports(request.task)) return;
			const controller = new AbortController();
			abortRef.current = controller;
			setRunning(true);
			setError(null);
			try {
				let image: FilePayload;
				let fileName: string | undefined;
				if ("file" in request.source) {
					const { file } = request.source;
					fileName = file.name;
					const cached = savedInputs.current.get(file);
					image = cached ?? (await saveStudioInput(file, "image"));
					savedInputs.current.set(file, image);
				} else {
					image = request.source.saved;
					fileName = request.source.fileName;
				}
				const ready = await ensureModelReady();
				if (controller.signal.aborted) return;
				await runImageTool({
					model: ready,
					task: request.task,
					image,
					fileName,
					threshold:
						request.task === "object-detection" ? request.threshold : undefined,
					signal: controller.signal,
				});
			} catch (reason) {
				// Run failures are shown on the card; load failures in the shell.
				if (!isCancellation(reason))
					logError("[ImageToolsStudio] run failed", reason);
			} finally {
				if (abortRef.current === controller) {
					abortRef.current = null;
					setRunning(false);
				}
			}
		},
		[ensureModelReady, supports],
	);

	const acceptFiles = useCallback(
		(files: File[]) => {
			const file =
				files.find((candidate) => candidate.type.startsWith("image/")) ?? null;
			if (!file) {
				setError(
					t("input.notImage", { defaultValue: "That file is not an image." }),
				);
				return;
			}
			if (file.size > MAX_INPUT_BYTES) {
				setError(
					t("input.tooLarge", {
						size: formatBytes(file.size),
						max: formatBytes(MAX_INPUT_BYTES),
						defaultValue: `This image is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_INPUT_BYTES)}.`,
					}),
				);
				return;
			}
			setError(null);
			revokePreviewUrl(stagedUrl.current);
			const url = createPreviewUrl(file);
			stagedUrl.current = url;
			setStaged({ file, url });
			if (url && typeof Image !== "undefined") {
				const probe = new Image();
				probe.onload = () =>
					setStaged((current) =>
						current?.file === file
							? {
									...current,
									width: probe.naturalWidth,
									height: probe.naturalHeight,
								}
							: current,
					);
				probe.src = url;
			}
			// Like remove.bg: dropping an image is the request. Re-runs with other
			// settings go through the Run button on the staged image.
			if (supports(task)) void run({ task, source: { file }, threshold });
		},
		[run, supports, t, task, threshold],
	);

	// Paste anywhere in the studio, except into a text field that wants it.
	useEffect(() => {
		const onPaste = (event: ClipboardEvent) => {
			if (isEditableTarget(event.target)) return;
			const files = Array.from(event.clipboardData?.files ?? []).filter(
				(file) => file.type.startsWith("image/"),
			);
			if (files.length === 0) return;
			event.preventDefault();
			acceptFiles(files);
		};
		window.addEventListener("paste", onPaste);
		return () => window.removeEventListener("paste", onPaste);
	}, [acceptFiles]);

	const retry = (item: StudioItem) => {
		const input = inputImageOf(item);
		const itemTask = taskOfItem(item);
		if (!input || !itemTask || running) return;
		if (!supports(itemTask)) {
			setTask(itemTask);
			return;
		}
		const params = item.generation.params ?? {};
		void run({
			task: itemTask,
			source: {
				saved: { kind: "file", path: input.path, mimeType: input.mimeType },
			},
			threshold:
				typeof params.threshold === "number" ? params.threshold : threshold,
		});
		void deleteItem(mode, item.id);
	};

	const supported = supports(task);
	const chooseFile = () => fileInputRef.current?.click();

	return (
		<section
			className="relative flex h-full min-h-0 flex-col"
			data-studio-canvas={mode}
			aria-label={t("canvas.label", { defaultValue: "Image tools" })}
			onDragOver={(event) => {
				if (!Array.from(event.dataTransfer.types).includes("Files")) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
				setDragging(true);
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					setDragging(false);
				}
			}}
			onDrop={(event) => {
				event.preventDefault();
				setDragging(false);
				const files = Array.from(event.dataTransfer.files);
				if (files.length) acceptFiles(files);
			}}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept="image/*"
				className="sr-only"
				tabIndex={-1}
				aria-hidden
				onChange={(event) => {
					const files = Array.from(event.target.files ?? []);
					// Reset so choosing the same file again still fires a change.
					event.target.value = "";
					if (files.length) acceptFiles(files);
				}}
				data-image-file-input
			/>

			<StudioThread empty={items.length === 0} isNarrow={isNarrow}>
				{items.length === 0 ? (
					<WorkspaceEmptyState
						compact={isNarrow}
						visual={<WorkspaceEmptyVisual icon={Wand2} compact={isNarrow} />}
						title={taskText(task, "label")}
						description={taskText(task, "description")}
						suggestions={IMAGE_TOOL_TASKS.filter(supports).map((option) => ({
							key: option,
							label: taskText(option, "label"),
							icon: TASK_META[option].icon,
							attributes: { "data-image-tool-suggestion": option },
							// Picking a tool here is the first step of using it.
							onSelect: () => {
								setTask(option);
								chooseFile();
							},
						}))}
					/>
				) : (
					items.map((item) => (
						<ImageToolCard
							key={item.id}
							item={item}
							isNarrow={isNarrow}
							onRetry={retry}
							onDelete={(target) => void deleteItem(mode, target.id)}
						/>
					))
				)}
			</StudioThread>

			<ImageToolInput
				staged={staged}
				onChoose={chooseFile}
				onClear={() => {
					revokePreviewUrl(stagedUrl.current);
					stagedUrl.current = null;
					setStaged(null);
					setError(null);
				}}
				task={task}
				onTaskChange={setTask}
				supports={supports}
				threshold={threshold}
				onThresholdChange={setThreshold}
				running={running}
				onRun={() => {
					if (staged)
						void run({ task, source: { file: staged.file }, threshold });
				}}
				onStop={() => abortRef.current?.abort()}
				error={error}
				above={supported ? null : <SwitchModelHint task={task} />}
				isNarrow={isNarrow}
			/>

			{dragging ? (
				<div
					className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/80 text-sm font-medium"
					data-image-drop-zone
				>
					{t("input.dropNow", { defaultValue: "Drop the image to use it" })}
				</div>
			) : null}
		</section>
	);
};
