import { describe, expect, it, vi } from "vitest";
import { parseSegment, resolvePath, splitChain } from "../command-line";
import { runHostCommandLine, usesHostCommand } from "../index";
import type { HostFiles } from "../types";

vi.mock("../git-command", () => ({
	runGit: vi.fn(async (argv: string[]) => ({
		stdout: `git:${argv.slice(1).join(" ")}\n`,
		stderr: "",
		exitCode: argv[1] === "fail" ? 1 : 0,
	})),
}));
vi.mock("../host-files", () => ({ createHostFiles: vi.fn() }));

describe("splitChain", () => {
	it("splits at &&, || and ; outside quotes", () => {
		expect(
			splitChain(`git add . && git commit -m "a && b; c" || echo no; ls`),
		).toEqual([
			{ text: "git add .", join: null },
			{ text: 'git commit -m "a && b; c"', join: "&&" },
			{ text: "echo no", join: "||" },
			{ text: "ls", join: ";" },
		]);
	});
});

describe("parseSegment", () => {
	it("unquotes arguments and finds env, redirects and pipes", () => {
		expect(
			parseSegment(
				`FOO=1 git commit -m 'first commit' "--author=A B" > out.txt 2>&1`,
			),
		).toEqual({
			argv: ["git", "commit", "-m", "first commit", "--author=A B"],
			env: { FOO: "1" },
			redirect: { path: "out.txt", append: false },
			mergeStderr: true,
			needsShell: false,
		});
		expect(parseSegment("git log | head").needsShell).toBe(true);
		expect(parseSegment('py -c "print(1 > 0)"').redirect).toBeUndefined();
	});
});

describe("resolvePath", () => {
	it("resolves like a shell", () => {
		expect(resolvePath("/notes/a", "../b/./c")).toBe("/notes/b/c");
		expect(resolvePath("/notes", "/abs")).toBe("/abs");
	});
});

const files = (): HostFiles & { written: Map<string, string> } => {
	const written = new Map<string, string>();
	return {
		written,
		isDirectory: async (path) => path === "/repo" || path === "/",
		exists: async () => true,
		list: async () => [],
		walk: async () => ({ files: [], truncated: false }),
		read: async () => new Uint8Array(),
		write: async (path, data) => {
			written.set(path, String(data));
		},
		append: async (path, data) => {
			written.set(path, (written.get(path) ?? "") + data);
		},
		remove: async () => undefined,
	};
};

describe("runHostCommandLine", () => {
	it("only takes command lines that use git or py", () => {
		expect(usesHostCommand("npm test && git status")).toBe(true);
		expect(usesHostCommand("python3 -V")).toBe(true);
		expect(usesHostCommand("echo git")).toBe(false);
	});

	it("runs host and shell segments in order with cd carried over", async () => {
		const runShell = vi.fn(async (command: string, cwd: string) => ({
			commandId: "c1",
			command,
			cwd,
			status: "completed" as const,
			completed: true,
			stdout: `shell:${command}@${cwd}\n`,
			stderr: "",
			nextOffset: 0,
			exitCode: 0,
			startedAt: 0,
			updatedAt: 0,
		}));
		const fileSystem = files();
		const result = await runHostCommandLine(
			{
				command:
					"cd repo && git status && git fail || echo recovered; git log > log.txt",
				cwd: "/",
			},
			{
				files: fileSystem,
				runShell,
				runPython: vi.fn(),
				filesChanged: vi.fn(),
			},
		);

		expect(result.stdout).toBe(
			"git:status\ngit:fail\nshell:echo recovered@/repo\n",
		);
		expect(result.exitCode).toBe(0);
		expect(result.completed).toBe(true);
		expect(fileSystem.written.get("/repo/log.txt")).toBe("git:log\n");
	});

	it("pipes curl into the shell, and the shell into curl", async () => {
		const shellResult = (command: string, stdout: string) => ({
			commandId: "c1",
			command,
			cwd: "/",
			status: "completed" as const,
			completed: true,
			stdout,
			stderr: "",
			nextOffset: 0,
			exitCode: 0,
			startedAt: 0,
			updatedAt: 0,
		});
		const runShellWithInput = vi.fn(
			async (command: string, _cwd: string, input: string) =>
				shellResult(command, input.toUpperCase()),
		);
		const http = {
			request: vi.fn(async (request: { url: URL; body?: Uint8Array }) => ({
				status: 200,
				statusText: "OK",
				httpVersion: "1.1" as const,
				headers: [] as Array<[string, string]>,
				body: request.body ?? new TextEncoder().encode("page"),
				url: request.url.href,
				followed: 0,
				remotePort: 3000,
			})),
		};
		const deps = {
			files: files(),
			runShell: vi.fn(async (command: string) =>
				shellResult(command, "piped in"),
			),
			runShellWithInput,
			runPython: vi.fn(),
			filesChanged: vi.fn(),
			http,
		};

		const down = await runHostCommandLine(
			{ command: "curl -s localhost:3000/ | grep page", cwd: "/" },
			deps,
		);
		expect(runShellWithInput).toHaveBeenCalledWith("grep page", "/", "page");
		expect(down).toMatchObject({ stdout: "PAGE", exitCode: 0 });

		const up = await runHostCommandLine(
			{
				command: "echo hi | curl -s --data-binary @- localhost:3000/",
				cwd: "/",
			},
			deps,
		);
		expect(deps.runShell).toHaveBeenCalledWith("echo hi", "/");
		expect(up).toMatchObject({ stdout: "piped in", exitCode: 0 });
		expect(usesHostCommand("echo hi | curl -s x")).toBe(true);
	});

	it("routes 2> and drops what goes to /dev/null", async () => {
		expect(parseSegment("curl -s x 2>/dev/null")).toMatchObject({
			argv: ["curl", "-s", "x"],
			stderrRedirect: { path: "/dev/null", append: false },
		});
		expect(parseSegment("echo a2>b").argv).toEqual(["echo", "a2"]);
		const fileSystem = files();
		const http = {
			request: vi.fn(async (request: { url: URL }) => ({
				status: 200,
				statusText: "OK",
				httpVersion: "1.1" as const,
				headers: [] as Array<[string, string]>,
				body: new TextEncoder().encode("body"),
				url: request.url.href,
				followed: 0,
				remotePort: 3000,
			})),
		};
		const result = await runHostCommandLine(
			{
				command:
					"curl localhost:3000/ > /dev/null 2> err.txt; curl -sS nope:// 2>/dev/null",
				cwd: "/",
			},
			{
				files: fileSystem,
				runShell: vi.fn(),
				runPython: vi.fn(),
				filesChanged: vi.fn(),
				http,
			},
		);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("");
		expect(fileSystem.written.has("/dev/null")).toBe(false);
		expect(fileSystem.written.get("/err.txt")).toContain("% Total");
	});

	it("refuses to pipe a host command", async () => {
		const result = await runHostCommandLine(
			{ command: "git log | head", cwd: "/" },
			{
				files: files(),
				runShell: vi.fn(),
				runPython: vi.fn(),
				filesChanged: vi.fn(),
			},
		);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain(
			"pipes and input redirects are not supported",
		);
	});
});
