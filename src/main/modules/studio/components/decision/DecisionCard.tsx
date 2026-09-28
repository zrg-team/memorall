import { Braces, ListChecks, Repeat2, RotateCcw, Trash2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { decisionToMarkdown } from "@/services/llm/utils/decision-schema";
import type { DecisionAnswer, DecisionQuestion } from "@/types/openai-media";
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
} from "../text-tools/text-tool-format";
import { RequestText, TextLabelScores } from "../text-tools/TextToolCard";
import {
	choiceBars,
	decisionResultOf,
	exchangeJson,
	nearestLevel,
	questionsOfItem,
	scoreBars,
} from "./decision-format";
import { QUESTION_TYPE_TEXT } from "./DecisionQuestionEditor";

const CHIP_CLASS =
	"rounded-md border border-border/40 bg-muted/50 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground";

const AnswerView: React.FC<{
	id: string;
	question: DecisionQuestion;
	answer: DecisionAnswer | undefined;
}> = ({ id, question, answer }) => {
	const { t } = useTranslation("studioDecision");
	let headline: React.ReactNode = (
		<span className="text-muted-foreground">
			{t("card.noAnswer", { defaultValue: "No answer" })}
		</span>
	);
	let bars: React.ReactNode = null;
	if (answer?.type === "choice") {
		headline = (
			<>
				<strong className="font-semibold">{answer.choice}</strong>
				{answer.confidence !== undefined ? (
					<span className="text-muted-foreground">
						{" · "}
						{t("card.confidence", {
							value: formatPercent(answer.confidence),
							defaultValue: `${formatPercent(answer.confidence)} confident`,
						})}
					</span>
				) : null}
			</>
		);
		bars = <TextLabelScores labels={choiceBars(question, answer)} />;
	} else if (answer?.type === "score") {
		const levels = Math.max(1, scoreBars(question, answer).length - 1);
		const level = nearestLevel(question, answer);
		headline = (
			<>
				<strong className="font-semibold tabular-nums">
					{answer.score.toFixed(2)}
				</strong>
				<span className="text-muted-foreground">
					{" "}
					/ {levels}
					{level ? ` · ${level}` : ""}
				</span>
			</>
		);
		bars = <TextLabelScores labels={scoreBars(question, answer)} />;
	} else if (answer?.type === "noul") {
		headline = (
			<>
				<strong className="font-semibold tabular-nums">
					{formatPercent(answer.noul)}
				</strong>
				<span className="text-muted-foreground">
					{" "}
					{t("card.likelyTrue", { defaultValue: "likely true" })}
				</span>
			</>
		);
		bars = (
			<TextLabelScores
				labels={[
					{
						label: t("card.true", { defaultValue: "True" }),
						score: answer.noul,
					},
				]}
			/>
		);
	}
	return (
		<section
			className="space-y-1.5"
			data-decision-answer={id}
			data-answer-type={answer?.type ?? "none"}
		>
			<div className="flex min-w-0 items-baseline gap-2">
				<span className="truncate font-mono text-xs font-medium">{id}</span>
				<span className="shrink-0 text-[11px] text-muted-foreground">
					{t(`types.${question.type}.label`, {
						defaultValue: QUESTION_TYPE_TEXT[question.type].label,
					})}
				</span>
			</div>
			{question.instructions.trim() ? (
				<p className="text-xs text-muted-foreground">{question.instructions}</p>
			) : null}
			<p className="text-sm" data-decision-headline>
				{headline}
			</p>
			{bars}
		</section>
	);
};

interface DecisionCardProps {
	item: StudioItem;
	isNarrow: boolean;
	onReuse: (item: StudioItem) => void;
	onRetry: (item: StudioItem) => void;
	onDelete: (item: StudioItem) => void;
}

