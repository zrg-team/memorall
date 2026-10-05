import { describe, expect, it, vi } from "vitest";
import type {
	SandboxMediaRunRequest,
	SandboxMediaRunResult,
} from "../../types";
import { runHostCommandLine, usesHostCommand } from "..";
import { runFfmpeg, runMagick } from "../media-command";
import type { HostCommandContext } from "../types";

const encode = (text: string) => new TextEncoder().encode(text);

/** A computer with these files under /work, and an engine that answers `reply`. */
const createContext = (
	existing: Record<string, string>,
	reply: Partial<SandboxMediaRunResult> = {},
	stdin?: Uint8Array,
) => {
	const files = new Map(Object.entries(existing));
	const written = new Map<string, Uint8Array | string>();
	const runMedia = vi.fn(
		async (
			_request: SandboxMediaRunRequest,
		): Promise<SandboxMediaRunResult> => ({
			exitCode: 0,
			stdout: new Uint8Array(),
			stderr: "",
			changed: [],
			...reply,
		}),
	);
	const isDirectory = async (path: string) =>
		path === "/" ||
		[...files.keys()].some((file) => file.startsWith(`${path}/`));
	const context: HostCommandContext = {
		cwd: "/work",
		env: {},
		stdin,
		files: {
			isDirectory,
			exists: async (path) => files.has(path) || (await isDirectory(path)),
			list: async (dir) =>
				[...files.keys()]
					.filter(
						(path) =>
							path.startsWith(`${dir}/`) &&
							!path.slice(dir.length + 1).includes("/"),
					)
					.map((path) => ({ path, size: 1 })),
			walk: async () => ({ files: [], truncated: false }),
			read: async (path) => encode(files.get(path) ?? ""),
			write: async (path, data) => {
				written.set(path, data);
			},
			append: async () => undefined,
			remove: async () => undefined,
		},
		runPython: vi.fn(),
		runMedia,
		filesChanged: vi.fn(),
	};
	const sent = () => runMedia.mock.calls[0]?.[0] as SandboxMediaRunRequest;
	const sentPaths = () =>
		sent()
			.files.map((file) => file.path)
			.sort();
	return { context, runMedia, written, sent, sentPaths };
};

