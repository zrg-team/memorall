import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import {
	normalizeFsPath,
	globMatches,
	globDescendFilter,
	globOptsIntoNoise,
	globSearchRoot,
	walkEntries,
} from "./util";

const TOOL_NAME = "document_fs_glob" as const;

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

		// See the sibling tool in the flows package: start from the pattern's
		// literal prefix, skip build and dependency folders unless the pattern
		// names one, and prune any branch the pattern can no longer match.
		const searchRoot = globSearchRoot(pattern, basePath);
		const canDescend = globDescendFilter(pattern, basePath);

		const result = await walkEntries(dfs, searchRoot, {
			recursive: true,
			withSizes: false,
			pruneNoise: !globOptsIntoNoise(pattern),
			limit: MAX_MATCHES,
			shouldDescend: (displayPath) => canDescend(displayPath),
			keep: (entry) => {
				const rel =
					basePath === "/"
						? entry.path.slice(1)
						: entry.path.slice(basePath.length + 1);
				return rel.length > 0 && globMatches(pattern, rel);
			},
		});

		if (result.entries.length === 0) {
			const skipped = result.prunedDirectories
				? ` ${result.prunedDirectories} build/dependency folder(s) were skipped \u2014 name one in the pattern to include it.`
				: "";
			return `No files found matching "${pattern}" under "${basePath}".${skipped}`;
		}

		const paths = result.entries.map((entry) => entry.path).join("\n");
		if (!result.truncated) return paths;
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
		};
	}
}
