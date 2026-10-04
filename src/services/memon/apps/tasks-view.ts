import {
	englishKitText,
	type MemonBadge,
	type MemonKitApp,
	type MemonKitText,
	type MemonViewNode,
} from "../app-kit/types";

type MemonBadgeTone = Exclude<MemonBadge, string>["tone"];
import { isTaskOpen, MEMON_TASK_STATES, taskProgress } from "../tasks-file";
import type { MemonMachineSnapshot, MemonTask, MemonTaskState } from "../types";

const NEW_TASK = "tasks:new";
const EDITING = "tasks:edit";
const EDIT_TITLE = "tasks:edit:title";
const EDIT_CHECKLIST = "tasks:edit:checklist";
const SHOW_FINISHED = "tasks:showFinished";
/** A finished task whose checklist is shown, by id. */
const DETAILS = (id: number) => `tasks:details:${id}`;
/** Finished tasks listed at once; older ones stay in the file. */
const FINISHED_SHOWN = 20;

/** Open tasks in the order they are worked on: started, approved, proposed. */
const OPEN_ORDER: Record<MemonTaskState, number> = {
	in_progress: 0,
	approved: 1,
	new: 2,
	done: 3,
	dropped: 3,
};

/** A state's badge color: what needs the user stands out. */
const STATE_TONE: Record<MemonTaskState, MemonBadgeTone | undefined> = {
	new: "warning",
	approved: undefined,
	in_progress: "info",
	done: "success",
	dropped: "muted",
};

const quote = (text: string, max = 60) =>
	`"${text.length > max ? `${text.slice(0, max - 1)}…` : text}"`;

const pad = (value: number) => String(value).padStart(2, "0");

