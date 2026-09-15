import { TextSearch } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	WorkspaceEmptyState,
	WorkspaceEmptyVisual,
} from "@/main/components/molecules/WorkspaceEmptyState";
import { useStudioStore } from "@/main/stores/studio";
import {
	TEXT_TOOL_TASKS,
	type TextToolTask,
} from "@/services/llm/interfaces/model-category";
import type { StudioItem } from "@/types/studio";
import { logError } from "@/utils/logger";
import { isCancellation, runTextTool } from "../../services/studio-service";
import { textTaskOf } from "../../studio-model-info";
import { StudioThread } from "../shared/StudioThread";
import type { StudioCanvasProps } from "../studio-canvas";
import {
	DEFAULT_HYPOTHESIS_TEMPLATE,
	inputTextOf,
	requestParamsOf,
	textTaskOfItem,
} from "./text-tool-format";
import { TextToolCard } from "./TextToolCard";
import {
	draftDocuments,
	draftIsComplete,
	draftLabels,
	EMPTY_TEXT_TOOL_DRAFT,
	TextToolComposer,
	type TextToolComposerHandle,
	type TextToolDraft,
} from "./TextToolComposer";
import { TEXT_TASK_META, TextToolSwitchModelHint } from "./TextToolTaskPicker";

interface TextToolRequest {
	task: TextToolTask;
	input: string;
	labels?: string[];
	multiLabel?: boolean;
	hypothesisTemplate?: string;
	documents?: string[];
}

interface TextToolExample {
	key: string;
	task: TextToolTask;
	label: string;
	text: string;
	/** Zero-shot: comma-separated labels. */
	labels?: string;
	/** Ranking: one document per line. */
	documents?: string;
}

const EXAMPLES: readonly TextToolExample[] = [
	{
		key: "review",
		task: "text-classification",
		label: "Classify a product review",
		text: "The battery died after two days and support never answered my emails.",
	},
	{
		key: "comment",
		task: "text-classification",
		label: "Read the mood of a comment",
		text: "Loved the new update, everything feels faster and the dark mode is gorgeous!",
	},
	{
		key: "ticket",
		task: "zero-shot-classification",
		label: "Route a support ticket",
		text: "I was charged twice for my subscription this month and the app still says my plan has expired.",
		labels: "billing, bug, feature request",
	},
	{
		key: "headline",
		task: "zero-shot-classification",
		label: "Tag a news headline",
		text: "The central bank raised interest rates by half a point to cool inflation.",
		labels: "economy, politics, sports, technology",
	},
	{
		key: "password",
		task: "text-ranking",
		label: "Find the answer to a question",
		text: "How do I reset my password?",
		documents:
			"Our office is open Monday to Friday, from 9 am to 5 pm.\nOpen Settings, choose Account, then select Reset password and follow the link we email you.\nYou can change your profile picture from the Account page.",
	},
	{
		key: "capital",
		task: "text-ranking",
		label: "Rank search results",
		text: "What is the capital of Australia?",
		documents:
			"Sydney is the largest city in Australia.\nCanberra is the capital city of Australia.\nKangaroos are native to Australia.",
	},
];

const EMPTY_TEXT: Record<TextToolTask, { title: string; description: string }> =
	{
		"text-classification": {
			title: "Classify text",
			description:
				"Paste a review, a message or a comment to see what it is about or how it feels, with a score for each label.",
		},
		"zero-shot-classification": {
			title: "Sort text into your labels",
			description:
				"Write a text and the labels you care about. The model scores how well each label fits, no training needed.",
		},
		"text-ranking": {
			title: "Rank documents",
			description:
				"Ask a question and add the documents to compare, one per line. The most relevant ones come first.",
		},
	};

