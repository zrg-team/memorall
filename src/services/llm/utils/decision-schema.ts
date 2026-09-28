import type {
	DecisionAnswer,
	DecisionQuestion,
	DecisionQuestions,
	DecisionQuestionType,
	SystemOneResponse,
	SystemOneUsage,
} from "@/types/openai-media";

/**
 * Typed-decision questions in the `/v1/systemone` (TypeSafe Jev) shape: the
 * one schema the Decision studio edits, stores and sends, whichever backend
 * answers it.
 */

export const DECISION_QUESTION_TYPES: readonly DecisionQuestionType[] = [
	"choice",
	"score",
	"noul",
];

export const DECISION_LIMITS = {
	minChoiceOptions: 2,
	maxChoiceOptions: 255,
	minScoreLevels: 2,
	maxScoreLevels: 10,
	maxQuestionIdLength: 64,
} as const;

export interface DecisionSchemaError {
	/** Question id, or empty for the whole schema. */
	questionId: string;
	/** `instructions`, `criteria`, `type`, `id`, or empty. */
	field: string;
	message: string;
}

export interface DecisionSchemaResult {
	/** Normalized questions; null when there is nothing usable at all. */
	questions: DecisionQuestions | null;
	errors: DecisionSchemaError[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const isDecisionQuestionType = (
	value: unknown,
): value is DecisionQuestionType =>
	typeof value === "string" &&
	(DECISION_QUESTION_TYPES as readonly string[]).includes(value);

/** Choice options in order, as `[label, description | null]`. */
export function choiceOptionsOf(
	question: DecisionQuestion,
): [string, string | null][] {
	const criteria = question.criteria;
	if (Array.isArray(criteria)) {
		return criteria.map((label) => [String(label), null]);
	}
	if (!isRecord(criteria)) return [];
	return Object.entries(criteria).map(([label, description]) => [
		label,
		typeof description === "string" && description.trim() ? description : null,
	]);
}

/** Score levels, lowest first. */
export function scoreLevelsOf(question: DecisionQuestion): string[] {
	return Array.isArray(question.criteria)
		? question.criteria.map((level) => String(level))
		: [];
}

/** The optional wording of a noul's two outcomes. */
export function noulCriteriaOf(question: DecisionQuestion): {
	true?: string;
	false?: string;
} {
	const criteria = question.criteria;
	if (!isRecord(criteria)) return {};
	const pick = (value: unknown) =>
		typeof value === "string" && value.trim() ? value : undefined;
	return { true: pick(criteria.true), false: pick(criteria.false) };
}

/** One question in canonical form: choice criteria as a record, no blanks. */
export function normalizeDecisionQuestion(
	question: DecisionQuestion,
): DecisionQuestion {
	const instructions = question.instructions;
	if (question.type === "choice") {
		const criteria: Record<string, string | null> = {};
		for (const [label, description] of choiceOptionsOf(question)) {
			const key = label.trim();
			if (key && !(key in criteria)) criteria[key] = description;
		}
		return { type: "choice", instructions, criteria };
	}
	if (question.type === "score") {
		return {
			type: "score",
			instructions,
			criteria: scoreLevelsOf(question)
				.map((level) => level.trim())
				.filter(Boolean),
		};
	}
	const wording = noulCriteriaOf(question);
	const criteria = Object.fromEntries(
		Object.entries(wording).filter(([, value]) => value),
	);
	return Object.keys(criteria).length > 0
		? { type: "noul", instructions, criteria }
		: { type: "noul", instructions };
}

/**
 * Validates and normalizes a questions map. Accepts the bare map or a full
 * `/systemone` request (`{ questions: {...} }`), so a request pasted from
 * elsewhere works as-is.
 */
export function validateDecisionQuestions(
	value: unknown,
): DecisionSchemaResult {
	const errors: DecisionSchemaError[] = [];
	const map =
		isRecord(value) && isRecord(value.questions) ? value.questions : value;
	if (!isRecord(map)) {
		return {
			questions: null,
			errors: [
				{
					questionId: "",
					field: "",
					message: "Questions must be an object keyed by question id.",
				},
			],
		};
	}

	const questions: DecisionQuestions = {};
	for (const [rawId, rawQuestion] of Object.entries(map)) {
		const id = rawId.trim();
		const fail = (field: string, message: string) =>
			errors.push({ questionId: rawId, field, message });
		if (!id) {
			fail("id", "Give the question an id.");
			continue;
		}
		if (id.length > DECISION_LIMITS.maxQuestionIdLength) {
			fail(
				"id",
				`Keep the id under ${DECISION_LIMITS.maxQuestionIdLength} characters.`,
			);
		}
		if (!isRecord(rawQuestion)) {
			fail("", "Each question must be an object.");
			continue;
		}
		if (!isDecisionQuestionType(rawQuestion.type)) {
			fail("type", 'The type must be "choice", "score" or "noul".');
			continue;
		}
		const instructions =
			typeof rawQuestion.instructions === "string"
				? rawQuestion.instructions
				: isRecord(rawQuestion.instructions)
					? JSON.stringify(rawQuestion.instructions)
					: "";
		if (!instructions.trim()) {
			fail("instructions", "Write what the question asks.");
		}
		const question = normalizeDecisionQuestion({
			type: rawQuestion.type,
			instructions,
			criteria: rawQuestion.criteria as DecisionQuestion["criteria"],
		});
		if (question.type === "choice") {
			const count = choiceOptionsOf(question).length;
			if (count < DECISION_LIMITS.minChoiceOptions) {
				fail("criteria", "A choice needs at least two options.");
			} else if (count > DECISION_LIMITS.maxChoiceOptions) {
				fail(
					"criteria",
					`A choice takes at most ${DECISION_LIMITS.maxChoiceOptions} options.`,
				);
			}
		} else if (question.type === "score") {
			const count = scoreLevelsOf(question).length;
			if (
				count < DECISION_LIMITS.minScoreLevels ||
				count > DECISION_LIMITS.maxScoreLevels
			) {
				fail(
					"criteria",
					`A score needs ${DECISION_LIMITS.minScoreLevels} to ${DECISION_LIMITS.maxScoreLevels} levels, lowest first.`,
				);
			}
		}
		questions[id] = question;
	}

	if (Object.keys(map).length === 0) {
		errors.push({
			questionId: "",
			field: "",
			message: "Add at least one question.",
		});
	}
	return { questions, errors };
}

export interface ParsedDecisionSchema extends DecisionSchemaResult {
	/** Set when the text is not JSON at all. */
	syntaxError?: string;
}

/** The JSON view's text -> questions. */
export function parseDecisionSchema(text: string): ParsedDecisionSchema {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return {
			questions: null,
			errors: [],
			syntaxError: error instanceof Error ? error.message : String(error),
		};
	}
	return validateDecisionQuestions(value);
}

/** Questions -> the JSON view's text, as the request's `questions` field. */
export function formatDecisionSchema(questions: DecisionQuestions): string {
	return JSON.stringify({ questions }, null, 2);
}

export const questionCountOf = (questions: DecisionQuestions | null): number =>
	questions ? Object.keys(questions).length : 0;

/** Questions stored in a session's metadata, if any. */
export function decisionSchemaOf(metadata: unknown): DecisionQuestions | null {
	if (!isRecord(metadata)) return null;
	const { questions } = validateDecisionQuestions(metadata.decisionSchema);
	return questions && Object.keys(questions).length > 0 ? questions : null;
}

/**
 * What to send as `state`: a JSON object when the text is one, the text
 * otherwise. The protocol takes either.
 */
export function decisionStateOf(
	text: string,
): string | Record<string, unknown> {
	const trimmed = text.trim();
	if (trimmed.startsWith("{")) {
		try {
			const value = JSON.parse(trimmed);
			if (isRecord(value)) return value;
		} catch {
			// Not JSON after all; send the text.
		}
	}
	return text;
}

const toNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const toProbabilities = (
	value: unknown,
): Record<string, number> | undefined => {
	if (!isRecord(value)) return undefined;
	const entries = Object.entries(value)
		.map(([key, score]) => [key, toNumber(score)] as const)
		.filter(
			(entry): entry is readonly [string, number] => entry[1] !== undefined,
		);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

function toAnswer(value: unknown): DecisionAnswer | null {
	if (!isRecord(value)) return null;
	if (value.type === "choice" && typeof value.choice === "string") {
		return {
			type: "choice",
			choice: value.choice,
			probabilities: toProbabilities(value.probabilities),
			confidence: toNumber(value.confidence),
		};
	}
	if (value.type === "score" && toNumber(value.score) !== undefined) {
		const legend = isRecord(value.legend)
			? Object.fromEntries(
					Object.entries(value.legend).map(([key, label]) => [
						key,
						String(label),
					]),
				)
			: undefined;
		return {
			type: "score",
			score: value.score as number,
			legend,
			probabilities: toProbabilities(value.probabilities),
			confidence: toNumber(value.confidence),
		};
	}
	if (value.type === "noul" && toNumber(value.noul) !== undefined) {
		return { type: "noul", noul: value.noul as number };
	}
	return null;
}

/** A `/systemone` response body in the app's shape; unknown answers drop. */
export function normalizeSystemOneResponse(
	raw: unknown,
	fallbackModel: string,
): SystemOneResponse {
	const body = isRecord(raw) ? raw : {};
	const answers: Record<string, DecisionAnswer> = {};
	if (isRecord(body.answers)) {
		for (const [id, value] of Object.entries(body.answers)) {
			const answer = toAnswer(value);
			if (answer) answers[id] = answer;
		}
	}
	let usage: SystemOneUsage | undefined;
	if (isRecord(body.usage)) {
		usage = {
			input_tokens: toNumber(body.usage.input_tokens),
			output_tokens: toNumber(body.usage.output_tokens),
			cost: toNumber(body.usage.cost),
		};
	}
	return {
		object: "systemone",
		model: typeof body.model === "string" ? body.model : fallbackModel,
		answers,
		usage,
	};
}

const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;

/** One run as markdown, for Save to Files. */
export function decisionToMarkdown(input: {
	state: string;
	questions: DecisionQuestions;
	answers: Record<string, DecisionAnswer>;
	model?: string;
}): string {
	const lines: string[] = ["# Decision", ""];
	if (input.model) lines.push(`Model: ${input.model}`, "");
	lines.push("## Input", "", input.state.trim(), "", "## Answers", "");
	for (const [id, question] of Object.entries(input.questions)) {
		const answer = input.answers[id];
		lines.push(`### ${id}`, "", question.instructions.trim(), "");
		if (!answer) {
			lines.push("_No answer._", "");
			continue;
		}
		if (answer.type === "choice") {
			lines.push(`**${answer.choice}**`, "");
			for (const [label, probability] of Object.entries(
				answer.probabilities ?? {},
			)) {
				lines.push(`- ${label}: ${percent(probability)}`);
			}
		} else if (answer.type === "score") {
			lines.push(`**${answer.score.toFixed(2)}**`, "");
			const levels = scoreLevelsOf(question);
			for (const [level, probability] of Object.entries(
				answer.probabilities ?? {},
			)) {
				const name = answer.legend?.[level] ?? levels[Number(level)] ?? level;
				lines.push(`- ${level} (${name}): ${percent(probability)}`);
			}
		} else {
			lines.push(`**${percent(answer.noul)}** true`);
		}
		lines.push("");
	}
	return `${lines.join("\n").trim()}\n`;
}
