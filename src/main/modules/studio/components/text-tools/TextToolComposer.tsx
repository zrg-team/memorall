import {
	ChevronDown,
	FileText,
	SlidersHorizontal,
	Tags,
	X,
} from "lucide-react";
import type React from "react";
import {
	forwardRef,
	useId,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import { Switch } from "@/main/components/ui/switch";
import type { TextToolTask } from "@/services/llm/interfaces/model-category";
import {
	COMPOSER_CONTROL,
	StudioComposer,
	StudioComposerTextarea,
} from "../shared/StudioComposer";
import {
	DEFAULT_HYPOTHESIS_TEMPLATE,
	parseDocuments,
	parseLabels,
	uniqueNonEmpty,
} from "./text-tool-format";
import { TextToolTaskSelector } from "./TextToolTaskPicker";

/** Everything the composer holds between runs. */
export interface TextToolDraft {
	/** The text to classify, or the ranking query. */
	text: string;
	/** Zero-shot labels already turned into chips. */
	labels: string[];
	/** What is typed in the labels field and not yet a chip. */
	labelDraft: string;
	multiLabel: boolean;
	hypothesisTemplate: string;
	/** Ranking documents, one per line. */
	documents: string;
}

export const EMPTY_TEXT_TOOL_DRAFT: TextToolDraft = {
	text: "",
	labels: [],
	labelDraft: "",
	multiLabel: false,
	hypothesisTemplate: DEFAULT_HYPOTHESIS_TEMPLATE,
	documents: "",
};

/** The labels a run would send: the chips plus whatever is still typed. */
export const draftLabels = (draft: TextToolDraft) =>
	uniqueNonEmpty([...draft.labels, ...parseLabels(draft.labelDraft)]);

export const draftDocuments = (draft: TextToolDraft) =>
	parseDocuments(draft.documents);

/** Whether the draft holds everything `task` needs. */
export const draftIsComplete = (task: TextToolTask, draft: TextToolDraft) => {
	if (!draft.text.trim()) return false;
	if (task === "zero-shot-classification") return draftLabels(draft).length > 0;
	if (task === "text-ranking") return draftDocuments(draft).length > 0;
	return true;
};

export interface TextToolComposerHandle {
	focus: () => void;
}

interface TextToolComposerProps {
	task: TextToolTask;
	onTaskChange: (task: TextToolTask) => void;
	supports: (task: TextToolTask) => boolean;
	draft: TextToolDraft;
	onDraftChange: (patch: Partial<TextToolDraft>) => void;
	running: boolean;
	onSubmit: () => void;
	onStop: () => void;
	/** Above the card: the switch-model hint. */
	hint?: React.ReactNode;
	isNarrow: boolean;
}

const LabelsField: React.FC<{
	draft: TextToolDraft;
	onDraftChange: (patch: Partial<TextToolDraft>) => void;
	onEnter: () => void;
	disabled: boolean;
}> = ({ draft, onDraftChange, onEnter, disabled }) => {
	const { t } = useTranslation("studioText");
	const inputId = useId();
	const multiId = useId();
	const commit = (text: string) => {
		const added = parseLabels(text);
		onDraftChange({
			labels: uniqueNonEmpty([...draft.labels, ...added]),
			labelDraft: "",
		});
	};
	const labelsName = t("composer.labels", { defaultValue: "Labels" });
	return (
		<div
			className="flex flex-wrap items-center gap-1.5 border-t border-border/50 px-3 py-2 sm:px-4"
			data-text-tool-labels
		>
			<Tags size={14} className="shrink-0 text-muted-foreground" aria-hidden />
			<label htmlFor={inputId} className="sr-only">
				{labelsName}
			</label>
			{draft.labels.map((label) => (
				<span
					key={label}
					className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-border bg-muted/40 py-0.5 pl-2 pr-0.5 text-xs"
					data-text-tool-label-chip={label}
				>
					<span className="min-w-0 truncate">{label}</span>
					<button
						type="button"
						className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() =>
							onDraftChange({
								labels: draft.labels.filter((entry) => entry !== label),
							})
						}
						disabled={disabled}
						aria-label={t("composer.removeLabel", {
							label,
							defaultValue: `Remove ${label}`,
						})}
					>
						<X size={10} />
					</button>
				</span>
			))}
			<input
				id={inputId}
				value={draft.labelDraft}
				onChange={(event) => {
					const value = event.target.value;
					if (!value.includes(",")) {
						onDraftChange({ labelDraft: value });
						return;
					}
					// A comma finishes a label; the text after the last one stays typed.
					const pieces = value.split(",");
					const rest = pieces.pop() ?? "";
					onDraftChange({
						labels: uniqueNonEmpty([...draft.labels, ...pieces]),
						labelDraft: rest.trimStart(),
					});
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !event.nativeEvent.isComposing) {
						event.preventDefault();
						if (draft.labelDraft.trim()) commit(draft.labelDraft);
						else onEnter();
					} else if (
						event.key === "Backspace" &&
						!draft.labelDraft &&
						draft.labels.length > 0
					) {
						onDraftChange({ labels: draft.labels.slice(0, -1) });
					}
				}}
				onBlur={() => {
					if (draft.labelDraft.trim()) commit(draft.labelDraft);
				}}
				placeholder={
					draft.labels.length > 0
						? t("composer.addLabel", { defaultValue: "Add a label" })
						: t("composer.labelsPlaceholder", {
								defaultValue: "Labels, separated by commas",
							})
				}
				className="h-7 min-w-[9rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
				data-text-tool-label-input
			/>
			<div className="ml-auto flex shrink-0 items-center gap-2">
				<Switch
					id={multiId}
					checked={draft.multiLabel}
					onCheckedChange={(checked) => onDraftChange({ multiLabel: checked })}
					data-text-tool-multi-label
				/>
				<Label
					htmlFor={multiId}
					className="cursor-pointer text-xs font-normal text-muted-foreground"
				>
					{t("composer.multiLabel", {
						defaultValue: "Several labels can apply",
					})}
				</Label>
			</div>
		</div>
	);
};

