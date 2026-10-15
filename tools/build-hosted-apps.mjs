#!/usr/bin/env node
/**
 * Builds the hosted apps (tools/hosted-apps/apps.mjs) into
 * public/vendors/apps/<id>/: the app's page, which Files and MemonOS frame,
 * and engine/engine.js, which the agent's tools load to read and change files.
 *
 *   node tools/build-hosted-apps.mjs              build what changed
 *   node tools/build-hosted-apps.mjs --force      rebuild every app
 *   node tools/build-hosted-apps.mjs --only pdf,whiteboard
 *   node tools/build-hosted-apps.mjs --optional   warn instead of failing (offline dev)
 *
 * Steps per app: fetch the pinned upstream commit (sparse, once), copy the app
 * into a work folder, add the host files and the engine, apply the source
 * edits, move inline scripts to files and drop remote ones (MV3 runs no
 * remote or inline code), `npm ci`, build the page and the engine with the
 * app's own Vite, prune what the host never uses, audit for remote code, and
 * publish. A build is cached by a key of everything that goes into it, so an
 * unchanged app is not built again.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DIST_REWRITES,
	HIDE_EVERYWHERE,
	HOST_NAME_REWRITE,
	HOSTED_APP_BUILDS,
	HOSTED_APPS_SOURCE,
} from "./hosted-apps/apps.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL_DIR = join(ROOT, "tools", "hosted-apps");
const CACHE = join(ROOT, "node_modules", ".cache", "memorall-hosted-apps");
const OUTPUT = join(ROOT, "public", "vendors", "apps");
const WINDOWS = process.platform === "win32";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const only = (() => {
	const at = args.indexOf("--only");
	return at >= 0 && args[at + 1]
		? new Set(args[at + 1].split(",").map((id) => id.trim()))
		: null;
})();
const FORCE = flag("force");
const OPTIONAL = flag("optional");

const log = (message) => console.log(`[hosted-apps] ${message}`);

const run = (command, commandArgs, options = {}) => {
	const result = spawnSync(command, commandArgs, {
		stdio: options.quiet ? "pipe" : "inherit",
		encoding: "utf8",
		shell: WINDOWS && /^(npm|npx)$/.test(command),
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${commandArgs.join(" ")} failed (${result.status})${result.stderr ? `:\n${result.stderr}` : ""}`,
		);
	}
	return result.stdout ?? "";
};

const sha = (...parts) => {
	const hash = createHash("sha256");
	for (const part of parts) hash.update(part);
	return hash.digest("hex");
};

const walkFiles = (directory) => {
	if (!existsSync(directory)) return [];
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...walkFiles(path));
		else files.push(path);
	}
	return files.sort();
};

/** Everything that decides how an app builds: a new value rebuilds it. */
const buildKey = (app) =>
	sha(
		HOSTED_APPS_SOURCE.commit,
		JSON.stringify(app),
		JSON.stringify(DIST_REWRITES),
		readFileSync(fileURLToPath(import.meta.url)),
		...walkFiles(TOOL_DIR).flatMap((file) => [
			relative(TOOL_DIR, file).replaceAll("\\", "/"),
			readFileSync(file),
		]),
	).slice(0, 24);

// ─── Source ──────────────────────────────────────────────────────────────────

const SOURCE = join(CACHE, `source-${HOSTED_APPS_SOURCE.commit.slice(0, 12)}`);

/**
 * The pinned commit, only the apps' folders: the upstream repo holds 51 apps
 * and half a gigabyte of committed audit builds this never needs.
 */
