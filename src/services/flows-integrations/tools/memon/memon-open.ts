import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_OPEN_TOOL } from "@/services/memon/constants";
import { runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		app: z
			.enum(["browser", "files", "editor", "terminal", "tasks", "visualize"])
			.describe("The app to open or bring to the front."),
		url: z
			.string()
			.optional()
			.describe(
				"Browser: the page to open. Plain words search DuckDuckGo instead.",
			),
		newTab: z
			.boolean()
			.optional()
			.describe("Browser: open in a new tab and keep the current page."),
		embedded: z
			.boolean()
			.optional()
			.describe(
				"Browser: a local address a Terminal server listens on (http://localhost:PORT) opens embedded; any other opens in a real browser tab, where the user's own servers are. true or false forces one.",
			),
		path: z
			.string()
			.optional()
			.describe(
				'Files: the folder to show (default "/"), or a file to open in its app: a .terminal launcher runs in a new Terminal tab, a .studio app opens Studio set up, a .tasks file opens in Tasks. Editor: the file to open as text (a launcher or studio app too, to read or change it without running it); a missing file starts empty and is created on save. Visualize: the .openui file to open.',
			),
	})
	.describe("Open an app on the computer, a page in the Browser, or a file.");

type Input = z.infer<typeof schema>;

export const createMemonOpenTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_OPEN_TOOL,
	description:
		"Open an app on the computer and return the screen. Browser opens a url (or a search); Files shows a folder; Editor opens a file; Terminal brings up the shell.",
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_OPEN_TOOL,
			context,
			input.app === "browser"
				? `Opening ${input.url ?? "the browser"}`
				: `Opening ${input.path ?? input.app}`,
			() => ({}),
			async (machine) => {
				switch (input.app) {
					case "browser":
						if (input.url) {
							await machine.openUrl(input.url, {
								newTab: input.newTab,
								embedded: input.embedded,
							});
							return `Opened ${input.url}.`;
						}
						machine.openWindow("browser");
						return "Brought the Browser to the front.";
					case "files": {
						const path = input.path ?? "/";
						if (await machine.isFolder(path)) {
							await machine.openFolder(path);
							return `Opened ${path} in Files.`;
						}
						await machine.openFile(path);
						return `Opened ${path}.`;
					}
					case "editor":
						if (!input.path)
							throw new Error("Give the path of the file to open.");
						await machine.openFile(input.path, { create: true, asText: true });
						return `Opened ${input.path}.`;
					case "terminal":
						machine.openWindow("terminal");
						return "Brought the Terminal to the front.";
					case "tasks":
						machine.openWindow("tasks");
						return "Brought Tasks to the front.";
					case "visualize":
						if (input.path) {
							await machine.openVisual(input.path);
							return `Opened ${input.path} in Visualize.`;
						}
						machine.openWindow("visualize");
						return "Brought Visualize to the front.";
				}
			},
		),
});

toolRegistry.register(MEMON_OPEN_TOOL, createMemonOpenTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_OPEN_TOOL]: { input: Input; services: void };
	}
}
