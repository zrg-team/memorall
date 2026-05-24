import { getKnowledgeDatabase } from "../../interfaces/knowledge";
import { logError, logInfo, logWarn } from "../../interfaces/logger";
import { getCurrentEmbeddingColumns } from "../../utils/embedding-size-config";
import { extractRetrievalTextFromMessages } from "../../utils/message-query";
import { defineStep, bindStep } from "../../interfaces/step";
import type {
	StepFactoryFromSpec,
	StepSpecFromDefinition,
} from "../../interfaces/step";
import { stepRegistry } from "../../step-registry";
import type { AllServices } from "../../interfaces/tool";
import type {
	ContextToSystemConfig,
	ContextToSystemInput,
	ContextToSystemOutput,
} from "../common/context-to-system";
import { asRecord, type StructMemNodeRow } from "./structmem-utils";

const STEP_NAME = "structmem-retrieve" as const;

export interface StructMemRetrievedMemory {
	id: string;
	nodeType:
		| "structmem_entry"
		| "structmem_factual_entry"
		| "structmem_relational_entry"
		| "structmem_summary";
	text: string;
	attributes: Record<string, unknown>;
	relevanceScore: number;
}

export interface StructMemRetrieveInput extends ContextToSystemInput {
	graphId?: string;
	contextQueries?: string[];
}

export interface StructMemRetrieveOutput extends ContextToSystemOutput {
	context: string;
	relevantNodes?: Array<{
		id: string;
		nodeType: string;
		name: string;
		summary: string;
		attributes: Record<string, unknown>;
		relevanceScore: number;
	}>;
	relevantEdges?: [];
	atomicMemories?: StructMemRetrievedMemory[];
	synthesisMemories?: StructMemRetrievedMemory[];
	errors?: string[];
}

export interface StructMemRetrieveConfig extends ContextToSystemConfig {
	entryLimit?: number;
	synthesisLimit?: number;
}

type StructMemRetrieveServices = Pick<AllServices, "database" | "embedding">;

const DEFAULT_ENTRY_LIMIT = 60;
const DEFAULT_SYNTHESIS_LIMIT = 5;

const STRUCTMEM_CONTEXT_PROMPT = `
# Knowledge Retrieval Context
The following context comes from StructMem memory. It has two circuits:
- Event Memory: timestamp-bound factual and relational entries.
- Synthesis Memory: consolidated cross-event summaries grounded in event citations.

Use Synthesis Memory for multi-hop, temporal, causal, or shared-experience reasoning. Use Event Memory as source-grounded evidence and to check details. If the context is insufficient, say what is missing before using general knowledge.

<context>
{context}
</context>
`.trim();

async function vectorSearchStructMemNodes(
	services: StructMemRetrieveServices,
	queryText: string,
	graphId: string,
	nodeType: "entry" | "summary",
	limit: number,
): Promise<StructMemRetrievedMemory[]> {
	const embedding = await services.embedding.get("default");
	if (!embedding?.isReady()) {
		logWarn("[STRUCTMEM_RETRIEVE] Embedding service unavailable");
		return [];
	}

	const queryEmbedding = await embedding.textToVector(queryText);
	const columns = await getCurrentEmbeddingColumns();
	const nodeTypeClause =
		nodeType === "entry"
			? "node_type IN ('structmem_entry', 'structmem_factual_entry', 'structmem_relational_entry')"
			: "node_type = 'structmem_summary'";
	const rows = await getKnowledgeDatabase(services.database).query(
		async ({ raw }) => {
			const queryResult = await raw(
				`SELECT id, node_type, name, summary, attributes, graph, created_at, updated_at,
			        1 - (${columns.nameEmbedding} <=> $1::vector) AS similarity
			 FROM nodes
			 WHERE ${nodeTypeClause}
			   AND graph = $2
			   AND attributes->>'structmem' = 'true'
			   AND ${columns.nameEmbedding} IS NOT NULL
			 ORDER BY similarity DESC
			 LIMIT $3`,
				[JSON.stringify(queryEmbedding), graphId, limit],
			);
			return ((queryResult as { rows?: StructMemNodeRow[] }).rows ??
				[]) as StructMemNodeRow[];
		},
	);

	return rows.map((row) => ({
		id: row.id,
		nodeType:
			row.node_type === "structmem_summary"
				? "structmem_summary"
				: row.node_type === "structmem_relational_entry"
					? "structmem_relational_entry"
					: row.node_type === "structmem_factual_entry"
						? "structmem_factual_entry"
						: "structmem_entry",
		text: row.summary || row.name,
		attributes: asRecord(row.attributes),
		relevanceScore: row.similarity ?? 0,
	}));
}

function formatEntry(memory: StructMemRetrievedMemory): string {
	const timestamp =
		typeof memory.attributes.timestamp === "string"
			? memory.attributes.timestamp
			: undefined;
	const eventId =
		typeof memory.attributes.eventId === "string"
			? memory.attributes.eventId
			: undefined;
	const entryKind =
		typeof memory.attributes.entryKind === "string"
			? memory.attributes.entryKind
			: undefined;

	return `- ${[
		timestamp ? `timestamp=${timestamp}` : undefined,
		eventId ? `event=${eventId}` : undefined,
		entryKind ? `kind=${entryKind}` : undefined,
	]
		.filter(Boolean)
		.join("; ")}: ${memory.text}`;
}