const fetchSource = () => {
	const marker = join(SOURCE, ".memorall-complete");
	if (existsSync(marker)) return;
	log(`fetching ${HOSTED_APPS_SOURCE.repository} @ ${HOSTED_APPS_SOURCE.commit.slice(0, 12)}`);
	rmSync(SOURCE, { recursive: true, force: true });
	mkdirSync(SOURCE, { recursive: true });
	const git = (...gitArgs) => run("git", ["-C", SOURCE, ...gitArgs]);
	git("init", "--quiet");
	git("config", "core.longpaths", "true");
	git("config", "core.autocrlf", "false");
	git("remote", "add", "origin", HOSTED_APPS_SOURCE.repository);
	const patterns = ["/LICENSE", "/dev/"];
	for (const app of HOSTED_APP_BUILDS) {
		patterns.push(`/${app.path}/`);
		for (const skip of ["tests", "e2e", "tmp", "store", "node_modules"])
			patterns.push(`!/${app.path}/${skip}/`);
	}
	git("sparse-checkout", "set", "--no-cone", ...patterns);
	git(
		"fetch",
		"--quiet",
		"--depth",
		"1",
		"--filter=blob:none",
		"origin",
		HOSTED_APPS_SOURCE.commit,
	);
	git("checkout", "--quiet", "FETCH_HEAD");
	writeFileSync(marker, HOSTED_APPS_SOURCE.commit);
};

// ─── Work folder ─────────────────────────────────────────────────────────────

const WORK = join(CACHE, "work");

/** The app's source, fresh, beside its installed packages from last time. */
const prepareWorkFolder = (app) => {
	const work = join(WORK, app.path);
	mkdirSync(work, { recursive: true });
	for (const entry of readdirSync(work)) {
		if (entry !== "node_modules") rmSync(join(work, entry), { recursive: true, force: true });
	}
	const from = join(SOURCE, app.path);
	cpSync(from, work, {
		recursive: true,
		// Relative: the cache itself sits under Memorall's node_modules.
		filter: (source) => !/(^|[\\/])node_modules([\\/]|$)/.test(relative(from, source)),
	});
	// Each app's vite.config imports ../../dev/puter-localhost.mjs.
	rmSync(join(WORK, "dev"), { recursive: true, force: true });
	cpSync(join(SOURCE, "dev"), join(WORK, "dev"), { recursive: true });
	return work;
};

const install = (app, work) => {
	const lock = join(work, "package-lock.json");
	const patches = walkFiles(join(work, "patches")).map((file) => readFileSync(file));
	const key = sha(readFileSync(lock), ...patches);
	const marker = join(work, "node_modules", ".memorall-installed");
	if (existsSync(marker) && readFileSync(marker, "utf8") === key) return;
	log(`${app.id}: npm ci`);
	// Install scripts stay off; the one an app needs (patch-package) runs below.
	run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
		cwd: work,
	});
	if (app.patchPackage) run("npx", ["--no-install", "patch-package", "--error-on-fail"], { cwd: work });
	writeFileSync(marker, key);
};

/** The host files, the app's engine and its config, in src/memorall/. */
const addHostFiles = (app, work) => {
	const target = join(work, "src", "memorall");
	mkdirSync(target, { recursive: true });
	for (const file of walkFiles(join(TOOL_DIR, "host"))) {
		cpSync(file, join(target, relative(join(TOOL_DIR, "host"), file)));
	}
	const prepare = join(TOOL_DIR, "prepare", `${app.id}.js`);
	if (existsSync(prepare)) cpSync(prepare, join(target, "prepare.js"));
	const engine = join(TOOL_DIR, "engines", `${app.id}.js`);
	if (!existsSync(engine)) throw new Error(`${app.id}: no engine at ${relative(ROOT, engine)}`);
	cpSync(engine, join(target, "engine.js"));
	cpSync(join(TOOL_DIR, "engines", "shared.js"), join(target, "engine-shared.js"));
	writeFileSync(
		join(target, "config.js"),
		[
			"// Written by tools/build-hosted-apps.mjs.",
			`export const APP = ${JSON.stringify(app.id)};`,
			`export const SIGNED_IN = ${app.signedIn !== false};`,
			`export const HIDE = ${JSON.stringify([...HIDE_EVERYWHERE, ...(app.hide ?? [])])};`,
			"",
		].join("\n"),
	);
	// The host's boot is main.js's first import: the app starts only after it.
	const main = join(work, "src", "main.js");
	if (!existsSync(main)) throw new Error(`${app.id}: no src/main.js to start from`);
	writeFileSync(main, `${MAIN_GATE}\n${readFileSync(main, "utf8")}`);
};

/** What the build puts first in every app's main.js. */
export const MAIN_GATE = 'import "./memorall/boot.js";';

