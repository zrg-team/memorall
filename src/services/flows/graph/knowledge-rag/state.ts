import { Annotation } from "@langchain/langgraph/web";
import type { ChatMessage } from "@/types/openai";
import {
	type BaseStateBase,
	BaseAnnotation,
} from "@/services/flows/interfaces/graph.base";

export interface KnowledgeRAGState extends BaseStateBase {
	// Input
	messages: ChatMessage[];
	query: string;
	topicId?: string;

	// Query Analysis
	extractedEntities: string[];
	queryIntent: "factual" | "relationship" | "summary" | "exploration";

	// Knowledge Retrieval
	relevantNodes: Array<{
		id: string;
		nodeType: string;
		name: string;
		summary: string;
		attributes: Record<string, unknown>;
		relevanceScore: number;
	}>;

	relevantEdges: Array<{
		id: string;
		sourceId: string;
		destinationId: string;
		edgeType: string;
		factText: string;
		attributes: Record<string, unknown>;
		relevanceScore: number;
	}>;

	// Context Building
	knowledgeContext: string;
	mermaidDiagram: string;

	// Steps for tracking progress
	steps: Array<{
		role: "assistant" | "tool" | "user";
		content: string;
		tool_calls?: Array<{
			id: string;
			name: string;
			arguments: string;
		}>;
		tool_call_id?: string;
	}>;

	// Flow control
	next?:
		| "analyze_query"
		| "retrieve_knowledge"
		| "build_context"
		| "generate_response";
}

export const KnowledgeRAGAnnotation = {
	...BaseAnnotation,
	messages: Annotation<ChatMessage[]>({
		value: (x, y) => y ?? x ?? [],
		default: () => [],
	}),
	query: Annotation<string>({
		value: (x, y) => y ?? x ?? "",
		default: () => "",
	}),
	topicId: Annotation<string | undefined>({
		value: (x, y) => y ?? x,
		default: () => undefined,
	}),
	extractedEntities: Annotation<string[]>({
		value: (x, y) => y ?? x ?? [],
		default: () => [],
	}),
	queryIntent: Annotation<KnowledgeRAGState["queryIntent"]>({
		value: (x, y) => y ?? x ?? "factual",
		default: () => "factual" as const,
	}),
	relevantNodes: Annotation<KnowledgeRAGState["relevantNodes"]>({
		value: (x, y) => y ?? x ?? [],
		default: () => [],
	}),
	relevantEdges: Annotation<KnowledgeRAGState["relevantEdges"]>({
		value: (x, y) => y ?? x ?? [],
		default: () => [],
	}),
	knowledgeContext: Annotation<string>({
		value: (x, y) => y ?? x ?? "",
		default: () => "",
	}),
	mermaidDiagram: Annotation<string>({
		value: (x, y) => y ?? x ?? "",
		default: () => "",
	}),
	steps: Annotation<KnowledgeRAGState["steps"]>({
		value: (x, y) => {
			if (!x) return y ?? [];
			if (!y) return x;
			return x.concat(y);
		},
		default: () => [],
	}),
	next: Annotation<KnowledgeRAGState["next"]>({
		value: (x, y) => y ?? x,
		default: () => undefined,
	}),
};
