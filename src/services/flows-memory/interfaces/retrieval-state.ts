/** State produced and consumed by retrieval pipeline steps. */
export interface RetrievalPipelineState {
	extractedEntities: string[];
	queryIntent: "factual" | "relationship" | "summary" | "exploration";

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

	context: string;
}
