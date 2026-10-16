import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import {
	HYPERFRAMES_PROJECT_FILES,
	normalizeProjectPath,
	projectFile,
} from "./util";
import { readFileBytes } from "@memorall/agent-harness-flows/tools/fs/util";
import type { HyperframesToolConfig } from "./config";
import { DESIGN_SPEC_FILES } from "./frame-presets";

const TOOL_NAME = "hyperframes_read" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory. Call hyperframes_list first if you do not already know this path — never guess values like 'default'.",
		),
	file: z
		.enum(HYPERFRAMES_PROJECT_FILES)
		.optional()
		.describe(
			"Which project file: index.html (the composition, default), frame.md or design.md (the design spec).",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createHyperframesReadTool: ToolFactory<
	Input,
	Services,
	HyperframesToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Read a HyperFrames project file: the composition (index.html, the default) or its design spec (frame.md / design.md). Use it to inspect the current state before editing. Reading the composition also names the project's design spec when it has one.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const target = input.file ?? "index.html";
		const file = projectFile(input.project_path, target, config?.rootPath);
		let raw: Uint8Array;
		try {
			raw = await readFileBytes(dfs, file, config);
		} catch {
			return target === "index.html"
				? `Error: ${file} not found. Use hyperframes_init to create the project first.`
				: `Error: ${file} not found. This project has no ${target}.`;
		}

		const text = new TextDecoder().decode(raw);
		if (target !== "index.html")
			return `${file} (${text.length} chars):\n\n${text}`;

		// The spec directs every edit: say which one the project has.
		const project = normalizeProjectPath(input.project_path, config?.rootPath);
		let spec: string | null = null;
		for (const name of DESIGN_SPEC_FILES) {
			try {
				await readFileBytes(dfs, `${project}/${name}`, config);
				spec = name;
				break;
			} catch {
				// Try the next one.
			}
		}
		const note = spec
			? `Design spec: ${project}/${spec} directs this project; keep to its tokens and rules (read it with ${spec === "DESIGN.md" ? "fs_read" : `hyperframes_read file: "${spec}"`} if it is not in this conversation).\n\n`
			: "";
		return `${note}${file} (${text.length} chars):\n\n${text}`;
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesReadTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: HyperframesToolConfig;
		};
	}
}
