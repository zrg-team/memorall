import {
	englishKitText,
	type MemonKitApp,
	type MemonViewNode,
} from "../app-kit/types";
import type { MemonMachineSnapshot, MemonNoteItem } from "../types";

const NEW_STEP = "notes:new";

const quote = (text: string, max = 60) =>
	`"${text.length > max ? `${text.slice(0, max - 1)}…` : text}"`;

const stepOf = (snapshot: MemonMachineSnapshot, id: string) => {
	const index = snapshot.notes.items.findIndex((item) => item.id === id);
	if (index < 0) throw new Error("That step is no longer in Notes.");
	return {
		step: index + 1,
		item: snapshot.notes.items[index] as MemonNoteItem,
	};
};

/**
 * Notes: the checklist the agent plans the task with, and its notes. The
 * user and the agent tick, reword, add and remove steps with the same
 * controls.
 */
export const notesApp: MemonKitApp = {
	refPrefix: "n",

	view(snapshot, t = englishKitText) {
		const { items, text } = snapshot.notes;
		const done = items.filter((item) => item.status === "done").length;
		const doing = items.find((item) => item.status === "doing");
		const newStep = String(snapshot.drafts[NEW_STEP] ?? "");
		const nodes: MemonViewNode[] = [
			{
				type: "progress",
				label: t("notes.done", "done"),
				value: done,
				max: items.length,
			},
		];
		if (snapshot.notes.error) {
			nodes.push({ type: "text", text: snapshot.notes.error, tone: "error" });
		}
		if (doing) {
			nodes.push({
				type: "text",
				text: t("notes.now", "now: {{step}}", { step: doing.text }),
				tone: "muted",
			});
		}
		if (!items.length) {
			nodes.push({
				type: "text",
				text: t("notes.empty", "No steps yet. Plan the work here."),
				tone: "muted",
			});
		}
		items.forEach((item, index) => {
			nodes.push({
				type: "item",
				id: `step:${item.id}`,
				title: `${index + 1}.`,
				status: item.status,
				children: [
					{
						type: "group",
						layout: "row",
						children: [
							{
								type: "input",
								id: `reword:${item.id}`,
								label: t("notes.wording", "Wording"),
								value: item.text,
								inline: true,
							},
							{
								type: "button",
								id: `tick:${item.id}`,
								label:
									item.status === "done"
										? t("notes.undo", "Undo")
										: t("notes.tick", "Done"),
							},
							{
								type: "button",
								id: `remove:${item.id}`,
								label: t("notes.remove", "Remove"),
								variant: "danger",
								icon: "delete",
							},
						],
					},
				],
			});
		});
		nodes.push(
			{
				type: "group",
				layout: "row",
				children: [
					{
						type: "input",
						id: "new",
						label: t("notes.newStep", "New step"),
						value: newStep,
						placeholder: t("notes.addPlaceholder", "Add a step"),
					},
					{
						type: "button",
						id: "add",
						label: t("notes.add", "Add"),
						icon: "add",
						disabled: newStep.trim()
							? undefined
							: t("notes.addDisabled", "type the step first"),
					},
				],
			},
			{
				type: "input",
				id: "notes",
				label: t("notes.text", "Notes"),
				value: text,
				lines: 6,
				placeholder: t(
					"notes.textPlaceholder",
					"Findings, sources, decisions…",
				),
			},
		);
		return nodes;
	},

	act(machine, id, value) {
		const snapshot = machine.snapshot();
		const [action, target = ""] = id.split(":");
		switch (action) {
			case "tick": {
				const { step, item } = stepOf(snapshot, target);
				const next = item.status === "done" ? "todo" : "done";
				machine.setNoteStatus(step, next);
				return `${next === "done" ? "ticked" : "unticked"} step ${step} ${quote(item.text)} in Notes`;
			}
			case "reword": {
				const { step } = stepOf(snapshot, target);
				const text = String(value ?? "").trim();
				machine.editNote(step, text);
				return `reworded step ${step} in Notes to ${quote(text)}`;
			}
			case "remove": {
				const { step, item } = stepOf(snapshot, target);
				machine.removeNote(step);
				return `removed step ${step} ${quote(item.text)} from Notes`;
			}
			case "new":
				machine.setDraft(NEW_STEP, String(value ?? ""));
				return "";
			case "add": {
				const text = String(machine.draft(NEW_STEP, "")).trim();
				if (!text) throw new Error("Type the step first.");
				machine.addNotes([text]);
				machine.setDraft(NEW_STEP, undefined);
				return `added step ${quote(text)} to Notes`;
			}
			case "notes":
				machine.writeNotesText(String(value ?? ""));
				return "edited the notes in Notes";
			default:
				throw new Error(`Notes has no control ${id}.`);
		}
	},
};
