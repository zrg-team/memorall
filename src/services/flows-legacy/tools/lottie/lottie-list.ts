import z from "zod";
import type { Tool, ToolFactory } from "@/services/flows-legacy/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { toolRegistry } from "@/services/flows-legacy/registries/tool-registry";
import { normalizeProjectPath } from "@/services/flows-legacy/tools/lottie/util";
import { listEntries, displayPathToFsPath } from "@/services/flows-legacy/tools/fs/util";
import type { LottieToolConfig } from "@/services/flows-legacy/tools/lottie/config";

const TOOL_NAME = "lottie_list" as const;

const schema = z.object({});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createLottieListTool: ToolFactory<
	Input,
	Services,
	LottieToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"List all existing Lottie animation projects. Returns project paths and file sizes. Call this before lottie_read or lottie_write when you do not already know the project_path — never guess a path like 'default'.",
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
			const animationPath = `${entry.path}/animation.json`;
			try {
				const fsPath = displayPathToFsPath(animationPath, config);
				const stat = await dfs.stat(fsPath);
				if (!stat.isFile()) continue;
				const raw = await dfs.readFile(fsPath);
				const json = new TextDecoder().decode(raw);
				const doc = JSON.parse(json);
				// Lottie/Bodymovin fingerprint
				if (!("layers" in doc) || !("fr" in doc)) continue;
				projects.push({ path: entry.path, size: stat.size });
			} catch {
				// not accessible, not valid JSON, or not a Lottie project
			}
		}

		if (projects.length === 0) {
			return `No Lottie projects found under ${root}. Use lottie_init to create one.`;
		}

		const lines = projects.map(
			(p) => `${p.path}  (${(p.size / 1024).toFixed(1)} KB)`,
		);
		return `Lottie projects under ${root}:\n${lines.join("\n")}`;
	},
});

toolRegistry.register(TOOL_NAME, createLottieListTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: LottieToolConfig;
		};
	}
}
