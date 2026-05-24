import { Annotation } from "@langchain/langgraph";
import { BaseAnnotation, type BaseStateBase } from "../graph.base";
import type { Node } from "../../interfaces/knowledge";
import type { Edge } from "../../interfaces/knowledge";
import type { Source } from "../../interfaces/knowledge";

export type StructMemEntryKind = "factual" | "relational";

export interface StructMemEntry {
	uuid: string;
	eventId: string;
	entryKind: StructMemEntryKind;
	text: string;
	timestamp: string;
	sourceId?: string;
	title?: string;
	url?: string;
	confidence?: number;
	metadata?: Record<string, unknown>;
	nodeId?: string;
}

export interface StructMemEvent {
	eventId: string;
	timestamp: string;
	entries: StructMemEntry[];
}

export interface StructMemSummary {
	uuid: string;
	text: string;
	sourceEventIds: string[];
	sourceEntryIds: string[];
	seedEntryIds: string[];
	timestampCitations: string[];
	metadata?: Record<string, unknown>;
	nodeId?: string;
}

export interface StructMemState extends BaseStateBase {
	content: string;
	title: string;
	url: string;
	sourceId?: string;
	sourceType: string;
	referenceTimestamp: string;
	metadata?: Record<string, unknown>;
	graphId?: string;
	previousMessages?: string;
	currentMessage: string;

	eventId?: string;
	factualEntries: StructMemEntry[];
	relationalEntries: StructMemEntry[];
	bufferedEntries: StructMemEntry[];
	relatedEntries: StructMemEntry[];
	reconstructedEvents: StructMemEvent[];
	consolidatedSummaries: StructMemSummary[];
	shouldConsolidate: boolean;

	createdNodes: Node[];
	createdEdges: Edge[];
	createdSource?: Source;

	processingStage:
		| "event_extraction"
		| "event_persistence"
		| "related_event_loading"
		| "cross_event_consolidation"
		| "summary_persistence"
		| "completed";
	errors: string[];
}

export const StructMemAnnotation = Annotation.Root({
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
	sourceId: Annotation<string | undefined>({
		value: (x, y) => y ?? x,
		default: () => undefined,
	}),
	sourceType: Annotation<string>({
		value: (x, y) => y ?? x,
		default: () => "conversation",
	}),
	referenceTimestamp: Annotation<string>({
		value: (x, y) => y ?? x,
		default: () => new Date().toISOString(),
	}),
	metadata: Annotation<Record<string, unknown> | undefined>({
		value: (x, y) => y ?? x,
		default: () => ({}),
	}),
	graphId: Annotation<string | undefined>({
		value: (x, y) => y ?? x,
		default: () => undefined,
	}),
	previousMessages: Annotation<string | undefined>({
		value: (x, y) => y ?? x,
		default: () => undefined,
	}),
	currentMessage: Annotation<string>({
		value: (x, y) => y ?? x,
		default: () => "",
	}),
	eventId: Annotation<string | undefined>({
		value: (x, y) => y ?? x,
		default: () => undefined,
	}),
	factualEntries: Annotation<StructMemEntry[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	relationalEntries: Annotation<StructMemEntry[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	bufferedEntries: Annotation<StructMemEntry[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	relatedEntries: Annotation<StructMemEntry[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	reconstructedEvents: Annotation<StructMemEvent[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	consolidatedSummaries: Annotation<StructMemSummary[]>({
		value: (x, y) => y ?? x,
		default: () => [],
	}),
	shouldConsolidate: Annotation<boolean>({
		value: (x, y) => y ?? x,
		default: () => false,
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
	processingStage: Annotation<StructMemState["processingStage"]>({
		value: (x, y) => y ?? x,
		default: () => "event_extraction",
	}),
	errors: Annotation<string[]>({
		value: (x, y) => (x || []).concat(y || []),
		default: () => [],
	}),
	...BaseAnnotation,
});
