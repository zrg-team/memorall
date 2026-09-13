import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/engine/tool.js";
import type { AllServices } from "../../interfaces/services/services.js";
import { toolRegistry } from "../../registries/tool-registry.js";
import type { FsToolConfig } from "./config.js";
import { normalizeFsPath, formatFileSize, walkEntries } from "./util.js";

const TOOL_NAME = "fs_ls" as const;

/** Enough to understand a tree; small enough to read and to pay for. */
const MAX_ENTRIES = 1_000;

const schema = z.object({
	path: z.string().optional().describe('Directory path to list (default: "/")'),
	recursive: z
		.boolean()
		.optional()
		.describe("List all subdirectory contents recursively (default: false)"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createFsLsTool: ToolFactory<Input, Services, FsToolConfig> = (
	services,
	config,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"List files and directories. Without recursive, shows only immediate children. With recursive: true, shows the full subtree.",
	schema,
	execute: async (input) => {
		const { path = "/", recursive = false } = input;

		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const dirPath = normalizeFsPath(path);

		try {
			// A recursive listing of a mapped folder is the most expensive thing
			// this tool can be asked for: every directory is a round trip to the
			// OS. Unbounded, it ran for minutes and answered nothing, which is
			// worse for an agent than a short answer that says it is short. So it
			// skips build and dependency folders, stops at a readable number of
			// entries, and gives up on time rather than on completeness.
			const result = await walkEntries(
				dfs,
				dirPath,
				recursive
					? { recursive: true, withSizes: true, limit: MAX_ENTRIES }
					: {
							recursive: false,
							withSizes: true,
							pruneNoise: false,
							limit: Number.POSITIVE_INFINITY,
							timeBudgetMs: Number.POSITIVE_INFINITY,
						},
				config,
			);
			const items = result.entries;
			if (items.length === 0) {
				return `Empty directory: ${dirPath}`;
			}

			const lines = items.map((n) => {
				if (n.type === "folder") return `${n.path}/`;
				const sizeStr =
					n.size !== undefined ? `  (${formatFileSize(n.size)})` : "";
				return `${n.path}${sizeStr}`;
			});

			const skipped = result.prunedDirectories
				? ` ${result.prunedDirectories} build/dependency folder(s) skipped.`
				: "";
			const partial = result.truncated
				? `\n\n(Partial \u2014 ${
						result.stopReason === "time"
							? "the listing ran out of time"
							: `stopped at ${MAX_ENTRIES} entries`
					}. List a sub-folder to see more.)`
				: "";

			return `${lines.length} item${lines.length !== 1 ? "s" : ""} in ${dirPath}:${skipped}\n${lines.join("\n")}${partial}`;
		} catch {
			return `Error: Path not found or is not a directory: ${path}`;
		}
	},
});

toolRegistry.register(TOOL_NAME, createFsLsTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: FsToolConfig;
		};
	}
}
