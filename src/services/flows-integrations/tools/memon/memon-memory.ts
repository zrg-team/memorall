import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_MEMORY_TOOL } from "@/services/memon/constants";
import { MEMON_DESKTOP_FILE_MAX_CHARS } from "@/services/memon/desktop-files";
import type { MemonMachine } from "@/services/memon/memon-machine";
import { runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		action: z
			.enum(["list", "add", "update", "remove"])
			.describe(
				"list: show the entries, numbered; add: a new entry; update: reword `entry`; remove: delete `entry`.",
			),
		file: z
			.enum(["memory", "bot"])
			.optional()
			.describe(
				"memory (default): Memory.md, what you remember about the user and their work. bot: Bot.md, the user's standing instructions for you — change it only when the user asks to change how you behave in future chats.",
			),
		text: z
			.string()
			.optional()
			.describe("add/update: one short, self-contained fact or instruction."),
		entry: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe(
				"update/remove: the entry number, as [n] in the prompt or list.",
			),
	})
	.describe("Remember things between chats in Memory.md, and keep Bot.md.");

type Input = z.infer<typeof schema>;

const needEntry = (input: Input): number => {
	if (!input.entry) throw new Error(`${input.action} needs the entry number.`);
	return input.entry;
};

const apply = async (machine: MemonMachine, input: Input): Promise<string> => {
	const file = input.file ?? "memory";
	const name = file === "bot" ? "Bot.md" : "Memory.md";
	const { entries, length } = await machine.editDesktopFile(
		file,
		input.action === "list"
			? { action: "list" }
			: input.action === "add"
				? { action: "add", text: input.text ?? "" }
				: input.action === "update"
					? {
							action: "update",
							entry: needEntry(input),
							text: input.text ?? "",
						}
					: { action: "remove", entry: needEntry(input) },
	);
	const done = {
		list: `${name} has ${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`,
		add: `Added to ${name}.`,
		update: `Updated entry ${input.entry} of ${name}.`,
		remove: `Removed entry ${input.entry} from ${name}.`,
	}[input.action];
	const list = entries.map((entry, index) => `[${index + 1}] ${entry}`);
	const tooLong =
		length > MEMON_DESKTOP_FILE_MAX_CHARS
			? [
					`${name} is ${length} characters; only the first ${MEMON_DESKTOP_FILE_MAX_CHARS} reach future chats. Remove or merge outdated entries.`,
				]
			: [];
	return [done, ...list, ...tooLong].join("\n");
};

export const createMemonMemoryTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_MEMORY_TOOL,
	description:
		"Keep what you remember between chats in Memory.md (and, when the user asks, their standing instructions in Bot.md), one entry at a time. Both files are read at the start of every chat.",
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_MEMORY_TOOL,
			context,
			`${input.file === "bot" ? "Bot.md" : "Memory.md"}: ${input.action}`,
			(machine) => ({ windowId: machine.findWindow("editor")?.id }),
			(machine) => apply(machine, input),
		),
});

toolRegistry.register(MEMON_MEMORY_TOOL, createMemonMemoryTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_MEMORY_TOOL]: { input: Input; services: void };
	}
}
