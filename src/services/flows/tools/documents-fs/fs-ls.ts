import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeFsPath, listEntries, formatFileSize } from "./util";

const TOOL_NAME = "document_fs_ls" as const;

const schema = z.object({
	path: z.string().optional().describe('Directory path to list (default: "/")'),
	recursive: z
		.boolean()
		.optional()
		.describe("List all subdirectory contents recursively (default: false)"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createFsLsTool: ToolFactory<Input, Services> = (
	services,
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
			const items = await listEntries(dfs, dirPath, recursive);
			if (items.length === 0) {
				return `Empty directory: ${dirPath}`;
			}
			const lines = items.map((n) => {
				if (n.type === "folder") return `${n.path}/`;
				const sizeStr =
					n.size !== undefined ? `  (${formatFileSize(n.size)})` : "";
				return `${n.path}${sizeStr}`;
			});

			return `${lines.length} item${lines.length !== 1 ? "s" : ""} in ${dirPath}:\n${lines.join("\n")}`;
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
		};
	}
}