describe("media commands", () => {
	it("run on the host, next to a running server", () => {
		for (const command of [
			"ffmpeg -i a.mp4 a.gif",
			"ffprobe a.mp4",
			"magick a.png b.jpg",
			"convert a.png b.jpg",
			"identify a.png",
			"mogrify -resize 50% *.png",
			"montage *.png sheet.png",
			"composite logo.png bg.png out.png",
			"compare a.png b.png diff.png",
		]) {
			expect(usesHostCommand(command)).toBe(true);
		}
	});

	it("are found by which, command -v and type, which look only at the shell's own", async () => {
		const files = {
			isDirectory: async () => true,
			exists: async () => true,
			list: async () => [],
			walk: async () => ({ files: [], truncated: false }),
			read: async () => new Uint8Array(),
			write: async () => undefined,
			append: async () => undefined,
			remove: async () => undefined,
		};
		const runShell = vi.fn(async (command: string) => ({
			commandId: "shell",
			command,
			cwd: "/",
			status: "failed" as const,
			completed: true,
			stdout: "",
			stderr: "",
			nextOffset: 0,
			exitCode: 1,
			startedAt: 0,
			updatedAt: 0,
		}));
		const lookup = (command: string) =>
			runHostCommandLine(
				{ command, cwd: "/" },
				{ files, runShell, runPython: vi.fn(), filesChanged: vi.fn() },
			);
		expect(usesHostCommand("which ffmpeg magick")).toBe(true);
		expect((await lookup("which ffmpeg magick")).stdout).toBe(
			"/usr/bin/ffmpeg\n/usr/bin/magick\n",
		);
		expect((await lookup("command -v convert")).stdout).toBe(
			"/usr/bin/convert\n",
		);
		expect((await lookup("type ffprobe")).stdout).toBe(
			"ffprobe is /usr/bin/ffprobe\n",
		);
		// Found, so what is chained after it runs.
		expect((await lookup("which ffmpeg && echo ok")).stdout).toBe(
			"/usr/bin/ffmpeg\n",
		);
		expect(runShell).toHaveBeenCalledWith("echo ok", "/");
		// Anything else is still the shell's to answer.
		expect(usesHostCommand("which node")).toBe(false);
		expect(usesHostCommand("which ffmpeg node")).toBe(false);
		expect(usesHostCommand("command ffmpeg")).toBe(false);
	});

	it("send magick the files it names, globs and frames included, and keep what it writes", async () => {
		const { context, sent, sentPaths, written } = createContext(
			{
				"/work/a.png": "a",
				"/work/b.png": "b",
				"/work/notes.txt": "n",
				"/work/anim.gif": "g",
				"/work/fonts/Inter.ttf": "f",
			},
			{
				stdout: encode("ok\n"),
				changed: [{ path: "/work/out/sheet.png", data: encode("png") }],
			},
		);
		const output = await runMagick(
			[
				"magick",
				"*.png",
				"anim.gif[0]",
				"-font",
				"fonts/Inter.ttf",
				"+append",
				"out/sheet.png",
			],
			context,
		);
		expect(sent().engine).toBe("magick");
		expect(sent().argv[0]).toBe("magick");
		expect(sentPaths()).toEqual([
			"/work/a.png",
			"/work/anim.gif",
			"/work/b.png",
			"/work/fonts/Inter.ttf",
		]);
		expect(output.stdout).toBe("ok\n");
		expect(written.get("/work/out/sheet.png")).toEqual(encode("png"));
		expect(context.filesChanged).toHaveBeenCalled();
	});

	it("send ffmpeg its inputs, image sequences, filter files and concat clips", async () => {
		const { context, sent, sentPaths } = createContext({
			"/work/in.mp4": "v",
			"/work/frames/f001.png": "1",
			"/work/frames/f002.png": "2",
			"/work/frames/other.jpg": "x",
			"/work/subs.srt": "s",
			"/work/list.txt": "file 'clips/one.mp4'\nfile clips/two.mp4\n",
			"/work/clips/one.mp4": "1",
			"/work/clips/two.mp4": "2",
			"/work/clips/three.mp4": "3",
		});
		await runFfmpeg(
			[
				"ffmpeg",
				"-framerate",
				"10",
				"-i",
				"frames/f%03d.png",
				"-i",
				"in.mp4",
				"-f",
				"concat",
				"-i",
				"list.txt",
				"-vf",
				"subtitles=subs.srt:force_style='FontSize=24'",
				"out/clip.mp4",
			],
			context,
		);
		expect(sent().engine).toBe("ffmpeg");
		expect(sentPaths()).toEqual([
			"/work/clips/one.mp4",
			"/work/clips/two.mp4",
			"/work/frames/f001.png",
			"/work/frames/f002.png",
			"/work/in.mp4",
			"/work/list.txt",
			"/work/subs.srt",
		]);
		expect(sent().dirs).toContain("/work");
		expect(sent().dirs).toContain("/work/frames");
	});

	it("point ffmpeg's pipes at files the engine passes on", async () => {
		const { context, sent } = createContext(
			{},
			{ stdout: encode("RIFF") },
			encode("mp3 bytes"),
		);
		const output = await runFfmpeg(
			["ffmpeg", "-i", "-", "-f", "wav", "-"],
			context,
		);
		expect(sent().argv).toEqual([
			"ffmpeg",
			"-i",
			"/tmp/memorall-stdin",
			"-f",
			"wav",
			"/tmp/memorall-stdout",
		]);
		expect(sent().stdin).toEqual(encode("mp3 bytes"));
		expect(sent().stdoutPath).toBe("/tmp/memorall-stdout");
		expect(output.stdoutBytes).toEqual(encode("RIFF"));
	});

	it("show progress as a terminal would and say what to use instead", async () => {
		const { context } = createContext(
			{ "/work/in.mp4": "v" },
			{
				exitCode: 1,
				stderr: "frame=1\rframe=2\rframe=3\nUnknown encoder 'h264_nvenc'\n",
			},
		);
		const output = await runFfmpeg(
			["ffmpeg", "-i", "in.mp4", "-c:v", "h264_nvenc", "out.mp4"],
			context,
		);
		expect(output.exitCode).toBe(1);
		expect(output.stderr).toContain("frame=3\nUnknown encoder");
		expect(output.stderr).not.toContain("frame=1");
		expect(output.stderr).toContain("no hardware encoders");
	});

	it("say so where the sandbox has no media engine", async () => {
		const { context } = createContext({ "/work/a.png": "a" });
		const output = await runMagick(["identify", "a.png"], {
			...context,
			runMedia: undefined,
		});
		expect(output.exitCode).toBe(1);
		expect(output.stderr).toContain("identify: media tools are not available");
	});
});
