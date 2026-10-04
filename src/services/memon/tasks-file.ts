import type { MemonTask, MemonTaskCheck, MemonTaskState } from "./types";

export const MEMON_TASK_STATES: readonly MemonTaskState[] = [
	"new",
	"approved",
	"in_progress",
	"done",
	"dropped",
];

/** Done and dropped tasks are finished; they stay as the record. */
export const isTaskOpen = (state: MemonTaskState): boolean =>
	state !== "done" && state !== "dropped";

/**
 * A `.tasks` file: the Tasks app's tasks, as JSON. Tasks keeps ~/.tasks
 * current as it changes; the user can open any `.tasks` file in Tasks, or
 * read and edit it as text. Times are ISO dates, so the file reads well.
 *
 * {
 *   "tasks": [{
 *     "id": 1, "title": "Build the landing page", "state": "in_progress",
 *     "createdBy": "user", "createdAt": "2026-10-04T09:00:00.000Z",
 *     "updatedAt": "2026-10-04T09:30:00.000Z",
 *     "checklist": [{ "text": "Write the copy", "done": true }]
 *   }]
 * }
 *
 * An older Notes file ({ "items": [...], "text": "…" }) reads as one task
 * holding its steps.
 */
export interface MemonTasksFile {
	tasks: MemonTask[];
}

const STATES: ReadonlySet<string> = new Set(MEMON_TASK_STATES);

/** States an older version or a hand edit may use. */
const STATE_ALIASES: Record<string, MemonTaskState> = {
	todo: "approved",
	doing: "in_progress",
	"in progress": "in_progress",
	inprogress: "in_progress",
	drop: "dropped",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const asState = (value: unknown, fallback: MemonTaskState): MemonTaskState => {
	if (typeof value !== "string") return fallback;
	const key = value.trim().toLowerCase();
	if (STATES.has(key)) return key as MemonTaskState;
	return STATE_ALIASES[key] ?? fallback;
};

const asTime = (value: unknown, fallback: number): number => {
	const time =
		typeof value === "number"
			? value
			: typeof value === "string"
				? Date.parse(value)
				: Number.NaN;
	return Number.isFinite(time) ? time : fallback;
};

const asChecklist = (value: unknown): MemonTaskCheck[] =>
	(Array.isArray(value) ? value : []).flatMap((item): MemonTaskCheck[] => {
		// An item may be written as just its text.
		const text =
			typeof item === "string" ? item : isRecord(item) ? item.text : "";
		if (typeof text !== "string" || !text.trim()) return [];
		const done =
			isRecord(item) &&
			(item.done === true || item.status === "done" || item.checked === true);
		return [{ text: text.trim(), done }];
	});

/** The steps of an older Notes file, as one task. */
const fromNotes = (data: Record<string, unknown>, now: number): MemonTask[] => {
	const checklist = asChecklist(data.items);
	if (!checklist.length) return [];
	const finished = checklist.every((item) => item.done);
	return [
		{
			id: 1,
			title: "Earlier plan",
			state: finished ? "done" : "in_progress",
			checklist,
			createdBy: "agent",
			createdAt: now,
			updatedAt: now,
			...(finished ? { finishedAt: now } : {}),
		},
	];
};

/** Reads a `.tasks` file; an empty one has no tasks. Throws on anything else. */
export const parseTasksFile = (
	content: string,
	now = Date.now(),
): MemonTasksFile => {
	if (!content.trim()) return { tasks: [] };
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch (error) {
		throw new Error(
			`it is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	if (Array.isArray(data)) data = { tasks: data };
	if (!isRecord(data)) {
		throw new Error('it must be a JSON object with a "tasks" list');
	}
	if (!Array.isArray(data.tasks) && Array.isArray(data.items)) {
		return { tasks: fromNotes(data, now) };
	}
	const used = new Set<number>();
	let next = 1;
	const tasks = (Array.isArray(data.tasks) ? data.tasks : []).flatMap(
		(item): MemonTask[] => {
			const title =
				typeof item === "string" ? item : isRecord(item) ? item.title : "";
			if (typeof title !== "string" || !title.trim()) return [];
			const record = isRecord(item) ? item : {};
			// Ids stay as written; a missing or repeated one gets a new number.
			let id =
				typeof record.id === "number" && Number.isInteger(record.id)
					? record.id
					: 0;
			if (id < 1 || used.has(id)) {
				while (used.has(next)) next += 1;
				id = next;
			}
			used.add(id);
			const createdAt = asTime(record.createdAt, now);
			const state = asState(record.state ?? record.status, "approved");
			const finishedAt =
				record.finishedAt !== undefined
					? asTime(record.finishedAt, now)
					: undefined;
			return [
				{
					id,
					title: title.trim(),
					state,
					checklist: asChecklist(record.checklist),
					createdBy: record.createdBy === "agent" ? "agent" : "user",
					createdAt,
					updatedAt: asTime(record.updatedAt, createdAt),
					...(finishedAt !== undefined ? { finishedAt } : {}),
				},
			];
		},
	);
	return { tasks };
};

const iso = (time: number): string => new Date(time).toISOString();

export const serializeTasksFile = (file: MemonTasksFile): string =>
	`${JSON.stringify(
		{
			tasks: file.tasks.map((task) => ({
				id: task.id,
				title: task.title,
				state: task.state,
				createdBy: task.createdBy,
				createdAt: iso(task.createdAt),
				updatedAt: iso(task.updatedAt),
				...(task.finishedAt !== undefined
					? { finishedAt: iso(task.finishedAt) }
					: {}),
				checklist: task.checklist.map(({ text, done }) => ({ text, done })),
			})),
		},
		null,
		2,
	)}\n`;

/** A task's progress: its ticked checklist items, or its state without one. */
export const taskProgress = (
	task: Pick<MemonTask, "state" | "checklist">,
): { done: number; total: number } =>
	task.checklist.length
		? {
				done: task.checklist.filter((item) => item.done).length,
				total: task.checklist.length,
			}
		: { done: task.state === "done" ? 1 : 0, total: 1 };
