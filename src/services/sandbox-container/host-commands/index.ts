import type {
	SandboxCommandResult,
	SandboxExecuteCommandRequest,
} from "../types";
import { byteToolFor } from "./byte-tools";
import {
	type ParsedSegment,
	parseSegment,
	resolvePath,
	splitChain,
	splitPipeline,
} from "./command-line";
import type {
	HostCommand,
	HostCommandContext,
	HostCommandOutput,
} from "./types";

const ffmpeg = () =>
	import("./media-command").then((module) => module.runFfmpeg);
const magick = () =>
	import("./media-command").then((module) => module.runMagick);

/**
 * Commands the sandbox shell cannot run itself, run on the host instead:
 * `git` needs binary-safe files, `py` (and `pip`, `zip`, `unzip`, which run
 * through it) needs Pyodide, `curl` needs the network (and this computer's
 * servers) the way curl reaches them, and `ffmpeg`, `ffprobe` and `magick`
 * (with ImageMagick's own `convert`, `identify`, `mogrify`, `composite`,
 * `montage` and `compare`) need FFmpeg.wasm and magick-wasm.
 */
const HOST_COMMANDS: Record<string, () => Promise<HostCommand>> = {
	compare: magick,
	composite: magick,
	convert: magick,
	curl: () => import("./curl-command").then((module) => module.runCurl),
	ffmpeg,
	ffprobe: ffmpeg,
	identify: magick,
	magick,
	mogrify: magick,
	montage: magick,
	git: () => import("./git-command").then((module) => module.runGit),
	py: () => import("./python-command").then((module) => module.runPython),
	python: () => import("./python-command").then((module) => module.runPython),
	python3: () => import("./python-command").then((module) => module.runPython),
	pip: () => import("./python-command").then((module) => module.runPip),
	pip3: () => import("./python-command").then((module) => module.runPip),
	zip: () => import("./python-command").then((module) => module.runZip),
	unzip: () => import("./python-command").then((module) => module.runUnzip),
};

/** The commands run on the host, by name. */
export const HOST_COMMAND_NAMES: readonly string[] = Object.keys(HOST_COMMANDS);

const isHostCommand = (name: string) => Object.hasOwn(HOST_COMMANDS, name);

/**
 * `which ffmpeg`, `command -v magick`, `type py`: the shell looks only among
 * its own commands, so it would say a host command is missing (and an agent
 * would go and install it). Answered here when every name asked about is a
 * host command; any other lookup stays the shell's.
 */
const lookupOf = (argv: readonly string[]): HostCommand | null => {
	const [command, ...rest] = argv;
	const flag = rest[0];
	if (command === "command" && flag !== "-v" && flag !== "-V") return null;
	if (command !== "which" && command !== "type" && command !== "command") {
		return null;
	}
	const names = rest.filter((arg) => !arg.startsWith("-"));
	if (!names.length || !names.every(isHostCommand)) return null;
	return async () => ({
		stdout: names
			.map((name) =>
				command === "type" || flag === "-V"
					? `${name} is /usr/bin/${name}\n`
					: `/usr/bin/${name}\n`,
			)
			.join(""),
		stderr: "",
		exitCode: 0,
	});
};

/** The host command that runs these words, if one does. */
const hostCommandFor = (
	argv: readonly string[],
): (() => Promise<HostCommand>) | null => {
	const name = argv[0];
	if (name && isHostCommand(name)) return HOST_COMMANDS[name] ?? null;
	const lookup = lookupOf(argv);
	return lookup ? async () => lookup : null;
};

const hostCommandOf = (segment: string) => {
	const { argv } = parseSegment(segment);
	return hostCommandFor(argv) ? (argv[0] as string) : null;
};

/** Whether any part of this command line needs a host command. */
export const usesHostCommand = (command: string): boolean =>
	splitChain(command).some((segment) =>
		splitPipeline(segment.text).some((stage) => hostCommandOf(stage) !== null),
	);

