import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-core/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-core/interfaces/services/services";
import { toolRegistry } from "@/services/flows-core/registries/tool-registry";
import { normalizeProjectPath } from "@/services/flows-core/tools/hyperframes/util";
import {
	listEntries,
	displayPathToFsPath,
} from "@/services/flows-core/tools/fs/util";
import type { HyperframesToolConfig } from "@/services/flows-core/tools/hyperframes/config";

const TOOL_NAME = "hyperframes_list" as const;

const schema = z.object({});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createHyperframesListTool: ToolFactory<
	Input,
	Services,
	HyperframesToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"List all existing HyperFrames projects. Returns project paths and composition sizes. Call this before hyperframes_read or hyperframes_edit when you do not already know the project_path — never guess a path like 'default'.",
	schema,
	execute: async () => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const root = normalizeProjectPath("", config?.rootPath);

		let entries;
		try {
			entries = await listEntries(dfs, root, false, config);
		} catch {
			return `No projects found (root: ${root})`;
		}

		const projects: Array<{ path: string; size: number }> = [];

		for (const entry of entries) {
			if (entry.type !== "folder") continue;
			const indexPath = `${entry.path}/index.html`;
			try {
				const fsPath = displayPathToFsPath(indexPath, config);
				const stat = await dfs.stat(fsPath);
				if (!stat.isFile()) continue;
				const raw = await dfs.readFile(fsPath);
				const html = new TextDecoder().decode(raw);
				// HyperFrames compositions always contain both markers
				if (
					!html.includes("data-composition-id") ||
					!html.includes("window.__timelines")
				)
					continue;
				projects.push({ path: entry.path, size: stat.size });
			} catch {
				// not accessible or not a HyperFrames project
			}
		}

		if (projects.length === 0) {
			return `No HyperFrames projects found under ${root}. Use hyperframes_init to create one.`;
		}

		const lines = projects.map(
			(p) => `${p.path}  (${(p.size / 1024).toFixed(1)} KB)`,
		);
		return `HyperFrames projects under ${root}:\n${lines.join("\n")}`;
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesListTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: HyperframesToolConfig;
		};
	}
}
