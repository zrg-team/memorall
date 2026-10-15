import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HOSTED_APP_IDS, HOSTED_APPS, hostedAppForPath } from "../catalog";
import {
	commandCatalogText,
	commandSignature,
	createHostedFile,
	type HostedFileAccess,
	requireHostedApp,
	runHostedAppCommands,
	runResultText,
} from "../commands";
import { HOSTED_APP_CHANNEL, HOSTED_APP_PROTOCOL_VERSION } from "../protocol";
import { fakeEngine } from "./fake-engine";

const disk = (initial: Record<string, string> = {}) => {
	const files = new Map(Object.entries(initial));
	const access: HostedFileAccess = {
		read: async (path) =>
			files.has(path) ? new TextEncoder().encode(files.get(path)) : null,
		write: vi.fn(async (path: string, bytes: Uint8Array) => {
			files.set(path, new TextDecoder().decode(bytes));
		}),
	};
	return { files, access };
};

const loadEngine = async () => fakeEngine("spreadsheet");

describe("hosted app catalog", () => {
	it("opens each app's own extensions, case-insensitively, and nothing else", () => {
		expect(hostedAppForPath("/a/Budget.XLSX")).toBe("spreadsheet");
		expect(hostedAppForPath("Plan.docx")).toBe("documents");
		expect(hostedAppForPath("deck.pptx")).toBe("presentation");
		expect(hostedAppForPath("~/Retro.whiteboard")).toBe("whiteboard");
		expect(hostedAppForPath("scan.pdf")).toBe("pdf");
		expect(hostedAppForPath("notes.md")).toBeNull();
		expect(hostedAppForPath("data.csv")).toBeNull();
		for (const id of HOSTED_APP_IDS) {
			expect(hostedAppForPath(`new.${HOSTED_APPS[id].newFile.extension}`)).toBe(
				id,
			);
		}
		expect(() => requireHostedApp("/notes/todo.md")).toThrow(
			/not a file an app opens/,
		);
	});

	it("speaks the same protocol as the shim inside the frame", () => {
		const shim = readFileSync("tools/hosted-apps/host/puter-host.js", "utf8");
		expect(shim).toContain(`const CHANNEL = "${HOSTED_APP_CHANNEL}";`);
		expect(shim).toContain(`const VERSION = ${HOSTED_APP_PROTOCOL_VERSION};`);
	});
});

describe("runHostedAppCommands", () => {
	it("runs the commands in order and writes the file once", async () => {
		const { files, access } = disk({ "/a.xlsx": "one" });
		const result = await runHostedAppCommands({
			path: "/a.xlsx",
			calls: [
				{ name: "add", args: { text: "two" } },
				{ name: "add", args: { text: "zero", where: "top" } },
				{ name: "read" },
			],
			files: access,
			loadEngine,
		});
		expect(files.get("/a.xlsx")).toBe("zero\none\ntwo");
		expect(access.write).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			app: "spreadsheet",
			created: false,
			saved: true,
		});
		expect(result.outcomes.map((outcome) => outcome.ok)).toEqual([
			true,
			true,
			true,
		]);
		expect(result.description).toBe("3 lines: zero | one | two");
	});

	it("stops at a failed command, keeps what ran before it, and says what was skipped", async () => {
		const { files, access } = disk({ "/a.xlsx": "one" });
		const result = await runHostedAppCommands({
			path: "/a.xlsx",
			calls: [
				{ name: "add", args: { text: "two" } },
				{ name: "fail" },
				{ name: "add", args: { text: "three" } },
			],
			files: access,
			loadEngine,
		});
		expect(files.get("/a.xlsx")).toBe("one\ntwo");
		expect(
			result.outcomes.map((outcome) => [
				outcome.name,
				outcome.ok,
				!!outcome.skipped,
			]),
		).toEqual([
			["add", true, false],
			["fail", false, false],
			["add", false, true],
		]);
		expect(runResultText(result)).toContain("- fail: FAILED Error: refused.");
		expect(runResultText(result)).toContain(
			"- add: skipped (an earlier command failed)",
		);
	});

	it("leaves an unchanged file alone, and makes a missing one", async () => {
		const { access } = disk({ "/a.xlsx": "one" });
		await runHostedAppCommands({
			path: "/a.xlsx",
			calls: [{ name: "read" }],
			files: access,
			loadEngine,
		});
		expect(access.write).not.toHaveBeenCalled();

		const fresh = disk();
		const made = await runHostedAppCommands({
			path: "/b.xlsx",
			calls: [{ name: "read" }],
			files: fresh.access,
			loadEngine,
		});
		expect(made).toMatchObject({ created: true, saved: true });
		expect(fresh.files.has("/b.xlsx")).toBe(true);
	});

	it("names the commands an unknown one could have been, and keeps a read-only file unchanged", async () => {
		const { access } = disk({ "/a.xlsx": "one" });
		const unknown = await runHostedAppCommands({
			path: "/a.xlsx",
			calls: [{ name: "write_cells" }],
			files: access,
			loadEngine,
		});
		expect(unknown.outcomes[0].content).toContain(
			"Its commands: read, add, fail",
		);

		const readOnly = await runHostedAppCommands({
			path: "/a.xlsx",
			calls: [{ name: "read" }, { name: "add", args: { text: "x" } }],
			files: access,
			loadEngine: async () =>
				fakeEngine("spreadsheet", { readOnlyFiles: true }),
		});
		expect(readOnly.outcomes[1]).toMatchObject({
			ok: false,
			content: expect.stringContaining("read only"),
		});
		expect(access.write).not.toHaveBeenCalled();
	});

	it("refuses files no app opens before loading anything", async () => {
		const load = vi.fn(loadEngine);
		await expect(
			runHostedAppCommands({
				path: "/notes.md",
				calls: [],
				files: disk().access,
				loadEngine: load,
			}),
		).rejects.toThrow(/Apps open \.xlsx/);
		expect(load).not.toHaveBeenCalled();
	});

	it("starts a new file the way the app does", async () => {
		const bytes = await createHostedFile("/New.xlsx", loadEngine);
		expect(new TextDecoder().decode(bytes)).toBe("");
	});
});

describe("commands as the agent reads them", () => {
	it("gives each command one line: parameters, optional marks, enums and reads", async () => {
		const engine = fakeEngine("spreadsheet");
		expect(commandSignature(engine.commands[0])).toBe(
			"read() [reads] — Reads the lines.",
		);
		expect(commandSignature(engine.commands[1])).toBe(
			'add(text: string, where?: "top"|"bottom") — Adds a line.',
		);
		const catalog = commandCatalogText(engine);
		expect(catalog.split("\n")[0]).toBe("Spreadsheet commands:");
		expect(catalog).toContain("Lines of text.");
	});
});
