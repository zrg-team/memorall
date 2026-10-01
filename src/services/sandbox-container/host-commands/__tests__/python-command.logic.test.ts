import { describe, expect, it, vi } from "vitest";
import { runPython } from "../python-command";
import type { HostCommandContext } from "../types";

const encode = (text: string) => new TextEncoder().encode(text);

const createContext = (existing: Record<string, string>) => {
	const written = new Map<string, Uint8Array | string>();
	const removed: string[] = [];
	const context: HostCommandContext = {
		cwd: "/work",
		env: {},
		files: {
			isDirectory: async () => true,
			exists: async (path) => path in existing,
			walk: async () => ({
				files: Object.keys(existing).map((path) => ({ path, size: 1 })),
				truncated: false,
			}),
			read: async (path) => encode(existing[path]),
			write: async (path, data) => {
				written.set(path, data);
			},
			append: async () => undefined,
			remove: async (path) => {
				removed.push(path);
			},
		},
		runPython: vi.fn(async () => ({
			exitCode: 0,
			stdout: "4\n",
			stderr: "",
			changed: [{ path: "/work/out.csv", data: encode("a,b\n") }],
			deleted: ["/work/old.txt"],
		})),
		filesChanged: vi.fn(),
	};
	return { context, written, removed };
};

describe("py", () => {
	it("runs a script with the working folder's files and keeps what it wrote", async () => {
		const { context, written, removed } = createContext({
			"/work/main.py": "print(2 + 2)",
			"/work/old.txt": "old",
		});

		const result = await runPython(["py", "main.py", "--fast"], context);

		expect(result).toEqual({ stdout: "4\n", stderr: "", exitCode: 0 });
		expect(context.runPython).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "file",
				target: "/work/main.py",
				argv: ["/work/main.py", "--fast"],
				cwd: "/work",
				files: expect.arrayContaining([
					{ path: "/work/main.py", data: encode("print(2 + 2)") },
				]),
			}),
		);
		expect(written.get("/work/out.csv")).toEqual(encode("a,b\n"));
		expect(removed).toEqual(["/work/old.txt"]);
		expect(context.filesChanged).toHaveBeenCalled();
	});

	it("passes -c code through as code", async () => {
		const { context } = createContext({});
		await runPython(["python3", "-c", "print(1)"], context);
		expect(context.runPython).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "code",
				target: "print(1)",
				argv: ["-c"],
			}),
		);
	});

	it("explains what it cannot do", async () => {
		const { context } = createContext({});
		expect((await runPython(["py"], context)).stderr).toContain(
			"interactive Python is not available",
		);
		expect(
			(await runPython(["py", "-m", "pip", "install", "x"], context)).stderr,
		).toContain("pip is not available");
		const missing = await runPython(["py", "nope.py"], context);
		expect(missing.exitCode).toBe(2);
		expect(missing.stderr).toContain("can't open file 'nope.py'");
		expect(context.runPython).not.toHaveBeenCalled();
	});
});
