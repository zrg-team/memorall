import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_WINDOW_TOOL } from "@/services/memon/constants";
import { runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		window: z
			.string()
			.describe(
				'The window, by id ("w2") or app ("browser", "files", "editor", "viewer", "terminal", "tasks", "studio").',
			),
		op: z
			.enum(["focus", "minimize", "maximize", "close"])
			.describe("What to do with the window."),
	})
	.describe("Arrange windows on the computer.");

type Input = z.infer<typeof schema>;

export const createMemonWindowTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_WINDOW_TOOL,
	description:
		"Focus, minimize, maximize or close a window on the computer, and return the screen.",
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_WINDOW_TOOL,
			context,
			`${input.op} ${input.window}`,
			(machine) => ({ windowId: machine.findWindow(input.window)?.id }),
			async (machine) => {
				const window = machine.findWindow(input.window);
				if (!window) throw new Error(`No window ${input.window} is open.`);
				switch (input.op) {
					case "focus":
						machine.focusWindow(window.id);
						break;
					case "minimize":
						machine.minimizeWindow(window.id);
						break;
					case "maximize":
						machine.toggleMaximize(window.id);
						break;
					case "close":
						await machine.closeWindow(window.id);
						break;
				}
				const done = {
					focus: "Focused",
					minimize: "Minimized",
					maximize: "Toggled maximize on",
					close: "Closed",
				}[input.op];
				return `${done} ${window.id}.`;
			},
		),
});

toolRegistry.register(MEMON_WINDOW_TOOL, createMemonWindowTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_WINDOW_TOOL]: { input: Input; services: void };
	}
}
