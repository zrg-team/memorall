import z from "zod";
import type { Tool, ToolFactory, AllServices } from "@/services/flows/interfaces/tool";
import { toolRegistry } from "@/services/flows/tool-registry";
import {
	appendAssistantOutputToState,
	type BaseStateBase,
} from "@/services/flows/graph/graph.base";
import { compositionFile } from "./util";

const TOOL_NAME = "hyperframes_show" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe("Workspace path to the project directory, e.g. /workspaces/product-launch"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "documentFileSystem">;

const escapeAttr = (v: string): string =>
	v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const createHyperframesShowTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Preview a HyperFrames composition with full player controls (play/pause, scrub bar). Reads the saved composition and renders it as an interactive player in chat.",
	schema,
	execute: async (input, context) => {
		if (!context) return "Error: tool context unavailable.";

		const dfs = services.documentFileSystem;
		if (!dfs) return "Error: documentFileSystem service not available.";

		const file = compositionFile(input.project_path);
		let raw: Uint8Array;
		try {
			raw = await dfs.getWorkspaceFileContent(file);
		} catch {
			return `Error: ${file} not found. Use hyperframes_write to create the project first.`;
		}

		const html = new TextDecoder().decode(raw);
		// Derive a display name from the last path segment
		const name = input.project_path.split("/").filter(Boolean).pop() ?? "composition";

		const artifact = [
			`\n\n<artifact`,
			` identifier="${escapeAttr(`hf-${name}`)}"`,
			` type="application/hyperframes"`,
			` title="${escapeAttr(name)}">`,
			html,
			`</artifact>\n\n`,
		].join("");

		appendAssistantOutputToState(context.state as BaseStateBase, artifact);
		return "Composition displayed.";
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesShowTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
