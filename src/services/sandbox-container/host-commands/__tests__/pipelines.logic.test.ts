import { describe, expect, it, vi } from "vitest";
import type {
	SandboxCommandResult,
	SandboxMediaRunRequest,
	SandboxMediaRunResult,
} from "../../types";
import { fromBase64, toBase64 } from "../byte-tools";
import { parseSegment } from "../command-line";
import { runHostCommandLine } from "../index";
import type { HostFiles } from "../types";

/** Bytes no text pipe survives: a PNG signature, a NUL, invalid UTF-8. */
const IMAGE = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xd8, 0xc3,
]);
const ENCODED = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x80, 0x81]);

const shellResult = (
	command: string,
	stdout: string,
	exitCode = 0,
): SandboxCommandResult => ({
	commandId: "shell",
	command,
	cwd: "/work",
	status: exitCode === 0 ? "completed" : "failed",
	completed: true,
	stdout,
	stderr: "",
	nextOffset: 0,
	exitCode,
	startedAt: 0,
	updatedAt: 0,
});

/** A computer whose magick prints ENCODED, and whose shell echoes. */
const computer = () => {
	const stored = new Map<string, Uint8Array>([["/work/img.png", IMAGE]]);
	const files: HostFiles = {
		isDirectory: async (path) => path === "/" || path === "/work",
		exists: async (path) => stored.has(path) || path === "/work",
		list: async () => [],
		walk: async () => ({ files: [], truncated: false }),
		read: async (path) => {
			const data = stored.get(path);
			if (!data) throw new Error(`ENOENT: ${path}`);
			return data;
		},
		write: async (path, data) => {
			stored.set(
				path,
				typeof data === "string" ? new TextEncoder().encode(data) : data,
			);
		},
		append: async () => undefined,
		remove: async () => undefined,
	};
	const runMedia = vi.fn(
		async (
			request: SandboxMediaRunRequest,
		): Promise<SandboxMediaRunResult> => ({
			exitCode: 0,
			stdout: request.argv.includes("png:-") ? ENCODED : new Uint8Array(),
			stderr: request.argv[0] === "ffmpeg" ? "frame=1\nsize=2kB\n" : "",
			changed: [],
		}),
	);
	const runShell = vi.fn(async (command: string) =>
		shellResult(
			command,
			command.startsWith("echo ")
				? `${command.slice(5)}\n`
				: `shell:${command}\n`,
		),
	);
	const runShellWithInput = vi.fn(
		async (command: string, _cwd: string, input: string) =>
			shellResult(command, `${command}<${input.length} chars>\n`),
	);
	const run = (command: string) =>
		runHostCommandLine(
			{ command, cwd: "/work" },
			{
				files,
				runShell,
				runShellWithInput,
				runPython: vi.fn(),
				runMedia,
				filesChanged: vi.fn(),
			},
		);
	const stdinOf = (call: number) => runMedia.mock.calls[call]?.[0].stdin;
	return { stored, runMedia, runShell, runShellWithInput, run, stdinOf };
};

describe("pipelines with host commands", () => {
	it("pass a file's bytes into magick with cat or <", async () => {
		const { run, stdinOf, runShell } = computer();
		expect(
			(await run("cat img.png | magick - -resize 50% small.webp")).exitCode,
		).toBe(0);
		expect(stdinOf(0)).toEqual(IMAGE);
		expect((await run("magick - small.webp < img.png")).exitCode).toBe(0);
		expect(stdinOf(1)).toEqual(IMAGE);
		expect(runShell).not.toHaveBeenCalled();
	});

	it("pass bytes from one host command to the next, through tee", async () => {
		const { run, stdinOf, stored, runMedia } = computer();
		const result = await run(
			"magick img.png png:- | tee copy.png | ffmpeg -i - out.mp4",
		);
		expect(result.exitCode).toBe(0);
		expect(stored.get("/work/copy.png")).toEqual(ENCODED);
		expect(stdinOf(1)).toEqual(ENCODED);
		// ffmpeg's input pipe was pointed at the bytes.
		expect(runMedia.mock.calls[1]?.[0].argv).toEqual([
			"ffmpeg",
			"-i",
			"/tmp/memorall-stdin",
			"out.mp4",
		]);
	});

	it("encode and decode base64 byte for byte", async () => {
		const { run, stdinOf } = computer();
		expect((await run("magick img.png png:- | base64 -w0")).stdout).toBe(
			toBase64(ENCODED),
		);
		expect((await run("magick img.png png:- | base64")).stdout).toBe(
			`${toBase64(ENCODED)}\n`,
		);
		await run(`echo ${toBase64(IMAGE)} | base64 -d | magick - out.png`);
		expect(stdinOf(2)).toEqual(IMAGE);
	});

	it("leave other commands to the shell, which carries text", async () => {
		const { run, runShell, runShellWithInput } = computer();
		const counted = await run("magick img.png png:- | wc -c");
		expect(runShellWithInput).toHaveBeenCalledWith(
			"wc -c",
			"/work",
			expect.any(String),
		);
		expect(counted.stdout).toContain("wc -c<");

		await run("ffmpeg -i in.mp4 out.mp4 2>&1 | tail -1");
		expect(runShellWithInput).toHaveBeenLastCalledWith(
			"tail -1",
			"/work",
			"frame=1\nsize=2kB\n",
		);

		// A cat with options, or of a file only the shell has, is the shell's.
		await run("cat -n img.png | magick - out.png");
		expect(runShell).toHaveBeenLastCalledWith("cat -n img.png", "/work");
		await run("cat node_modules/x.png | magick - out.png");
		expect(runShell).toHaveBeenLastCalledWith(
			"cat node_modules/x.png",
			"/work",
		);
	});

	it("say what is wrong with a redirect", async () => {
		const { run, runMedia } = computer();
		const missing = await run("magick - out.png < nope.png");
		expect(missing).toMatchObject({
			exitCode: 1,
			stderr: "nope.png: No such file or directory\n",
		});
		expect(runMedia).not.toHaveBeenCalled();
		const heredoc = await run("magick - out.png <<EOF");
		expect(heredoc.exitCode).toBe(2);
		expect(heredoc.stderr).toContain(
			"here-documents and process substitution are not supported for magick",
		);
	});
});

describe("input redirects and base64", () => {
	it("parse < file, and leave here-documents to the shell", () => {
		expect(parseSegment("magick - out.png < in.png")).toMatchObject({
			argv: ["magick", "-", "out.png"],
			inputRedirect: "in.png",
			needsShell: false,
		});
		expect(parseSegment("magick - <<EOF").needsShell).toBe(true);
		expect(parseSegment("diff <(ls) b").needsShell).toBe(true);
	});

	it("round-trips every byte", () => {
		const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
		for (const length of [0, 1, 2, 3, 255, 256]) {
			const slice = bytes.slice(0, length);
			expect(toBase64(slice)).toBe(Buffer.from(slice).toString("base64"));
			expect(fromBase64(toBase64(slice))).toEqual(slice);
		}
		expect(fromBase64("not base64!")).toBeNull();
	});
});
