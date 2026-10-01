import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import z from "zod";
import { MEMON_SCHEDULE_TOOL } from "@/services/memon/constants";
import type { MemonMachine } from "@/services/memon/memon-machine";
import { runMemonTool } from "./memon-tool-utils";

const schema = z
	.object({
		action: z
			.enum(["list", "create", "edit", "delete", "pause", "resume"])
			.describe(
				"list: show this agent's scheduled prompts; create: add one; edit: change one; delete/pause/resume: one by `schedule` number.",
			),
		schedule: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe(
				"edit/delete/pause/resume: the schedule number in the Scheduler.",
			),
		name: z.string().optional().describe("create/edit: a short name."),
		prompt: z
			.string()
			.optional()
			.describe("create/edit: what the agent is asked each time it runs."),
		cron: z
			.string()
			.optional()
			.describe(
				'create/edit: 5-field cron in local time: "0 9 * * *" every day 09:00, "30 17 * * 5" Fridays 17:30, "0 */6 * * *" every 6 hours.',
			),
	})
	.describe("View and manage this agent's scheduled prompts in the Scheduler.");

type Input = z.infer<typeof schema>;

const needSchedule = (input: Input): number => {
	if (!input.schedule) {
		throw new Error(`${input.action} needs the schedule number.`);
	}
	return input.schedule;
};

const apply = async (machine: MemonMachine, input: Input): Promise<string> => {
	await machine.openScheduler();
	switch (input.action) {
		case "list":
			return "Opened the Scheduler.";
		case "create": {
			if (!input.cron || !input.prompt) {
				throw new Error("create needs `cron` and `prompt`.");
			}
			const saved = await machine.saveSchedule({
				name: input.name ?? "",
				prompt: input.prompt,
				scheduleExpression: input.cron,
				status: "active",
				metadata: { scheduleMode: "raw" },
			});
			return `Created schedule "${saved.name}".`;
		}
		case "edit": {
			const current = machine.scheduleAt(needSchedule(input));
			const saved = await machine.saveSchedule({
				id: current.id,
				name: input.name ?? current.name,
				prompt: input.prompt ?? current.prompt,
				scheduleExpression: input.cron ?? current.scheduleExpression,
				status: current.status,
				// A new cron no longer matches the form's daily/weekly hints.
				metadata: input.cron ? { scheduleMode: "raw" } : current.metadata,
			});
			return `Updated schedule "${saved.name}".`;
		}
		case "pause":
		case "resume": {
			const current = machine.scheduleAt(needSchedule(input));
			await machine.saveSchedule({
				...current,
				status: input.action === "pause" ? "paused" : "active",
			});
			return `${input.action === "pause" ? "Paused" : "Resumed"} schedule "${current.name}".`;
		}
		case "delete": {
			const current = machine.scheduleAt(needSchedule(input));
			await machine.deleteSchedule(current.id);
			return `Deleted schedule "${current.name}".`;
		}
	}
};

export const createMemonScheduleTool: ToolFactory<Input> = (): Tool<Input> => ({
	name: MEMON_SCHEDULE_TOOL,
	description:
		"View, create, edit, pause, resume or delete this agent's scheduled prompts (runs of this agent at set times) in the Scheduler app. Returns the screen.",
	schema,
	execute: (input, context) =>
		runMemonTool(
			MEMON_SCHEDULE_TOOL,
			context,
			`Scheduler: ${input.action}`,
			(machine) => ({ windowId: machine.findWindow("scheduler")?.id }),
			(machine) => apply(machine, input),
		),
});

toolRegistry.register(MEMON_SCHEDULE_TOOL, createMemonScheduleTool);

declare global {
	interface ToolTypeRegistry {
		[MEMON_SCHEDULE_TOOL]: { input: Input; services: void };
	}
}
