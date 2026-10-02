import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_SCREEN_TOOL } from "@/services/memon/constants";
import { runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		window: z
			.string()
			.optional()
			.describe(
				'Optional window to focus first, by id ("w2") or app ("browser", "files", "editor", "terminal").',
			),
		waitSeconds: z
			.number()
			.min(1)
			.max(60)
			.optional()
			.describe(
				"Wait this long first (a page loading, a server starting, the user acting), then read the screen.",
			),
	})
	.describe("Read the computer screen.");

type Input = z.infer<typeof schema>;

export const createMemonScreenTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_SCREEN_TOOL,
	description:
		"Read the computer screen: the open windows, the focused window in full (a page outline with refs, a folder listing, a file, or terminal output), and anything the user changed since your last look.",
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_SCREEN_TOOL,
			context,
			input.waitSeconds
				? `Waiting ${input.waitSeconds}s`
				: "Looking at the screen",
			() => ({}),
			async (machine) => {
				if (input.waitSeconds) {
					await new Promise((resolve) =>
						setTimeout(resolve, (input.waitSeconds ?? 0) * 1000),
					);
				}
				if (input.window) {
					const window = machine.findWindow(input.window);
					if (!window) throw new Error(`No window ${input.window} is open.`);
					machine.focusWindow(window.id);
				}
				await machine.refreshBrowser();
				machine.terminal.refresh();
				return input.waitSeconds
					? `Waited ${input.waitSeconds}s, then read the screen.`
					: "Read the screen.";
			},
		),
});

toolRegistry.register(MEMON_SCREEN_TOOL, createMemonScreenTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_SCREEN_TOOL]: { input: Input; services: void };
	}
}