const countOf = (text, needle) => text.split(needle).length - 1;

const applyEdits = (app, work) => {
	for (const edit of app.edits ?? []) {
		const file = join(work, edit.file);
		const source = readFileSync(file, "utf8");
		const found = countOf(source, edit.find);
		if (found !== edit.count) {
			throw new Error(
				`${app.id}: expected ${edit.count} of the edit's text in ${edit.file}, found ${found}. The pinned source moved; update tools/hosted-apps/apps.mjs.`,
			);
		}
		writeFileSync(file, source.split(edit.find).join(edit.replace));
	}
};

/**
 * index.html as an extension page may hold it: remote scripts (the Puter SDK,
 * analytics) dropped, inline scripts moved to files in public/, and the
 * host's stylesheet added. The page still enters at src/main.js, whose first
 * import is now the host's boot.
 */
export const transformIndexHtml = (html) => {
	const inline = [];
	let entries = 0;
	const out = html.replace(
		/<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
		(whole, attrs, body) => {
			const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
			if (src) {
				if (/^(https?:)?\/\//i.test(src)) return "";
				if (/(^|\/)src\/main\.js$/.test(src)) entries += 1;
				return whole;
			}
			const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
			// Data blocks (JSON-LD) are not scripts the page runs.
			if (type && !/^(module|text\/javascript)$/i.test(type)) return whole;
			if (/plausible/i.test(body)) return "";
			const name = `memorall-inline-${inline.length}.js`;
			inline.push({ name, body });
			const kind = type ? ` type="${type}"` : "";
			return `<script${kind} src="./${name}"></script>`;
		},
	);
	if (entries !== 1) throw new Error(`index.html: expected one src/main.js entry, found ${entries}`);
	return { html: out.replace(/\n\s*<!--[^>]*Plausible[^>]*-->/gi, ""), inline };
};

const rewriteIndexHtml = (work) => {
	const file = join(work, "index.html");
	const { html, inline } = transformIndexHtml(readFileSync(file, "utf8"));
	writeFileSync(file, html);
	mkdirSync(join(work, "public"), { recursive: true });
	for (const script of inline) writeFileSync(join(work, "public", script.name), script.body.trim() + "\n");
};

// ─── Build ───────────────────────────────────────────────────────────────────

const ENGINE_CONFIG = `// Written by tools/build-hosted-apps.mjs: the app's Vite config, building
// src/memorall/engine.js as one ES module (with lazy chunks) into dist/engine.
import { defineConfig, loadConfigFromFile, mergeConfig } from "vite";

export default defineConfig(async (env) => {
	const loaded = await loadConfigFromFile(env, "vite.config.js");
	const { build, test, server, preview, ...rest } = loaded?.config ?? {};
	return mergeConfig(rest, {
		base: "./",
		publicDir: false,
		logLevel: "warn",
		build: {
			outDir: "dist/engine",
			emptyOutDir: true,
			copyPublicDir: false,
			target: "es2022",
			sourcemap: false,
			chunkSizeWarningLimit: 4000,
			lib: { entry: "src/memorall/engine.js", formats: ["es"], fileName: () => "engine.js" },
			rollupOptions: {
				output: {
					chunkFileNames: "chunks/[name]-[hash].js",
					assetFileNames: "assets/[name]-[hash][extname]",
				},
			},
		},
	});
});
`;

const vite = (work, viteArgs) =>
	run(process.execPath, [join(work, "node_modules", "vite", "bin", "vite.js"), ...viteArgs], {
		cwd: work,
	});

const build = (app, work) => {
	log(`${app.id}: building the page`);
	vite(work, ["build", "--base", "./", "--outDir", "dist", "--emptyOutDir", "--logLevel", "warn"]);
	log(`${app.id}: building the engine`);
	writeFileSync(join(work, "vite.memorall-engine.config.mjs"), ENGINE_CONFIG);
	vite(work, ["build", "--config", "vite.memorall-engine.config.mjs"]);
	for (const asset of app.engineAssets ?? []) {
		const to = join(work, "dist", "engine", asset.to);
		mkdirSync(dirname(to), { recursive: true });
		cpSync(join(work, asset.from), to, { recursive: true });
	}
};

const finishDist = (app, work) => {
	const dist = join(work, "dist");
	for (const path of app.prune ?? []) rmSync(join(dist, path), { recursive: true, force: true });
	for (const file of walkFiles(dist)) {
		if (!/\.(m?js|html)$/i.test(file)) continue;
		const source = readFileSync(file, "utf8");
		let next = source;
		for (const [find, replace] of DIST_REWRITES) next = next.split(find).join(replace);
		next = next.replace(HOST_NAME_REWRITE.pattern, HOST_NAME_REWRITE.replacement);
		if (next !== source) writeFileSync(file, next);
	}
	for (const file of walkFiles(dist).filter((path) => path.endsWith(".html"))) {
		const html = readFileSync(file, "utf8");
		for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
			const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(match[1])?.[1];
			if (!/\bsrc\s*=/.test(match[1]) && match[2].trim() && (!type || /^(module|text\/javascript)$/i.test(type))) {
				throw new Error(`${app.id}: ${relative(dist, file)} still runs an inline script`);
			}
		}
	}
	run(process.execPath, [join(ROOT, "tools", "check-mv3-remote-code.mjs"), dist]);
	return dist;
};

