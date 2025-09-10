import z from "zod";
import type { Tool, AllServices } from "../interfaces/tool";

// This tool needs ONLY embedding service
export const memorySearchTool: Tool<
	{ query: string; limit?: number },
	Pick<AllServices, "embedding">
> = {
	name: "memory_search",
	description: "Search through conversation memory and knowledge base",
	schema: z.object({
		query: z.string().describe("Search query"),
		limit: z.number().optional().describe("Maximum number of results"),
	}),
	execute: async (
		input: { query: string; limit?: number },
		services?: Pick<AllServices, "embedding">,
	) => {
		const { query, limit = 5 } = input;

		// TODO: Implement actual memory search using embedding service
		// For now, return a mock response
		return `Searched for "${query}" and found ${limit} relevant memories. This would integrate with the embedding service and knowledge graph.`;
	},
};