export const TextToolsStudio: React.FC<StudioCanvasProps> = ({
	mode,
	modelInfo,
	items,
	ensureModelReady,
	isNarrow,
}) => {
	const { t } = useTranslation("studioText");
	const deleteItem = useStudioStore((store) => store.deleteItem);

	const modelTasks = useMemo(() => {
		const declared = textTaskOf(modelInfo);
		return declared ? [declared] : [];
	}, [modelInfo]);
	// A model that does not report its task may try any of them rather than
	// having every task locked.
	const supports = useCallback(
		(task: TextToolTask) =>
			modelTasks.length === 0 || modelTasks.includes(task),
		[modelTasks],
	);

	const [task, setTask] = useState<TextToolTask>(
		() => modelTasks[0] ?? TEXT_TOOL_TASKS[0],
	);
	const [draft, setDraft] = useState<TextToolDraft>(EMPTY_TEXT_TOOL_DRAFT);
	const [running, setRunning] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const composerRef = useRef<TextToolComposerHandle>(null);

	// Picking a model for another task in the shell should land on that task.
	useEffect(() => {
		setTask((current) =>
			modelTasks.length === 0 || modelTasks.includes(current)
				? current
				: (modelTasks[0] ?? current),
		);
	}, [modelTasks]);

	const updateDraft = useCallback(
		(patch: Partial<TextToolDraft>) =>
			setDraft((current) => ({ ...current, ...patch })),
		[],
	);

	const run = useCallback(
		async (request: TextToolRequest) => {
			if (abortRef.current || !supports(request.task)) return;
			const controller = new AbortController();
			abortRef.current = controller;
			setRunning(true);
			try {
				const ready = await ensureModelReady();
				if (controller.signal.aborted) return;
				await runTextTool({
					model: ready,
					task: request.task,
					input: request.input,
					labels: request.labels,
					multiLabel: request.multiLabel,
					hypothesisTemplate: request.hypothesisTemplate,
					documents: request.documents,
					signal: controller.signal,
				});
			} catch (reason) {
				// Run failures are shown on the card; load failures in the shell.
				if (!isCancellation(reason))
					logError("[TextToolsStudio] run failed", reason);
			} finally {
				if (abortRef.current === controller) {
					abortRef.current = null;
					setRunning(false);
				}
			}
		},
		[ensureModelReady, supports],
	);

	const requestFor = (
		forTask: TextToolTask,
		input: string,
		from: {
			labels: string[];
			documents: string[];
			multiLabel: boolean;
			hypothesisTemplate?: string;
		},
	): TextToolRequest => {
		if (forTask === "zero-shot-classification") {
			const template = from.hypothesisTemplate?.trim();
			return {
				task: forTask,
				input,
				labels: from.labels,
				multiLabel: from.multiLabel,
				hypothesisTemplate:
					template && template !== DEFAULT_HYPOTHESIS_TEMPLATE
						? template
						: undefined,
			};
		}
		if (forTask === "text-ranking") {
			return { task: forTask, input, documents: from.documents };
		}
		return { task: forTask, input };
	};

	const submit = () => {
		if (running || !supports(task) || !draftIsComplete(task, draft)) return;
		const labels = draftLabels(draft);
		const request = requestFor(task, draft.text.trim(), {
			labels,
			documents: draftDocuments(draft),
			multiLabel: draft.multiLabel,
			hypothesisTemplate: draft.hypothesisTemplate,
		});
		// The text is spent; labels and documents usually serve the next run too.
		setDraft((current) => ({
			...current,
			text: "",
			labels: task === "zero-shot-classification" ? labels : current.labels,
			labelDraft: task === "zero-shot-classification" ? "" : current.labelDraft,
		}));
		void run(request);
	};

	const reuse = (item: StudioItem) => {
		const itemTask = textTaskOfItem(item);
		const params = requestParamsOf(item);
		if (itemTask) setTask(itemTask);
		setDraft((current) => ({
			...current,
			text: inputTextOf(item),
			labels: params.labels.length > 0 ? params.labels : current.labels,
			labelDraft: params.labels.length > 0 ? "" : current.labelDraft,
			multiLabel:
				itemTask === "zero-shot-classification"
					? params.multiLabel
					: current.multiLabel,
			hypothesisTemplate:
				params.hypothesisTemplate ??
				(itemTask === "zero-shot-classification"
					? DEFAULT_HYPOTHESIS_TEMPLATE
					: current.hypothesisTemplate),
			documents:
				params.documents.length > 0
					? params.documents.join("\n")
					: current.documents,
		}));
		composerRef.current?.focus();
	};

	const retry = (item: StudioItem) => {
		const itemTask = textTaskOfItem(item);
		const input = inputTextOf(item);
		if (!itemTask || !input || running) return;
		if (!supports(itemTask)) {
			setTask(itemTask);
			return;
		}
		void run(requestFor(itemTask, input, requestParamsOf(item)));
		// The retry replaces the failed card rather than stacking a second one.
		void deleteItem(mode, item.id);
	};

	const applyExample = (example: TextToolExample) => {
		const text = t(`examples.${example.key}.text`, {
			defaultValue: example.text,
		});
		setTask(example.task);
		setDraft((current) => ({
			...current,
			text,
			...(example.labels
				? {
						labels: [],
						labelDraft: t(`examples.${example.key}.labels`, {
							defaultValue: example.labels,
						}),
					}
				: {}),
			...(example.documents
				? {
						documents: t(`examples.${example.key}.documents`, {
							defaultValue: example.documents,
						}),
					}
				: {}),
		}));
		composerRef.current?.focus();
	};

	// The chosen task's examples lead; other runnable tasks follow.
	const examples = [
		...EXAMPLES.filter((example) => example.task === task),
		...EXAMPLES.filter(
			(example) => example.task !== task && supports(example.task),
		),
	];

	return (
		<section
			className="relative flex h-full min-h-0 flex-col"
			data-studio-canvas={mode}
			aria-label={t("canvas.label", { defaultValue: "Text tools" })}
		>
			<StudioThread empty={items.length === 0} isNarrow={isNarrow}>
				{items.length === 0 ? (
					<WorkspaceEmptyState
						compact={isNarrow}
						visual={
							<WorkspaceEmptyVisual icon={TextSearch} compact={isNarrow} />
						}
						title={t(`empty.${task}.title`, {
							defaultValue: EMPTY_TEXT[task].title,
						})}
						description={t(`empty.${task}.description`, {
							defaultValue: EMPTY_TEXT[task].description,
						})}
						suggestions={examples.map((example) => ({
							key: example.key,
							label: t(`examples.${example.key}.label`, {
								defaultValue: example.label,
							}),
							icon: TEXT_TASK_META[example.task].icon,
							attributes: {
								"data-text-tool-example": example.key,
								"data-task": example.task,
							},
							onSelect: () => applyExample(example),
						}))}
						columns={2}
					/>
				) : (
					items.map((item) => (
						<TextToolCard
							key={item.id}
							item={item}
							isNarrow={isNarrow}
							onReuse={reuse}
							onRetry={retry}
							onDelete={(target) => void deleteItem(mode, target.id)}
						/>
					))
				)}
			</StudioThread>

			<TextToolComposer
				ref={composerRef}
				task={task}
				onTaskChange={setTask}
				supports={supports}
				draft={draft}
				onDraftChange={updateDraft}
				running={running}
				onSubmit={submit}
				onStop={() => abortRef.current?.abort()}
				hint={supports(task) ? null : <TextToolSwitchModelHint task={task} />}
				isNarrow={isNarrow}
			/>
		</section>
	);
};
