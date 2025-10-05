import { useState, useEffect, useCallback } from "react";
import { knowledgeGraphService } from "@/modules/knowledge/services/knowledge-graph/knowledge-graph-service";
import type {
	ConversionProgress,
	KnowledgeGraphData,
	KnowledgeGraphConversionState,
} from "@/types/knowledge-graph";
import type { RememberedContent } from "@/services/database/db";

export function useKnowledgeGraph() {
	const [conversions, setConversions] = useState<
		Map<string, ConversionProgress>
	>(new Map());
	const [state, setState] = useState<KnowledgeGraphConversionState>({
		conversions: {},
		isRunning: false,
		totalPages: 0,
		completedPages: 0,
		failedPages: 0,
	});

	// Subscribe to conversion updates
	useEffect(() => {
		const unsubscribe = knowledgeGraphService.subscribe((newConversions) => {
			setConversions(new Map(newConversions));

			// Update state
			const conversionsArray = Array.from(newConversions.values());
			setState({
				conversions: Object.fromEntries(newConversions),
				isRunning: conversionsArray.some(
					(c) => c.status !== "completed" && c.status !== "failed",
				),
				totalPages: conversionsArray.length,
				completedPages: conversionsArray.filter((c) => c.status === "completed")
					.length,
				failedPages: conversionsArray.filter((c) => c.status === "failed")
					.length,
			});
		});

		return unsubscribe;
	}, []);

	const convertPage = useCallback(async (page: RememberedContent) => {
		await knowledgeGraphService.convertPageToKnowledgeGraph(page);
	}, []);

	const convertPages = useCallback(async (pages: RememberedContent[]) => {
		await knowledgeGraphService.convertMultiplePages(pages);
	}, []);

	const getKnowledgeGraph = useCallback(
		async (pageId: string): Promise<KnowledgeGraphData | null> => {
			return await knowledgeGraphService.getKnowledgeGraphForPage(pageId);
		},
		[],
	);

	const getConversion = useCallback(
		(pageId: string): ConversionProgress | null => {
			return conversions.get(pageId) || null;
		},
		[conversions],
	);

	const clearCompleted = useCallback(() => {
		knowledgeGraphService.clearCompletedConversions();
	}, []);

	const clearAll = useCallback(() => {
		knowledgeGraphService.clearConversions();
	}, []);

	return {
		conversions,
		state,
		convertPage,
		convertPages,
		getKnowledgeGraph,
		getConversion,
		clearCompleted,
		clearAll,
	};
}