const publish = (app, dist, key) => {
	const target = join(OUTPUT, app.id);
	rmSync(target, { recursive: true, force: true });
	mkdirSync(dirname(target), { recursive: true });
	cpSync(dist, target, { recursive: true });
	writeFileSync(
		join(target, ".build.json"),
		`${JSON.stringify({ id: app.id, key, commit: HOSTED_APPS_SOURCE.commit, builtAt: new Date().toISOString() }, null, "\t")}\n`,
	);
};

const builtKey = (app) => {
	try {
		return JSON.parse(readFileSync(join(OUTPUT, app.id, ".build.json"), "utf8")).key;
	} catch {
		return null;
	}
};

/** What the runtime reads to know which apps are there. */
const writeIndex = () => {
	mkdirSync(OUTPUT, { recursive: true });
	const apps = {};
	for (const app of HOSTED_APP_BUILDS) {
		const meta = join(OUTPUT, app.id, ".build.json");
		if (!existsSync(meta) || !existsSync(join(OUTPUT, app.id, "engine", "engine.js"))) continue;
		const { builtAt } = JSON.parse(readFileSync(meta, "utf8"));
		apps[app.id] = { entry: `${app.id}/index.html`, engine: `${app.id}/engine/engine.js`, builtAt };
	}
	writeFileSync(
		join(OUTPUT, "apps.json"),
		`${JSON.stringify({ apiVersion: 1, source: HOSTED_APPS_SOURCE, apps }, null, "\t")}\n`,
	);
	if (existsSync(join(SOURCE, "LICENSE"))) cpSync(join(SOURCE, "LICENSE"), join(OUTPUT, "LICENSE"));
};

const main = () => {
	const apps = HOSTED_APP_BUILDS.filter((app) => !only || only.has(app.id));
	const pending = apps.filter((app) => FORCE || builtKey(app) !== buildKey(app));
	if (!pending.length) {
		log("up to date");
		writeIndex();
		return;
	}
	fetchSource();
	const failures = [];
	for (const app of pending) {
		const started = Date.now();
		try {
			const work = prepareWorkFolder(app);
			install(app, work);
			addHostFiles(app, work);
			applyEdits(app, work);
			rewriteIndexHtml(work);
			build(app, work);
			publish(app, finishDist(app, work), buildKey(app));
			log(`${app.id}: done in ${Math.round((Date.now() - started) / 1000)}s`);
		} catch (error) {
			failures.push(app.id);
			console.error(`[hosted-apps] ${app.id} failed: ${error instanceof Error ? error.message : error}`);
		}
	}
	writeIndex();
	if (failures.length) {
		const message = `could not build ${failures.join(", ")}`;
		if (OPTIONAL) log(`${message}; Files and MemonOS use their built-in viewers for them.`);
		else throw new Error(message);
	}
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		main();
	} catch (error) {
		console.error(`[hosted-apps] ${error instanceof Error ? error.message : error}`);
		process.exit(OPTIONAL ? 0 : 1);
	}
}