function formatSummary(memory: StructMemRetrievedMemory): string {
	const citations = Array.isArray(memory.attributes.timestampCitations)
		? memory.attributes.timestampCitations.join(", ")
		: "";
	const sourceEvents = Array.isArray(memory.attributes.sourceEventIds)
		? memory.attributes.sourceEventIds.join(", ")
		: "";
	return `- ${[
		citations ? `citations=${citations}` : undefined,
		sourceEvents ? `events=${sourceEvents}` : undefined,
	]
		.filter(Boolean)
		.join("; ")}: ${memory.text}`;
}

function buildStructMemContext(
	atomicMemories: StructMemRetrievedMemory[],
	synthesisMemories: StructMemRetrievedMemory[],
): string {
	const eventMemory = atomicMemories.map(formatEntry).join("\n");
	const synthesisMemory = synthesisMemories.map(formatSummary).join("\n");

	return `
<event_memory>
${eventMemory}
</event_memory>

<synthesis_memory>
${synthesisMemory}
</synthesis_memory>
`.trim();
}

const definition = defineStep<
	StructMemRetrieveInput,
	StructMemRetrieveOutput,
	StructMemRetrieveServices,
	StructMemRetrieveConfig
>({
	name: STEP_NAME,
	execute: async ({ input, services, config, runConfig }) => {
		try {
			const graphId = input.graphId?.trim() || "default";
			const queryParts = [
				extractRetrievalTextFromMessages(input.messages),
				...(input.contextQueries ?? []),
			]
				.map((part) => part.trim())
				.filter(Boolean);
			const queryText = queryParts.join("\n");

			if (!queryText) {
				return {
					output: {
						context: "",
						messages: input.messages,
						relevantNodes: [],
						relevantEdges: [],
					},
				};
			}

			const [atomicMemories, synthesisMemories] = await Promise.all([
				vectorSearchStructMemNodes(
					services,
					queryText,
					graphId,
					"entry",
					config?.entryLimit ?? DEFAULT_ENTRY_LIMIT,
				),
				vectorSearchStructMemNodes(
					services,
					queryText,
					graphId,
					"summary",
					config?.synthesisLimit ?? DEFAULT_SYNTHESIS_LIMIT,
				),
			]);

			const context = buildStructMemContext(atomicMemories, synthesisMemories);

			const contextToSystem = stepRegistry.getStepByName<
				ContextToSystemInput,
				ContextToSystemOutput
			>("context-to-system", services, {
				prompt: config?.prompt ?? STRUCTMEM_CONTEXT_PROMPT,
			});
			const contextToSystemResult = await contextToSystem.execute(
				{
					context,
					messages: input.messages,
				},
				runConfig,
			);

			const relevantNodes = [...atomicMemories, ...synthesisMemories].map(
				(memory) => ({
					id: memory.id,
					nodeType: memory.nodeType,
					name:
						memory.nodeType === "structmem_summary"
							? "StructMem synthesis memory"
							: memory.nodeType === "structmem_relational_entry"
								? "StructMem relational memory"
								: "StructMem factual memory",
					summary: memory.text,
					attributes: memory.attributes,
					relevanceScore: memory.relevanceScore,
				}),
			);

			logInfo("[STRUCTMEM_RETRIEVE] Complete", {
				entries: atomicMemories.length,
				syntheses: synthesisMemories.length,
			});
			runConfig?.writer?.({
				type: "actions",
				actions: [
					{
						id: crypto.randomUUID(),
						name: "structmem_knowledge_retrieval",
						description: `Retrieved ${atomicMemories.length} event memories and ${synthesisMemories.length} synthesis memories`,
						metadata: {
							atomicMemories,
							synthesisMemories,
						},
					},
				],
			});

			return {
				output: {
					context,
					messages: contextToSystemResult.output.messages,
					relevantNodes,
					relevantEdges: [],
					atomicMemories,
					synthesisMemories,
				},
			};
		} catch (error) {
			logError("[STRUCTMEM_RETRIEVE] Failed", error);
			return {
				output: {
					context: "",
					messages: input.messages,
					relevantNodes: [],
					relevantEdges: [],
					errors: [
						error instanceof Error
							? error.message
							: "StructMem knowledge retrieval failed",
					],
				},
			};
		}
	},
});

type StructMemRetrieveSpec = StepSpecFromDefinition<typeof definition>;

export const createStructMemRetrieveStep: StepFactoryFromSpec<
	StructMemRetrieveSpec
> = (services: StructMemRetrieveServices, config?: StructMemRetrieveConfig) =>
	bindStep(definition, services, config);

stepRegistry.register(STEP_NAME, createStructMemRetrieveStep, {
	description:
		"StructMem dual-circuit Knowledge Retrieval over event and synthesis memories",
	configParams: [
		{
			key: "entryLimit",
			type: "number",
			default: DEFAULT_ENTRY_LIMIT,
			description: "Number of atomic event memories to retrieve",
		},
		{
			key: "synthesisLimit",
			type: "number",
			default: DEFAULT_SYNTHESIS_LIMIT,
			description: "Number of consolidated synthesis memories to retrieve",
		},
	],
	defaultStateMapping: {
		messages: "messages",
		graphId: "graphId",
		contextQueries: "contextQueries",
	},
	enabledByDefault: false,
});

declare global {
	interface StepTypeRegistry {
		[STEP_NAME]: StructMemRetrieveSpec;
	}
}