/** A time both the user and the agent read the same way: 2026-10-04 09:30. */
export const formatTaskTime = (time: number): string => {
	const date = new Date(time);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const taskStateLabel = (
	state: MemonTaskState,
	t: MemonKitText = englishKitText,
): string =>
	t(
		`tasks.state.${state}`,
		{
			new: "new",
			approved: "approved",
			in_progress: "in progress",
			done: "done",
			dropped: "dropped",
		}[state],
	);

/** Open and finished tasks, each in the order the window lists them. */
export const sortTasks = (
	items: readonly MemonTask[],
): { open: MemonTask[]; finished: MemonTask[] } => ({
	open: items
		.filter((task) => isTaskOpen(task.state))
		.sort((a, b) => OPEN_ORDER[a.state] - OPEN_ORDER[b.state] || a.id - b.id),
	finished: items
		.filter((task) => !isTaskOpen(task.state))
		.sort(
			(a, b) =>
				(b.finishedAt ?? b.updatedAt) - (a.finishedAt ?? a.updatedAt) ||
				b.id - a.id,
		),
});

/** The checklist as the edit field holds it: one item per line, ticks kept. */
const checklistText = (task: MemonTask): string =>
	task.checklist
		.map((item) => `${item.done ? "[x]" : "[ ]"} ${item.text}`)
		.join("\n");

const editingId = (snapshot: MemonMachineSnapshot): number | null => {
	const id = Number(snapshot.drafts[EDITING]);
	return Number.isInteger(id) && id > 0 ? id : null;
};

const taskNumber = (target: string): number => {
	const id = Number(target);
	if (!Number.isInteger(id)) throw new Error("That task is no longer there.");
	return id;
};

const stateSelect = (task: MemonTask, t: MemonKitText): MemonViewNode => ({
	type: "select",
	id: `state:${task.id}`,
	label: t("tasks.stateLabel", "State"),
	value: task.state,
	inline: true,
	options: MEMON_TASK_STATES.map((state) => ({
		value: state,
		label: taskStateLabel(state, t),
	})),
});

const taskDetail = (task: MemonTask, t: MemonKitText): string => {
	const added = t(
		task.createdBy === "user" ? "tasks.addedByUser" : "tasks.addedByAgent",
		task.createdBy === "user"
			? "added by the user {{time}}"
			: "added by the agent {{time}}",
		{ time: formatTaskTime(task.createdAt) },
	);
	if (task.finishedAt === undefined) return added;
	return `${added} · ${t(
		task.state === "done" ? "tasks.doneAt" : "tasks.droppedAt",
		task.state === "done" ? "done {{time}}" : "dropped {{time}}",
		{ time: formatTaskTime(task.finishedAt) },
	)}`;
};

const editForm = (
	snapshot: MemonMachineSnapshot,
	task: MemonTask,
	t: MemonKitText,
): MemonViewNode[] => [
	{
		type: "input",
		id: `editTitle:${task.id}`,
		label: t("tasks.title", "Title"),
		value: String(snapshot.drafts[EDIT_TITLE] ?? task.title),
	},
	{
		type: "input",
		id: `editChecklist:${task.id}`,
		label: t(
			"tasks.checklistField",
			'Checklist, one item per line ("[x] " marks a done one)',
		),
		value: String(snapshot.drafts[EDIT_CHECKLIST] ?? checklistText(task)),
		lines: Math.min(10, Math.max(3, task.checklist.length + 1)),
	},
	{
		type: "group",
		layout: "row",
		children: [
			{
				type: "button",
				id: `save:${task.id}`,
				label: t("kit.save", "Save"),
				variant: "primary",
				icon: "save",
			},
			{ type: "button", id: "cancel", label: t("kit.cancel", "Cancel") },
			{ type: "spacer" },
			{
				type: "button",
				id: `delete:${task.id}`,
				label: t("kit.delete", "Delete"),
				variant: "danger",
				icon: "delete",
				userOnly: true,
			},
		],
	},
];

/** A task's progress bar and checklist, each item a box to tick. */
const checklistNodes = (task: MemonTask, t: MemonKitText): MemonViewNode[] => {
	if (!task.checklist.length) return [];
	const { done, total } = taskProgress(task);
	return [
		{
			type: "progress",
			label: t("tasks.progress", "done"),
			value: done,
			max: total,
		},
		...task.checklist.map(
			(item, index): MemonViewNode => ({
				type: "toggle",
				id: `check:${task.id}:${index + 1}`,
				label: item.text,
				checked: item.done,
				variant: "check",
			}),
		),
	];
};

const taskNode = (
	snapshot: MemonMachineSnapshot,
	task: MemonTask,
	t: MemonKitText,
): MemonViewNode => {
	const head = {
		type: "item" as const,
		id: `task:${task.id}`,
		title: `#${task.id} ${task.title}`,
		detail: taskDetail(task, t),
		badges: [
			{
				text:
					task.state === "new"
						? t("tasks.waiting", "new · waiting for approval")
						: taskStateLabel(task.state, t),
				tone: STATE_TONE[task.state],
			},
		],
		// A dropped task has no box to tick: it reads "- #5 …".
		status:
			task.state === "done"
				? ("done" as const)
				: task.state === "in_progress"
					? ("doing" as const)
					: task.state === "dropped"
						? undefined
						: ("todo" as const),
		tone: task.state === "dropped" ? ("muted" as const) : undefined,
	};
	if (editingId(snapshot) === task.id) {
		return { ...head, children: editForm(snapshot, task, t) };
	}
	if (!isTaskOpen(task.state)) {
		// A finished task is the record, folded to one line until asked; its
		// state can still be changed back.
		const { done, total } = taskProgress(task);
		const shown = Boolean(snapshot.drafts[DETAILS(task.id)]);
		return {
			...head,
			detail: task.checklist.length
				? `${head.detail} · ${done}/${total} ${t("tasks.progress", "done")}`
				: head.detail,
			children: [
				...(shown ? checklistNodes(task, t) : []),
				{
					type: "group",
					layout: "row",
					children: [
						stateSelect(task, t),
						...(task.checklist.length
							? [
									{
										type: "button" as const,
										id: `details:${task.id}`,
										label: shown
											? t("tasks.hideDetails", "Hide details")
											: t("tasks.details", "Details"),
										icon: shown ? "collapse" : "expand",
										variant: "ghost" as const,
									},
								]
							: []),
						{
							type: "button",
							id: `edit:${task.id}`,
							label: t("kit.edit", "Edit"),
							icon: "edit",
							variant: "ghost",
						},
					],
				},
			],
		};
	}
	const children: MemonViewNode[] = [...checklistNodes(task, t)];
	children.push({
		type: "group",
		layout: "row",
		children: [
			stateSelect(task, t),
			...(task.state === "new"
				? [
						{
							type: "button" as const,
							id: `approve:${task.id}`,
							label: t("tasks.approve", "Approve"),
							variant: "primary" as const,
							userOnly: true,
						},
					]
				: []),
			{
				type: "button",
				id: `edit:${task.id}`,
				label: t("kit.edit", "Edit"),
				icon: "edit",
				variant: "ghost",
			},
		],
	});
	return { ...head, children };
};

/**
 * Tasks: the work the user and the agent share. Each task has a state (the
 * agent proposes, the user approves), a checklist and its times; tasks are
 * never cleared, so finished ones stay as the record. The user and the
 * agent use the same controls; approving and deleting are the user's.
 */
export const tasksApp: MemonKitApp = {
	refPrefix: "n",

	view(snapshot, t = englishKitText) {
		const { open, finished } = sortTasks(snapshot.tasks.items);
		const newTask = String(snapshot.drafts[NEW_TASK] ?? "");
		const showFinished = Boolean(snapshot.drafts[SHOW_FINISHED]);
		const nodes: MemonViewNode[] = [];
		if (snapshot.tasks.error) {
			nodes.push({ type: "text", text: snapshot.tasks.error, tone: "error" });
		}
		nodes.push({
			type: "group",
			layout: "row",
			children: [
				{
					type: "input",
					id: "new",
					label: t("tasks.newTask", "New task"),
					value: newTask,
					placeholder: t("tasks.addPlaceholder", "What needs doing?"),
					hideLabel: true,
				},
				{
					type: "button",
					id: "add",
					label: t("tasks.add", "Add"),
					icon: "add",
					disabled: newTask.trim()
						? undefined
						: t("tasks.addDisabled", "type the task first"),
				},
			],
		});
		if (!open.length) {
			nodes.push({
				type: "text",
				text: t(
					"tasks.empty",
					"No open tasks. Add one here, or ask the agent in chat.",
				),
				tone: "muted",
			});
		} else {
			nodes.push(
				{
					type: "heading",
					text: t("tasks.open", "Open ({{count}})", { count: open.length }),
				},
				...open.map((task) => taskNode(snapshot, task, t)),
			);
		}
		if (finished.length) {
			nodes.push({
				type: "group",
				layout: "row",
				children: [
					{
						type: "heading",
						text: t("tasks.finished", "Finished ({{count}})", {
							count: finished.length,
						}),
					},
					{
						type: "toggle",
						id: "showFinished",
						label: t("tasks.showFinished", "Show"),
						checked: showFinished,
					},
				],
			});
			if (showFinished) {
				nodes.push(
					...finished
						.slice(0, FINISHED_SHOWN)
						.map((task) => taskNode(snapshot, task, t)),
				);
				if (finished.length > FINISHED_SHOWN) {
					nodes.push({
						type: "text",
						text: t(
							"tasks.older",
							"… {{count}} older ones are kept in {{file}}.",
							{
								count: finished.length - FINISHED_SHOWN,
								file: snapshot.tasks.path?.split("/").pop() ?? ".tasks",
							},
						),
						tone: "muted",
					});
				}
			}
		}
		return nodes;
	},

	act(machine, id, value, { byUser }) {
		const [action, target = "", item = ""] = id.split(":");
		switch (action) {
			case "new":
				machine.setDraft(NEW_TASK, String(value ?? ""));
				return "";
			case "add": {
				const title = String(machine.draft(NEW_TASK, "")).trim();
				if (!title) throw new Error("Type the task first.");
				const task = machine.addTask({
					title,
					by: byUser ? "user" : "agent",
				});
				machine.setDraft(NEW_TASK, undefined);
				return `added task #${task.id} ${quote(task.title)} to Tasks`;
			}
			case "check": {
				const done = value === true;
				const { task, text } = machine.checkTaskItem(
					taskNumber(target),
					Number(item),
					done,
				);
				return `${done ? "ticked" : "unticked"} ${quote(text)} of task #${task.id} in Tasks`;
			}
			case "state": {
				const state = String(value) as MemonTaskState;
				if (!MEMON_TASK_STATES.includes(state)) {
					throw new Error(
						`A task's state is one of ${MEMON_TASK_STATES.join(", ")}.`,
					);
				}
				const task = machine.setTaskState(taskNumber(target), state);
				return `set task #${task.id} ${quote(task.title)} to ${taskStateLabel(state)} in Tasks`;
			}
			case "approve": {
				const task = machine.setTaskState(taskNumber(target), "approved");
				return `approved task #${task.id} ${quote(task.title)} in Tasks`;
			}
			case "edit": {
				const task = machine.taskById(taskNumber(target));
				machine.setDraft(EDIT_TITLE, task.title);
				machine.setDraft(EDIT_CHECKLIST, checklistText(task));
				machine.setDraft(EDITING, task.id);
				return "";
			}
			case "editTitle":
				machine.setDraft(EDIT_TITLE, String(value ?? ""));
				return "";
			case "editChecklist":
				machine.setDraft(EDIT_CHECKLIST, String(value ?? ""));
				return "";
			case "save": {
				const task = machine.editTask(taskNumber(target), {
					title: String(machine.draft(EDIT_TITLE, "")),
					checklist: String(machine.draft(EDIT_CHECKLIST, "")).split("\n"),
				});
				machine.clearDrafts(EDITING);
				return `edited task #${task.id} ${quote(task.title)} in Tasks`;
			}
			case "cancel":
				machine.clearDrafts(EDITING);
				return "";
			case "delete": {
				const task = machine.removeTask(taskNumber(target));
				machine.clearDrafts(EDITING);
				return `deleted task #${task.id} ${quote(task.title)} from Tasks`;
			}
			case "showFinished":
				machine.setDraft(SHOW_FINISHED, value === true ? true : undefined);
				return "";
			case "details": {
				const id = taskNumber(target);
				const shown = Boolean(machine.draft(DETAILS(id), false));
				machine.setDraft(DETAILS(id), shown ? undefined : true);
				return "";
			}
			default:
				throw new Error(`Tasks has no control ${id}.`);
		}
	},
};
