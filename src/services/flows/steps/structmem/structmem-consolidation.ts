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
	StructMemEvent,
	StructMemState,
	StructMemSummary,
} from "../../graph/structmem/state";
import {
	getChatResponseText,
	parseJsonObject,
	parseStringArray,
	warnParseFailure,
} from "./structmem-utils";
import { logError, logInfo } from "../../interfaces/logger";

const STEP_NAME = "structmem-consolidation" as const;

export interface StructMemConsolidationInput {
	bufferedEntries: StructMemEntry[];
	relatedEntries: StructMemEntry[];
	reconstructedEvents: StructMemEvent[];
}

export interface StructMemConsolidationOutput {
	consolidatedSummaries?: StructMemSummary[];
	processingStage?: StructMemState["processingStage"];
	errors?: string[];
}

export interface StructMemConsolidationConfig {
	qaSynthesisLimit?: number;
}

type ParsedSummary = {
	text?: string;
	source_event_ids?: unknown;
	source_entry_ids?: unknown;
	seed_entry_ids?: unknown;
	timestamp_citations?: unknown;
	metadata?: unknown;
};

type ParsedConsolidation = {
	summaries?: ParsedSummary[];
};

const CONSOLIDATION_SYSTEM_PROMPT = `You perform StructMem cross-event consolidation for long-horizon conversational memory.

Synthesize higher-level memory only from the provided event entries. The goal is to make grounded cross-event relationships explicit: temporal dependencies, causal chains, shared experiences, evolving preferences, commitments, and interpersonal dynamics.

Grounding rules:
- Every summary must cite concrete source event ids and timestamp citations from the input.
- Prefer summaries that connect buffered events to retrieved historical events.
- Do not add unsupported links, intentions, causes, dates, or relationships.
- If evidence is insufficient, return an empty summaries array.
- Return strict JSON only with this shape:
{
  "summaries": [
    {
      "text": "grounded cross-event synthesis",
      "source_event_ids": ["event-id"],
      "source_entry_ids": ["entry-uuid"],
      "seed_entry_ids": ["retrieved-entry-uuid"],
      "timestamp_citations": ["2026-04-29T00:00:00.000Z"]
    }
  ]
}`;

function formatEvents(
	bufferedEntries: StructMemEntry[],
	relatedEntries: StructMemEntry[],
	reconstructedEvents: StructMemEvent[],
): string {
	const bufferedIds = new Set(bufferedEntries.map((entry) => entry.uuid));
	const relatedIds = new Set(relatedEntries.map((entry) => entry.uuid));

	return reconstructedEvents
		.map((event) => {
			const entries = event.entries
				.map((entry) => {
					const origin = bufferedIds.has(entry.uuid)
						? "buffer"
						: relatedIds.has(entry.uuid)
							? "retrieved"
							: "context";
					return `- entry_id=${entry.uuid}; kind=${entry.entryKind}; origin=${origin}; timestamp=${entry.timestamp}; text=${entry.text}`;
				})
				.join("\n");
			return `<EVENT id="${event.eventId}" timestamp="${event.timestamp}">\n${entries}\n</EVENT>`;
		})
		.join("\n\n");
}

function normalizeSummaries(
	parsed: ParsedConsolidation,
	bufferedEntries: StructMemEntry[],
	relatedEntries: StructMemEntry[],
	limit: number,
): StructMemSummary[] {
	const knownEntryIds = new Set(
		[...bufferedEntries, ...relatedEntries].map((entry) => entry.uuid),
	);
	const relatedEntryIds = new Set(relatedEntries.map((entry) => entry.uuid));
	const summaries = Array.isArray(parsed.summaries) ? parsed.summaries : [];

	return summaries
		.slice(0, limit)
		.map((summary): StructMemSummary | null => {
			if (!summary.text?.trim()) return null;
			const sourceEntryIds = parseStringArray(summary.source_entry_ids).filter(
				(id) => knownEntryIds.has(id),
			);
			const seedEntryIds = parseStringArray(summary.seed_entry_ids).filter(
				(id) => relatedEntryIds.has(id),
			);
			const sourceEventIds = parseStringArray(summary.source_event_ids);
			const timestampCitations = parseStringArray(summary.timestamp_citations);

			if (sourceEntryIds.length === 0 || timestampCitations.length === 0) {
				return null;
			}

			return {
				uuid: crypto.randomUUID(),
				text: summary.text.trim(),
				sourceEventIds,
				sourceEntryIds,
				seedEntryIds,
				timestampCitations,
				metadata:
					typeof summary.metadata === "object" && summary.metadata !== null
						? (summary.metadata as Record<string, unknown>)
						: {},
			};
		})
		.filter((summary): summary is StructMemSummary => summary !== null);
}

const definition = defineStep<
	StructMemConsolidationInput,
	StructMemConsolidationOutput,
	Pick<AllServices, "llm">,
	StructMemConsolidationConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, config, runConfig }) => {
		try {
			if (!services.llm.isReady()) {
				throw new Error("LLM service is not ready");
			}
			const reconstructedEvents = input.reconstructedEvents ?? [];
			const bufferedEntries = input.bufferedEntries ?? [];
			if (bufferedEntries.length === 0 || reconstructedEvents.length === 0) {
				return {
					output: {
						consolidatedSummaries: [],
						processingStage: "completed",
					},
				};
			}

			const response = (await services.llm.chatCompletions({
				messages: [
					{ role: "system", content: CONSOLIDATION_SYSTEM_PROMPT },
					{
						role: "user",
						content: formatEvents(
							bufferedEntries,
							input.relatedEntries ?? [],
							reconstructedEvents,
						),
					},
				],
				temperature: 0.1,
				stream: false,
			})) as ChatCompletionResponse;
			const content = getChatResponseText(response);

			let parsed: ParsedConsolidation;
			try {
				parsed = parseJsonObject(content) as ParsedConsolidation;
			} catch (error) {
				warnParseFailure("STRUCTMEM_CONSOLIDATION", content, error);
				return {
					output: {
						consolidatedSummaries: [],
						processingStage: "completed",
						errors: ["StructMem consolidation returned invalid JSON"],
					},
				};
			}

			const summaries = normalizeSummaries(
				parsed,
				bufferedEntries,
				input.relatedEntries ?? [],
				config?.qaSynthesisLimit ?? 5,
			);

			logInfo("[STRUCTMEM_CONSOLIDATION] Produced summaries", {
				count: summaries.length,
			});
			runConfig?.writer?.({
				type: "actions",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "StructMem Consolidation Complete",
						description: `Produced ${summaries.length} grounded summaries`,
						metadata: { summaryCount: summaries.length },
					},
				],
			});

			return {
				output: {
					consolidatedSummaries: summaries,
					processingStage:
						summaries.length > 0 ? "summary_persistence" : "completed",
				},
			};
		} catch (error) {
			logError("[STRUCTMEM_CONSOLIDATION] Error", error);
			return {
				output: {
					consolidatedSummaries: [],
					processingStage: "completed",
					errors: [
						error instanceof Error
							? error.message
							: "StructMem consolidation failed",
					],
				},
			};
		}
	},
});

type StructMemConsolidationSpec = StepSpecFromDefinition<typeof definition>;

export const createStructMemConsolidationStep: StepFactoryFromSpec<
	StructMemConsolidationSpec
> = (
	services: Pick<AllServices, "llm">,
	config?: StructMemConsolidationConfig,
) => bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createStructMemConsolidationStep);

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: StructMemConsolidationSpec;
	}
}
