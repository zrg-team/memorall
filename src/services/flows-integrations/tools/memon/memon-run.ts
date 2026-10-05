import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_RUN_TOOL, memonDisplayPath } from "@/services/memon/constants";
import {
	runTerminalAction,
	terminalActionLabel,
} from "@/services/memon/terminal/terminal-actions";
import { runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		command: z
			.string()
			.optional()
			.describe(
				"The shell command to run. Leave out to work with the running one.",
			),
		input: z
			.string()
			.optional()
			.describe(
				"Type this line into the running command, e.g. an answer to its prompt.",
			),
		stop: z.boolean().optional().describe("Stop the running command (Ctrl+C)."),
		cwd: z
			.string()
			.optional()
			.describe(
				"Working directory; defaults to the Terminal tab's current one.",
			),
		terminal: z
			.string()
			.optional()
			.describe(
				'Terminal tab to work in, e.g. "2", or "new" to open one; it comes to the front so the screen shows its output. Alone, it only switches to that tab. Defaults to the tab in front.',
			),
		closeTab: z
			.boolean()
			.optional()
			.describe(
				"Close the Terminal tab given by terminal (default: the tab in front), stopping the command running in it.",
			),
		waitSeconds: z
			.number()
			.min(1)
			.max(120)
			.optional()
			.describe(
				"How long to wait for the command to finish before returning (default 10). With nothing else set, waits for the running command, or just waits when nothing runs.",
			),
		saveAs: z
			.string()
			.optional()
			.describe(
				'Keep `command` as a launcher instead of running it, e.g. "Start Landing Page" saves ~/Start Landing Page.terminal on the desktop; opening it runs the command in a new Terminal tab, in `cwd` (default: the tab\'s directory). A path saves it there.',
			),
	})
	.describe(
		"Run, wait for, type into, or stop a command in the computer's Terminal, and open, switch or close its tabs.",
	);

type Input = z.infer<typeof schema>;

export const createMemonRunTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_RUN_TOOL,
	description:
		'Run a shell command in the Terminal window (the same "/" tree as Files) and return its output with the screen. Long commands keep running and streaming: call again to wait, type into them, or stop them. The Terminal has tabs, each with its own working directory; `cd dir` changes the tab\'s directory for later commands. One long command (a server) runs at a time; while it does, file and text commands (ls, cat, mkdir, grep…), curl, git, py, ffmpeg and magick still run next to it in any tab; anything else waits for it.',
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_RUN_TOOL,
			context,
			input.saveAs !== undefined
				? `Saving ${input.saveAs}`
				: terminalActionLabel(input),
			(machine) => ({
				windowId: machine.findWindow("terminal")?.id,
				ref: "t1",
			}),
			async (machine) => {
				if (input.saveAs !== undefined) {
					if (!input.command?.trim()) {
						throw new Error("saveAs needs the command to keep.");
					}
					const path = await machine.saveTerminalLauncher(
						input.saveAs,
						input.command,
						input.cwd,
					);
					return `Saved ${memonDisplayPath(path, machine.home)}: opening it (a click on the desktop, or memon_open { app: "files", path }) runs \`${input.command.trim()}\` in a new Terminal tab.`;
				}
				return runTerminalAction(machine.terminal, input);
			},
		),
});

toolRegistry.register(MEMON_RUN_TOOL, createMemonRunTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_RUN_TOOL]: { input: Input; services: void };
	}
}
