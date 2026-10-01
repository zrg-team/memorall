import { validateCronExpression } from "@/services/cron-jobs/cron-expression";
import {
	englishKitText,
	type MemonKitApp,
	type MemonViewNode,
} from "../app-kit/types";
import type { MemonSchedule } from "../types";

const WEEKDAYS = [
	"Sundays",
	"Mondays",
	"Tuesdays",
	"Wednesdays",
	"Thursdays",
	"Fridays",
	"Saturdays",
];

/** "every day at 09:00", "Fridays at 17:00", or the cron itself. */
export const describeSchedule = (schedule: MemonSchedule): string => {
	const { metadata, scheduleExpression } = schedule;
	const time = typeof metadata?.time === "string" ? metadata.time : null;
	if (metadata?.scheduleMode === "daily" && time) {
		return `every day at ${time} (${scheduleExpression})`;
	}
	if (
		metadata?.scheduleMode === "weekly" &&
		time &&
		typeof metadata.dayOfWeek === "number"
	) {
		return `${WEEKDAYS[metadata.dayOfWeek] ?? "weekly"} at ${time} (${scheduleExpression})`;
	}
	return `cron ${scheduleExpression}`;
};

const formatWhen = (time?: number): string =>
	time ? new Date(time).toLocaleString() : "—";

const EDITING = "scheduler:editing";
const field = (name: string) => `scheduler:${name}`;
const DEFAULT_CRON = "0 9 * * *";

/**
 * Scheduler: the agent's scheduled prompts, the same ones the agent settings
 * page lists. New and edited schedules are filled in on one shared form.
 */
