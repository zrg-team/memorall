import type {
	SandboxCommandResult,
	SandboxExecuteCommandRequest,
} from "../types";
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

/**
 * Commands the sandbox shell cannot run itself, run on the host instead:
 * `git` needs binary-safe files, `py` (and `pip`, `zip`, `unzip`, which run
 * through it) needs Pyodide, and `curl` needs the network (and this
 * computer's servers) the way curl reaches them.
 */
const HOST_COMMANDS: Record<string, () => Promise<HostCommand>> = {
	curl: () => import("./curl-command").then((module) => module.runCurl),
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

const hostCommandOf = (segment: string) => {
	const name = parseSegment(segment).argv[0];
	return name && Object.hasOwn(HOST_COMMANDS, name) ? name : null;
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

		// A pipeline with one host command in it: the stages before it run in
		// the shell and feed its stdin, it runs here, and the stages after it
		// read what it printed, as a pipe would carry it.
		const stages = splitPipeline(segment.text);
		const hostAt = stages
			.map((stage, index) => (hostCommandOf(stage) ? index : -1))
			.filter((index) => index >= 0);
		if (stages.length > 1 && hostAt.length === 1) {
			const at = hostAt[0] as number;
			const stage = parseSegment(stages[at] as string);
			const command = await HOST_COMMANDS[stage.argv[0] as string]?.();
			const after = stages.slice(at + 1);
			if (
				command &&
				!stage.needsShell &&
				(after.length === 0 || deps.runShellWithInput)
			) {
				let input: Uint8Array | undefined;
				let beforeErr = "";
				if (at > 0) {
					const before = await deps.runShell(
						withStatus(stages.slice(0, at).join(" | "), exitCode),
						cwd,
					);
					if (!before.completed) return before;
					input = encoder.encode(before.stdout);
					beforeErr = before.stderr;
				}
				const output = await command(stage.argv, {
					...deps,
					cwd,
					env: { ...request.env, ...stage.env },
					timeoutMs: request.commandTimeoutMs,
					stdin: input,
					stdoutRedirected: after.length > 0 || Boolean(stage.redirect),
				});
				if (!after.length) {
					const routed = await applyRedirects(stage, output, cwd, deps);
					stdout += routed.stdout;
					stderr += beforeErr + routed.stderr;
					exitCode = output.exitCode;
					continue;
				}
				const result = await (
					deps.runShellWithInput as NonNullable<
						HostCommandLineDeps["runShellWithInput"]
					>
				)(withStatus(after.join(" | "), output.exitCode), cwd, output.stdout);
				if (!result.completed) return result;
				stdout += result.stdout;
				stderr += beforeErr + output.stderr + result.stderr;
				exitCode = result.exitCode ?? (result.status === "completed" ? 0 : 1);
				continue;
			}
		}

		const load =
			name && Object.hasOwn(HOST_COMMANDS, name) ? HOST_COMMANDS[name] : null;
		if (!load) {
			// Each shell segment runs on its own: `$?` is filled in with the
			// line's last exit code, as the shell would have it.
			const result = await deps.runShell(
				withStatus(segment.text, exitCode),
				cwd,
			);
			// A server or watcher keeps running: hand its process back as is.
			if (!result.completed) return result;
			stdout += result.stdout;
			stderr += result.stderr;
			exitCode = result.exitCode ?? (result.status === "completed" ? 0 : 1);
			continue;
		}
		if (parsed.needsShell) {
			stderr += `${name}: pipes and input redirects are not supported for ${name}; run it on its own\n`;
			exitCode = 2;
			continue;
		}

		const command = await load();
		const output = await command(parsed.argv, {
			...deps,
			cwd,
			env: { ...request.env, ...parsed.env },
			timeoutMs: request.commandTimeoutMs,
			stdoutRedirected: Boolean(parsed.redirect),
		});
		const routed = await applyRedirects(parsed, output, cwd, deps);
		stdout += routed.stdout;
		stderr += routed.stderr;
		exitCode = output.exitCode;
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
