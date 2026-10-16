import { describe, expect, it } from "vitest";
import type { MemonWindowApp } from "@/services/memon/constants";
import { type MemonDockLauncher, memonDockLayout } from "../dock-layout";

const launchers = (...ids: MemonWindowApp[]): MemonDockLauncher[] =>
	ids.map((id) => ({ id, available: true }));

const ALL = launchers(
	"browser",
	"files",
	"terminal",
	"tasks",
	"visualize",
	"spreadsheet",
	"documents",
	"presentation",
	"whiteboard",
	"pdf",
	"scheduler",
	"studio",
	"skills",
	"connections",
	"pi",
	"fx",
);

const shape = (layout: ReturnType<typeof memonDockLayout>) =>
	layout.entries.map((entry) =>
		entry.kind === "app"
			? entry.launcher.id
			: `${entry.id}[${entry.launchers.map((launcher) => launcher.id).join(",")}]`,
	);

describe("the computer's dock", () => {
	it("keeps the main apps and groups the rest", () => {
		expect(shape(memonDockLayout(ALL, () => false))).toEqual([
			"browser",
			"files",
			"terminal",
			"tasks",
			"pi",
			"fx",
			"office[spreadsheet,documents,presentation,whiteboard,pdf]",
			"create[visualize,studio]",
			"agent[scheduler,skills,connections]",
		]);
	});

	it("shows a grouped app with a window open beside the others", () => {
		const layout = memonDockLayout(
			ALL,
			(app) => app === "pdf" || app === "skills",
		);
		expect(layout.running.map((launcher) => launcher.id)).toEqual([
			"pdf",
			"skills",
		]);
		// A pinned app's open window is already in the dock.
		expect(memonDockLayout(ALL, (app) => app === "files").running).toEqual([]);
	});

	it("shows a group of one as its app, and no empty group", () => {
		// Without Files there are no Office apps; Visualize is off.
		const layout = memonDockLayout(
			launchers("browser", "terminal", "studio", "scheduler", "skills"),
			() => false,
		);
		expect(shape(layout)).toEqual([
			"browser",
			"terminal",
			"studio",
			"agent[scheduler,skills]",
		]);
	});

	it("keeps an app that is in no group, where it was", () => {
		expect(
			shape(memonDockLayout(launchers("viewer", "browser"), () => false)),
		).toEqual(["viewer", "browser"]);
	});
});
