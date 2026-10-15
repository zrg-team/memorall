import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MEMON_FEATURE_CONFIG } from "../../../feature-config";
import { MemonMachine, type MemonPorts } from "../../../memon-machine";
import { serializeScreen } from "../../../screen-serializer";
import type { MemonHostedAppsPort } from "../hosted-apps-app";
import { fakeEngine } from "./fake-engine";

/** A computer with Files and the hosted apps, on a disk that announces writes. */
const computer = async (initial: Record<string, string>) => {
	const files = new Map(Object.entries(initial));
	const listeners = new Set<() => void>();
	const announce = () => {
		for (const listener of listeners) listener();
	};
	const hosted: MemonHostedAppsPort = {
		available: async () => ["spreadsheet", "documents"],
		files: {
			read: async (path) =>
				files.has(path) ? new TextEncoder().encode(files.get(path)) : null,
			write: async (path, bytes) => {
				files.set(path, new TextDecoder().decode(bytes));
				announce();
			},
		},
		loadEngine: async (id) => fakeEngine(id),
		services: {},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	const ports = {
		browser: { availability: () => ({ available: true }) },
		terminal: { availability: () => ({ available: true }) },
		files: {
			availability: () => ({ available: true }),
			list: vi.fn(async () => []),
			read: vi.fn(async (path: string) => files.get(path) ?? ""),
			isDirectory: vi.fn(async (path: string) => path === "/" || path === "/w"),
			exists: vi.fn(async (path: string) => files.has(path)),
			subscribe: vi.fn(() => () => {}),
		},
		hosted,
	} as unknown as MemonPorts;
	const machine = new MemonMachine(
		"agent-1",
		ports,
		DEFAULT_MEMON_FEATURE_CONFIG,
	);
	await machine.hosted.availableApps();
	return {
		machine,
		files,
		writeElsewhere: async (path: string, text: string) => {
			files.set(path, text);
			announce();
			await vi.advanceTimersByTimeAsync(500);
		},
	};
};

describe("hosted apps on the Memon computer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("opens Office files in their app, with the file as the engine describes it on the agent's screen", async () => {
		const { machine } = await computer({ "/w/Budget.xlsx": "rent\nfood" });
		await machine.openFile("/w/Budget.xlsx");
		const snapshot = machine.snapshot();
		expect(snapshot.hostedApps).toEqual(["spreadsheet", "documents"]);
		expect(snapshot.windows.map((window) => window.app)).toEqual([
			"spreadsheet",
		]);
		expect(snapshot.hosted?.spreadsheet).toMatchObject({
			path: "/w/Budget.xlsx",
			loading: false,
		});
		const screen = serializeScreen(snapshot);
		expect(screen).toContain("Spreadsheet · /w/Budget.xlsx");
		expect(screen).toContain("2 lines: rent | food");
		expect(screen).toContain('memon_app { path: "/w/Budget.xlsx" }');
	});

	it("keeps files of apps this build lacks in the Viewer", async () => {
		const { machine } = await computer({ "/w/Deck.pptx": "x" });
		await machine.openFile("/w/Deck.pptx").catch(() => {});
		expect(machine.snapshot().windows.map((window) => window.app)).toEqual([
			"viewer",
		]);
	});

	it("runs the agent's commands in the app window and saves the file", async () => {
		const { machine, files } = await computer({ "/w/Budget.xlsx": "rent" });
		const result = await machine.hosted.run("/w/Budget.xlsx", [
			{ name: "add", args: { text: "food" } },
		]);
		expect(result.saved).toBe(true);
		expect(files.get("/w/Budget.xlsx")).toBe("rent\nfood");
		const snapshot = machine.snapshot();
		expect(
			snapshot.windows.find((window) => window.id === snapshot.focusedWindowId)
				?.app,
		).toBe("spreadsheet");
		expect(snapshot.hosted?.spreadsheet?.text).toBe("2 lines: rent | food");
	});

	it("follows the user's saves in the app, and forgets the file when the window closes", async () => {
		const { machine, writeElsewhere } = await computer({
			"/w/Plan.docx": "intro",
		});
		await machine.openFile("/w/Plan.docx");
		await writeElsewhere("/w/Plan.docx", "intro\nscope");
		expect(machine.snapshot().hosted?.documents?.text).toBe(
			"2 lines: intro | scope",
		);

		machine.hosted.noteSaved("documents", "/w/Other.docx");
		const opened = machine.snapshot().hosted?.documents?.opened;
		await vi.advanceTimersByTimeAsync(10);
		expect(machine.snapshot().hosted?.documents).toMatchObject({
			path: "/w/Other.docx",
			opened,
		});

		const window = machine.findWindow("documents");
		await machine.closeWindow(window?.id ?? "");
		expect(machine.snapshot().hosted?.documents).toBeUndefined();
	});

	it("lists an app's commands and explains one in full", async () => {
		const { machine } = await computer({});
		expect(await machine.hosted.commands("/w/New.xlsx")).toContain(
			'- add(text: string, where?: "top"|"bottom")',
		);
		expect(await machine.hosted.commands("/w/New.xlsx", "add")).toContain(
			'"enum":["top","bottom"]',
		);
	});
});
