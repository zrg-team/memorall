import { Braces, CopyPlus, ListChecks, Plus, X } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/main/components/ui/tabs";
import {
	DECISION_QUESTION_TYPES,
	formatDecisionSchema,
	parseDecisionSchema,
	validateDecisionQuestions,
} from "@/services/llm/utils/decision-schema";
import type { DecisionQuestions } from "@/types/openai-media";
import { CopyTextButton } from "../image-generation/ImageActions";
import {
	draftsToQuestions,
	duplicateIds,
	emptyQuestionDraft,
	type QuestionDraft,
	questionsToDrafts,
} from "./decision-format";
import {
	DecisionQuestionEditor,
	QUESTION_TYPE_TEXT,
} from "./DecisionQuestionEditor";

/** Another session's questions, offered as a starting point. */
export interface DecisionSchemaSource {
	id: string;
	title: string;
	questions: DecisionQuestions;
}

interface DecisionSchemaPanelProps {
	drafts: QuestionDraft[];
	onDraftsChange: (drafts: QuestionDraft[]) => void;
	/** Other sessions that have questions. */
	sources: DecisionSchemaSource[];
	disabled?: boolean;
	/** Shown as a close button (the narrow layout's dialog). */
	onClose?: () => void;
	className?: string;
}

/** Problems per question id, and ones that belong to no question. */
export function schemaProblems(drafts: readonly QuestionDraft[]): {
	byKey: Map<string, string[]>;
	general: string[];
	count: number;
} {
	const byKey = new Map<string, string[]>();
	const general: string[] = [];
	const add = (key: string, message: string) =>
		byKey.set(key, [...(byKey.get(key) ?? []), message]);
	const duplicates = duplicateIds(drafts);
	const { errors } = validateDecisionQuestions(draftsToQuestions(drafts));
	for (const draft of drafts) {
		const id = draft.id.trim();
		if (!id) add(draft.key, "Give the question an id.");
		else if (duplicates.has(id))
			add(draft.key, `Another question is also "${id}".`);
	}
	for (const error of errors) {
		const owner = drafts.find((draft) => draft.id.trim() === error.questionId);
		if (owner) add(owner.key, error.message);
		else general.push(error.message);
	}
	let count = general.length;
	for (const messages of byKey.values()) count += messages.length;
	return { byKey, general, count };
}

