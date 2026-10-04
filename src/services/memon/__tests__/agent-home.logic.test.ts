import { describe, expect, it } from "vitest";
import {
	type MemonHomeIO,
	moveMemonHome,
	prepareMemonHome,
	uniqueAgentName,
} from "../agent-home";
import { memonAgentFolderName, memonHomeDir } from "../constants";
import { migrateMemonHomeFiles } from "../desktop-files";
import { parseStudioAppFile, serializeStudioAppFile } from "../studio-app-file";
import {
	parseTasksFile,
	serializeTasksFile,
	taskProgress,
} from "../tasks-file";
import {
	parseTerminalHistory,
	parseTerminalLauncher,
	serializeTerminalHistory,
	serializeTerminalLauncher,
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

describe("the home's files", () => {
	it("reads and writes tasks as JSON, with readable times", () => {
		const content = serializeTasksFile({
			tasks: [
				{
					id: 3,
					title: "Search",
					state: "done",
					checklist: [{ text: "One", done: true }],
					createdBy: "user",
					createdAt: Date.UTC(2026, 9, 4, 9),
					updatedAt: Date.UTC(2026, 9, 4, 10),
					finishedAt: Date.UTC(2026, 9, 4, 10),
				},
			],
		});
		expect(JSON.parse(content).tasks[0]).toEqual({
			id: 3,
			title: "Search",
			state: "done",
			createdBy: "user",
			createdAt: "2026-10-04T09:00:00.000Z",
			updatedAt: "2026-10-04T10:00:00.000Z",
			finishedAt: "2026-10-04T10:00:00.000Z",
			checklist: [{ text: "One", done: true }],
		});
		expect(parseTasksFile(content).tasks[0]).toMatchObject({
			id: 3,
			createdAt: Date.UTC(2026, 9, 4, 9),
			finishedAt: Date.UTC(2026, 9, 4, 10),
		});
	});

	it("reads tasks written by hand, and an older Notes file as one task", () => {
		const { tasks } = parseTasksFile(
			JSON.stringify({
				tasks: [
					"Plain",
					{ id: 2, title: "Doing", state: "In Progress", checklist: ["a"] },
					{ id: 2, title: "Same id", status: "todo" },
					{ title: "" },
				],
			}),
			1000,
		);
		expect(tasks.map(({ id, title, state }) => ({ id, title, state }))).toEqual(
			[
				{ id: 1, title: "Plain", state: "approved" },
				{ id: 2, title: "Doing", state: "in_progress" },
				{ id: 3, title: "Same id", state: "approved" },
			],
		);
		expect(tasks[1]?.checklist).toEqual([{ text: "a", done: false }]);
		expect(
			parseTasksFile(
				'{ "items": [{ "text": "Search", "status": "done" }], "text": "x" }',
				1000,
			).tasks,
		).toEqual([
			{
				id: 1,
				title: "Earlier plan",
				state: "done",
				checklist: [{ text: "Search", done: true }],
				createdBy: "agent",
				createdAt: 1000,
				updatedAt: 1000,
				finishedAt: 1000,
			},
		]);
		expect(parseTasksFile("")).toEqual({ tasks: [] });
		expect(() => parseTasksFile("1")).toThrow('"tasks" list');
		expect(() => parseTasksFile("{ nope")).toThrow("not valid JSON");
		expect(taskProgress({ state: "done", checklist: [] })).toEqual({
			done: 1,
			total: 1,
		});
	});

	it("keeps the command history one command per line, and reads the older JSON", () => {
		const content = serializeTerminalHistory(["ls", "node app.js"]);
		expect(content).toBe("ls\nnode app.js\n");
		expect(parseTerminalHistory(content)).toEqual(["ls", "node app.js"]);
		expect(parseTerminalHistory("pwd\r\n\n  \ngit status")).toEqual([
			"pwd",
			"git status",
		]);
		expect(parseTerminalHistory('{ "history": ["ls", 3, "  "] }')).toEqual([
			"ls",
		]);
		expect(serializeTerminalHistory([])).toBe("");
	});

	it("reads a launcher as JSON or as the command itself", () => {
		const content = serializeTerminalLauncher({
			command: "npm run dev",
			cwd: "~/site",
		});
		expect(parseTerminalLauncher(content)).toEqual({
			command: "npm run dev",
			cwd: "~/site",
		});
		expect(parseTerminalLauncher("# dev\nnpm i\nnpm run dev\n")).toEqual({
			command: "npm i && npm run dev",
		});
		expect(parseTerminalLauncher('{ "history": ["ls"] }')).toBeNull();
		expect(parseTerminalLauncher("")).toBeNull();
	});

	it("reads a studio app's tool and settings, never its input", () => {
		const content = serializeStudioAppFile({
			tool: "speech",
			title: "Narrator",
			settings: { voice: "af_heart", speed: 1.2 },
		});
		expect(JSON.parse(content)).toEqual({
			tool: "speech",
			title: "Narrator",
			voice: "af_heart",
			speed: 1.2,
		});
		expect(
			parseStudioAppFile(
				'{ "tool": "decision", "text": "an input", "questions": { "a": {} }, "count": "2" }',
				"/agents/Max/Analyze User Feedback.studio",
			),
		).toEqual({
			tool: "decision",
			title: "Analyze User Feedback",
			settings: { questions: { a: {} } },
		});
		expect(() => parseStudioAppFile('{ "tool": "nope" }', "/a.studio")).toThrow(
			'it needs "tool"',
		);
	});

	it("moves an older version's visible files to hidden ones, once", async () => {
		const files = new Map<string, string>([
			["/h/my.notes", '{ "items": ["a"], "text": "Keep me" }'],
			["/h/my.terminal", '{ "history": ["ls"] }'],
			["/h/Notes.md", "mine"],
			["/k/my.notes", "{}"],
			["/k/.tasks", '{ "tasks": [] }'],
		]);
		const io = {
			read: async (path: string) => {
				const content = files.get(path);
				if (content === undefined) throw new Error("ENOENT");
				return content;
			},
			write: async (path: string, content: string) => {
				files.set(path, content);
			},
			exists: async (path: string) => files.has(path),
			move: async (from: string, to: string) => {
				files.set(to, files.get(from) ?? "");
				files.delete(from);
			},
		};
		await migrateMemonHomeFiles(io, "/h");
		await migrateMemonHomeFiles(io, "/k");
		expect([...files.keys()].sort()).toEqual([
			"/h/.tasks",
			"/h/.terminal_history",
			"/h/Notes 2.md",
			"/h/Notes.md",
			"/k/.tasks",
			"/k/my.notes",
		]);
		expect(files.get("/h/Notes 2.md")).toBe("# Notes\n\nKeep me\n");
		expect(files.get("/k/.tasks")).toBe('{ "tasks": [] }');
	});
});
