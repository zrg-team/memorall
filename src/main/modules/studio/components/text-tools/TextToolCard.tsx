import { Repeat2, RotateCcw, Trash2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { ImageToolLabel, TextToolRanking } from "@/types/openai-media";
import type { StudioItem } from "@/types/studio";
import { CopyTextButton } from "../image-generation/ImageActions";
import { useElapsedSeconds } from "../image-generation/ImageGenerationCard";
import { SaveToFilesAction } from "../shared/SaveToFilesAction";
import {
	STUDIO_ACTION_CLASS,
	StudioAction,
	StudioTurn,
} from "../shared/StudioThread";
import {
	formatPercent,
	inputTextOf,
	markdownFileName,
	requestParamsOf,
	resultLabelsOf,
	resultRankingOf,
	resultsAsMarkdown,
	resultsAsText,
	textTaskOfItem,
} from "./text-tool-format";
import { TEXT_TASK_META, useTextTaskText } from "./TextToolTaskPicker";

/** Inputs longer than this start clamped behind "Show more". */
const LONG_INPUT_CHARS = 280;
const LONG_INPUT_LINES = 4;

const ScoreBar: React.FC<{ score: number }> = ({ score }) => (
	<div className="h-1 overflow-hidden rounded-full bg-muted">
		<div
			className="h-full rounded-full bg-primary"
			style={{ width: formatPercent(score) }}
		/>
	</div>
);

/** Labels with score bars, the same look as image classification. */
export const TextLabelScores: React.FC<{
	labels: readonly ImageToolLabel[];
}> = ({ labels }) => (
	<ul className="w-full max-w-md space-y-1.5" data-text-tool-result-labels>
		{labels.map((entry) => (
			<li
				key={entry.label}
				className="space-y-0.5"
				data-text-tool-result-label={entry.label}
			>
				<div className="flex items-baseline justify-between gap-2 text-xs">
					<span className="truncate">{entry.label}</span>
					<span className="tabular-nums text-muted-foreground">
						{formatPercent(entry.score)}
					</span>
				</div>
				<ScoreBar score={entry.score} />
			</li>
		))}
	</ul>
);

const RankedDocument: React.FC<{
	entry: TextToolRanking;
	rank: number;
}> = ({ entry, rank }) => (
	<li
		className="flex min-w-0 gap-2.5 py-2 first:pt-0 last:pb-0"
		data-text-tool-rank={rank}
		data-document-index={entry.index}
	>
		<span
			className={cn(
				"flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums",
				rank === 1
					? "bg-primary/15 text-primary"
					: "bg-muted text-muted-foreground",
			)}
			aria-hidden
		>
			{rank}
		</span>
		<div className="min-w-0 flex-1 space-y-1">
			<p
				className="line-clamp-3 whitespace-pre-line break-words text-sm leading-relaxed"
				title={entry.document}
			>
				{entry.document}
			</p>
			<div className="flex items-center gap-2">
				<div className="w-full max-w-[12rem] flex-1">
					<ScoreBar score={entry.score} />
				</div>
				<span className="text-xs tabular-nums text-muted-foreground">
					{formatPercent(entry.score)}
				</span>
			</div>
		</div>
	</li>
);

const RequestText: React.FC<{ text: string }> = ({ text }) => {
	const { t } = useTranslation("studioText");
	const [expanded, setExpanded] = useState(false);
	const long =
		text.length > LONG_INPUT_CHARS ||
		text.split(/\r?\n/).length > LONG_INPUT_LINES;
	return (
		<span className="flex min-w-0 flex-col items-start gap-0.5">
			<span
				className={cn(
					"whitespace-pre-line break-words",
					long && !expanded && "line-clamp-4",
				)}
				data-text-tool-request-text
			>
				{text}
			</span>
			{long ? (
				<button
					type="button"
					onClick={() => setExpanded((current) => !current)}
					aria-expanded={expanded}
					className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					data-text-tool-show-more
				>
					{expanded
						? t("card.showLess", { defaultValue: "Show less" })
						: t("card.showMore", { defaultValue: "Show more" })}
				</button>
			) : null}
		</span>
	);
};

const CHIP_CLASS =
	"rounded-md border border-border/40 bg-muted/50 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground";

interface TextToolCardProps {
	item: StudioItem;
	isNarrow: boolean;
	onReuse: (item: StudioItem) => void;
	onRetry: (item: StudioItem) => void;
	onDelete: (item: StudioItem) => void;
}

export const TextToolCard: React.FC<TextToolCardProps> = ({
	item,
	isNarrow,
	onReuse,
	onRetry,
	onDelete,
}) => {
	const { t } = useTranslation("studioText");
	const { t: tc } = useTranslation("studio");
	const taskText = useTextTaskText();
	const task = textTaskOfItem(item);
	const { status } = item.generation;
	const running = status === "running";
	const seconds = useElapsedSeconds(item.createdAt, running);
	const input = inputTextOf(item);
	const params = requestParamsOf(item);
	const labels = resultLabelsOf(item);
	const ranking = resultRankingOf(item);
	const hasResults = labels.length > 0 || ranking.length > 0;
	const Icon = task ? TEXT_TASK_META[task].icon : null;
	const taskLabel = task
		? taskText(task, "label")
		: t("canvas.label", { defaultValue: "Text tools" });

	const labelCount = params.labels.length;
	const documentCount = params.documents.length;

	const request = (
		<span className="flex min-w-0 flex-col gap-1.5">
			<span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
				{Icon ? <Icon size={13} className="shrink-0" /> : null}
				<span className="truncate">{taskLabel}</span>
			</span>
			<RequestText text={input} />
			{labelCount > 0 || documentCount > 0 ? (
				<span className="flex flex-wrap items-center gap-1">
					{labelCount > 0 ? (
						<span
							className={CHIP_CLASS}
							title={params.labels.join(", ")}
							data-text-tool-label-count={labelCount}
						>
							{t("card.labelCount", {
								count: labelCount,
								defaultValue:
									labelCount === 1 ? "1 label" : `${labelCount} labels`,
							})}
						</span>
					) : null}
					{task === "zero-shot-classification" && params.multiLabel ? (
						<span className={CHIP_CLASS} data-text-tool-multi-label-chip>
							{t("card.multiLabel", { defaultValue: "Several can apply" })}
						</span>
					) : null}
					{documentCount > 0 ? (
						<span
							className={CHIP_CLASS}
							data-text-tool-document-chip={documentCount}
						>
							{t("card.documentCount", {
								count: documentCount,
								defaultValue:
									documentCount === 1
										? "1 document"
										: `${documentCount} documents`,
							})}
						</span>
					) : null}
				</span>
			) : null}
		</span>
	);

	let body: React.ReactNode = null;
	if (status === "done") {
		if (!hasResults) {
			body = (
				<p className="text-xs text-muted-foreground" data-text-tool-no-results>
					{t("card.noResults", { defaultValue: "The model returned nothing." })}
				</p>
			);
		} else {
			body = (
				<>
					{labels.length > 0 ? <TextLabelScores labels={labels} /> : null}
					{ranking.length > 0 ? (
						<ol
							className="w-full divide-y divide-border/50"
							data-text-tool-ranking
						>
							{ranking.map((entry, position) => (
								<RankedDocument
									key={entry.index}
									entry={entry}
									rank={position + 1}
								/>
							))}
						</ol>
					) : null}
				</>
			);
		}
	}

	const markdown = () =>
		resultsAsMarkdown({
			taskLabel,
			input,
			inputHeading:
				task === "text-ranking"
					? t("export.query", { defaultValue: "Query" })
					: t("export.text", { defaultValue: "Text" }),
			resultsHeading: t("export.results", { defaultValue: "Results" }),
			labels,
			ranking,
		});

	return (
		<StudioTurn
			item={item}
			data-text-tool-item={item.id}
			data-task={task}
			request={request}
			runningLabel={`${tc("common.running", { defaultValue: "Working…" })} · ${t(
				"card.elapsed",
				{ seconds, defaultValue: `${seconds}s` },
			)}`}
			actions={
				<>
					{status === "done" && hasResults ? (
						<CopyTextButton
							text={resultsAsText(labels, ranking)}
							label={t("card.copyResults", { defaultValue: "Copy results" })}
							showLabel={!isNarrow}
							className={cn(STUDIO_ACTION_CLASS, "w-auto")}
						/>
					) : null}
					{status === "done" && hasResults ? (
						<SaveToFilesAction
							fileName={markdownFileName(input)}
							mimeType="text/markdown"
							content={async () => markdown()}
							iconOnly={isNarrow}
							data-text-tool-save
						/>
					) : null}
					<StudioAction
						icon={<Repeat2 className="h-3.5 w-3.5" />}
						label={t("card.reuse", { defaultValue: "Reuse input" })}
						iconOnly
						onClick={() => onReuse(item)}
						data-text-tool-reuse
					/>
					{status === "failed" || status === "cancelled" ? (
						<StudioAction
							icon={<RotateCcw className="h-3.5 w-3.5" />}
							label={tc("common.retry", { defaultValue: "Retry" })}
							onClick={() => onRetry(item)}
							disabled={!task || !input}
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
