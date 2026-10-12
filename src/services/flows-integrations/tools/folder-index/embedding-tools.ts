import type {
	ToolExecutionResult,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import {
	EMBEDDING_CHUNKS_TOOL,
	EMBEDDING_SEARCH_TOOL,
	EMBEDDING_INDEX_TYPE_ID,
} from "@/services/folder-index/constants";
import {
	indexRootOf,
	indexRoots,
	normalizeFolderPath,
	parentFolder,
} from "@/services/folder-index/index-config";
import {
	embeddingToolResult,
	attachEmbeddingPreviews,
} from "@/services/folder-index/embedding/tool-results";
import { getFolderIndexRuntime } from "@/services/folder-index/runtime";

type Services = Record<string, never>;
const annotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};
const error = (value: unknown): ToolExecutionResult => ({
	content: `Error: ${value instanceof Error ? value.message : String(value)}`,
	isError: true,
});
const searchSchema = z.object({
	query: z
		.string()
		.trim()
		.min(1)
		.max(2000)
		.describe(
			"Describe the passage, image, sound, music or video moment to find.",
		),
	folder: z
		.string()
		.optional()
		.describe("Only this folder and its indexed descendants."),
	kind: z.enum(["text", "image", "audio", "video"]).optional(),
	limit: z.number().int().min(1).max(50).optional(),
});
type SearchInput = z.infer<typeof searchSchema>;

export const createEmbeddingSearchTool: ToolFactory<
	SearchInput,
	Services
> = () => ({
	name: EMBEDDING_SEARCH_TOOL,
	title: "Search file content by meaning",
	description:
		"Search indexed file content by meaning. For visual questions use kind=image. Returns source paths, excerpts, locations, ranked similarity and source image previews when the model supports vision. Use the matches and inspect images before answering; text grep cannot inspect visual content.",
	schema: searchSchema,
	annotations,
	execute: async (input, context) => {
		try {
			const { indexer, embeddings } = await getFolderIndexRuntime();
			const config = await indexer.loadConfig();
			const roots = indexRoots(config, EMBEDDING_INDEX_TYPE_ID);
			if (!roots.length)
				return {
					content: `No folder has an Embeddings index.${config.settings.agentsMayAsk ? " You may suggest enabling Embeddings in Files › Indexes." : ""}`,
				};
			const result = await embeddings.search(
				input,
				roots,
				(path, root) =>
					indexRootOf(
						config,
						EMBEDDING_INDEX_TYPE_ID,
						parentFolder(path) ?? "/",
					) === root,
			);
			const output = embeddingToolResult(result, {
				actionType: EMBEDDING_SEARCH_TOOL,
				query: input.query,
				folder: input.folder,
			});
			const previews = await attachEmbeddingPreviews(output, context?.signal);
			const text = JSON.stringify(output, null, 2);
			return {
				content: previews.length
					? ([
							{ type: "text", text },
							...previews,
						] as unknown as ToolExecutionResult["content"])
					: text,
				structuredContent: output,
				meta: {
					searched: result.searched,
					truncated: result.truncated,
					paths: result.hits.map((hit) => hit.path),
				},
			};
		} catch (value) {
			return error(value);
		}
	},
});

const chunksSchema = z.object({
	path: z.string().min(1).describe("The source file's library path."),
	offset: z.number().int().min(0).optional(),
	limit: z.number().int().min(1).max(20).optional(),
});
type ChunksInput = z.infer<typeof chunksSchema>;
export const createEmbeddingChunksTool: ToolFactory<
	ChunksInput,
	Services
> = () => ({
	name: EMBEDDING_CHUNKS_TOOL,
	title: "Read indexed content chunks",
	description:
		"Inspect a source file's content chunks with excerpts and page/time locations. Media chunks identify a segment; they do not contain a generated transcript.",
	schema: chunksSchema,
	annotations,
	execute: async (input, context) => {
		try {
			const { indexer, embeddings } = await getFolderIndexRuntime();
			const config = await indexer.loadConfig();
			const path = normalizeFolderPath(input.path);
			const root = indexRootOf(
				config,
				EMBEDDING_INDEX_TYPE_ID,
				parentFolder(path) ?? "/",
			);
			if (!root)
				return {
					content: "This file is outside the folders with an Embeddings index.",
				};
			const chunks = await embeddings.chunks(path, root);
			const offset = input.offset ?? 0;
			const shown = chunks.slice(offset, offset + (input.limit ?? 10));
			const output = embeddingToolResult(
				{
					hits: shown.map((chunk) => ({ ...chunk, score: 0 })),
					searched: chunks.length,
					truncated: false,
				},
				{
					actionType: EMBEDDING_CHUNKS_TOOL,
					path,
					total: chunks.length,
					offset,
				},
			);
			for (const hit of output.hits) delete hit.score;
			const previews = await attachEmbeddingPreviews(output, context?.signal);
			const text = JSON.stringify(output, null, 2);
			return {
				content: previews.length
					? ([
							{ type: "text", text },
							...previews,
						] as unknown as ToolExecutionResult["content"])
					: text,
				structuredContent: output,
				meta: { total: chunks.length, offset },
			};
		} catch (value) {
			return error(value);
		}
	},
});

toolRegistry.register(EMBEDDING_SEARCH_TOOL, createEmbeddingSearchTool);
toolRegistry.register(EMBEDDING_CHUNKS_TOOL, createEmbeddingChunksTool);
declare global {
	interface ToolTypeRegistry {
		[EMBEDDING_SEARCH_TOOL]: { input: SearchInput; services: Services };
		[EMBEDDING_CHUNKS_TOOL]: { input: ChunksInput; services: Services };
	}
}