export const DecisionSchemaPanel: React.FC<DecisionSchemaPanelProps> = ({
	drafts,
	onDraftsChange,
	sources,
	disabled = false,
	onClose,
	className,
}) => {
	const { t } = useTranslation("studioDecision");
	const [tab, setTab] = useState<"builder" | "json">("builder");
	const [jsonText, setJsonText] = useState("");
	const [jsonError, setJsonError] = useState<string | null>(null);

	const questions = useMemo(() => draftsToQuestions(drafts), [drafts]);
	const problems = useMemo(() => schemaProblems(drafts), [drafts]);
	const schemaJson = formatDecisionSchema(questions);

	const update = (key: string, patch: Partial<QuestionDraft>) =>
		onDraftsChange(
			drafts.map((draft) =>
				draft.key === key ? { ...draft, ...patch } : draft,
			),
		);

	const replaceWith = (next: DecisionQuestions) => {
		if (
			drafts.length > 0 &&
			!window.confirm(
				t("schema.replaceConfirm", {
					defaultValue: "Replace this session's questions?",
				}),
			)
		) {
			return;
		}
		onDraftsChange(questionsToDrafts(next));
		setJsonText(formatDecisionSchema(next));
		setJsonError(null);
	};

	const onJsonChange = (text: string) => {
		setJsonText(text);
		const parsed = parseDecisionSchema(text);
		if (parsed.syntaxError) {
			setJsonError(parsed.syntaxError);
			return;
		}
		if (!parsed.questions) {
			setJsonError(parsed.errors[0]?.message ?? "Not a questions object.");
			return;
		}
		setJsonError(null);
		onDraftsChange(questionsToDrafts(parsed.questions));
	};

	const count = drafts.length;

	return (
		<section
			className={cn("flex min-h-0 flex-col", className)}
			aria-label={t("schema.title", { defaultValue: "Questions" })}
			data-decision-schema
		>
			<header className="flex items-center gap-1.5 px-3 pb-2 pt-3">
				<ListChecks size={15} className="shrink-0 text-muted-foreground" />
				<h2 className="text-sm font-semibold">
					{t("schema.title", { defaultValue: "Questions" })}
				</h2>
				<span
					className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground"
					data-decision-question-count={count}
				>
					{count}
				</span>
				<div className="ml-auto flex items-center gap-0.5">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-7 gap-1 px-2 text-xs text-muted-foreground"
								disabled={disabled || sources.length === 0}
								title={
									sources.length === 0
										? t("schema.noSources", {
												defaultValue: "No other session has questions yet",
											})
										: undefined
								}
								data-decision-copy-from
							>
								<CopyPlus size={13} />
								{t("schema.copyFrom", { defaultValue: "Copy from…" })}
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="max-w-72">
							<DropdownMenuLabel className="text-xs">
								{t("schema.copyFromLabel", {
									defaultValue: "Use the questions of",
								})}
							</DropdownMenuLabel>
							{sources.map((source) => {
								const size = Object.keys(source.questions).length;
								return (
									<DropdownMenuItem
										key={source.id}
										onSelect={() => replaceWith(source.questions)}
										data-decision-source={source.id}
									>
										<span className="min-w-0 flex-1 truncate">
											{source.title}
										</span>
										<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
											{t("schema.questionCount", {
												count: size,
												defaultValue:
													size === 1 ? "1 question" : `${size} questions`,
											})}
										</span>
									</DropdownMenuItem>
								);
							})}
						</DropdownMenuContent>
					</DropdownMenu>
					<CopyTextButton
						text={schemaJson}
						label={t("schema.copyJson", { defaultValue: "Copy JSON" })}
					/>
					{onClose ? (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-muted-foreground"
							onClick={onClose}
							aria-label={t("schema.close", { defaultValue: "Close" })}
						>
							<X size={14} />
						</Button>
					) : null}
				</div>
			</header>

			<Tabs
				value={tab}
				onValueChange={(value) => {
					const next = value as "builder" | "json";
					if (next === "json") {
						setJsonText(schemaJson);
						setJsonError(null);
					}
					setTab(next);
				}}
				className="flex min-h-0 flex-1 flex-col"
			>
				<TabsList className="mx-3 grid h-8 grid-cols-2">
					<TabsTrigger
						value="builder"
						className="text-xs"
						data-decision-tab="builder"
					>
						<ListChecks size={13} className="mr-1" />
						{t("schema.builder", { defaultValue: "Builder" })}
					</TabsTrigger>
					<TabsTrigger
						value="json"
						className="text-xs"
						data-decision-tab="json"
					>
						<Braces size={13} className="mr-1" />
						JSON
					</TabsTrigger>
				</TabsList>

				<TabsContent
					value="builder"
					className="mt-0 min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
				>
					{drafts.length === 0 ? (
						<p
							className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
							data-decision-schema-empty
						>
							{t("schema.empty", {
								defaultValue:
									"Add the questions to answer about each text. Every run answers all of them.",
							})}
						</p>
					) : null}
					{drafts.map((draft, index) => (
						<DecisionQuestionEditor
							key={draft.key}
							draft={draft}
							disabled={disabled}
							errors={problems.byKey.get(draft.key) ?? []}
							onChange={(patch) => update(draft.key, patch)}
							onRemove={() =>
								onDraftsChange(
									drafts.filter((entry) => entry.key !== draft.key),
								)
							}
							onDuplicate={() => {
								const copy = {
									...emptyQuestionDraft(
										draft.type,
										drafts.map((entry) => entry.id),
									),
									type: draft.type,
									instructions: draft.instructions,
									options: draft.options.map((option) => ({ ...option })),
									levels: [...draft.levels],
									noulTrue: draft.noulTrue,
									noulFalse: draft.noulFalse,
								};
								onDraftsChange([
									...drafts.slice(0, index + 1),
									copy,
									...drafts.slice(index + 1),
								]);
							}}
						/>
					))}
					<div className="flex flex-wrap gap-1 pt-1" data-decision-add-question>
						{DECISION_QUESTION_TYPES.map((type) => (
							<Button
								key={type}
								type="button"
								variant="outline"
								size="sm"
								className="h-7 gap-1 px-2 text-xs"
								disabled={disabled}
								onClick={() =>
									onDraftsChange([
										...drafts,
										emptyQuestionDraft(
											type,
											drafts.map((entry) => entry.id),
										),
									])
								}
								data-decision-add={type}
							>
								<Plus size={13} />
								{t(`types.${type}.label`, {
									defaultValue: QUESTION_TYPE_TEXT[type].label,
								})}
							</Button>
						))}
					</div>
					{problems.general.length > 0 && drafts.length > 0 ? (
						<ul className="text-[11px] text-destructive">
							{problems.general.map((message) => (
								<li key={message}>{message}</li>
							))}
						</ul>
					) : null}
				</TabsContent>

				<TabsContent
					value="json"
					className="mt-0 flex min-h-0 flex-1 flex-col gap-1.5 px-3 py-2"
				>
					<textarea
						value={jsonText}
						onChange={(event) => onJsonChange(event.target.value)}
						spellCheck={false}
						disabled={disabled}
						aria-label={t("schema.jsonLabel", {
							defaultValue: "Questions as JSON",
						})}
						className="min-h-[16rem] w-full flex-1 resize-none rounded-xl border border-border/70 bg-muted/30 p-3 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
						data-decision-json
					/>
					{jsonError ? (
						<p
							className="text-[11px] text-destructive"
							role="alert"
							data-decision-json-error
						>
							{jsonError}
						</p>
					) : (
						<p className="text-[11px] text-muted-foreground">
							{t("schema.jsonHint", {
								defaultValue:
									"The request's questions, as /systemone takes them. A full request with state works too.",
							})}
						</p>
					)}
				</TabsContent>
			</Tabs>
		</section>
	);
};
