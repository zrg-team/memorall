import { describe, expect, it } from "vitest";
import {
	assignRefs,
	controlsByRef,
	renderViewText,
} from "../app-kit/render-text";
import {
	englishKitText,
	type MemonKitText,
	type MemonViewNode,
} from "../app-kit/types";
import { kitAppForRef } from "../apps";
import {
	draftsFromQuestions,
	questionsFromDrafts,
	studioRequestFrom,
	studioApp,
} from "../apps/studio-view";
import type { MemonMachineSnapshot } from "../types";

const nodes: MemonViewNode[] = [
	{
		type: "group",
		layout: "row",
		children: [
			{ type: "heading", text: "Questions" },
			{ type: "button", id: "json", label: "Edit as JSON" },
			{ type: "button", id: "page", label: "Open page", userOnly: true },
		],
	},
	{
		type: "item",
		id: "step:1",
		title: "1.",
		status: "done",
		children: [
			{
				type: "group",
				layout: "row",
				children: [
					{
						type: "input",
						id: "reword:1",
						label: "Wording",
						value: "Search sources",
						inline: true,
					},
					{ type: "button", id: "tick:1", label: "Undo" },
				],
			},
		],
	},
	{
		type: "select",
		id: "voice",
		label: "Voice",
		value: "af",
		options: [
			{ value: "af", label: "Bella" },
			{ value: "am", label: "Adam" },
		],
	},
	{
		type: "toggle",
		id: "use",
		label: "Use",
		checked: false,
		disabled: "no agent",
	},
	{
		type: "input",
		id: "notes",
		label: "Notes",
		value: "one\ntwo",
		lines: 4,
	},
	{
		type: "input",
		id: "path",
		label: "File",
		value: "",
		suggestions: ["/a.mp3", "/b.wav"],
	},
	{
		type: "button",
		id: "run",
		label: "Run",
		disabled: "no model chosen for this studio",
	},
];

describe("app kit text", () => {
	it("numbers the controls in reading order and leaves out the user's own", () => {
		const refs = [...assignRefs(nodes, "x").values()];
		expect(refs).toEqual(["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"]);
		const controls = controlsByRef(nodes, "x");
		expect(controls.get("x1")).toMatchObject({ id: "json" });
		expect(controls.get("x2")).toMatchObject({ id: "reword:1" });
		expect(
			[...controls.values()].some((control) => control.id === "page"),
		).toBe(false);
	});

	it("reads like the window: rows on one line, values, options and why a control is off", () => {
		expect(renderViewText(nodes, "x")).toEqual([
			"Questions: [x1] Edit as JSON",
			'[x] 1. [x2] Wording: "Search sources" · [x3] Undo',
			"[x4] Voice: Bella (choose: af | am)",
			"[x5] [off] Use (unavailable: no agent)",
			"[x6] Notes:",
			"  | one",
			"  | two",
			"[x7] File: (empty)",
			"  e.g. /a.mp3, /b.wav",
			"[x8] Run (unavailable: no model chosen for this studio)",
		]);
	});

	it("finds the app a ref belongs to", () => {
		expect(kitAppForRef("s12")?.[0]).toBe("studio");
		expect(kitAppForRef("n1")?.[0]).toBe("notes");
		expect(kitAppForRef("h3")?.[0]).toBe("scheduler");
		expect(kitAppForRef("b4")).toBeNull();
		expect(kitAppForRef("sx")).toBeNull();
	});
});

const snapshotWith = (
	drafts: Record<string, unknown>,
	selected: MemonMachineSnapshot["studio"]["selected"] = "decision",
): MemonMachineSnapshot =>
	({
		drafts,
		files: { cwd: "/", entries: [] },
		studio: {
			selected,
			tools: [{ id: "decision", ready: true, model: "laya-onnx" }],
			runs: [],
			error: null,
		},
	}) as unknown as MemonMachineSnapshot;

