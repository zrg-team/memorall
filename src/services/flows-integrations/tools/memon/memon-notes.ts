import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_NOTES_TOOL } from "@/services/memon/constants";
import type { MemonMachine } from "@/services/memon/memon-machine";
import { runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		action: z
			.enum(["set", "add", "edit", "start", "done", "undo", "remove", "write"])
			.describe(
				"set: replace the checklist with `items`; add: append `items`; edit: reword one `step` to `text`; start/done/undo/remove: change one `step`; write: replace the free-form notes with `text`.",
			),
		items: z
			.array(z.string())
			.optional()
			.describe("set/add: the steps, in order, each a short action."),
		step: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe("edit/start/done/undo/remove: the step number shown in Notes."),
		text: z
			.string()
			.optional()
			.describe(
				"edit: the step's new wording. write: findings, sources and decisions worth keeping (replaces the notes).",
			),
	})
	.describe("Keep the task's checklist and notes in the Notes app.");

type Input = z.infer<typeof schema>;

const needStep = (input: Input): number => {
	if (!input.step) throw new Error(`${input.action} needs the step number.`);
	return input.step;
};

const apply = (machine: MemonMachine, input: Input): string => {
	switch (input.action) {
		case "set": {
			const items = input.items ?? [];
			machine.setNotes(items);
			return `Notes has ${items.length} step${items.length === 1 ? "" : "s"}.`;
		}
		case "add": {
			const items = input.items ?? [];
			if (!items.length) throw new Error("add needs the items to add.");
			machine.addNotes(items);
			return `Added ${items.length} step${items.length === 1 ? "" : "s"}.`;
		}
		case "edit":
			return `Reworded step ${input.step}: ${machine.editNote(needStep(input), input.text ?? "").text}`;
		case "start":
			return `Started step ${input.step}: ${machine.setNoteStatus(needStep(input), "doing").text}`;
		case "done":
			return `Finished step ${input.step}: ${machine.setNoteStatus(needStep(input), "done").text}`;
		case "undo":
			return `Reopened step ${input.step}: ${machine.setNoteStatus(needStep(input), "todo").text}`;
		case "remove":
			return `Removed step ${input.step}: ${machine.removeNote(needStep(input)).text}`;
		case "write":
			machine.writeNotesText(input.text ?? "");
			return "Updated the notes.";
	}
};

export const createMemonNotesTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_NOTES_TOOL,
	description:
		"Plan and track the task in the Notes app the user watches: set the checklist, mark steps started or done, and keep notes. Returns the screen.",
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_NOTES_TOOL,
			context,
			`Notes: ${input.action}`,
			(machine) => ({ windowId: machine.findWindow("notes")?.id }),
			async (machine) => apply(machine, input),
		),
});

toolRegistry.register(MEMON_NOTES_TOOL, createMemonNotesTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_NOTES_TOOL]: { input: Input; services: void };
	}
}
