import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/services/filesystem/fs", async () => {
	const { configure, fs, InMemory } = await import("@zenfs/core");
	await configure({ mounts: { "/home": InMemory } });
	return { default: fs };
});
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { initialize: async () => undefined },
}));
import fs from "@/services/filesystem/fs";
import { runGit } from "../git-command";
import type { HostCommandContext } from "../types";

const context = (cwd = "/repo"): HostCommandContext => ({
	cwd,
	env: {},
	files: {} as HostCommandContext["files"],
	runPython: vi.fn(),
	filesChanged: vi.fn(),
});

const git = (line: string, cwd?: string) =>
	runGit(["git", ...line.split(" ")], context(cwd));

const write = (path: string, content: string) =>
	fs.promises.writeFile(`/home/files${path}`, content);

describe("git on the host filesystem", () => {
	beforeAll(async () => {
		await fs.promises.mkdir("/home/files/repo/src", { recursive: true });
		await write("/repo/a.txt", "hello\n");
		await write("/repo/src/b.js", "console.log(1)\n");
	});

	it("initializes, stages and commits", async () => {
		expect((await git("init")).stdout).toBe(
			"Initialized empty Git repository in /repo/.git/\n",
		);
		expect((await git("status")).stdout).toContain("Untracked files:\n\ta.txt");

		await git("add .");
		const staged = await git("status");
		expect(staged.stdout).toContain("Changes to be committed:");
		expect(staged.stdout).toContain("new file:   src/b.js");

		const commit = await runGit(
			["git", "commit", "-m", "first commit"],
			context(),
		);
		expect(commit.exitCode).toBe(0);
		expect(commit.stdout).toMatch(
			/^\[main [0-9a-f]{7}\] first commit\n 2 files changed\n$/,
		);
		expect((await git("status")).stdout).toContain(
			"nothing to commit, working tree clean",
		);
	});

	it("shows unstaged and staged diffs", async () => {
		await write("/repo/a.txt", "hello world\n");
		const diff = await git("diff");
		expect(diff.stdout).toContain("diff --git a/a.txt b/a.txt");
		expect(diff.stdout).toContain("-hello\n+hello world");

		await git("add a.txt");
		expect((await git("diff")).stdout).toBe("");
		expect((await git("diff --staged")).stdout).toContain("+hello world");
		expect((await git("status -s")).stdout).toBe("M  a.txt\n");
	});

	it("logs, branches and runs from a subfolder", async () => {
		await runGit(["git", "commit", "-m", "second"], context());
		const log = await git("log --oneline", "/repo/src");
		expect(log.stdout).toMatch(
			/^[0-9a-f]{7} second\n[0-9a-f]{7} first commit\n$/,
		);

		expect((await git("checkout -b feature")).stdout).toBe(
			"Switched to a new branch 'feature'\n",
		);
		expect((await git("branch")).stdout).toBe("* feature\n  main\n");
	});

	it("keeps global config in /.gitconfig, outside the repository", async () => {
		await git("config --global user.name Ada");
		expect((await git("config --global user.name")).stdout).toBe("Ada\n");
		expect(
			new TextDecoder().decode(
				await fs.promises.readFile("/home/files/.gitconfig"),
			),
		).toBe("[user]\n\tname = Ada\n");
		await write("/repo/c.txt", "c\n");
		await git("add c.txt");
		await runGit(["git", "commit", "-m", "by ada"], context());
		expect((await git("log -n 1")).stdout).toContain("Author: Ada <");
	});

	it("explains a folder that is not a repository", async () => {
		await fs.promises.mkdir("/home/files/plain", { recursive: true });
		const result = await git("status", "/plain");
		expect(result.exitCode).toBe(128);
		expect(result.stderr).toContain("not a git repository");
	});
});
