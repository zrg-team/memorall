import { describe, expect, it } from "vitest";
import {
	type MemonHomeIO,
	moveMemonHome,
	prepareMemonHome,
	uniqueAgentName,
} from "../agent-home";
import { memonAgentFolderName, memonHomeDir } from "../constants";
import { parseNotesFile, serializeNotesFile } from "../notes-file";
import {
	parseTerminalHistory,
	serializeTerminalHistory,
} from "../terminal/terminal-history";

/** Files and folders in memory, as the documents filesystem keeps them. */
const createIO = (paths: Record<string, string> = {}) => {
	const files = new Map(Object.entries(paths));
	const dirs = new Set<string>(["/"]);
	const isDirectory = (path: string) =>
		dirs.has(path) ||
		[...files.keys()].some((file) => file.startsWith(`${path}/`));
	const io: MemonHomeIO = {
		async list(dir) {
			const names = new Set<string>();
			for (const path of [...files.keys(), ...dirs]) {
				if (path.startsWith(`${dir}/`)) {
					names.add(path.slice(dir.length + 1).split("/")[0] as string);
				}
			}
			return [...names].map((name) => {
				const path = `${dir}/${name}`;
				return { name, path, type: isDirectory(path) ? "dir" : "file" };
			});
		},
		exists: async (path) => files.has(path) || isDirectory(path),
		isDirectory: async (path) => isDirectory(path),
		async move(from, to) {
			for (const [path, content] of [...files]) {
				if (path === from || path.startsWith(`${from}/`)) {
					files.delete(path);
					files.set(`${to}${path.slice(from.length)}`, content);
				}
			}
			for (const dir of [...dirs]) {
				if (dir === from || dir.startsWith(`${from}/`)) {
					dirs.delete(dir);
					dirs.add(`${to}${dir.slice(from.length)}`);
				}
			}
		},
		async mkdir(path) {
			dirs.add(path);
		},
		async removeEmptyDir(path) {
			dirs.delete(path);
		},
	};
	return { io, files, dirs };
};

describe("agent names and homes", () => {
	it("names a home after the agent, as a folder can hold it", () => {
		expect(memonHomeDir("Researcher")).toBe("/agents/Researcher");
		expect(memonHomeDir("  Web / Scraper:  2 ")).toBe("/agents/Web Scraper 2");
		expect(memonAgentFolderName("..hidden")).toBe("hidden");
		expect(memonAgentFolderName("///")).toBe("agent");
		expect(memonHomeDir(null)).toBe("/agents/guest");
	});

	it("adds 1, 2, 3… to a name another agent has", () => {
		expect(uniqueAgentName("Researcher", [])).toBe("Researcher");
		expect(uniqueAgentName("Researcher", ["Researcher"])).toBe("Researcher 1");
		expect(
			uniqueAgentName("researcher", ["Researcher", "Researcher 1", "Writer"]),
		).toBe("researcher 2");
		// Names that make the same folder are the same name.
		expect(uniqueAgentName("Web/Scraper", ["Web Scraper"])).toBe(
			"Web/Scraper 1",
		);
	});

	it("moves an older home in, its Desktop's files to the top", async () => {
		const { io, files } = createIO({
			"/.users/agent-1/Desktop/Bot.md": "Answer briefly.",
			"/.users/agent-1/Desktop/Memory.md": "- Uses Edge",
			"/.users/agent-1/Visuals/Report.openui": "root = …",
			"/agents/Researcher/Memory.md": "kept",
		});

		await prepareMemonHome(io, "/agents/Researcher", ["/.users/agent-1"]);

		expect(files.get("/agents/Researcher/Bot.md")).toBe("Answer briefly.");
		expect(files.get("/agents/Researcher/Visuals/Report.openui")).toBe(
			"root = …",
		);
		// What the home has stays; the old copy is left where it was.
		expect(files.get("/agents/Researcher/Memory.md")).toBe("kept");
		expect(files.get("/.users/agent-1/Desktop/Memory.md")).toBe("- Uses Edge");
		expect(await io.isDirectory("/agents/Researcher/Desktop")).toBe(false);
		expect(await io.isDirectory("/.users/agent-1/Visuals")).toBe(false);
	});

	it("moves a home when its agent is renamed", async () => {
		const { io, files } = createIO({
			"/agents/Researcher/Bot.md": "Answer briefly.",
		});
		await expect(moveMemonHome(io, "Researcher", "Analyst")).resolves.toBe(
			"/agents/Analyst",
		);
		expect(files.get("/agents/Analyst/Bot.md")).toBe("Answer briefly.");
		expect(files.has("/agents/Researcher/Bot.md")).toBe(false);

		await moveMemonHome(io, "Analyst", "analyst");
		expect(files.get("/agents/analyst/Bot.md")).toBe("Answer briefly.");
	});
});

describe("the .notes and .terminal files", () => {
	it("reads and writes notes as JSON", () => {
		const content = serializeNotesFile({
			items: [{ text: "Search", status: "done" }],
			text: "Sources",
		});
		expect(JSON.parse(content)).toEqual({
			items: [{ text: "Search", status: "done" }],
			text: "Sources",
		});
		expect(parseNotesFile(content)).toEqual({
			items: [{ text: "Search", status: "done" }],
			text: "Sources",
		});
		expect(
			parseNotesFile(
				'{ "items": ["Plain", { "text": "Odd", "status": "x" }] }',
			),
		).toEqual({
			items: [
				{ text: "Plain", status: "todo" },
				{ text: "Odd", status: "todo" },
			],
			text: "",
		});
		expect(parseNotesFile("")).toEqual({ items: [], text: "" });
		expect(() => parseNotesFile("[1]")).toThrow("JSON object");
		expect(() => parseNotesFile("{ nope")).toThrow("not valid JSON");
	});

	it("reads and writes the command history as JSON", () => {
		const content = serializeTerminalHistory(["ls", "node app.js"]);
		expect(JSON.parse(content)).toEqual({ history: ["ls", "node app.js"] });
		expect(parseTerminalHistory(content)).toEqual(["ls", "node app.js"]);
		expect(parseTerminalHistory('["pwd", 3, "  "]')).toEqual(["pwd"]);
		expect(() => parseTerminalHistory('{ "history": 1 }')).toThrow(
			'"history" list',
		);
	});
});
