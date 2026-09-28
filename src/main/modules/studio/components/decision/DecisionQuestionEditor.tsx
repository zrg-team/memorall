import { ArrowDown, ArrowUp, Copy, Plus, Trash2, X } from "lucide-react";
import type React from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import { Textarea } from "@/main/components/ui/textarea";
import {
	DECISION_LIMITS,
	DECISION_QUESTION_TYPES,
} from "@/services/llm/utils/decision-schema";
import type { DecisionQuestionType } from "@/types/openai-media";
import type { QuestionDraft } from "./decision-format";

export const QUESTION_TYPE_TEXT: Record<
	DecisionQuestionType,
	{ label: string; hint: string }
> = {
	choice: { label: "Choice", hint: "Pick one of your options." },
	score: { label: "Score", hint: "Place it on ordered levels, lowest first." },
	noul: { label: "Yes / no", hint: "How likely the statement is true." },
};

const ICON_BUTTON =
	"h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground";

interface DecisionQuestionEditorProps {
	draft: QuestionDraft;
	onChange: (patch: Partial<QuestionDraft>) => void;
	onDuplicate: () => void;
	onRemove: () => void;
	/** Problems with this question, already in words. */
	errors: string[];
	disabled?: boolean;
}

/** One question: id, type, what it asks and its answers. */
export const DecisionQuestionEditor: React.FC<DecisionQuestionEditorProps> = ({
	draft,
	onChange,
	onDuplicate,
	onRemove,
	errors,
	disabled = false,
}) => {
	const { t } = useTranslation("studioDecision");
	const idField = useId();
	const instructionsField = useId();
	const typeText = (type: DecisionQuestionType, key: "label" | "hint") =>
		t(`types.${type}.${key}`, { defaultValue: QUESTION_TYPE_TEXT[type][key] });

	const setOption = (
		index: number,
		patch: Partial<QuestionDraft["options"][number]>,
	) =>
		onChange({
			options: draft.options.map((option, position) =>
				position === index ? { ...option, ...patch } : option,
			),
		});

	const moveLevel = (index: number, offset: -1 | 1) => {
		const target = index + offset;
		if (target < 0 || target >= draft.levels.length) return;
		const levels = [...draft.levels];
		[levels[index], levels[target]] = [
			levels[target] ?? "",
			levels[index] ?? "",
		];
		onChange({ levels });
	};

	return (
		<fieldset
			className={cn(
				"space-y-2.5 rounded-xl border bg-card/60 p-3",
				errors.length > 0 ? "border-destructive/40" : "border-border/70",
			)}
			disabled={disabled}
			data-decision-question={draft.id}
			data-question-type={draft.type}
		>
			<legend className="sr-only">
				{t("builder.question", { defaultValue: "Question" })} {draft.id}
			</legend>
			<div className="flex items-center gap-1.5">
				<label htmlFor={idField} className="sr-only">
					{t("builder.id", { defaultValue: "Question id" })}
				</label>
				<Input
					id={idField}
					value={draft.id}
					onChange={(event) =>
						onChange({ id: event.target.value.replace(/\s+/g, "_") })
					}
					placeholder={t("builder.idPlaceholder", { defaultValue: "id" })}
					className="h-8 min-w-0 flex-1 font-mono text-xs"
					data-decision-question-id
				/>
				<Select
					value={draft.type}
					onValueChange={(value) =>
						onChange({ type: value as DecisionQuestionType })
					}
				>
					<SelectTrigger
						className="h-8 w-[7.5rem] shrink-0 text-xs"
						aria-label={t("builder.type", { defaultValue: "Answer type" })}
						data-decision-question-type
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{DECISION_QUESTION_TYPES.map((type) => (
							<SelectItem key={type} value={type} className="text-xs">
								{typeText(type, "label")}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className={ICON_BUTTON}
					onClick={onDuplicate}
					aria-label={t("builder.duplicate", { defaultValue: "Duplicate" })}
					title={t("builder.duplicate", { defaultValue: "Duplicate" })}
					data-decision-question-duplicate
				>
					<Copy size={14} />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className={cn(ICON_BUTTON, "hover:text-destructive")}
					onClick={onRemove}
					aria-label={t("builder.remove", { defaultValue: "Remove question" })}
					title={t("builder.remove", { defaultValue: "Remove question" })}
					data-decision-question-remove
				>
					<Trash2 size={14} />
				</Button>
			</div>

			<label htmlFor={instructionsField} className="sr-only">
				{t("builder.instructions", { defaultValue: "What to decide" })}
			</label>
			<Textarea
				id={instructionsField}
				value={draft.instructions}
				onChange={(event) => onChange({ instructions: event.target.value })}
				placeholder={t("builder.instructionsPlaceholder", {
					defaultValue: "What should be decided? e.g. Which team handles this?",
				})}
				rows={2}
				className="min-h-[3.25rem] resize-y text-sm"
				data-decision-question-instructions
			/>
			<p className="text-[11px] text-muted-foreground">
				{typeText(draft.type, "hint")}
			</p>

			{draft.type === "choice" ? (
				<div className="space-y-1.5" data-decision-options>
					{draft.options.map((option, index) => (
						<div
							// Rows have no id of their own; order is their identity.
							// biome-ignore lint/suspicious/noArrayIndexKey: see above
							key={index}
							className="flex items-center gap-1.5"
							data-decision-option={index}
						>
							<Input
								value={option.label}
								onChange={(event) =>
									setOption(index, { label: event.target.value })
								}
								placeholder={t("builder.optionLabel", {
									defaultValue: "Option",
								})}
								aria-label={t("builder.optionLabel", {
									defaultValue: "Option",
								})}
								className="h-8 w-[38%] min-w-0 text-xs"
								data-decision-option-label
							/>
							<Input
								value={option.description}
								onChange={(event) =>
									setOption(index, { description: event.target.value })
								}
								placeholder={t("builder.optionDescription", {
									defaultValue: "Meaning (optional)",
								})}
								aria-label={t("builder.optionDescription", {
									defaultValue: "Meaning (optional)",
								})}
								className="h-8 min-w-0 flex-1 text-xs"
								data-decision-option-description
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className={ICON_BUTTON}
								onClick={() =>
									onChange({
										options: draft.options.filter(
											(_, position) => position !== index,
										),
									})
								}
								disabled={draft.options.length <= 1}
								aria-label={t("builder.removeOption", {
									defaultValue: "Remove option",
								})}
							>
								<X size={13} />
							</Button>
						</div>
					))}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 gap-1 px-2 text-xs text-muted-foreground"
						onClick={() =>
							onChange({
								options: [...draft.options, { label: "", description: "" }],
							})
						}
						disabled={draft.options.length >= DECISION_LIMITS.maxChoiceOptions}
						data-decision-add-option
					>
						<Plus size={13} />
						{t("builder.addOption", { defaultValue: "Add option" })}
					</Button>
				</div>
			) : null}

			{draft.type === "score" ? (
				<ol className="space-y-1.5" data-decision-levels>
					{draft.levels.map((level, index) => (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: levels are ordered by position
							key={index}
							className="flex items-center gap-1.5"
							data-decision-level={index}
						>
							<span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
								{index}
							</span>
							<Input
								value={level}
								onChange={(event) =>
									onChange({
										levels: draft.levels.map((entry, position) =>
											position === index ? event.target.value : entry,
										),
									})
								}
								aria-label={t("builder.level", {
									index,
									defaultValue: `Level ${index}`,
								})}
								className="h-8 min-w-0 flex-1 text-xs"
								data-decision-level-input
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className={ICON_BUTTON}
								onClick={() => moveLevel(index, -1)}
								disabled={index === 0}
								aria-label={t("builder.moveUp", { defaultValue: "Move up" })}
							>
								<ArrowUp size={13} />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className={ICON_BUTTON}
								onClick={() => moveLevel(index, 1)}
								disabled={index === draft.levels.length - 1}
								aria-label={t("builder.moveDown", {
									defaultValue: "Move down",
								})}
							>
								<ArrowDown size={13} />
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className={ICON_BUTTON}
								onClick={() =>
									onChange({
										levels: draft.levels.filter(
											(_, position) => position !== index,
										),
									})
								}
								disabled={draft.levels.length <= DECISION_LIMITS.minScoreLevels}
								aria-label={t("builder.removeLevel", {
									defaultValue: "Remove level",
								})}
							>
								<X size={13} />
							</Button>
						</li>
					))}
					<li>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 gap-1 px-2 text-xs text-muted-foreground"
							onClick={() => onChange({ levels: [...draft.levels, ""] })}
							disabled={draft.levels.length >= DECISION_LIMITS.maxScoreLevels}
							data-decision-add-level
						>
							<Plus size={13} />
							{t("builder.addLevel", { defaultValue: "Add level" })}
						</Button>
					</li>
				</ol>
			) : null}

			{draft.type === "noul" ? (
				<div className="grid gap-1.5 sm:grid-cols-2" data-decision-noul>
					<Input
						value={draft.noulTrue}
						onChange={(event) => onChange({ noulTrue: event.target.value })}
						placeholder={t("builder.noulTrue", {
							defaultValue: "True means… (optional)",
						})}
						aria-label={t("builder.noulTrue", {
							defaultValue: "True means… (optional)",
						})}
						className="h-8 text-xs"
					/>
					<Input
						value={draft.noulFalse}
						onChange={(event) => onChange({ noulFalse: event.target.value })}
						placeholder={t("builder.noulFalse", {
							defaultValue: "False means… (optional)",
						})}
						aria-label={t("builder.noulFalse", {
							defaultValue: "False means… (optional)",
						})}
						className="h-8 text-xs"
					/>
				</div>
			) : null}

			{errors.length > 0 ? (
				<ul
					className="space-y-0.5 text-[11px] text-destructive"
					data-decision-question-errors
				>
					{errors.map((error) => (
						<li key={error}>{error}</li>
					))}
				</ul>
			) : null}
		</fieldset>
	);
};