const DocumentsPanel: React.FC<{
	documents: string;
	onChange: (documents: string) => void;
}> = ({ documents, onChange }) => {
	const { t } = useTranslation("studioText");
	const [open, setOpen] = useState(true);
	const textareaId = useId();
	const count = parseDocuments(documents).length;
	const title = t("composer.documents", { defaultValue: "Documents" });
	return (
		<div
			className="overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-sm"
			data-text-tool-documents-panel
			data-open={open}
		>
			<button
				type="button"
				aria-expanded={open}
				aria-controls={textareaId}
				onClick={() => setOpen((current) => !current)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
				data-text-tool-documents-toggle
			>
				<FileText size={14} className="shrink-0 text-muted-foreground" />
				<span>{title}</span>
				<span
					className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground"
					data-text-tool-document-count={count}
				>
					{count}
				</span>
				<span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">
					{t("composer.documentsHint", { defaultValue: "One per line" })}
				</span>
				<ChevronDown
					size={14}
					className={cn(
						"shrink-0 text-muted-foreground transition-transform",
						open && "rotate-180",
					)}
				/>
			</button>
			{open ? (
				<textarea
					id={textareaId}
					value={documents}
					onChange={(event) => onChange(event.target.value)}
					aria-label={title}
					placeholder={t("composer.documentsPlaceholder", {
						defaultValue:
							"Paste the documents to rank, one on each line.\nThe most relevant comes first.",
					})}
					rows={4}
					className="block max-h-56 min-h-[96px] w-full resize-y border-0 border-t border-border/50 bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground sm:px-4"
					data-text-tool-documents
				/>
			) : null}
		</div>
	);
};

/**
 * The composer pinned under the results: chat's composer holding the text,
 * with the task and its options in the toolbar. Zero-shot adds a labels row
 * to the card; ranking adds a documents panel above it.
 */
export const TextToolComposer = forwardRef<
	TextToolComposerHandle,
	TextToolComposerProps
>(
	(
		{
			task,
			onTaskChange,
			supports,
			draft,
			onDraftChange,
			running,
			onSubmit,
			onStop,
			hint,
			isNarrow,
		},
		ref,
	) => {
		const { t } = useTranslation("studioText");
		const { t: tc } = useTranslation("studio");
		const textarea = useRef<HTMLTextAreaElement>(null);
		const textareaId = useId();
		const templateId = useId();

		useImperativeHandle(ref, () => ({
			focus: () => textarea.current?.focus(),
		}));

		const canSubmit = supports(task) && draftIsComplete(task, draft);
		const submitIfReady = () => {
			if (canSubmit && !running) onSubmit();
		};

		const placeholder =
			task === "text-ranking"
				? t("composer.queryPlaceholder", {
						defaultValue: "What are you looking for?",
					})
				: task === "zero-shot-classification"
					? t("composer.zeroShotPlaceholder", {
							defaultValue: "Paste the text to sort into your labels",
						})
					: t("composer.textPlaceholder", {
							defaultValue: "Paste or write the text to classify",
						});

		const settingsLabel = t("composer.settings", {
			defaultValue: "Label settings",
		});
		const templateChanged =
			draft.hypothesisTemplate.trim() !== DEFAULT_HYPOTHESIS_TEMPLATE;

		const above =
			hint || task === "text-ranking" ? (
				<div className="space-y-2">
					{hint}
					{task === "text-ranking" ? (
						<DocumentsPanel
							documents={draft.documents}
							onChange={(documents) => onDraftChange({ documents })}
						/>
					) : null}
				</div>
			) : null;

		return (
			<StudioComposer
				data-text-tool-input
				data-task={task}
				above={above}
				running={running}
				canSubmit={canSubmit}
				onSubmit={onSubmit}
				onStop={onStop}
				submitLabel={t("composer.run", { defaultValue: "Run" })}
				stopLabel={tc("common.stop", { defaultValue: "Stop" })}
				submitProps={{ "data-text-tool-run": true }}
				stopProps={{ "data-text-tool-stop": true }}
				trailing={
					isNarrow ? null : (
						<span className="hidden truncate px-1 text-[11px] text-muted-foreground sm:inline">
							{t("composer.shortcut", { defaultValue: "Enter to run" })}
						</span>
					)
				}
				tools={
					<>
						<TextToolTaskSelector
							active={task}
							supported={supports}
							onSelect={onTaskChange}
							isNarrow={isNarrow}
						/>
						{task === "zero-shot-classification" ? (
							<Popover>
								<PopoverTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className={cn(
											COMPOSER_CONTROL,
											"shrink-0 gap-1 px-2",
											templateChanged && "text-foreground",
										)}
										aria-label={settingsLabel}
										title={settingsLabel}
										data-text-tool-settings-trigger
									>
										<SlidersHorizontal size={14} />
									</Button>
								</PopoverTrigger>
								<PopoverContent
									align="start"
									side="top"
									className="w-72 max-w-[calc(100vw-1.5rem)] space-y-1.5 p-3"
									data-text-tool-settings
								>
									<Label htmlFor={templateId} className="text-xs">
										{t("settings.hypothesisTemplate", {
											defaultValue: "Hypothesis template",
										})}
									</Label>
									<Input
										id={templateId}
										value={draft.hypothesisTemplate}
										onChange={(event) =>
											onDraftChange({ hypothesisTemplate: event.target.value })
										}
										placeholder={DEFAULT_HYPOTHESIS_TEMPLATE}
										className="h-8 text-xs"
										data-text-tool-hypothesis-template
									/>
									<p className="text-[11px] text-muted-foreground">
										{t("settings.hypothesisHint", {
											defaultValue:
												"Each label replaces {} to form the sentence the model checks.",
										})}
									</p>
								</PopoverContent>
							</Popover>
						) : null}
					</>
				}
			>
				<label htmlFor={textareaId} className="sr-only">
					{placeholder}
				</label>
				<StudioComposerTextarea
					id={textareaId}
					ref={textarea}
					value={draft.text}
					onChange={(event) => onDraftChange({ text: event.target.value })}
					onSubmitShortcut={submitIfReady}
					placeholder={placeholder}
					data-text-tool-text
				/>
				{task === "zero-shot-classification" ? (
					<LabelsField
						draft={draft}
						onDraftChange={onDraftChange}
						onEnter={submitIfReady}
						disabled={running}
					/>
				) : null}
			</StudioComposer>
		);
	},
);
TextToolComposer.displayName = "TextToolComposer";
