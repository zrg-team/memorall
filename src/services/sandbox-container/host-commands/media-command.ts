import { FFMPEG_FONT } from "../installed-commands";
import type { SandboxMediaRunRequest, SandboxPythonFile } from "../types";
import { resolvePath } from "./command-line";
import type {
	HostCommand,
	HostCommandContext,
	HostCommandOutput,
} from "./types";

/**
 * `ffmpeg` and `ffprobe` (FFmpeg.wasm) and `magick` with ImageMagick's own
 * tools `convert`, `identify`, `mogrify`, `composite`, `montage` and
 * `compare` (magick-wasm): installed with the app, run in the sandbox page,
 * nothing to install. The files a command line names go in with each run —
 * a name, a glob, a %03d sequence, a file inside a filter ("subtitles=a.srt",
 * "movie=logo.png"), the files a concat list names — and the files the tool
 * writes come back, byte for byte.
 */

const FFMPEG_TIMEOUT_MS = 10 * 60_000;
const MAGICK_TIMEOUT_MS = 2 * 60_000;
const MAX_FILES = 2000;
const MAX_BYTES = 512 * 1024 * 1024;

/** Where an ffmpeg pipe is pointed inside the engine, outside the user's files. */
const STDIN_PATH = "/tmp/memorall-stdin";
const STDOUT_PATH = "/tmp/memorall-stdout";

const decoder = new TextDecoder();

const fail = (
	tool: string,
	message: string,
	exitCode = 1,
): HostCommandOutput => ({
	stdout: "",
	stderr: `${tool}: ${message}\n`,
	exitCode,
});

const dirname = (path: string): string =>
	path.slice(0, path.lastIndexOf("/")) || "/";

/** A pattern part of a name: a glob (*, ?) or an image sequence (%03d). */
const PATTERN = /[*?]|%0?\d*d/;

const patternToRegExp = (name: string): RegExp =>
	new RegExp(
		`^${name
			.split(/(%0?\d*d|\*|\?)/)
			.map((part) =>
				part === "*"
					? "[^/]*"
					: part === "?"
						? "[^/]"
						: /^%0?\d*d$/.test(part)
							? "\\d+"
							: part.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
			)
			.join("")}$`,
	);

