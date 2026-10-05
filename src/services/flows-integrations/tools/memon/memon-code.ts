import { getFlowRunInboxFromVars } from "@memorall/agent-harness-flows/context/run-inbox";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import {
	PI_CODE_ACTIONS,
	PI_CODE_DEFAULT_WAIT_SECONDS,
	PI_CODE_KEYS,
	PI_CODE_MAX_WAIT_SECONDS,
	type PiCodeKey,
	piCodeActionLabel,
} from "@/services/memon/apps/pi-code/pi-code-app";
import { MEMON_CODE_TOOL } from "@/services/memon/constants";
import { runMemonTool } from "./memon-tool-utils";

const KEYS = Object.keys(PI_CODE_KEYS) as [PiCodeKey, ...PiCodeKey[]];

const schema = z
	.object({
		action: z
			.enum(PI_CODE_ACTIONS)
			.describe(
				'"prompt" hands pi work, or steers it while it works, and waits until its turn ends; "wait" waits for that again; "stop" stops it; "keys" types into its terminal; "new" starts a new pi session; "compact" compacts its conversation; "close" quits pi.',
			),
		text: z
			.string()
			.optional()
			.describe(
				"prompt: the work for pi, standing on its own (the goal, the files, how to check it). keys: the text to type. compact: what the summary should keep.",
			),
		key: z
			.enum(KEYS)
			.optional()
			.describe('keys: a key pressed after text, e.g. "enter" or "escape".'),
		queue: z
			.enum(["steer", "followUp"])
			.optional()
			.describe(
				'A prompt while pi works: "steer" (default) reaches it after its current tool calls, "followUp" once it is done.',
			),
		cwd: z
			.string()
			.optional()
			.describe(
				'prompt: the folder pi works in when this call starts it, e.g. "~/todo-app" (default ~). It stays until pi is closed.',
			),
		waitSeconds: z
			.number()
			.min(0)
			.max(PI_CODE_MAX_WAIT_SECONDS)
			.optional()
			.describe(
				`The most seconds to wait for pi's turn to end (prompt and wait: ${PI_CODE_DEFAULT_WAIT_SECONDS} by default; 0 returns at once).`,
			),
	})
	.describe("Drive pi code, the coding agent app on the computer.");

type Input = z.infer<typeof schema>;

export const createMemonCodeTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_CODE_TOOL,
	description:
		"Hand coding work to pi code, the pi coding agent in its own window: it reads, edits and runs code in the computer's files with its own tools, on the chat's model. A prompt returns when pi's turn ends: it answered or asks you something, failed, or the user stopped it; or sooner, when the user writes to you. Then answer it, steer it, stop it or type into it. The user confirms in the pi code window before you hand it work. Returns a summary and the screen, which shows pi's conversation while its window is in front.",
	schema,
	execute: (input, context) => {
		const inbox = getFlowRunInboxFromVars(context?.runtime);
		return runMemonTool(
			MEMON_CODE_TOOL,
			context,
			piCodeActionLabel(input),
			(machine) => ({ windowId: machine.findWindow("pi")?.id, ref: "p1" }),
			(machine) => machine.piCode.act(input, { inbox: () => inbox?.size ?? 0 }),
		);
	},
});

toolRegistry.register(MEMON_CODE_TOOL, createMemonCodeTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_CODE_TOOL]: { input: Input; services: void };
	}
}