export interface HostCommandLineDeps
	extends Omit<HostCommandContext, "cwd" | "env" | "timeoutMs"> {
	/** Runs one plain segment in the sandbox shell. */
	runShell(command: string, cwd: string): Promise<SandboxCommandResult>;
	/** Runs a plain segment in the sandbox shell with `input` piped into it. */
	runShellWithInput?(
		command: string,
		cwd: string,
		input: string,
	): Promise<SandboxCommandResult>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Output sent here is dropped, as a shell's /dev/null drops it. */
const DEV_NULL = "/dev/null";

/** `2> file`, `2>&1` and `> file` (or >>) on a host command's output. */
const applyRedirects = async (
	parsed: ParsedSegment,
	output: HostCommandOutput,
	cwd: string,
	deps: HostCommandLineDeps,
): Promise<{ stdout: string; stderr: string }> => {
	let out = output.stdout;
	let err = output.stderr;
	const write = async (
		redirect: { path: string; append: boolean },
		text: string,
		bytes?: Uint8Array,
	) => {
		const path = resolvePath(cwd, redirect.path);
		if (path === DEV_NULL) return;
		if (redirect.append) await deps.files.append(path, text);
		else await deps.files.write(path, bytes ?? text);
		deps.filesChanged();
	};
	if (parsed.stderrRedirect) {
		await write(parsed.stderrRedirect, err);
		err = "";
	}
	if (parsed.mergeStderr) {
		out += err;
		err = "";
	}
	if (parsed.redirect) {
		await write(
			parsed.redirect,
			out,
			parsed.mergeStderr ? undefined : output.stdoutBytes,
		);
		out = "";
	}
	return { stdout: out, stderr: err };
};

/** `$?` expanded to the last exit code, except inside single quotes. */
export const withStatus = (text: string, code: number): string => {
	let out = "";
	let quote: '"' | "'" | null = null;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index] as string;
		if (quote === "'") {
			if (char === "'") quote = null;
			out += char;
			continue;
		}
		if (char === "\\" && index + 1 < text.length) {
			out += char + text[index + 1];
			index += 1;
			continue;
		}
		if (char === '"') quote = quote === '"' ? null : '"';
		else if (char === "'" && !quote) quote = "'";
		if (char === "$" && text[index + 1] === "?") {
			out += String(code);
			index += 1;
			continue;
		}
		out += char;
	}
	return out;
};

interface PipelineOutcome {
	stdout: string;
	stderr: string;
	exitCode: number;
}

const exitCodeOf = (result: PipelineOutcome | SandboxCommandResult): number =>
	"completed" in result
		? (result.exitCode ?? (result.status === "completed" ? 0 : 1))
		: result.exitCode;

type PipelineStep =
	| { kind: "host"; parsed: ParsedSegment; command: HostCommand }
	| { kind: "shell"; stages: string[] };

/**
 * A pipeline with a host command in it, run as a shell runs one: what each
 * stage prints is the next one's stdin, and the last one's status is the
 * pipeline's. Host commands, and `cat`, `tee` and `base64` next to them, run
 * here and hand on bytes as they are, so images and video go through whole
 * (`cat a.png | magick - b.webp`, `curl -sL … | ffmpeg -i - …`); a run of
 * other stages goes to the sandbox shell together, which carries text.
 */
