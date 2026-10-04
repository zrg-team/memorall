import { sandboxAssetUrl } from "./shared.js";

/**
 * The `py` command's interpreter: Pyodide in a worker, so a runaway script can
 * be stopped without freezing the sandbox. The host sends the files under the
 * working directory with each run and gets back what the script changed;
 * Pyodide's own filesystem never persists between runs. The packages bundled
 * next to it (see tools/pyodide-packages.mjs) load when a run imports them.
 */

const DEFAULT_TIMEOUT_MS = 60_000;
// Pyodide's own directories; user files with these roots are not synced.
const SYSTEM_ROOTS = ["/lib", "/dev", "/proc", "/sys", "/tmp", "/home/pyodide"];

const RUNNER = [
	"import os, sys, runpy, traceback",
	// A worker has no page to draw on: charts are saved to files (savefig).
	"os.environ.setdefault('MPLBACKEND', 'Agg')",
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
// WebGL packages (zengl) draw on the page's canvas, found through window and
// document; a worker has neither, so they get an OffscreenCanvas under those
// names. Set after Pyodide has loaded, so its own environment check is not
// misled into seeing a page.
const NO_WEBGL2 =
	"WebGL2 is not available here (no GPU access, or WebGL is turned off in this browser), so nothing can render with it.";
const offerOffscreenCanvas = () => {
	if (typeof OffscreenCanvas === "undefined") return;
	const createCanvas = () => {
		const canvas = new OffscreenCanvas(512, 512);
		const getContext = canvas.getContext.bind(canvas);
		// Without this a missing context comes back as nothing, and the package
		// fails later with an error that does not say why.
		canvas.getContext = (type, options) => {
			const context = getContext(type, options);
			if (!context && type === "webgl2") throw new Error(NO_WEBGL2);
			return context;
		};
		return canvas;
	};
	let canvas = null;
	self.window ??= self;
	self.document ??= {
		getElementById: (id) => (id === "canvas" ? (canvas ??= createCanvas()) : null),
		createElement: (tag) => (tag === "canvas" ? createCanvas() : null),
		body: { appendChild: () => undefined },
	};
};
let ready = null;
const load = () => {
	ready ??= loadPyodide({ indexURL: ${JSON.stringify(indexUrl)} }).then((py) => {
		offerOffscreenCanvas();
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
const decoder = new TextDecoder();
// The bundled packages a run imports load before it runs; the lock file lists
// only those, so any other import fails as "No module named ...".
const loadImports = async (py, mode, target, files, stderr) => {
	const sources = mode === "code" ? [target] : mode === "module" ? ["import " + target] : [];
	for (const file of files) {
		if (file.path.endsWith(".py")) sources.push(decoder.decode(file.data));
	}
	for (const source of sources) {
		try {
			await py.loadPackagesFromImports(source, {
				messageCallback: () => {},
				errorCallback: (text) => stderr.push(text + "\\n"),
			});
		} catch {
			// A file that does not parse: running it says so.
		}
	}
};
// Which bundled package a module belongs to, from the lock file shipped with them.
let moduleIndex = null;
const packageOfModule = async (name) => {
	moduleIndex ??= fetch(${JSON.stringify(`${indexUrl}pyodide-lock.json`)})
		.then((response) => response.json())
		.then((lock) => {
			const index = new Map();
			for (const [name, entry] of Object.entries(lock.packages ?? {})) {
				for (const module of entry.imports ?? []) index.set(module, name);
			}
			return index;
		})
		.catch(() => new Map());
	return (await moduleIndex).get(name);
};
const MISSING_MODULE = /No module named '([^'.]+)/;
const MAX_LAZY_LOADS = 6;
const execute = (py, mode, target, argv, cwd) => {
	const run = py.globals.get("__memorall_run");
	try {
		return run(mode, target, py.toPy(argv), cwd);
	} finally {
		run.destroy();
	}
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
		const before = new Map();
		// The working tree as the host sent it: before the run, and again
		// before a retry, so the second run starts where the first did.
		const restore = () => {
			const leftovers = [];
			walk(FS, cwd, leftovers);
			for (const path of [...synced, ...leftovers]) {
				try { FS.unlink(path); } catch {}
			}
			for (const file of files) {
				if (isSystemPath(file.path)) continue;
				FS.mkdirTree(file.path.slice(0, file.path.lastIndexOf("/")) || "/");
				FS.writeFile(file.path, file.data);
				before.set(file.path, file.data);
			}
			FS.mkdirTree(cwd);
		};
		restore();
		await loadImports(py, mode, target, files, stderr);
		let exitCode = execute(py, mode, target, argv, cwd);
		// A bundled package imported lazily (pandas's Excel reader, a converter
		// document_html picks per file) is not among the script's imports:
		// load it and run again, as long as each run finds a new one.
		for (let round = 0; exitCode !== 0 && round < MAX_LAZY_LOADS; round += 1) {
			const missing = MISSING_MODULE.exec(stderr.join(""));
			const lazy = missing ? await packageOfModule(missing[1]) : undefined;
			if (!lazy || lazy in py.loadedPackages) break;
			await py.loadPackage(lazy, { messageCallback: () => {} });
			stdout.length = 0;
			stderr.length = 0;
			restore();
			exitCode = execute(py, mode, target, argv, cwd);
		}
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
