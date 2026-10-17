import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import type { HyperframesToolConfig } from "./config";
import {
	appendAssistantOutputToState,
	type BaseStateBase,
} from "@memorall/agent-harness-flows/graph/graph.base";
import { compositionFile, normalizeProjectPath } from "./util";
import { readFileBytes } from "@memorall/agent-harness-flows/tools/fs/util";
import {
	createHyperframesReference,
	serializeHyperframesReference,
} from "./reference";
import {
	formatLintResult,
	lintHyperframesComposition,
} from "./hyperframes-validate";

const TOOL_NAME = "hyperframes_show" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory, e.g. /projects/product-launch",
		),
	force: z
		.boolean()
		.optional()
		.describe(
			"Show the preview even though validation reports errors. Only when you are certain every reported error is a false positive.",
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

export const createHyperframesShowTool: ToolFactory<
	Input,
	Services,
	HyperframesToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Validate a HyperFrames composition and, when it has no errors, show it in chat as a video player (play/pause, scrub, MP4 export and download). Returns the validation errors instead of showing a broken composition.",
	schema,
	execute: async (input, context) => {
		if (!context) return "Error: tool context unavailable.";

		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const file = compositionFile(input.project_path, config?.rootPath);
		let raw: Uint8Array;
		try {
			raw = await readFileBytes(dfs, file, config);
		} catch {
			return `Error: ${file} not found. Use hyperframes_init to create the project first.`;
		}

		const html = new TextDecoder().decode(raw);
		const projectPath = normalizeProjectPath(
			input.project_path,
			config?.rootPath,
		);

		let lintSummary = "";
		try {
			const lint = await lintHyperframesComposition(
				html,
				dfs,
				projectPath,
				config?.rootPath,
				config?.resourceRoots,
				config,
			);
			if (!lint.ok && !input.force) {
				return `${formatLintResult(lint, file)}\n\nNot shown: fix the errors with hyperframes_edit, then call hyperframes_show again.`;
			}
			lintSummary = formatLintResult(lint, file);
		} catch (error) {
			lintSummary = `Linter error: ${error instanceof Error ? error.message : String(error)}`;
		}

		// Derive a display name from the last path segment
		const name = projectPath.split("/").filter(Boolean).pop() ?? "composition";
		const reference = createHyperframesReference(projectPath, html);

		const artifact = [
			`\n\n<artifact`,
			` identifier="${escapeAttr(`hf-${name}`)}"`,
			` type="application/hyperframes"`,
			` title="${escapeAttr(name)}"`,
			` project-path="${escapeAttr(projectPath)}">`,
			serializeHyperframesReference(reference),
			`</artifact>\n\n`,
		].join("");

		appendAssistantOutputToState(context.state as BaseStateBase, artifact);
		return `Composition displayed (${file}). ${lintSummary}`.trim();
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesShowTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: HyperframesToolConfig;
		};
	}
}
