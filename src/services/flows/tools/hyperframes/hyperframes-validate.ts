import z from "zod";
import type { Tool, ToolFactory, AllServices } from "@/services/flows/interfaces/tool";
import { toolRegistry } from "@/services/flows/tool-registry";
import {
	lintHyperframeHtml,
	type HyperframeLintResult,
} from "@hyperframes/core/lint";
import { compositionFile } from "./util";

const TOOL_NAME = "hyperframes_validate" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe("Workspace path to the project directory, e.g. /workspaces/product-launch"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "documentFileSystem">;

const formatResult = (result: HyperframeLintResult, file: string): string => {
	const errPart = result.errorCount > 0
		? `${result.errorCount} error${result.errorCount === 1 ? "" : "s"}`
		: "";
	const warnPart = result.warningCount > 0
		? `${result.warningCount} warning${result.warningCount === 1 ? "" : "s"}`
		: "";
	const summary = result.ok
		? `✓ Valid${warnPart ? ` (${warnPart})` : ""}`
		: `✗ ${[errPart, warnPart].filter(Boolean).join(", ")}`;

	const lines = [`HyperFrames lint [${file}]: ${summary}`];

	for (const f of result.findings) {
		const tag = f.severity === "error" ? "ERROR" : "WARNING";
		const code = f.code ? ` [${f.code}]` : "";
		lines.push(`  ${tag}${code} ${f.message}`);
		if (f.selector) lines.push(`    selector: ${f.selector}`);
		if (f.fixHint) lines.push(`    Fix: ${f.fixHint}`);
		if (f.snippet) lines.push(`    > ${f.snippet.trim()}`);
	}

	return lines.join("\n");
};

export const createHyperframesValidateTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Lint a HyperFrames composition for structural errors (missing timeline, broken scene windows, invalid attributes). Run after hyperframes_write and before hyperframes_show.",
	schema,
	execute: async (input) => {
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
		try {
			return formatResult(lintHyperframeHtml(html), file);
		} catch (error) {
			return `Linter error: ${error instanceof Error ? error.message : String(error)}`;
		}
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesValidateTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
