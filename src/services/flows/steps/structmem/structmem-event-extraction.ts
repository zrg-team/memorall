import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { AllServices } from "../../interfaces/tool";
import type { ChatCompletionResponse } from "../../interfaces/messages";
import type {
	StructMemEntry,
	StructMemState,
} from "../../graph/structmem/state";
import {
	createEntry,
	getChatResponseText,
	parseJsonObject,
	warnParseFailure,
} from "./structmem-utils";
import { logError, logInfo } from "../../interfaces/logger";

const STEP_NAME = "structmem-event-extraction" as const;

export interface StructMemEventExtractionInput {
	currentMessage: string;
	previousMessages?: string;
	content?: string;
	title?: string;
	url?: string;
	sourceId?: string;
	referenceTimestamp: string;
	metadata?: Record<string, unknown>;
}

export interface StructMemEventExtractionOutput {
	eventId?: string;
	factualEntries?: StructMemEntry[];
	relationalEntries?: StructMemEntry[];
	processingStage?: StructMemState["processingStage"];
	errors?: string[];
}

type ParsedExtraction = {
	factual_entries?: Array<
		string | { text?: string; confidence?: number; metadata?: unknown }
	>;
	relational_entries?: Array<
		string | { text?: string; confidence?: number; metadata?: unknown }
	>;
};

const EVENT_EXTRACTION_SYSTEM_PROMPT = `You construct StructMem event memory for long-horizon conversational agents.

Extract event-centered memory entries from one current utterance or document segment. Return natural-language entries, not entity-relation triples.

Separate two complementary perspectives:
1. factual_entries: objective event content, stated preferences, plans, actions, commitments, observations, and temporally relevant facts.
2. relational_entries: interpersonal dynamics, causal influences, dependencies, reactions, shared context, temporal dependencies, and interaction state.

Rules:
- Only include information grounded in the provided input/context.
- Preserve temporal wording and speaker relationships when present.
- Prefer compact complete sentences.
- Do not invent entities, causes, or relations.
- Return strict JSON only with this shape:
{
  "factual_entries": [{"text": "grounded factual memory", "confidence": 0.0}],
  "relational_entries": [{"text": "grounded relational memory", "confidence": 0.0}]
}`;

function formatInput(input: StructMemEventExtractionInput): string {
	const parts: string[] = [];
	if (input.title || input.url) {
		parts.push(
			`<METADATA>\n${[
				input.title ? `Title: ${input.title}` : undefined,
				input.url ? `URL: ${input.url}` : undefined,
				`Reference timestamp: ${input.referenceTimestamp}`,
			]
				.filter(Boolean)
				.join("\n")}\n</METADATA>`,
		);
	}
	if (input.previousMessages?.trim()) {
		parts.push(
			`<RECENT_CONTEXT>\n${input.previousMessages}\n</RECENT_CONTEXT>`,
		);
	}
	const current = input.currentMessage || input.content || "";
	parts.push(`<CURRENT_EVENT>\n${current}\n</CURRENT_EVENT>`);
	return parts.join("\n\n");
}

function normalizeParsedEntries(
	value: ParsedExtraction[keyof ParsedExtraction],
	eventId: string,
	entryKind: "factual" | "relational",
	input: StructMemEventExtractionInput,
): StructMemEntry[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			const text = typeof entry === "string" ? entry : entry.text;
			if (!text?.trim()) return null;
			const confidence =
				typeof entry === "object" && typeof entry.confidence === "number"
					? entry.confidence
					: undefined;
			const metadata =
				typeof entry === "object" &&
				typeof entry.metadata === "object" &&
				entry.metadata !== null
					? (entry.metadata as Record<string, unknown>)
					: undefined;
			return createEntry(eventId, entryKind, text, input.referenceTimestamp, {
				sourceId: input.sourceId,
				title: input.title,
				url: input.url,
				confidence,
				metadata: {
					...(input.metadata ?? {}),
					...(metadata ?? {}),
				},
			});
		})
		.filter((entry): entry is StructMemEntry => entry !== null);
}

const definition = defineStep<
	StructMemEventExtractionInput,
	StructMemEventExtractionOutput,
	Pick<AllServices, "llm">
>({
	name: STEP_NAME,
	execute: async ({ input, services, runConfig }) => {
		try {
			if (!services.llm.isReady()) {
				throw new Error("LLM service is not ready");
			}
			const current = input.currentMessage || input.content || "";
			if (!current.trim()) {
				return {
					output: {
						factualEntries: [],
						relationalEntries: [],
						processingStage: "event_persistence",
					},
				};
			}

			const eventId = crypto.randomUUID();
			const response = (await services.llm.chatCompletions({
				messages: [
					{ role: "system", content: EVENT_EXTRACTION_SYSTEM_PROMPT },
					{ role: "user", content: formatInput(input) },
				],
				temperature: 0.1,
				stream: false,
			})) as ChatCompletionResponse;
			const content = getChatResponseText(response);

			let parsed: ParsedExtraction;
			try {
				parsed = parseJsonObject(content) as ParsedExtraction;
			} catch (error) {
				warnParseFailure("STRUCTMEM_EVENT_EXTRACTION", content, error);
				return {
					output: {
						eventId,
						factualEntries: [],
						relationalEntries: [],
						processingStage: "event_persistence",
						errors: ["StructMem event extraction returned invalid JSON"],
					},
				};
			}

			const factualEntries = normalizeParsedEntries(
				parsed.factual_entries,
				eventId,
				"factual",
				input,
			);
			const relationalEntries = normalizeParsedEntries(
				parsed.relational_entries,
				eventId,
				"relational",
				input,
			);

			logInfo("[STRUCTMEM_EVENT_EXTRACTION] Extracted entries", {
				factual: factualEntries.length,
				relational: relationalEntries.length,
			});
			runConfig?.writer?.({
				type: "actions",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "StructMem Event Extracted",
						description: `Extracted ${factualEntries.length} factual and ${relationalEntries.length} relational entries`,
						metadata: { eventId },
					},
				],
			});

			return {
				output: {
					eventId,
					factualEntries,
					relationalEntries,
					processingStage: "event_persistence",
				},
			};
		} catch (error) {
			logError("[STRUCTMEM_EVENT_EXTRACTION] Error", error);
			return {
				output: {
					errors: [
						error instanceof Error
							? error.message
							: "StructMem event extraction failed",
					],
				},
			};
		}
	},
});

type StructMemEventExtractionSpec = StepSpecFromDefinition<typeof definition>;

export const createStructMemEventExtractionStep: StepFactoryFromSpec<
	StructMemEventExtractionSpec
> = (services: Pick<AllServices, "llm">) => bindStep(definition, services);

stepRegistry.register(STEP_NAME, createStructMemEventExtractionStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: StructMemEventExtractionSpec;
	}
}
