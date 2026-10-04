import {
	BUNDLED_PYTHON_PACKAGES,
	BUNDLED_PYTHON_SUMMARY,
	BUNDLED_PYTHON_USAGE,
	type PythonPackageUsage,
	pythonPackageUsage,
} from "../python-packages";
import type { SandboxPythonFile } from "../types";
import { resolvePath } from "./command-line";
import type { HostCommand } from "./types";

/**
 * `py` (also `python`, `python3`): Pyodide with the standard library and the
 * bundled packages (`python-packages.json`), run in the sandbox page. A
 * script's imports of those load on their own. The working directory's files
 * go in with each run and whatever the script creates or changes there comes
 * back, byte for byte.
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

/** What there is, for a script or a pip that asked for something else. */
const AVAILABLE = `only the standard library and ${BUNDLED_PYTHON_SUMMARY} are available, and packages cannot be installed here`;

/** Python's own wording, or pandas' for an optional reader ("openpyxl"). */
const MISSING_MODULE =
	/(?:ModuleNotFoundError: No module named|Missing optional dependency) '([^'.]+)/;

/** A requirement's package name: "pandas>=2" → "pandas". */
const requirementName = (requirement: string): string =>
	requirement
		.split(/[<>=!~;[\s]/)[0]
		.trim()
		.toLowerCase()
		.replace(/_/g, "-");

/** The top-level modules a script imports: "import a.b, c" → a, c; "from d import e" → d. */
export const importedModules = (source: string): Set<string> => {
	const modules = new Set<string>();
	for (const [, from, names] of source.matchAll(
		/^\s*(?:from\s+([A-Za-z_]\w*)[\w.]*\s+import\b|import\s+([^\n#;]+))/gm,
	)) {
		if (from) modules.add(from);
		for (const name of names?.split(",") ?? []) {
			const module = /^\s*([A-Za-z_]\w*)/.exec(name)?.[1];
			if (module) modules.add(module);
		}
	}
	return modules;
};

/**
 * How the packages a failed run imported work here, for those that differ
 * from their usual docs: an agent that guessed from those docs gets the
 * right way next to the error it hit.
 */
const usageAfterFailure = (source: string): string => {
	const imported = importedModules(source);
	return BUNDLED_PYTHON_USAGE.filter((usage) =>
		usage.imports.some((module) => imported.has(module)),
	)
		.map((usage) => `py: ${usage.name} here: ${usage.note}\n`)
		.join("");
};

const showPackage = (name: string, usage: PythonPackageUsage | undefined) =>
	[
		`Name: ${name}`,
		"Location: bundled with py",
		...(usage
			? [`Imports: ${usage.imports.join(", ")}`, `Here: ${usage.note}`]
			: []),
	].join("\n");

/**
 * `pip` (also `pip3`): nothing can be installed, but a bundled package needs
 * no install. Saying so lets a script that starts with `pip install numpy`
 * go on, and tells it plainly when it asked for something that is not here.
 */
export const runPip: HostCommand = async (argv) => {
	const [subcommand, ...rest] = argv.slice(1);
	const bundled = new Set(BUNDLED_PYTHON_PACKAGES);
	if (subcommand === "list" || subcommand === "freeze") {
		return {
			stdout: `${[...bundled].join("\n")}\n`,
			stderr: "",
			exitCode: 0,
		};
	}
	if (subcommand === "show") {
		const names = rest.filter((arg) => !arg.startsWith("-"));
		const found = names.flatMap((name) => {
			const key = requirementName(name);
			const usage = pythonPackageUsage(name);
			return bundled.has(key) || usage
				? [showPackage(usage?.name ?? key, usage)]
				: [];
		});
		const unknown = names.filter(
			(name) =>
				!bundled.has(requirementName(name)) && !pythonPackageUsage(name),
		);
		return {
			stdout: found.length ? `${found.join("\n---\n")}\n` : "",
			stderr: unknown.length
				? `WARNING: Package(s) not found: ${unknown.join(", ")}\n`
				: "",
			exitCode: found.length && !unknown.length ? 0 : 1,
		};
	}
	if (subcommand !== "install") {
		return fail(`pip: ${AVAILABLE}.`, 1);
	}
	const wanted = rest
		.filter((arg) => !arg.startsWith("-"))
		.map(requirementName)
		.filter(Boolean);
	const missing = wanted.filter((name) => !bundled.has(name));
	if (!wanted.length || missing.length) {
		return fail(
			`pip: cannot install ${missing.join(", ") || "packages"}: ${AVAILABLE}.`,
			1,
		);
	}
	return {
		stdout: wanted
			.map((name) => `Requirement already satisfied: ${name} (bundled with py)`)
			.join("\n")
			.concat("\n"),
		stderr: "",
		exitCode: 0,
	};
};

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
		if (args[1] === "pip") return runPip(["pip", ...args.slice(2)], context);
		if (args[1] === "ensurepip") return fail(`py: ${AVAILABLE}.`, 1);
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
	const failed = result.exitCode !== 0;
	const missing = failed && MISSING_MODULE.exec(result.stderr);
	const decoder = new TextDecoder();
	const script =
		mode === "code"
			? target
			: mode === "module"
				? `import ${target}`
				: decoder.decode(
						files.find((file) => file.path === target)?.data ??
							new Uint8Array(),
					);
	const hint = missing
		? `py: no module '${missing[1]}': ${AVAILABLE}.\n`
		: failed
			? usageAfterFailure(script)
			: "";
	return {
		stdout: result.stdout,
		stderr: note + result.stderr + hint,
		exitCode: result.exitCode,
	};
};

/** Flags zip and unzip take that change nothing here (zipfile recurses and overwrites). */
const IGNORED_ARCHIVE_FLAG = /^-[rqoyX]+$/;

/**
 * `zip`: the shell has tar and gzip but no zip, so it is Python's zipfile.
 * `zip [-r] out.zip FILE_OR_DIR...` (folders go in whole).
 */
export const runZip: HostCommand = async (argv, context) => {
	const args = argv.slice(1).filter((arg) => !IGNORED_ARCHIVE_FLAG.test(arg));
	const [archive, ...paths] = args;
	if (!archive || !paths.length) {
		return fail("usage: zip [-r] archive.zip FILE_OR_DIR...", 1);
	}
	const target = archive.toLowerCase().endsWith(".zip")
		? archive
		: `${archive}.zip`;
	return runPython(["py", "-m", "zipfile", "-c", target, ...paths], context);
};

/**
 * `unzip`, the same way: `unzip a.zip [-d dir]` extracts (over what is there),
 * `unzip -l a.zip` lists.
 */
export const runUnzip: HostCommand = async (argv, context) => {
	const args = argv.slice(1);
	const list = args.includes("-l");
	const destinationIndex = args.indexOf("-d");
	const destination =
		destinationIndex >= 0 ? args[destinationIndex + 1] : undefined;
	const archive = args.find(
		(arg, index) =>
			!arg.startsWith("-") &&
			!(destinationIndex >= 0 && index === destinationIndex + 1),
	);
	if (!archive || (destinationIndex >= 0 && !destination)) {
		return fail("usage: unzip [-l] archive.zip [-d dir]", 1);
	}
	return runPython(
		list
			? ["py", "-m", "zipfile", "-l", archive]
			: ["py", "-m", "zipfile", "-e", archive, destination ?? "."],
		context,
	);
};