export const schedulerApp: MemonKitApp = {
	refPrefix: "h",

	view(snapshot, t = englishKitText) {
		const { scheduler, drafts } = snapshot;
		if (!scheduler.agentId) {
			return [
				{
					type: "text",
					text: t(
						"scheduler.noAgent",
						"This computer has no agent yet. Start it from an agent, or chat with one, to see its schedules.",
					),
					tone: "muted",
				},
			];
		}
		const editing = drafts[EDITING] as string | undefined;
		const nodes: MemonViewNode[] = [
			{
				type: "group",
				layout: "row",
				children: [
					{
						type: "heading",
						text: scheduler.agentName
							? t("scheduler.titleOf", "Schedules of {{agent}}", {
									agent: scheduler.agentName,
								})
							: t("scheduler.title", "Schedules"),
					},
					{
						type: "button",
						id: "new",
						label: t("kit.new", "New"),
						icon: "add",
					},
					{
						type: "button",
						id: "refresh",
						label: t("kit.refresh", "Refresh"),
						icon: "refresh",
					},
				],
			},
		];
		if (scheduler.loading) {
			nodes.push({
				type: "text",
				text: t("kit.loading", "(loading…)"),
				tone: "muted",
			});
		}
		if (scheduler.error) {
			nodes.push({ type: "text", text: scheduler.error, tone: "error" });
		}
		if (editing) {
			const cron = String(drafts[field("cron")] ?? DEFAULT_CRON);
			const check = validateCronExpression(cron);
			nodes.push({
				type: "group",
				children: [
					{
						type: "heading",
						text:
							editing === "new"
								? t("scheduler.newTitle", "New schedule")
								: t("scheduler.editTitle", "Edit schedule"),
					},
					{
						type: "input",
						id: "name",
						label: t("scheduler.name", "Name"),
						value: String(drafts[field("name")] ?? ""),
						placeholder: t("scheduler.namePlaceholder", "Morning brief"),
					},
					{
						type: "input",
						id: "prompt",
						label: t("scheduler.prompt", "Prompt"),
						value: String(drafts[field("prompt")] ?? ""),
						lines: 3,
						placeholder: t(
							"scheduler.promptPlaceholder",
							"What the agent is asked each time it runs",
						),
					},
					{
						type: "input",
						id: "cron",
						label: t("scheduler.cron", "When (5-field cron, local time)"),
						value: cron,
						mono: true,
						placeholder: DEFAULT_CRON,
					},
					{
						type: "text",
						text: check.valid
							? t("scheduler.runs", "runs {{when}}", {
									when: describeSchedule({
										id: "",
										name: "",
										status: "active",
										prompt: "",
										scheduleExpression: cron,
									}),
								})
							: t("scheduler.invalid", "not a valid schedule: {{error}}", {
									error: check.error ?? cron,
								}),
						tone: check.valid ? "muted" : "error",
					},
					{
						type: "group",
						layout: "row",
						children: [
							{
								type: "button",
								id: "save",
								label: t("kit.save", "Save"),
								variant: "primary",
								icon: "save",
								disabled: !String(drafts[field("prompt")] ?? "").trim()
									? t("scheduler.needPrompt", "write the prompt first")
									: check.valid
										? undefined
										: t("scheduler.fixCron", "fix the schedule first"),
							},
							{
								type: "button",
								id: "cancel",
								label: t("kit.cancel", "Cancel"),
								variant: "ghost",
							},
						],
					},
				],
			});
		}
		if (!scheduler.items.length && !scheduler.loading) {
			nodes.push({
				type: "text",
				text: t(
					"scheduler.empty",
					"No scheduled prompts yet. Add one to run this agent at set times.",
				),
				tone: "muted",
			});
		}
		scheduler.items.forEach((schedule, index) => {
			nodes.push({
				type: "item",
				id: `schedule:${schedule.id}`,
				title: `${index + 1}. ${schedule.name}`,
				detail: describeSchedule(schedule),
				badges: [t(`scheduler.status.${schedule.status}`, schedule.status)],
				tone: schedule.lastError ? "error" : undefined,
				children: [
					{
						type: "text",
						text: t("scheduler.when", "next: {{next}} · last: {{last}}", {
							next: formatWhen(schedule.nextRunAt),
							last: schedule.lastRunAt
								? `${formatWhen(schedule.lastRunAt)} (${schedule.lastStatus ?? "?"})`
								: t("scheduler.never", "never"),
						}),
						tone: "muted",
					},
					{
						type: "text",
						text: t("scheduler.promptLine", "prompt: {{prompt}}", {
							prompt: schedule.prompt.replace(/\s+/g, " ").slice(0, 200),
						}),
						tone: "muted",
					},
					...(schedule.lastError
						? [
								{
									type: "text" as const,
									text: t("scheduler.lastError", "last error: {{error}}", {
										error: schedule.lastError.slice(0, 200),
									}),
									tone: "error" as const,
								},
							]
						: []),
					{
						type: "group",
						layout: "row",
						children: [
							{
								type: "button",
								id: `edit:${schedule.id}`,
								label: t("kit.edit", "Edit"),
								icon: "edit",
							},
							{
								type: "button",
								id: `${schedule.status === "active" ? "pause" : "resume"}:${schedule.id}`,
								label:
									schedule.status === "active"
										? t("scheduler.pause", "Pause")
										: t("scheduler.resume", "Resume"),
							},
							{
								type: "button",
								id: `delete:${schedule.id}`,
								label: t("kit.delete", "Delete"),
								variant: "danger",
								icon: "delete",
							},
						],
					},
				],
			});
		});
		return nodes;
	},

	async act(machine, id, value) {
		const [action, target = ""] = id.split(":");
		const find = () => {
			const schedule = machine
				.snapshot()
				.scheduler.items.find((item) => item.id === target);
			if (!schedule) throw new Error("That schedule no longer exists.");
			return schedule;
		};
		switch (action) {
			case "refresh":
				await machine.refreshSchedules();
				return "refreshed the Scheduler";
			case "new":
				machine.clearDrafts("scheduler:");
				machine.setDraft(EDITING, "new");
				machine.setDraft(field("cron"), DEFAULT_CRON);
				return "started a new schedule";
			case "edit": {
				const schedule = find();
				machine.clearDrafts("scheduler:");
				machine.setDraft(EDITING, schedule.id);
				machine.setDraft(field("name"), schedule.name);
				machine.setDraft(field("prompt"), schedule.prompt);
				machine.setDraft(field("cron"), schedule.scheduleExpression);
				return `started editing "${schedule.name}"`;
			}
			case "name":
			case "prompt":
			case "cron":
				machine.setDraft(field(action), String(value ?? ""));
				return "";
			case "cancel":
				machine.clearDrafts("scheduler:");
				return "closed the schedule form";
			case "save": {
				const editing = machine.draft<string | undefined>(EDITING, undefined);
				const existing =
					editing && editing !== "new"
						? machine
								.snapshot()
								.scheduler.items.find((item) => item.id === editing)
						: undefined;
				const cron = String(machine.draft(field("cron"), DEFAULT_CRON));
				const saved = await machine.saveSchedule({
					id: existing?.id,
					name: String(machine.draft(field("name"), "")),
					prompt: String(machine.draft(field("prompt"), "")),
					scheduleExpression: cron,
					status: existing?.status ?? "active",
					// A typed cron no longer matches the form's daily/weekly hints.
					metadata:
						existing && existing.scheduleExpression === cron
							? existing.metadata
							: { scheduleMode: "raw" },
				});
				machine.clearDrafts("scheduler:");
				return `${existing ? "edited" : "created"} schedule "${saved.name}" (${saved.scheduleExpression})`;
			}
			case "pause":
			case "resume": {
				const schedule = find();
				await machine.saveSchedule({
					...schedule,
					status: action === "pause" ? "paused" : "active",
				});
				return `${action === "pause" ? "paused" : "resumed"} schedule "${schedule.name}"`;
			}
			case "delete": {
				const schedule = find();
				await machine.deleteSchedule(schedule.id);
				return `deleted schedule "${schedule.name}"`;
			}
			default:
				throw new Error(`The Scheduler has no control ${id}.`);
		}
	},
};