describe("Studio Decision", () => {
	it("keeps what options mean when going between the builder and JSON", () => {
		const questions = questionsFromDrafts([
			{
				id: "sentiment",
				type: "choice",
				instructions: "How does the writer feel?",
				criteria: "positive, neutral, negative",
			},
			{
				id: "priority",
				type: "score",
				instructions: "How urgent is it?",
				criteria: "low: can wait\nhigh: today",
			},
			{
				id: "reply",
				type: "noul",
				instructions: "Does it need a reply?",
				criteria: "",
			},
			{ id: " ", type: "choice", instructions: "skipped", criteria: "a, b" },
		]);
		expect(questions).toEqual({
			sentiment: {
				type: "choice",
				instructions: "How does the writer feel?",
				criteria: ["positive", "neutral", "negative"],
			},
			priority: {
				type: "score",
				instructions: "How urgent is it?",
				criteria: { low: "can wait", high: "today" },
			},
			reply: { type: "noul", instructions: "Does it need a reply?" },
		});
		expect(draftsFromQuestions(questions)).toEqual([
			{
				id: "sentiment",
				type: "choice",
				instructions: "How does the writer feel?",
				criteria: "positive, neutral, negative",
			},
			{
				id: "priority",
				type: "score",
				instructions: "How urgent is it?",
				criteria: "low: can wait\nhigh: today",
			},
			{
				id: "reply",
				type: "noul",
				instructions: "Does it need a reply?",
				criteria: "",
			},
		]);
	});

	it("shows the builder by default and the JSON only when asked", () => {
		const builder = renderViewText(studioApp.view(snapshotWith({})), "s").join(
			"\n",
		);
		expect(builder).toContain("Questions: [s");
		expect(builder).toContain("] Edit as JSON");
		expect(builder).toContain('Id: "sentiment"');
		expect(builder).toContain("Type: Pick one (choose: choice | score | noul)");
		expect(builder).not.toContain("Questions JSON");

		const json = renderViewText(
			studioApp.view(
				snapshotWith({
					"studio:decision:json": true,
					"studio:decision:jsonText": '{"questions":{}}',
				}),
			),
			"s",
		).join("\n");
		expect(json).toContain("] Use the builder");
		expect(json).toContain("Questions JSON:");
		expect(json).toContain('  | {"questions":{}}');
		expect(json).not.toContain('Id: "sentiment"');
	});

	it("builds the run from the form and refuses questions that are not ready", () => {
		expect(
			studioRequestFrom(
				snapshotWith({ "studio:decision:text": " Refund me now! " }),
				"decision",
			),
		).toMatchObject({
			tool: "decision",
			text: "Refund me now!",
			questions: {
				sentiment: { type: "choice" },
				urgent: { type: "noul" },
			},
		});
		expect(() =>
			studioRequestFrom(
				snapshotWith({
					"studio:decision:questions": [
						{ id: "only", type: "choice", instructions: "Pick", criteria: "a" },
					],
				}),
				"decision",
			),
		).toThrow("only: A choice needs at least two options.");
		expect(() =>
			studioRequestFrom(
				snapshotWith({
					"studio:decision:json": true,
					"studio:decision:jsonText": "{nope",
				}),
				"decision",
			),
		).toThrow("The questions JSON is not valid");
	});

	it("offers to set up a model only to the user", () => {
		const snapshot = snapshotWith({});
		(snapshot.studio.tools[0] as { ready: boolean }).ready = false;
		const view = studioApp.view(snapshot);
		const text = renderViewText(view, "s").join("\n");
		expect(text).toContain("model: none — the user chooses one in Studio");
		expect(text).not.toContain("Set up a model");
		expect(text).toContain(
			"Run (unavailable: no model chosen for this studio)",
		);
		expect(JSON.stringify(view)).toContain('"id":"setup"');
	});
});

describe("app kit languages", () => {
	const snapshot = {
		...snapshotWith({}, null),
		notes: {
			items: [{ id: "a", text: "Search", status: "doing" }],
			text: "",
		},
	} as unknown as MemonMachineSnapshot;

	it("keeps the refs and ids the agent reads whatever the window's language", async () => {
		const { notesApp } = await import("../apps/notes-view");
		const shout: MemonKitText = (key, english, values) =>
			englishKitText(key, english, values).toUpperCase();
		for (const app of [notesApp, studioApp]) {
			const english = controlsByRef(app.view(snapshot), app.refPrefix);
			const shouted = controlsByRef(app.view(snapshot, shout), app.refPrefix);
			expect([...shouted.keys()]).toEqual([...english.keys()]);
			expect([...shouted.values()].map((control) => control.id)).toEqual(
				[...english.values()].map((control) => control.id),
			);
		}
		expect(renderViewText(notesApp.view(snapshot, shout), "n")).toContain(
			"NOW: SEARCH",
		);
	});

	it("has every word the views use in both languages", async () => {
		const { MEMON_KIT_APPS } = await import("../apps");
		const en = (await import("@/main/i18n/locales/en/common.json")).default
			.memonComputer as Record<string, unknown>;
		const vn = (await import("@/main/i18n/locales/vn/common.json")).default
			.memonComputer as Record<string, unknown>;
		const lookup = (tree: Record<string, unknown>, key: string) =>
			key
				.split(".")
				.reduce<unknown>(
					(node, part) =>
						node && typeof node === "object"
							? (node as Record<string, unknown>)[part]
							: undefined,
					tree,
				);
		const used = new Set<string>();
		const record: MemonKitText = (key, english) => {
			used.add(key);
			return english;
		};
		const states: MemonMachineSnapshot[] = [
			snapshot,
			snapshotWith({}),
			snapshotWith({ "studio:decision:json": true }),
		];
		for (const state of states) {
			for (const app of Object.values(MEMON_KIT_APPS)) {
				try {
					app.view(state, record);
				} catch {
					// A partial snapshot; the other states cover this app.
				}
			}
		}
		expect(used.size).toBeGreaterThan(20);
		for (const key of used) {
			expect(typeof lookup(en, key), `en ${key}`).toBe("string");
			expect(typeof lookup(vn, key), `vn ${key}`).toBe("string");
		}
	});
});
