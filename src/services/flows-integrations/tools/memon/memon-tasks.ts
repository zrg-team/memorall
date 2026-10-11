import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_TASKS_TOOL } from "@/services/memon/constants";
import type { MemonMachine } from "@/services/memon/memon-machine";
import {
	currentTask,
	isTaskOpen,
	numberedChecklist,
	taskProgress,
} from "@/services/memon/tasks-file";
import type { MemonTask } from "@/services/memon/types";
import { runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		action: z
			.enum(["add", "start", "check", "uncheck", "edit", "done", "drop"])
			.describe(
				"add: a new task with `title` and its checklist `items`; start: begin `task` (in progress); check/uncheck: tick one checklist `item` of `task`; edit: rename `task` to `title` and/or replace its checklist with `items`; done: finish `task`; drop: give `task` up (it stays as the record).",
			),
		task: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe(
				"The task's number, #3 in Tasks. start/drop need it; check/uncheck/edit/done act on the task in progress (the screen's \"now: #3\") when it is left out.",
			),
		title: z
			.string()
			.optional()
			.describe(
				'add/edit: the outcome, short, as a person would name it: "Landing page for the spring launch", not the request word for word.',
			),
		items: z
			.array(z.string())
			.optional()
			.describe(
				'add/edit: the checklist, in order: 3–8 concrete steps, each one you can see is done ("Write the hero copy", not "Think about copy"). edit replaces the whole list: items with the same text keep their tick, "[x] " marks one done and "[ ] " not, so one edit brings every item up to date.',
			),
		item: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe(
				"check/uncheck (required): the checklist item's number in the task, from 1.",
			),
		start: z
			.boolean()
			.optional()
			.describe(
				"add: true for a task the user asked for, started at once. Leave out to propose it: it stays new until the user approves it.",
			),
	})
	.describe("Keep the tasks you share with the user in the Tasks app.");

type Input = z.infer<typeof schema>;

const STATE_WORDS: Record<MemonTask["state"], string> = {
	new: "new",
	approved: "approved",
	in_progress: "in progress",
	done: "done",
	dropped: "dropped",
};

/**
 * The task an action is about: the one given, else (except for start and
 * drop, which must name it) the task in progress, the screen's "now".
 */
const needTask = (machine: MemonMachine, input: Input): number => {
	if (input.task) return input.task;
	const open = machine
		.snapshot()
		.tasks.items.filter((task) => isTaskOpen(task.state));
	const now =
		input.action === "start" || input.action === "drop"
			? undefined
			: currentTask(open);
	if (now) return now.id;
	throw new Error(
		`${input.action} needs \`task\`, the task's number. ${
			open.length
				? `Open tasks: ${open.map((task) => `#${task.id} ${task.title} (${STATE_WORDS[task.state]})`).join("; ")}.`
				: "There are no open tasks."
		}`,
	);
};

const progressOf = (task: MemonTask): string => {
	if (!task.checklist.length) return "";
	const { done, total } = taskProgress(task);
	return ` (${done}/${total})`;
};

const apply = (machine: MemonMachine, input: Input): string => {
	switch (input.action) {
		case "add": {
			if (!input.title?.trim()) throw new Error("add needs the title.");
			const task = machine.addTask({
				title: input.title,
				checklist: input.items,
				state: input.start ? "in_progress" : "new",
				by: "agent",
			});
			return input.start
				? `Added and started task #${task.id}: ${task.title}${progressOf(task)}.`
				: `Proposed task #${task.id}: ${task.title}. It waits for the user's approval.`;
		}
		case "start": {
			const task = machine.setTaskState(
				needTask(machine, input),
				"in_progress",
			);
			return `Started task #${task.id}: ${task.title}${progressOf(task)}.`;
		}
		case "check":
		case "uncheck": {
			const id = needTask(machine, input);
			if (!input.item) {
				const task = machine.taskById(id);
				throw new Error(
					task.checklist.length
						? `${input.action} needs \`item\`, the item's number in task #${id}:\n${numberedChecklist(task)}`
						: `${input.action} needs \`item\`, but task #${id} has no checklist; add items with { action: "edit", task: ${id}, items }.`,
				);
			}
			const { task, text } = machine.checkTaskItem(
				id,
				input.item,
				input.action === "check",
			);
			return `${input.action === "check" ? "Ticked" : "Unticked"} "${text}" of task #${task.id}${progressOf(task)}.`;
		}
		case "edit": {
			if (input.title === undefined && !input.items) {
				throw new Error("edit needs a new title or items.");
			}
			const task = machine.editTask(needTask(machine, input), {
				title: input.title,
				checklist: input.items,
			});
			return `Edited task #${task.id}: ${task.title}${progressOf(task)}.`;
		}
		case "done": {
			const task = machine.setTaskState(needTask(machine, input), "done");
			const open = task.checklist.filter((item) => !item.done).length;
			return `Finished task #${task.id}: ${task.title}.${open ? ` ${open} checklist item${open === 1 ? " is" : "s are"} still unticked.` : ""}`;
		}
		case "drop": {
			const task = machine.setTaskState(needTask(machine, input), "dropped");
			return `Dropped task #${task.id}: ${task.title}. It stays in Tasks as the record.`;
		}
	}
};

export const createMemonTasksTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_TASKS_TOOL,
	description:
		"Plan and track work in the Tasks app the user watches and edits too: add a task with its checklist, start it, tick items, finish or drop it. Tasks stay across chats. Keep them as a careful person would: one task per piece of work, and before adding one, continue the open task it belongs to; tick each item as you finish it, so the list always shows where the work stands; when the plan changes, edit the list rather than leaving stale items; when asked to bring a task up to date, check what is really done and fix the whole list in one edit; finish it only when every item is ticked or edited out. Returns the screen.",
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_TASKS_TOOL,
			context,
			`Tasks: ${input.action}${input.task ? ` #${input.task}` : ""}`,
			(machine) => ({ windowId: machine.findWindow("tasks")?.id }),
			async (machine) => apply(machine, input),
		),
});

toolRegistry.register(MEMON_TASKS_TOOL, createMemonTasksTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_TASKS_TOOL]: { input: Input; services: void };
	}
}
