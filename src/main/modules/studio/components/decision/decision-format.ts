import {
	choiceOptionsOf,
	noulCriteriaOf,
	scoreLevelsOf,
	validateDecisionQuestions,
} from "@/services/llm/utils/decision-schema";
import type {
	DecisionAnswer,
	DecisionQuestion,
	DecisionQuestions,
	DecisionQuestionType,
	ImageToolLabel,
	SystemOneUsage,
} from "@/types/openai-media";
import type { StudioContentPart, StudioItem } from "@/types/studio";

/**
 * The builder's working copy of one question. Unlike the stored schema it
 * keeps what is half-typed - an empty option row, a blank level - so editing
 * never deletes what the user is in the middle of writing.
 */
export interface QuestionDraft {
	/** React key; stable across renames. */
	key: string;
	id: string;
	type: DecisionQuestionType;
	instructions: string;
	options: { label: string; description: string }[];
	levels: string[];
	noulTrue: string;
	noulFalse: string;
}

let draftKeySeed = 0;
const nextKey = () => `q${++draftKeySeed}`;

export function emptyQuestionDraft(
	type: DecisionQuestionType,
	taken: readonly string[] = [],
): QuestionDraft {
	const base = type === "noul" ? "is_true" : type;
	let id = base;
	for (let index = 2; taken.includes(id); index++) id = `${base}_${index}`;
	return {
		key: nextKey(),
		id,
		type,
		instructions: "",
		options: [
			{ label: "", description: "" },
			{ label: "", description: "" },
		],
		levels: ["low", "medium", "high"],
		noulTrue: "",
		noulFalse: "",
	};
}

export function questionToDraft(
	id: string,
	question: DecisionQuestion,
): QuestionDraft {
	const noul = noulCriteriaOf(question);
	const options = choiceOptionsOf(question).map(([label, description]) => ({
		label,
		description: description ?? "",
	}));
	const levels = scoreLevelsOf(question);
	return {
		key: nextKey(),
		id,
		type: question.type,
		instructions: question.instructions,
		options:
			question.type === "choice" && options.length > 0
				? options
				: [
						{ label: "", description: "" },
						{ label: "", description: "" },
					],
		levels:
			question.type === "score" && levels.length > 0
				? levels
				: ["low", "medium", "high"],
		noulTrue: noul.true ?? "",
		noulFalse: noul.false ?? "",
	};
}

export const questionsToDrafts = (
	questions: DecisionQuestions | null,
): QuestionDraft[] =>
	Object.entries(questions ?? {}).map(([id, question]) =>
		questionToDraft(id, question),
	);

/** Drafts -> the schema as sent; blanks drop, later duplicate ids win. */
export function draftsToQuestions(
	drafts: readonly QuestionDraft[],
): DecisionQuestions {
	const questions: DecisionQuestions = {};
	for (const draft of drafts) {
		const id = draft.id.trim();
		if (!id) continue;
		if (draft.type === "choice") {
			const criteria: Record<string, string | null> = {};
			for (const option of draft.options) {
				const label = option.label.trim();
				if (label && !(label in criteria)) {
					criteria[label] = option.description.trim() || null;
				}
			}
			questions[id] = {
				type: "choice",
				instructions: draft.instructions,
				criteria,
			};
		} else if (draft.type === "score") {
			questions[id] = {
				type: "score",
				instructions: draft.instructions,
				criteria: draft.levels.map((level) => level.trim()).filter(Boolean),
			};
		} else {
			const criteria = {
				...(draft.noulTrue.trim() ? { true: draft.noulTrue.trim() } : {}),
				...(draft.noulFalse.trim() ? { false: draft.noulFalse.trim() } : {}),
			};
			questions[id] =
				Object.keys(criteria).length > 0
					? { type: "noul", instructions: draft.instructions, criteria }
					: { type: "noul", instructions: draft.instructions };
		}
	}
	return questions;
}

/** Ids used by more than one question; the schema can only keep one. */
export function duplicateIds(drafts: readonly QuestionDraft[]): Set<string> {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const draft of drafts) {
		const id = draft.id.trim();
		if (!id) continue;
		if (seen.has(id)) duplicates.add(id);
		seen.add(id);
	}
	return duplicates;
}

/** The questions a run used, as stored with it. */
export function questionsOfItem(item: StudioItem): DecisionQuestions {
	const { questions } = validateDecisionQuestions(
		item.generation.params?.questions,
	);
	return questions ?? {};
}

export interface DecisionResult {
	model: string;
	answers: Record<string, DecisionAnswer>;
	usage?: SystemOneUsage;
}

export function decisionResultOf(item: StudioItem): DecisionResult | null {
	const part = item.parts.find(
		(entry): entry is Extract<StudioContentPart, { type: "decision" }> =>
			entry.type === "decision",
	);
	return part ? part.decision : null;
}

/** A choice's options as bars, most likely first. */
export function choiceBars(
	question: DecisionQuestion,
	answer: Extract<DecisionAnswer, { type: "choice" }>,
): ImageToolLabel[] {
	const probabilities = answer.probabilities ?? {};
	const labels = choiceOptionsOf(question).map(([label]) => label);
	const known = labels.length > 0 ? labels : Object.keys(probabilities);
	return known
		.map((label) => ({
			label,
			score: probabilities[label] ?? (label === answer.choice ? 1 : 0),
		}))
		.sort((left, right) => right.score - left.score);
}

/** A score's levels as bars, in level order. */
export function scoreBars(
	question: DecisionQuestion,
	answer: Extract<DecisionAnswer, { type: "score" }>,
): ImageToolLabel[] {
	const levels = scoreLevelsOf(question);
	const probabilities = answer.probabilities ?? {};
	const count = Math.max(levels.length, Object.keys(probabilities).length);
	return Array.from({ length: count }, (_, index) => ({
		label: answer.legend?.[String(index)] ?? levels[index] ?? String(index),
		score: probabilities[String(index)] ?? 0,
	}));
}

/** The level a fractional score is closest to. */
export function nearestLevel(
	question: DecisionQuestion,
	answer: Extract<DecisionAnswer, { type: "score" }>,
): string | undefined {
	const index = Math.round(answer.score);
	return answer.legend?.[String(index)] ?? scoreLevelsOf(question)[index];
}

/** Request and response of one run, as a `/systemone` exchange. */
export function exchangeJson(item: StudioItem, input: string): string {
	const result = decisionResultOf(item);
	return JSON.stringify(
		{
			request: {
				model: item.generation.modelId,
				state: input,
				questions: questionsOfItem(item),
			},
			response: result
				? { model: result.model, answers: result.answers, usage: result.usage }
				: null,
		},
		null,
		2,
	);
}