const runPipeline = async (
	stages: readonly string[],
	cwd: string,
	status: number,
	request: SandboxExecuteCommandRequest,
	deps: HostCommandLineDeps,
): Promise<PipelineOutcome | SandboxCommandResult> => {
	const steps: PipelineStep[] = [];
	for (const stage of stages) {
		const parsed = parseSegment(stage);
		const load = hostCommandFor(parsed.argv);
		const command = load
			? await load()
			: await byteToolFor(parsed.argv, cwd, deps.files);
		const previous = steps[steps.length - 1];
		if (command) steps.push({ kind: "host", parsed, command });
		else if (previous?.kind === "shell") previous.stages.push(stage);
		else steps.push({ kind: "shell", stages: [stage] });
	}

	let input: Uint8Array | undefined;
	let stdout = "";
	let stderr = "";
	let exitCode = 0;
	for (const [index, step] of steps.entries()) {
		const last = index === steps.length - 1;
		if (step.kind === "shell") {
			const line = withStatus(step.stages.join(" | "), status);
			if (input !== undefined && !deps.runShellWithInput) {
				const host = steps.find((each) => each.kind === "host");
				const name = host?.kind === "host" ? host.parsed.argv[0] : "it";
				return {
					stdout,
					stderr: `${stderr}${name}: pipes and input redirects are not supported for ${name} here; run it on its own\n`,
					exitCode: 2,
				};
			}
			const result =
				input === undefined
					? await deps.runShell(line, cwd)
					: await (
							deps.runShellWithInput as NonNullable<
								HostCommandLineDeps["runShellWithInput"]
							>
						)(line, cwd, decoder.decode(input));
			if (!result.completed) return result;
			stderr += result.stderr;
			exitCode = exitCodeOf(result);
			if (last) stdout = result.stdout;
			else input = encoder.encode(result.stdout);
			continue;
		}

		const { parsed, command } = step;
		const name = parsed.argv[0] as string;
		if (parsed.needsShell) {
			return {
				stdout,
				stderr: `${stderr}${name}: here-documents and process substitution are not supported for ${name}; use a file or a pipe\n`,
				exitCode: 2,
			};
		}
		let stdin = input;
		if (parsed.inputRedirect !== undefined) {
			const path = resolvePath(cwd, parsed.inputRedirect);
			if (
				!(await deps.files.exists(path)) ||
				(await deps.files.isDirectory(path))
			) {
				// As a shell does: the command does not run, the pipe goes on empty.
				stderr += `${parsed.inputRedirect}: No such file or directory\n`;
				exitCode = 1;
				input = new Uint8Array();
				continue;
			}
			stdin = await deps.files.read(path);
		}
		const output = await command(parsed.argv, {
			...deps,
			cwd,
			env: { ...request.env, ...parsed.env },
			timeoutMs: request.commandTimeoutMs,
			stdin,
			stdoutRedirected: !last || Boolean(parsed.redirect),
		});
		const routed = await applyRedirects(parsed, output, cwd, deps);
		stderr += routed.stderr;
		exitCode = output.exitCode;
		if (last) stdout = routed.stdout;
		else if (parsed.redirect) input = new Uint8Array();
		else if (parsed.mergeStderr) input = encoder.encode(routed.stdout);
		else input = output.stdoutBytes ?? encoder.encode(output.stdout);
	}
	return { stdout, stderr, exitCode };
};

/**
 * Runs a command line that uses a host command. Segments run one by one with
 * `&&`, `||` and `;` meaning what they do in a shell; `cd` carries over to
 * the next segment; everything that is not a host command still goes to the
 * sandbox shell.
 */
export const runHostCommandLine = async (
	request: SandboxExecuteCommandRequest,
	deps: HostCommandLineDeps,
): Promise<SandboxCommandResult> => {
	const startedAt = Date.now();
	let cwd = request.cwd ?? "/";
	let stdout = "";
	let stderr = "";
	let exitCode = 0;

	for (const segment of splitChain(request.command)) {
		if (segment.join === "&&" && exitCode !== 0) continue;
		if (segment.join === "||" && exitCode === 0) continue;
		const parsed = parseSegment(segment.text);
		const name = parsed.argv[0];

		if (name === "cd" && !parsed.needsShell) {
			const target = resolvePath(cwd, parsed.argv[1] ?? "/");
			if (await deps.files.isDirectory(target)) {
				cwd = target;
				exitCode = 0;
			} else {
				stderr += `cd: ${parsed.argv[1]}: No such file or directory\n`;
				exitCode = 1;
			}
			continue;
		}

		const stages = splitPipeline(segment.text);
		const result = stages.some((stage) => hostCommandOf(stage))
			? await runPipeline(stages, cwd, exitCode, request, deps)
			: // Each shell segment runs on its own: `$?` is filled in with the
				// line's last exit code, as the shell would have it.
				await deps.runShell(withStatus(segment.text, exitCode), cwd);
		// A server or watcher keeps running: hand its process back as is.
		if ("completed" in result && !result.completed) return result;
		stdout += result.stdout;
		stderr += result.stderr;
		exitCode = exitCodeOf(result);
	}

	return {
		commandId: `host-${crypto.randomUUID()}`,
		command: request.command,
		cwd: request.cwd ?? "/",
		status: exitCode === 0 ? "completed" : "failed",
		completed: true,
		stdout,
		stderr,
		nextOffset: 0,
		exitCode,
		startedAt,
		updatedAt: Date.now(),
	};
};