export const DecisionCard: React.FC<DecisionCardProps> = ({
	item,
	isNarrow,
	onReuse,
	onRetry,
	onDelete,
}) => {
	const { t } = useTranslation("studioDecision");
	const { t: tc } = useTranslation("studio");
	const [view, setView] = useState<"answers" | "json">("answers");
	const { status } = item.generation;
	const running = status === "running";
	const seconds = useElapsedSeconds(item.createdAt, running);
	const input = inputTextOf(item);
	const questions = questionsOfItem(item);
	const questionIds = Object.keys(questions);
	const result = decisionResultOf(item);
	const json = exchangeJson(item, input);

	const request = (
		<span className="flex min-w-0 flex-col gap-1.5">
			<span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
				<ListChecks size={13} className="shrink-0" />
				<span className="truncate">
					{t("card.label", { defaultValue: "Decision" })}
				</span>
			</span>
			<RequestText text={input} />
			{questionIds.length > 0 ? (
				<span className="flex flex-wrap items-center gap-1">
					<span
						className={CHIP_CLASS}
						title={questionIds.join(", ")}
						data-decision-card-question-count={questionIds.length}
					>
						{t("schema.questionCount", {
							count: questionIds.length,
							defaultValue:
								questionIds.length === 1
									? "1 question"
									: `${questionIds.length} questions`,
						})}
					</span>
				</span>
			) : null}
		</span>
	);

	let body: React.ReactNode = null;
	if (status === "done" && result) {
		body = (
			<div className="w-full max-w-md space-y-3">
				<div
					className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5"
					role="tablist"
				>
					{(["answers", "json"] as const).map((entry) => (
						<button
							key={entry}
							type="button"
							role="tab"
							aria-selected={view === entry}
							onClick={() => setView(entry)}
							className={cn(
								"flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								view === entry
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground",
							)}
							data-decision-card-view={entry}
						>
							{entry === "json" ? <Braces size={11} /> : null}
							{entry === "json"
								? "JSON"
								: t("card.answers", { defaultValue: "Answers" })}
						</button>
					))}
				</div>
				{view === "answers" ? (
					<div className="space-y-4" data-decision-answers>
						{questionIds.map((id) => (
							<AnswerView
								key={id}
								id={id}
								question={questions[id] as DecisionQuestion}
								answer={result.answers[id]}
							/>
						))}
					</div>
				) : (
					<pre
						className="max-h-96 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 font-mono text-[11px] leading-5"
						data-decision-card-json
					>
						{json}
					</pre>
				)}
			</div>
		);
	} else if (status === "done") {
		body = (
			<p className="text-xs text-muted-foreground" data-decision-no-results>
				{t("card.noResults", { defaultValue: "The model returned nothing." })}
			</p>
		);
	}

	const usage = result?.usage;
	const details =
		usage && (usage.input_tokens || usage.cost) ? (
			<>
				{usage.input_tokens ? (
					<span className={CHIP_CLASS} data-decision-tokens>
						{t("card.tokens", {
							count: usage.input_tokens,
							defaultValue: `${usage.input_tokens} tokens`,
						})}
					</span>
				) : null}
				{usage.cost ? (
					<span className={CHIP_CLASS} data-decision-cost>
						${usage.cost.toPrecision(2)}
					</span>
				) : null}
			</>
		) : null;

	return (
		<StudioTurn
			item={item}
			data-decision-item={item.id}
			request={request}
			details={details}
			runningLabel={`${tc("common.running", { defaultValue: "Working…" })} · ${t(
				"card.elapsed",
				{ seconds, defaultValue: `${seconds}s` },
			)}`}
			actions={
				<>
					{status === "done" && result ? (
						<CopyTextButton
							text={json}
							label={t("card.copyJson", { defaultValue: "Copy JSON" })}
							showLabel={!isNarrow}
							className={cn(STUDIO_ACTION_CLASS, "w-auto")}
						/>
					) : null}
					{status === "done" && result ? (
						<SaveToFilesAction
							fileName={markdownFileName(input)}
							mimeType="text/markdown"
							content={async () =>
								decisionToMarkdown({
									state: input,
									questions,
									answers: result.answers,
									model: result.model,
								})
							}
							iconOnly={isNarrow}
							data-decision-save
						/>
					) : null}
					<StudioAction
						icon={<Repeat2 className="h-3.5 w-3.5" />}
						label={t("card.reuse", {
							defaultValue: "Reuse text and questions",
						})}
						iconOnly
						onClick={() => onReuse(item)}
						data-decision-reuse
					/>
					{status === "failed" || status === "cancelled" ? (
						<StudioAction
							icon={<RotateCcw className="h-3.5 w-3.5" />}
							label={tc("common.retry", { defaultValue: "Retry" })}
							onClick={() => onRetry(item)}
							disabled={!input || questionIds.length === 0}
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