/** The names one argument may hold: itself and the parts of a filter or option string. */
const candidates = (arg: string): string[] => {
	const names = new Set([arg]);
	for (const part of arg.split(/[=:,;'"[\]|]/)) {
		if (part && part !== arg && /[./]/.test(part)) names.add(part);
	}
	return [...names];
};

/** Lines of an ffmpeg concat list: `file 'clip.mp4'`. */
const CONCAT_ENTRY = /^\s*file\s+(?:'([^']+)'|"([^"]+)"|(\S+))/gm;

interface Gathered {
	files: SandboxPythonFile[];
	dirs: string[];
	error?: string;
}

/** The files and folders a command line names, read from the host. */
const gather = async (
	args: readonly string[],
	context: HostCommandContext,
): Promise<Gathered> => {
	const { cwd, files } = context;
	const paths = new Set<string>();
	const dirs = new Set<string>([cwd]);
	const addDirOf = async (path: string) => {
		const parent = dirname(path);
		if (await files.isDirectory(parent)) dirs.add(parent);
	};
	for (const arg of args) {
		for (const name of candidates(arg)) {
			const path = resolvePath(cwd, name);
			if (PATTERN.test(name)) {
				const parent = dirname(path);
				if (!(await files.isDirectory(parent))) continue;
				dirs.add(parent);
				const pattern = patternToRegExp(path);
				for (const entry of await files.list(parent)) {
					if (pattern.test(entry.path)) paths.add(entry.path);
				}
				continue;
			}
			if (await files.isDirectory(path)) dirs.add(path);
			else if (await files.exists(path)) paths.add(path);
			else await addDirOf(path);
		}
	}
	// An ffmpeg concat list names its clips inside the file.
	for (const path of [...paths]) {
		if (!/\.(txt|ffconcat|list)$/i.test(path)) continue;
		const text = decoder.decode(await files.read(path));
		for (const match of text.matchAll(CONCAT_ENTRY)) {
			const listed = resolvePath(
				dirname(path),
				match[1] ?? match[2] ?? match[3] ?? "",
			);
			if (await files.exists(listed)) paths.add(listed);
		}
	}
	if (paths.size > MAX_FILES) {
		return {
			files: [],
			dirs: [],
			error: `the command names ${paths.size} files; at most ${MAX_FILES} go in one run`,
		};
	}
	const gathered: SandboxPythonFile[] = [];
	let bytes = 0;
	for (const path of paths) {
		const data = await files.read(path);
		bytes += data.byteLength;
		if (bytes > MAX_BYTES) {
			return {
				files: [],
				dirs: [],
				error: `the files it names are over ${MAX_BYTES / 1024 / 1024} MB together; work on fewer or smaller files at a time`,
			};
		}
		gathered.push({ path, data });
	}
	return { files: gathered, dirs: [...dirs] };
};

/** What a terminal shows of a line rewritten with \r (ffmpeg's progress). */
const asShown = (text: string): string =>
	text
		.split("\n")
		.map((line) => {
			const parts = line.split("\r").filter(Boolean);
			return parts[parts.length - 1] ?? "";
		})
		.join("\n");

const run = async (
	engine: SandboxMediaRunRequest["engine"],
	argv: string[],
	context: HostCommandContext,
	request: Partial<SandboxMediaRunRequest>,
	timeoutMs: number,
): Promise<HostCommandOutput> => {
	const tool = argv[0] as string;
	if (!context.runMedia)
		return fail(tool, "media tools are not available in this sandbox");
	const gathered = await gather(argv.slice(1), context);
	if (gathered.error) return fail(tool, gathered.error);
	const result = await context.runMedia({
		engine,
		argv,
		cwd: context.cwd,
		files: gathered.files,
		dirs: gathered.dirs,
		timeoutMs: context.timeoutMs ?? timeoutMs,
		...request,
	});
	for (const file of result.changed)
		await context.files.write(file.path, file.data);
	if (result.changed.length) context.filesChanged();
	return {
		stdout: decoder.decode(result.stdout),
		stdoutBytes: result.stdout,
		stderr: result.stderr,
		exitCode: result.exitCode,
	};
};

/** Pipes in an ffmpeg command line ("-i -", "pipe:1", a last "-") pointed at files the engine passes on. */
const pointPipes = (argv: readonly string[], context: HostCommandContext) => {
	const tool = argv[0];
	const args = [...argv];
	let stdinPath: string | undefined;
	let stdoutPath: string | undefined;
	for (let index = 1; index < args.length; index += 1) {
		const arg = args[index] as string;
		const last = index === args.length - 1;
		const afterInput = args[index - 1] === "-i";
		const input =
			(afterInput || (tool === "ffprobe" && last)) &&
			(arg === "-" || arg === "pipe:" || arg === "pipe:0");
		if (input && context.stdin) {
			args[index] = STDIN_PATH;
			stdinPath = STDIN_PATH;
		} else if (
			tool === "ffmpeg" &&
			!afterInput &&
			(arg === "pipe:1" || (last && (arg === "-" || arg === "pipe:")))
		) {
			args[index] = STDOUT_PATH;
			stdoutPath = STDOUT_PATH;
		}
	}
	return { args, stdinPath, stdoutPath };
};

/** What to try instead, after an ffmpeg failure an agent tends to hit. */
const ffmpegHint = (stderr: string): string => {
	if (
		/Unknown encoder|Encoder not found|_nvenc|_qsv|_vaapi|videotoolbox/i.test(
			stderr,
		)
	) {
		return "ffmpeg: this is FFmpeg.wasm (one thread, no hardware encoders). Video: libx264, libx265, libvpx (vp8), libvpx-vp9, libtheora, libwebp, gif, mjpeg, png; audio: aac, libmp3lame, libopus, libvorbis, flac, pcm_s16le. ffmpeg -encoders lists them.\n";
	}
	if (/Protocol not found|Connection refused|https?:\/\//i.test(stderr)) {
		return "ffmpeg: it cannot open URLs here; download the file with curl -o first.\n";
	}
	if (
		/Cannot find a valid font|font.*not found|Could not load font/i.test(stderr)
	) {
		return `ffmpeg: give drawtext a font: fontfile=${FFMPEG_FONT} (or a .ttf in your files); subtitles take fontsdir=${dirname(FFMPEG_FONT)}.\n`;
	}
	return "";
};

/**
 * `ffmpeg` and `ffprobe` on FFmpeg.wasm. Its ffmpeg always overwrites (-y)
 * and never reads the keyboard (-nostdin).
 */
export const runFfmpeg: HostCommand = async (argv, context) => {
	const { args, stdinPath, stdoutPath } = pointPipes(argv, context);
	const output = await run(
		"ffmpeg",
		args,
		context,
		{ stdin: stdinPath ? context.stdin : undefined, stdinPath, stdoutPath },
		FFMPEG_TIMEOUT_MS,
	);
	const stderr = asShown(output.stderr);
	return {
		...output,
		stderr: output.exitCode === 0 ? stderr : stderr + ffmpegHint(stderr),
	};
};

/**
 * `magick` and ImageMagick's tools by name. ImageMagick reads "-" from
 * what is piped in and writes "png:-" to the pipe or the redirect.
 */
export const runMagick: HostCommand = (argv, context) =>
	run("magick", argv, context, { stdin: context.stdin }, MAGICK_TIMEOUT_MS);
