import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-legacy/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { toolRegistry } from "@/services/flows-legacy/registries/tool-registry";
import type { LottieToolConfig } from "@/services/flows-legacy/tools/lottie/config";
import {
	appendAssistantOutputToState,
	type BaseStateBase,
} from "@/services/flows-legacy/graph/graph.base";
import {
	animationFile,
	normalizeProjectPath,
} from "@/services/flows-legacy/tools/lottie/util";
import { readFileBytes } from "@/services/flows-legacy/tools/fs/util";

const TOOL_NAME = "lottie_show" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory, e.g. /projects/loading-spinner",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

const escapeAttr = (v: string): string =>
	v
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

export const createLottieShowTool: ToolFactory<
	Input,
	Services,
	LottieToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Preview a Lottie/Bodymovin animation with full player controls (play/pause, scrub bar). Reads the saved animation.json and renders it as an interactive player in chat.",
	schema,
	execute: async (input, context) => {
		if (!context) return "Error: tool context unavailable.";

		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const file = animationFile(input.project_path, config?.rootPath);
		let raw: Uint8Array;
		try {
			raw = await readFileBytes(dfs, file, config);
		} catch {
			return `Error: ${file} not found. Use lottie_init to create the project first.`;
		}

		const raw_json = new TextDecoder().decode(raw);
		const projectPath = normalizeProjectPath(
			input.project_path,
			config?.rootPath,
		);
		// Derive a display name from the last path segment
		const name =
			input.project_path.split("/").filter(Boolean).pop() ?? "animation";

		const artifact = [
			`\n\n<artifact`,
			` identifier="${escapeAttr(`lottie-${name}`)}"`,
			` type="lottie"`,
			` title="${escapeAttr(name)}"`,
			` project-path="${escapeAttr(projectPath)}">`,
			raw_json,
			`</artifact>\n\n`,
		].join("");

		appendAssistantOutputToState(context.state as BaseStateBase, artifact);
		return "Animation displayed.";
	},
});

toolRegistry.register(TOOL_NAME, createLottieShowTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: LottieToolConfig;
		};
	}
}
