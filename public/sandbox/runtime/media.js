import { sandboxAssetUrl } from "./shared.js";

/**
 * The engines of the `ffmpeg`/`ffprobe` and `magick` commands: FFmpeg.wasm
 * (@ffmpeg/core, one thread) and ImageMagick (magick-wasm), each in a worker
 * of its own so a long job can be stopped without freezing the sandbox. The
 * host sends the files a command line names with each run and gets back the
 * files it wrote. Both ship with the extension (tools/copy-bundled-assets.mjs),
 * with Liberation Sans for text; nothing is fetched from the web.
 */

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const FONTS = {
	LiberationSans: "vendors/fonts/LiberationSans-Regular.ttf",
	"LiberationSans-Bold": "vendors/fonts/LiberationSans-Bold.ttf",
};

const fontUrls = () =>
	Object.fromEntries(
		Object.entries(FONTS).map(([name, path]) => [name, sandboxAssetUrl(path)]),
	);

const ffmpegWorkerSource = () => {
	const coreUrl = sandboxAssetUrl("vendors/ffmpeg/ffmpeg-core.js");
	const wasmUrl = sandboxAssetUrl("vendors/ffmpeg/ffmpeg-core.wasm");
	return `
importScripts(${JSON.stringify(coreUrl)});
const CORE_URL = ${JSON.stringify(coreUrl)};
const WASM_URL = ${JSON.stringify(wasmUrl)};
const FONTS = ${JSON.stringify(Object.values(fontUrls()))};
// FFmpeg's own directories and the fonts: never sent back as the user's files.
const SYSTEM_ROOTS = ["/dev", "/proc", "/sys", "/tmp", "/home/web_user", "/usr"];
const FONT_DIR = "/usr/share/fonts";
const isSystemPath = (path) =>
	SYSTEM_ROOTS.some((root) => path === root || path.startsWith(root + "/"));
const join = (dir, name) => (dir === "/" ? "/" + name : dir + "/" + name);
const mkdirp = (FS, dir) => {
	let path = "";
	for (const part of dir.split("/").filter(Boolean)) {
		path += "/" + part;
		try { FS.mkdir(path); } catch {}
	}
};
const walk = (FS, dir, out) => {
	let names;
	try { names = FS.readdir(dir); } catch { return; }
	for (const name of names) {
		if (name === "." || name === "..") continue;
		const path = join(dir, name);
		if (isSystemPath(path)) continue;
		const stat = FS.stat(path);
		if (FS.isDir(stat.mode)) walk(FS, path, out);
		else if (FS.isFile(stat.mode)) out.push(path);
	}
};
const stamp = (FS, path) => {
	const stat = FS.stat(path);
	return stat.size + ":" + Number(stat.mtime);
};
// The core's ffprobe() reports only what exit() set, and ffprobe returns
// from main when it succeeds: its own return code says how it went.
const runFfprobe = (core, args) => {
	const argv = ["./ffprobe", ...args];
	let code = 1;
	try {
		code = core._ffprobe(argv.length, core.stringsToPtr(argv));
	} catch (error) {
		if (!String(error && error.message).startsWith("Aborted")) throw error;
	}
	return core.ret !== -1 ? core.ret : code;
};
// The wasm is compiled once; each run gets an instance of its own, so nothing
// (memory, files, FFmpeg's log state) carries from one command to the next.
let shared = null;
const loadShared = () => {
	shared ??= Promise.all([
		fetch(WASM_URL).then((response) => {
			if (!response.ok) throw new Error("could not load " + WASM_URL);
			return WebAssembly.compileStreaming(response);
		}),
		Promise.all(
			FONTS.map(async (url) => [
				url.slice(url.lastIndexOf("/") + 1),
				new Uint8Array(await (await fetch(url)).arrayBuffer()),
			]),
		),
	]);
	shared.catch(() => { shared = null; });
	return shared;
};
const newCore = async () => {
	const [module, fonts] = await loadShared();
	const core = await self.createFFmpegCore({
		// The core finds its wasm through this, as @ffmpeg/ffmpeg's worker does.
		mainScriptUrlOrBlob: CORE_URL + "#" + btoa(JSON.stringify({ wasmURL: WASM_URL, workerURL: "" })),
		instantiateWasm: (imports, done) => {
			WebAssembly.instantiate(module, imports).then((instance) => done(instance, module));
			return {};
		},
	});
	mkdirp(core.FS, FONT_DIR);
	for (const [name, data] of fonts) core.FS.writeFile(FONT_DIR + "/" + name, data);
	return core;
};
self.onmessage = async (event) => {
	const { id, argv, cwd, files, dirs, stdin, stdinPath, stdoutPath } = event.data;
	const stdout = [];
	const stderr = [];
	let core;
	try {
		core = await newCore();
	} catch (error) {
		self.postMessage({ id, exitCode: 1, stdout: new Uint8Array(), stderr: "ffmpeg: FFmpeg.wasm did not load: " + (error && error.message ? error.message : error) + "\\n", changed: [], fatal: true });
		return;
	}
	const FS = core.FS;
	core.setLogger(({ type, message }) => {
		// How the core stops on an error, not FFmpeg's own words.
		if (message === "Aborted()") return;
		(type === "stdout" ? stdout : stderr).push(message);
	});
	const before = new Map();
	try {
		for (const dir of dirs) mkdirp(FS, dir);
		mkdirp(FS, cwd);
		mkdirp(FS, "/tmp");
		for (const file of files) {
			mkdirp(FS, file.path.slice(0, file.path.lastIndexOf("/")) || "/");
			FS.writeFile(file.path, file.data);
			before.set(file.path, stamp(FS, file.path));
		}
		if (stdinPath) FS.writeFile(stdinPath, stdin || new Uint8Array());
		FS.chdir(cwd);
		const tool = argv[0];
		const exitCode = tool === "ffprobe" ? runFfprobe(core, argv.slice(1)) : core.exec(...argv.slice(1));
		const after = [];
		walk(FS, "/", after);
		const changed = [];
		for (const path of after) {
			if (before.get(path) !== stamp(FS, path)) changed.push({ path, data: FS.readFile(path) });
		}
		let out = new TextEncoder().encode(stdout.length ? stdout.join("\\n") + "\\n" : "");
		if (stdoutPath) {
			try { out = FS.readFile(stdoutPath); } catch {}
		}
		const transfer = [...new Set([out.buffer, ...changed.map((file) => file.data.buffer)])];
		self.postMessage({ id, exitCode, stdout: out, stderr: stderr.join("\\n") + (stderr.length ? "\\n" : ""), changed }, transfer);
	} catch (error) {
		// Something outside FFmpeg failed: the page starts a new worker.
		self.postMessage({
			id,
			exitCode: 1,
			stdout: new TextEncoder().encode(stdout.join("\\n")),
			stderr: stderr.join("\\n") + "\\nffmpeg: " + (error && error.message ? error.message : error) + "\\n",
			changed: [],
			fatal: true,
		});
	}
};
`;
};

