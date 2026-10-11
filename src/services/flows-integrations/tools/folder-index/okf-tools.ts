import type {
	Tool,
	ToolExecutionResult,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import {
	OKF_INDEX_TOOL,
	OKF_INDEX_TYPE_ID,
	OKF_READ_TOOL,
	OKF_SEARCH_TOOL,
} from "@/services/folder-index/constants";
import {
	indexRootOf,
	indexRoots,
	normalizeFolderPath,
} from "@/services/folder-index/index-config";
import { OkfReader } from "@/services/folder-index/okf/okf-query";
import { getFolderIndexRuntime } from "@/services/folder-index/runtime";

/**
 * The agent's read-only view of OKF indexes. These tools never touch the
 * user's files: they read the cards the indexer keeps in its own store, so
 * they need no file service.
 */

type Services = Record<string, never>;

const READ_ONLY = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
} as const;

/** Longest card or index returned in one call. */
const RESPONSE_BUDGET = 16_000;

const clip = (text: string): string =>
	text.length > RESPONSE_BUDGET
		? `${text.slice(0, RESPONSE_BUDGET)}\n\n[Cut at ${RESPONSE_BUDGET} characters.]`
		: text;

const errorResult = (
	error: unknown,
	fallback: string,
): ToolExecutionResult => ({
	content: `Error: ${error instanceof Error ? error.message : fallback}`,
	isError: true,
});

/** Folders with an OKF index, and whether the user lets agents suggest more. */
const okfScope = async (): Promise<{ roots: string[]; mayAsk: boolean }> => {
	const config = await (await getFolderIndexRuntime()).indexer.loadConfig();
	return {
		roots: indexRoots(config, OKF_INDEX_TYPE_ID),
		mayAsk: config.settings.agentsMayAsk,
	};
};

/** How the user adds an index, offered only when they let agents ask. */
const ADD_INDEX_HINT =
	" If it would help, you may suggest the user add one: in Files, open the folder's menu and choose Indexes › OKF.";

const noIndexMessage = (mayAsk: boolean): string =>
	`No folder has an OKF index yet.${mayAsk ? ADD_INDEX_HINT : ""}`;

// ── okf_index ───────────────────────────────────────────────────────────────

const indexSchema = z.object({
	path: z
		.string()
		.optional()
		.describe(
			'Folder to list, e.g. "/Work/Invoices 2026". Omit to list every folder with an OKF index.',
		),
});
type IndexInput = z.infer<typeof indexSchema>;

export const createOkfIndexTool: ToolFactory<
	IndexInput,
	Services
> = (): Tool<IndexInput> => ({
	name: OKF_INDEX_TOOL,
	title: "List an OKF index",
	description:
		"List indexed folders, or return one folder's OKF index.md: every file with its type and one-line description, and its subfolders.",
	schema: indexSchema,
	annotations: READ_ONLY,
	execute: async (input): Promise<ToolExecutionResult> => {
		try {
			const { indexer, okfReader } = await getFolderIndexRuntime();
			const { roots, mayAsk } = await okfScope();
			if (!roots.length) return { content: noIndexMessage(mayAsk) };
			if (!input.path?.trim()) {
				const lines = await Promise.all(
					roots.map(async (root) => {
						const status = await indexer
							.getType(OKF_INDEX_TYPE_ID)
							?.status(root);
						return `- ${root} (${status?.entries ?? 0} files${status?.updatedAt ? `, updated ${status.updatedAt}` : ""})`;
					}),
				);
				return {
					content: `Folders with an OKF index:\n${lines.join("\n")}\n\nCall ${OKF_INDEX_TOOL} with one of these paths to see its files.`,
					meta: { roots },
				};
			}
			const folder = normalizeFolderPath(input.path);
			const config = await indexer.loadConfig();
			if (!indexRootOf(config, OKF_INDEX_TYPE_ID, folder)) {
				return {
					content: `${folder} has no OKF index. Indexed folders: ${roots.join(", ")}.${mayAsk ? ADD_INDEX_HINT : ""}`,
				};
			}
			const index = await okfReader.readIndex(folder);
			if (index === null) {
				return {
					content: `${folder} is being indexed or holds no indexed files yet. Try again shortly, or search with ${OKF_SEARCH_TOOL}.`,
				};
			}
			return {
				content: clip(
					`OKF index of ${folder} (links are to cards; read one with ${OKF_READ_TOOL} using the file's path):\n\n${index}`,
				),
			};
		} catch (error) {
			return errorResult(error, "Could not read the index");
		}
	},
});

// ── okf_read ────────────────────────────────────────────────────────────────

