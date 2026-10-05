import { describe, expect, it } from "vitest";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import { listSavedFolders } from "../host/saved-folders";

const HOME = "/agents/Bot";
const SESSIONS = `${HOME}/.pi/agent/sessions`;

/** Folders and files, each file with the time it was last written. */
const memoryFs = (
	files: Record<string, { content: string; mtime: number }>,
	folders: string[],
): IFlowFileSystem => {
	const dirs = new Set(folders);
	for (const path of Object.keys(files)) {
		let dir = path.slice(0, path.lastIndexOf("/"));
		while (dir) {
			dirs.add(dir);
			dir = dir.slice(0, dir.lastIndexOf("/"));
		}
	}
	const children = (dir: string) =>
		[...new Set([...dirs, ...Object.keys(files)])]
			.filter(
				(path) =>
					path.startsWith(`${dir}/`) &&
					!path.slice(dir.length + 1).includes("/"),
			)
			.map((path) => path.slice(dir.length + 1));
	const fs = {
		async readdir(dir: string, options?: { withFileTypes: true }) {
			if (!dirs.has(dir)) throw new Error("ENOENT");
			const names = children(dir);
			return options
				? names.map((name) => ({
						name,
						isFile: () => !dirs.has(`${dir}/${name}`),
						isDirectory: () => dirs.has(`${dir}/${name}`),
						isSymbolicLink: () => false,
					}))
				: names;
		},
		async readFile(path: string) {
			const file = files[path];
			if (!file) throw new Error("ENOENT");
			return file.content;
		},
		async stat(path: string) {
			const file = files[path];
			if (!file && !dirs.has(path)) throw new Error("ENOENT");
			return {
				isDirectory: () => dirs.has(path),
				isFile: () => Boolean(file),
				mtime: new Date(file?.mtime ?? 0),
			};
		},
	};
	return fs as unknown as IFlowFileSystem;
};

/** A saved pi session: its header, then the prompts and replies. */
const session = (
	cwd: string,
	started: string,
	messages: Array<{ role: "user" | "assistant"; text: string; at: string }>,
	name?: string,
): string =>
	[
		{ type: "session", version: 3, id: started, timestamp: started, cwd },
		...messages.map((message, index) => ({
			type: "message",
			id: `m${index}`,
			parentId: index ? `m${index - 1}` : null,
			timestamp: message.at,
			message: {
				role: message.role,
				content: [{ type: "text", text: message.text }],
			},
		})),
		...(name
			? [
					{
						type: "session_info",
						id: "i1",
						parentId: null,
						timestamp: started,
						name,
					},
				]
			: []),
	]
		.map((entry) => JSON.stringify(entry))
		.join("\n");

describe("listSavedFolders", () => {
	const fs = memoryFs(
		{
			// ~/todo: two sessions, the older one written to last.
			[`${SESSIONS}/--agents-Bot-todo--/2026-10-01T10-00-00-000Z_a.jsonl`]: {
				content: session(`${HOME}/todo`, "2026-10-01T10:00:00.000Z", [
					{
						role: "user",
						text: "Build a todo API",
						at: "2026-10-01T10:00:01.000Z",
					},
					{ role: "assistant", text: "Done.", at: "2026-10-04T09:00:00.000Z" },
				]),
				mtime: Date.parse("2026-10-04T09:00:00.000Z"),
			},
			[`${SESSIONS}/--agents-Bot-todo--/2026-10-02T10-00-00-000Z_b.jsonl`]: {
				content: session(`${HOME}/todo`, "2026-10-02T10:00:00.000Z", [
					{ role: "user", text: "Add tests", at: "2026-10-02T10:00:01.000Z" },
				]),
				mtime: Date.parse("2026-10-02T10:00:01.000Z"),
			},
			// /projects/game: one named session, used last.
			[`${SESSIONS}/--projects-game--/2026-10-03T10-00-00-000Z_c.jsonl`]: {
				content: session(
					"/projects/game",
					"2026-10-03T10:00:00.000Z",
					[
						{
							role: "user",
							text: "Slow the intro",
							at: "2026-10-05T08:00:00.000Z",
						},
					],
					"Intro pacing",
				),
				mtime: Date.parse("2026-10-05T08:00:00.000Z"),
			},
			// A folder deleted since.
			[`${SESSIONS}/--agents-Bot-old--/2026-09-01T10-00-00-000Z_d.jsonl`]: {
				content: session(`${HOME}/old`, "2026-09-01T10:00:00.000Z", [
					{ role: "user", text: "Hello", at: "2026-09-01T10:00:01.000Z" },
				]),
				mtime: Date.parse("2026-09-01T10:00:01.000Z"),
			},
		},
		[`${HOME}/todo`, "/projects/game"],
	);

	it("lists the folders pi worked in, the one used last first, with the session to continue", async () => {
		await expect(listSavedFolders(fs, HOME)).resolves.toEqual([
			{
				path: "/projects/game",
				lastUsed: Date.parse("2026-10-05T08:00:00.000Z"),
				sessions: 1,
				latest: {
					file: `${SESSIONS}/--projects-game--/2026-10-03T10-00-00-000Z_c.jsonl`,
					title: "Intro pacing",
				},
			},
			{
				path: `${HOME}/todo`,
				lastUsed: Date.parse("2026-10-04T09:00:00.000Z"),
				sessions: 2,
				latest: {
					file: `${SESSIONS}/--agents-Bot-todo--/2026-10-01T10-00-00-000Z_a.jsonl`,
					title: "Build a todo API",
				},
			},
		]);
	});

	it("reads one folder's sessions, and nothing when pi has none", async () => {
		const [todo, ...rest] = await listSavedFolders(fs, HOME, `${HOME}/todo`);
		expect(rest).toEqual([]);
		expect(todo?.path).toBe(`${HOME}/todo`);
		await expect(listSavedFolders(fs, HOME, `${HOME}/new`)).resolves.toEqual(
			[],
		);
		await expect(listSavedFolders(memoryFs({}, [HOME]), HOME)).resolves.toEqual(
			[],
		);
	});
});
