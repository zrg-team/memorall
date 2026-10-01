import { sandboxAssetUrl } from "./shared.js";

/**
 * The `py` command's interpreter: Pyodide in a worker, so a runaway script can
 * be stopped without freezing the sandbox. The host sends the files under the
 * working directory with each run and gets back what the script changed;
 * Pyodide's own filesystem never persists between runs.
 */

const DEFAULT_TIMEOUT_MS = 60_000;
// Pyodide's own directories; user files with these roots are not synced.
const SYSTEM_ROOTS = ["/lib", "/dev", "/proc", "/sys", "/tmp", "/home/pyodide"];

const RUNNER = [
	"import os, sys, runpy, traceback",
	"def __memorall_run(mode, target, argv, cwd):",
	"    os.makedirs(cwd, exist_ok=True)",
	"    os.chdir(cwd)",
	"    sys.argv = list(argv)",
	"    code = 0",
	"    try:",
	"        if mode == 'code':",
	"            exec(compile(target, '<string>', 'exec'), {'__name__': '__main__'})",
	"        elif mode == 'module':",
	"            runpy.run_module(target, run_name='__main__', alter_sys=True)",
	"        else:",
	"            runpy.run_path(target, run_name='__main__')",
	"    except SystemExit as error:",
	"        if error.code is None:",
	"            code = 0",
	"        elif isinstance(error.code, int):",
	"            code = error.code",
	"        else:",
	"            print(error.code, file=sys.stderr)",
	"            code = 1",
	"    except BaseException:",
	"        traceback.print_exc()",
	"        code = 1",
	"    finally:",
	"        sys.stdout.flush()",
	"        sys.stderr.flush()",
	"    return code",
].join("\n");

const workerSource = () => {
	const loaderUrl = sandboxAssetUrl("vendors/pyodide/pyodide.js");
	const indexUrl = sandboxAssetUrl("vendors/pyodide/");
	return `
importScripts(${JSON.stringify(loaderUrl)});
const SYSTEM_ROOTS = ${JSON.stringify(SYSTEM_ROOTS)};
let ready = null;
const load = () => {
	ready ??= loadPyodide({ indexURL: ${JSON.stringify(indexUrl)} }).then((py) => {
		py.runPython(${JSON.stringify(RUNNER)});
		return py;
	});
	return ready;
};
const isSystemPath = (path) =>
	SYSTEM_ROOTS.some((root) => path === root || path.startsWith(root + "/"));
const join = (dir, name) => (dir === "/" ? "/" + name : dir + "/" + name);
const walk = (FS, dir, out) => {
	let names;
	try { names = FS.readdir(dir); } catch { return; }
	for (const name of names) {
		if (name === "." || name === "..") continue;
		const path = join(dir, name);
		if (isSystemPath(path)) continue;
		const stat = FS.stat(path);
		if (FS.isDir(stat.mode)) {
			if (name === "node_modules" || name === ".git" || name === "__pycache__") continue;
			walk(FS, path, out);
		} else if (FS.isFile(stat.mode)) {
			out.push(path);
		}
	}
};
const sameBytes = (a, b) => {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
	return true;
};
let synced = [];
self.onmessage = async (event) => {
	const { id, mode, target, argv, cwd, files } = event.data;
	const stdout = [];
	const stderr = [];
	try {
		const py = await load();
		const FS = py.FS;
		py.setStdout({ batched: (text) => stdout.push(text + "\\n") });
		py.setStderr({ batched: (text) => stderr.push(text + "\\n") });
		py.setStdin({ error: true });
		for (const path of synced) {
			try { FS.unlink(path); } catch {}
		}
		const before = new Map();
		for (const file of files) {
			if (isSystemPath(file.path)) continue;
			FS.mkdirTree(file.path.slice(0, file.path.lastIndexOf("/")) || "/");
			FS.writeFile(file.path, file.data);
			before.set(file.path, file.data);
		}
		FS.mkdirTree(cwd);
		const run = py.globals.get("__memorall_run");
		const exitCode = run(mode, target, py.toPy(argv), cwd);
		run.destroy();
		const after = [];
		walk(FS, cwd, after);
		const changed = [];
		for (const path of after) {
			const data = FS.readFile(path);
			const previous = before.get(path);
			if (!previous || !sameBytes(previous, data)) changed.push({ path, data });
		}
		const present = new Set(after);
		const deleted = [...before.keys()].filter((path) => !present.has(path));
		synced = after;
		self.postMessage({ id, exitCode, stdout: stdout.join(""), stderr: stderr.join(""), changed, deleted });
	} catch (error) {
		self.postMessage({
			id,
			exitCode: 1,
			stdout: stdout.join(""),
			stderr: stderr.join("") + String(error && error.message ? error.message : error) + "\\n",
			changed: [],
			deleted: [],
		});
	}
};
`;
};

let worker = null;
let nextId = 0;

const startWorker = () => {
	const url = URL.createObjectURL(
		new Blob([workerSource()], { type: "text/javascript" }),
	);
	worker = new Worker(url);
	URL.revokeObjectURL(url);
	return worker;
};

/** Runs one py invocation; the payload carries the working tree's files. */
export const runPythonOperation = (payload = {}) => {
	const timeoutMs = Number.isFinite(payload.timeoutMs)
		? payload.timeoutMs
		: DEFAULT_TIMEOUT_MS;
	const active = worker ?? startWorker();
	const id = ++nextId;
	return new Promise((resolve) => {
		const finish = (result) => {
			clearTimeout(timer);
			active.removeEventListener("message", onMessage);
			resolve(result);
		};
		const onMessage = (event) => {
			if (event.data?.id === id) finish(event.data);
		};
		const timer = setTimeout(() => {
			// The script is still running: drop the interpreter and start fresh
			// next time.
			active.terminate();
			if (worker === active) worker = null;
			finish({
				id,
				exitCode: 124,
				stdout: "",
				stderr: `py: stopped after ${Math.round(timeoutMs / 1000)}s\n`,
				changed: [],
				deleted: [],
			});
		}, timeoutMs);
		active.addEventListener("message", onMessage);
		active.postMessage({
			id,
			mode: payload.mode,
			target: payload.target,
			argv: payload.argv ?? [],
			cwd: payload.cwd ?? "/",
			files: payload.files ?? [],
		});
	});
};