const magickWorkerSource = () => `
self.MEMORALL_MAGICK_ASSETS = ${JSON.stringify({
	wasmUrl: sandboxAssetUrl("vendors/magick/magick.wasm"),
	fonts: fontUrls(),
})};
importScripts(${JSON.stringify(sandboxAssetUrl("vendors/magick/magick-worker.js"))});
`;

const SOURCES = { ffmpeg: ffmpegWorkerSource, magick: magickWorkerSource };
const workers = new Map();
let nextId = 0;

const startWorker = (engine) => {
	const url = URL.createObjectURL(
		new Blob([SOURCES[engine]()], { type: "text/javascript" }),
	);
	const worker = new Worker(url);
	URL.revokeObjectURL(url);
	workers.set(engine, worker);
	return worker;
};

const stopWorker = (engine, worker) => {
	worker.terminate();
	if (workers.get(engine) === worker) workers.delete(engine);
};

/** Runs one ffmpeg, ffprobe or magick command line on the files it names. */
export const runMediaOperation = (payload = {}) => {
	const engine = payload.engine === "magick" ? "magick" : "ffmpeg";
	const argv = payload.argv ?? [engine];
	const timeoutMs = Number.isFinite(payload.timeoutMs)
		? payload.timeoutMs
		: DEFAULT_TIMEOUT_MS;
	const worker = workers.get(engine) ?? startWorker(engine);
	const id = ++nextId;
	return new Promise((resolve) => {
		const finish = (result) => {
			clearTimeout(timer);
			worker.removeEventListener("message", onMessage);
			worker.removeEventListener("error", onError);
			resolve(result);
		};
		const onMessage = (event) => {
			if (event.data?.id !== id) return;
			if (event.data.fatal) stopWorker(engine, worker);
			const { fatal: _fatal, ...result } = event.data;
			finish(result);
		};
		const onError = (event) => {
			stopWorker(engine, worker);
			finish({
				id,
				exitCode: 1,
				stdout: new Uint8Array(),
				stderr: `${argv[0]}: ${event.message || "the engine stopped"}\n`,
				changed: [],
			});
		};
		const timer = setTimeout(() => {
			// Still working: drop the engine and load it fresh next time.
			stopWorker(engine, worker);
			finish({
				id,
				exitCode: 124,
				stdout: new Uint8Array(),
				stderr: `${argv[0]}: stopped after ${Math.round(timeoutMs / 1000)}s\n`,
				changed: [],
			});
		}, timeoutMs);
		worker.addEventListener("message", onMessage);
		worker.addEventListener("error", onError);
		const files = payload.files ?? [];
		worker.postMessage(
			{
				id,
				argv,
				cwd: payload.cwd ?? "/",
				files,
				dirs: payload.dirs ?? [],
				stdin: payload.stdin,
				stdinPath: payload.stdinPath,
				stdoutPath: payload.stdoutPath,
			},
			[...new Set(files.map((file) => file.data.buffer))],
		);
	});
};
