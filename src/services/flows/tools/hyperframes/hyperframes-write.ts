import z from "zod";
import type { Tool, ToolFactory, AllServices } from "@/services/flows/interfaces/tool";
import { toolRegistry } from "@/services/flows/tool-registry";
import { compositionFile } from "./util";

const TOOL_NAME = "hyperframes_write" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe("Workspace path to the project directory, e.g. /workspaces/product-launch"),
	content: z.string().min(1).describe("Full HyperFrames composition HTML"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "documentFileSystem">;

export const createHyperframesWriteTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Create or overwrite the composition HTML for a HyperFrames project. The file is always saved as index.html inside the project directory.",
	schema,
	execute: async (input) => {
		const dfs = services.documentFileSystem;
		if (!dfs) return "Error: documentFileSystem service not available.";

		const file = compositionFile(input.project_path);
		await dfs.writeWorkspaceFile(file, input.content);
		return `Saved: ${file}`;
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesWriteTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
