import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeFsPath, globMatches, listEntries } from "./util";

const TOOL_NAME = "fs_glob" as const;

const schema = z.object({
	pattern: z
		.string()
		.describe(
			'Glob pattern to match paths (e.g. "**/*.md", "notes/**/*.txt", "*.json")',
		),
	path: z
		.string()
		.optional()
		.describe('Base directory to search under (default: "/")'),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createFsGlobTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Find paths that match a glob pattern. Supports common glob syntax including **, *, ?, {a,b}, [abc], [!abc], and extglob groups like @(a|b). For ambiguous asset/name searches, combine likely names and extensions in one pattern, e.g. **/*{icon,logo,brand}*.{png,jpg,jpeg,svg,webp,ico}, instead of making repeated narrow calls. Returns matching paths.",
	schema,
	execute: async (input) => {
		const { pattern, path = "/" } = input;

		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const basePath = normalizeFsPath(path);

		const entries = await listEntries(dfs, basePath, true);
		const matches = entries.filter((entry) => {
			const rel =
				basePath === "/"
					? entry.path.slice(1)
					: entry.path.slice(basePath.length + 1);
			return rel.length > 0 && globMatches(pattern, rel);
		});

		if (matches.length === 0) {
			return `No files found matching "${pattern}" under "${basePath}"`;
		}

		return matches.map((entry) => entry.path).join("\n");
	},
});

toolRegistry.register(TOOL_NAME, createFsGlobTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
