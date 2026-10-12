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
import { chunkLocationLabel } from "@/services/folder-index/embedding/types";
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
		"Search EmbeddingGemma 2 content chunks across documents, images, audio, music and video. Returns source paths, excerpts, pages or timestamps, and cosine similarity (not confidence).",
	schema: searchSchema,
	annotations,
	execute: async (input) => {
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
			return {
				content:
					`${result.hits.length} matches from ${result.searched} chunks${result.truncated ? " (search limit reached; narrow the folder)" : ""}:\n\n` +
					result.hits
						.map(
							(hit) =>
								`${hit.path}\n  ${hit.kind} · ${chunkLocationLabel(hit.location)} · cosine ${hit.score.toFixed(3)}\n  Chunk: ${hit.id}${hit.text ? `\n  ${hit.text}` : ""}`,
						)
						.join("\n\n")
						.slice(0, 16_000),
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
	execute: async (input) => {
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
			return {
				content:
					`${path}: ${chunks.length} chunks, showing ${shown.length} from offset ${offset}.\n\n` +
					shown
						.map(
							(chunk) =>
								`${chunk.id} · ${chunk.kind} · ${chunkLocationLabel(chunk.location)}${chunk.text ? `\n${chunk.text}` : ""}`,
						)
						.join("\n\n")
						.slice(0, 16_000),
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
