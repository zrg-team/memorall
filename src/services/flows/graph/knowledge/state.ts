import { Annotation } from "@langchain/langgraph/web";
import {
	BaseAnnotation,
	type BaseStateBase,
} from "../../interfaces/graph.base";
import type { Node, NewNode } from "@/services/database/entities/nodes";
import type { Edge, NewEdge } from "@/services/database/entities/edges";
import type { Source, NewSource } from "@/services/database/entities/sources";

export interface ExtractedEntity {
	uuid: string;
	name: string;
	summary?: string;
	nodeType: string;
	attributes?: Record<string, unknown>;
}

export interface ResolvedEntity extends ExtractedEntity {
	isExisting: boolean;
	existingId?: string;
	finalName: string;
}

export interface ExtractedFact {
	uuid: string;
	sourceEntityId: string;
	destinationEntityId: string;
	relationType: string;
	factText: string;
	attributes?: Record<string, unknown>;
}

export interface ResolvedFact extends ExtractedFact {
	isExisting: boolean;
	existingId?: string;
}

export interface TemporalInfo {
	validAt?: string;
	invalidAt?: string;
}

export interface EnrichedFact extends ResolvedFact {
	temporal: TemporalInfo;
}

export interface KnowledgeGraphState extends BaseStateBase {
	// Input data
	content: string;
	title: string;
	url: string;
	pageId: string;
	referenceTimestamp: string;
	metadata?: Record<string, unknown>;

	// Processing state
	previousMessages?: string;
	currentMessage: string;

	// Extraction results
	extractedEntities: ExtractedEntity[];
	resolvedEntities: ResolvedEntity[];
	extractedFacts: ExtractedFact[];
	resolvedFacts: ResolvedFact[];
	enrichedFacts: EnrichedFact[];

	// Database operations
	createdNodes: Node[];
	createdEdges: Edge[];
	createdSource?: Source;

	// Existing data for resolution
	existingNodes: Node[];
	existingEdges: Edge[];

	// Processing status
	processingStage:
		| "entity_extraction"
		| "entity_resolution"
		| "fact_extraction"
		| "fact_resolution"
		| "temporal_extraction"
		| "database_operations"
		| "completed";
	errors: string[];
}

export const KnowledgeGraphAnnotation = Annotation.Root({
	content: Annotation<string>({
		value: (x, y) => y ?? x,
		default: () => "",
	}),
	title: Annotation<string>({
		value: (x, y) => y ?? x,
		default: () => "",
	}),
	url: Annotation<string>({
		value: (x, y) => y ?? x,
		default: () => "",
	}),
	pageId: Annotation<string>({
		value: (x, y) => y ?? x,
		default: () => "",
	}),
	referenceTimestamp: Annotation<string>({
		value: (x, y) => y ?? x,
		default: () => new Date().toISOString(),
	}),
	metadata: Annotation<Record<string, unknown> | undefined>({
		value: (x, y) => y ?? x,
		default: () => ({}),
	}),
	previousMessages: Annotation<string | undefined>({
		value: (x, y) => y ?? x,
		default: () => undefined,
	}),
	currentMessage: Annotation<string>({
		value: (x, y) => y ?? x,
		default: () => "",
	}),
	extractedEntities: Annotation<ExtractedEntity[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	resolvedEntities: Annotation<ResolvedEntity[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	extractedFacts: Annotation<ExtractedFact[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	resolvedFacts: Annotation<ResolvedFact[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	enrichedFacts: Annotation<EnrichedFact[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	createdNodes: Annotation<Node[]>({
		value: (x, y) => (x || []).concat(y || []),
		default: () => [],
	}),
	createdEdges: Annotation<Edge[]>({
		value: (x, y) => (x || []).concat(y || []),
		default: () => [],
	}),
	createdSource: Annotation<Source | undefined>({
		value: (x, y) => y ?? x,
		default: () => undefined,
	}),
	existingNodes: Annotation<Node[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	existingEdges: Annotation<Edge[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	processingStage: Annotation<KnowledgeGraphState["processingStage"]>({
		value: (x, y) => y ?? x,
		default: () => "entity_extraction",
	}),
	errors: Annotation<string[]>({
		value: (x, y) => (x || []).concat(y || []),
		default: () => [],
	}),
	...BaseAnnotation,
});
