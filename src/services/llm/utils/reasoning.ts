import type { ReasoningEffort } from "@/types/openai";
import type { ModelReasoning } from "../interfaces/base-llm";

/** Every effort level, lowest first. */
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** What a listing that only says "supports reasoning" accepts. */
const STANDARD_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high"];

export const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
	typeof value === "string" &&
	(REASONING_EFFORTS as readonly string[]).includes(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** The readable text of one `reasoning_details` item; encrypted ones have none. */
const readDetailText = (detail: unknown): string => {
	if (!isRecord(detail)) return "";
	if (detail.type === "reasoning.text" && typeof detail.text === "string") {
		return detail.text;
	}
	if (
		detail.type === "reasoning.summary" &&
		typeof detail.summary === "string"
	) {
		return detail.summary;
	}
	return "";
};

/**
 * The reasoning text one streamed delta carries.
 *
 * Providers stream a reasoning model's thinking beside its content, in one of a
 * few shapes: OpenRouter's `reasoning` string (with the same text again in
 * `reasoning_details`), or `reasoning_content` (DeepSeek, LM Studio, vLLM).
 * Read the first one present, so text sent in two shapes is not doubled.
 */
export const readReasoningDelta = (delta: unknown): string => {
	if (!isRecord(delta)) return "";
	if (typeof delta.reasoning === "string") return delta.reasoning;
	if (typeof delta.reasoning_content === "string") {
		return delta.reasoning_content;
	}
	return Array.isArray(delta.reasoning_details)
		? delta.reasoning_details.map(readDetailText).join("")
		: "";
};

/**
 * A model's reasoning controls, from an OpenAI-compatible listing entry.
 *
 * OpenRouter describes them as `reasoning: { supported_efforts, default_effort,
 * mandatory }`. Only the levels it names are accepted — any other is a
 * validation error — and reasoning that is not mandatory can always be turned
 * off. A listing without that description but with `reasoning_effort` among
 * its `supported_parameters` takes the standard levels.
 */
export const readModelReasoning = (
	entry: unknown,
): ModelReasoning | undefined => {
	if (!isRecord(entry)) return undefined;
	const described = isRecord(entry.reasoning) ? entry.reasoning : undefined;
	const parameters = Array.isArray(entry.supported_parameters)
		? entry.supported_parameters
		: [];
	const levels: readonly ReasoningEffort[] = described
		? Array.isArray(described.supported_efforts)
			? described.supported_efforts.filter(isReasoningEffort)
			: []
		: parameters.includes("reasoning_effort")
			? STANDARD_EFFORTS
			: [];
	const mandatory = described?.mandatory === true;
	const canTurnOff =
		described?.mandatory === false || (levels.includes("none") && !mandatory);

	const efforts = REASONING_EFFORTS.filter((effort) =>
		effort === "none" ? canTurnOff : levels.includes(effort),
	);
	if (efforts.length === 0) return undefined;
	const defaultEffort = described?.default_effort;
	return {
		efforts,
		...(isReasoningEffort(defaultEffort) ? { defaultEffort } : {}),
		...(mandatory ? { mandatory } : {}),
	};
};
