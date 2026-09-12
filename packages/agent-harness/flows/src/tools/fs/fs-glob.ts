import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/engine/tool.js";
import type { AllServices } from "../../interfaces/services/services.js";
import { toolRegistry } from "../../registries/tool-registry.js";
import type { FsToolConfig } from "./config.js";
import {
	normalizeFsPath,
	globMatches,
	globDescendFilter,
	globOptsIntoNoise,
	globSearchRoot,
	walkEntries,
} from "./util.js";

const TOOL_NAME = "fs_glob" as const;

/** Enough to answer any real question; small enough to stay readable. */
const MAX_MATCHES = 500;

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

export const createFsGlobTool: ToolFactory<Input, Services, FsToolConfig> = (
	services,
	config,
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

		// Three things keep this from reading the whole library, in the order they
		// save the most. The pattern's literal prefix moves the starting point
		// down the tree; the noise list keeps the walk out of `node_modules` and
		// friends unless the pattern asks for them; and the partial match prunes
		// any branch the pattern can no longer match. What survives all three is
		// read concurrently, under a result cap and a time budget.
		const searchRoot = globSearchRoot(pattern, basePath);
		const canDescend = globDescendFilter(pattern, basePath);

		const relativeTo = (entryPath: string): string =>
			basePath === "/"
				? entryPath.slice(1)
				: entryPath.slice(basePath.length + 1);

		const result = await walkEntries(
			dfs,
			searchRoot,
			{
				recursive: true,
				withSizes: false,
				pruneNoise: !globOptsIntoNoise(pattern),
				limit: MAX_MATCHES,
				shouldDescend: (displayPath) => canDescend(displayPath),
				keep: (entry) => {
					const rel = relativeTo(entry.path);
					return rel.length > 0 && globMatches(pattern, rel);
				},
			},
			config,
		);

		if (result.entries.length === 0) {
			const scope =
				searchRoot === basePath
					? `"${basePath}"`
					: `"${basePath}" (searched "${searchRoot}")`;
			const skipped = result.prunedDirectories
				? ` ${result.prunedDirectories} build/dependency folder(s) were skipped \u2014 name one in the pattern to include it.`
				: "";
			return `No files found matching "${pattern}" under ${scope}.${skipped}`;
		}

		const paths = result.entries.map((entry) => entry.path).join("\n");
		if (!result.truncated) return paths;

		// Saying so matters: a truncated search that looks complete is how an
		// agent concludes a file does not exist.
		const why =
			result.stopReason === "time"
				? "the search ran out of time"
				: `the first ${MAX_MATCHES} matches were reached`;
		return `${paths}\n\n(Partial results \u2014 ${why}. Narrow the pattern or pass a more specific "path" to see the rest.)`;
	},
});

toolRegistry.register(TOOL_NAME, createFsGlobTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: FsToolConfig;
		};
	}
}