const readSchema = z.object({
	path: z
		.string()
		.min(1)
		.describe(
			'The file\'s path, e.g. "/Work/Invoices 2026/acme.pdf" (its card "acme.pdf.md" works too).',
		),
});
type ReadInput = z.infer<typeof readSchema>;

export const createOkfReadTool: ToolFactory<
	ReadInput,
	Services
> = (): Tool<ReadInput> => ({
	name: OKF_READ_TOOL,
	title: "Read an OKF card",
	description:
		"Read one file's OKF card: frontmatter (type, title, description, tags, provenance, trust) and body (file facts and the start of its text).",
	schema: readSchema,
	annotations: READ_ONLY,
	execute: async (input): Promise<ToolExecutionResult> => {
		try {
			const { okfReader } = await getFolderIndexRuntime();
			const card = await okfReader.readCard(input.path);
			if (!card) {
				return {
					content: `No OKF card for ${normalizeFolderPath(input.path)}. Find files with ${OKF_SEARCH_TOOL} or ${OKF_INDEX_TOOL}.`,
				};
			}
			return {
				content: clip(
					`Card of ${card.path} (${OkfReader.trustLine(card.text)}):\n\n${card.text}`,
				),
			};
		} catch (error) {
			return errorResult(error, "Could not read the card");
		}
	},
});

// ── okf_search ──────────────────────────────────────────────────────────────

const searchSchema = z.object({
	query: z
		.string()
		.optional()
		.describe("Words to find in titles, descriptions, tags and card text."),
	type: z
		.string()
		.optional()
		.describe('Only cards whose type contains this, e.g. "PDF" or "invoice".'),
	tags: z
		.array(z.string())
		.optional()
		.describe("Only cards with all of these tags."),
	folder: z
		.string()
		.optional()
		.describe("Only files in this folder or below it."),
	limit: z
		.number()
		.int()
		.min(1)
		.max(50)
		.optional()
		.describe("Most results (default 10)."),
});
type SearchInput = z.infer<typeof searchSchema>;

export const createOkfSearchTool: ToolFactory<
	SearchInput,
	Services
> = (): Tool<SearchInput> => ({
	name: OKF_SEARCH_TOOL,
	title: "Search OKF cards",
	description:
		"Search the OKF cards of every indexed folder by words, type, tags or folder. Returns file paths with their type, description and matching lines.",
	schema: searchSchema,
	annotations: READ_ONLY,
	execute: async (input): Promise<ToolExecutionResult> => {
		try {
			if (
				!input.query?.trim() &&
				!input.type?.trim() &&
				!input.tags?.length &&
				!input.folder?.trim()
			) {
				return {
					content: "Error: give at least one of query, type, tags or folder.",
					isError: true,
				};
			}
			const { okfReader } = await getFolderIndexRuntime();
			const { roots, mayAsk } = await okfScope();
			if (!roots.length) return { content: noIndexMessage(mayAsk) };
			const { hits, searched, truncated } = await okfReader.search(
				input,
				roots,
			);
			if (!hits.length) {
				return {
					content: `No cards matched (searched ${searched}). Try fewer words, or list a folder with ${OKF_INDEX_TOOL}.`,
					meta: { searched },
				};
			}
			const blocks = hits.map((hit) =>
				[
					`${hit.path}`,
					`  ${hit.type}${hit.tags.length ? ` · tags: ${hit.tags.join(", ")}` : ""}${hit.status !== "stable" ? ` · ${hit.status}` : ""}${hit.stale ? " · stale" : ""}`,
					...(hit.description ? [`  ${hit.description}`] : []),
					...hit.matches.map((line) => `  > ${line}`),
				].join("\n"),
			);
			return {
				content: clip(
					`${hits.length} of ${searched} cards matched${truncated ? " (the index is large; narrow with folder)" : ""}:\n\n${blocks.join("\n\n")}`,
				),
				meta: { searched, paths: hits.map((hit) => hit.path) },
			};
		} catch (error) {
			return errorResult(error, "Could not search the cards");
		}
	},
});

toolRegistry.register(OKF_INDEX_TOOL, createOkfIndexTool);
toolRegistry.register(OKF_READ_TOOL, createOkfReadTool);
toolRegistry.register(OKF_SEARCH_TOOL, createOkfSearchTool);

declare global {
	interface ToolTypeRegistry {
		[OKF_INDEX_TOOL]: { input: IndexInput; services: Services };
		[OKF_READ_TOOL]: { input: ReadInput; services: Services };
		[OKF_SEARCH_TOOL]: { input: SearchInput; services: Services };
	}
}
