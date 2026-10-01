import type { SandboxPythonFile } from "../types";
import { resolvePath } from "./command-line";
import type { HostCommand } from "./types";

/**
 * `py` (also `python`, `python3`): Pyodide with the standard library, run in
 * the sandbox page. The working directory's files go in with each run and
 * whatever the script creates or changes there comes back, byte for byte.
 */

const SKIP_DIRS: ReadonlySet<string> = new Set([
	"node_modules",
	".git",
	"__pycache__",
	".venv",
]);
const MAX_FILES = 400;
const MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const USAGE = 'usage: py file.py [args] | py -c "code" | py -m module [args]';

const fail = (message: string, exitCode = 2) => ({
	stdout: "",
	stderr: `${message}\n`,
	exitCode,
});

export const runPython: HostCommand = async (argv, context) => {
	const args = argv.slice(1);
	const { cwd } = context;
	if (!args.length) {
		return fail(`py: interactive Python is not available here.\n${USAGE}`);
	}

	let mode: "file" | "code" | "module";
	let target: string;
	let scriptArgv: string[];
	if (args[0] === "--version" || args[0] === "-V") {
		mode = "code";
		target = "import sys; print('Python ' + sys.version.split()[0])";
		scriptArgv = ["-c"];
	} else if (args[0] === "-c") {
		mode = "code";
		target = args[1] ?? "";
		scriptArgv = ["-c", ...args.slice(2)];
	} else if (args[0] === "-m") {
		if (!args[1]) return fail(`py: -m needs a module name.\n${USAGE}`);
		if (args[1] === "pip" || args[1] === "ensurepip") {
			return fail(
				"py: pip is not available; only Python's standard library is bundled.",
				1,
			);
		}
		mode = "module";
		target = args[1];
		scriptArgv = [args[1], ...args.slice(2)];
	} else if (args[0].startsWith("-")) {
		return fail(`py: option ${args[0]} is not supported.\n${USAGE}`);
	} else {
		mode = "file";
		target = resolvePath(cwd, args[0]);
		scriptArgv = [target, ...args.slice(1)];
		if (!(await context.files.exists(target))) {
			return fail(
				`py: can't open file '${args[0]}': [Errno 2] No such file or directory`,
			);
		}
	}

	const { files: entries, truncated } = await context.files.walk(cwd, {
		skipDirs: SKIP_DIRS,
		maxFiles: MAX_FILES,
		maxBytes: MAX_BYTES,
	});
	const paths = new Set(entries.map((entry) => entry.path));
	if (mode === "file") paths.add(target);
	const files: SandboxPythonFile[] = await Promise.all(
		[...paths].map(async (path) => ({
			path,
			data: await context.files.read(path),
		})),
	);

	const result = await context.runPython({
		mode,
		target,
		argv: scriptArgv,
		cwd,
		files,
		timeoutMs: context.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	});

	for (const file of result.changed) {
		await context.files.write(file.path, file.data);
	}
	for (const path of result.deleted) {
		await context.files.remove(path).catch(() => undefined);
	}
	if (result.changed.length || result.deleted.length) context.filesChanged();

	const note = truncated
		? `py: only the first ${files.length} files under ${cwd} were available to the script\n`
		: "";
	return {
		stdout: result.stdout,
		stderr: note + result.stderr,
		exitCode: result.exitCode,
	};
};
