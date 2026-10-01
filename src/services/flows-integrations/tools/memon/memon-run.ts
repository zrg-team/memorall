import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_RUN_TOOL } from "@/services/memon/constants";
import type { MemonMachine } from "@/services/memon/memon-machine";
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
			.describe("Working directory; defaults to the Terminal's current one."),
		waitSeconds: z
			.number()
			.min(1)
			.max(120)
			.optional()
			.describe(
				"How long to wait for the command to finish before returning (default 10). With nothing else set, waits for the running command, or just waits when nothing runs.",
			),
	})
	.describe(
		"Run, wait for, type into, or stop a command in the computer's Terminal.",
	);

type Input = z.infer<typeof schema>;

/** Quiet this long, a running command may just be finished. */
const QUIET_HINT_MS = 5_000;

const formatElapsed = (ms: number | null): string => {
	if (ms === null) return "";
	const seconds = Math.round(ms / 1000);
	return seconds < 60
		? `${seconds}s`
		: `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

/** Where the command stands after the call. */
const status = (machine: MemonMachine, done: string): string => {
	const running = machine.currentCommand;
	if (!running) return done;
	const quietMs = machine.commandQuietMs ?? 0;
	const servers = machine.servers;
	// The sandbox cannot tell a finished script from a waiting one: a script
	// that never calls process.exit keeps "running". A server is meant to.
	const quiet = servers.length
		? ` It serves ${servers.map((port) => `http://localhost:${port}`).join(", ")}; leave it running and open that address in the Browser to see the page.`
		: quietMs >= QUIET_HINT_MS
			? ` It has printed nothing for ${formatElapsed(quietMs)}; if its work is done, stop it.`
			: "";
	return `\`${running}\` is still running (${formatElapsed(machine.commandElapsedMs)}); its output streams into the Terminal.${quiet} Call memon_run with no command to keep waiting, input to answer a prompt, or stop: true to stop it.`;
};

const apply = async (machine: MemonMachine, input: Input): Promise<string> => {
	const waitMs = (input.waitSeconds ?? 10) * 1000;
	if (input.command) {
		const outcome = await machine.runCommand(input.command, {
			cwd: input.cwd,
			waitMs,
		});
		if (outcome.alongside) {
			return `Ran \`${input.command}\` (exit ${outcome.exitCode ?? "?"}) next to \`${machine.currentCommand}\`, which keeps running.`;
		}
		return status(
			machine,
			`Ran \`${input.command}\` (exit ${outcome.exitCode ?? "?"}).`,
		);
	}
	if (input.stop) {
		await machine.stopCommand();
		return status(machine, "Stopped the command.");
	}
	if (input.input !== undefined) {
		await machine.sendCommandInput(input.input);
		await machine.waitForCommand(waitMs);
		return status(machine, `Typed "${input.input}"; the command finished.`);
	}
	if (!machine.currentCommand) {
		if (!input.waitSeconds) {
			return "Nothing is running in the Terminal; pass command to run one.";
		}
		await new Promise((resolve) => setTimeout(resolve, waitMs));
		return `Waited ${input.waitSeconds}s; nothing is running in the Terminal.`;
	}
	await machine.waitForCommand(waitMs);
	return status(machine, "The command finished.");
};

export const createMemonRunTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_RUN_TOOL,
	description:
		'Run a shell command in the Terminal window (the same "/" tree as Files) and return its output with the screen. Long commands keep running and streaming: call again to wait, type into them, or stop them. `cd dir` changes the working directory for later commands.',
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_RUN_TOOL,
			context,
			input.command
				? `Running ${input.command.length > 40 ? `${input.command.slice(0, 39)}…` : input.command}`
				: input.stop
					? "Stopping the command"
					: input.input !== undefined
						? "Typing into the command"
						: "Waiting for the command",
			(machine) => ({
				windowId: machine.findWindow("terminal")?.id,
				ref: "t1",
			}),
			(machine) => apply(machine, input),
		),
});

toolRegistry.register(MEMON_RUN_TOOL, createMemonRunTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_RUN_TOOL]: { input: Input; services: void };
	}
}
