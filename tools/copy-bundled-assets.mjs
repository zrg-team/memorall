/*
 Copies assets required by AI libraries to web-accessible locations for MV3 extensions.

 1. ONNX Runtime Web (for @huggingface/transformers)
    - Source: node_modules/onnxruntime-web/dist
    - Dest:   public/vendors/transformers

 2. Wllama WASM files
    - Source: node_modules/@wllama/wllama/esm
    - Dest:   public/runner/libs

 3. WebLLM library
    - Source: node_modules/@mlc-ai/web-llm/lib
    - Dest:   public/runner/libs

 3b. Transformers.js library
    - Source: node_modules/@huggingface/transformers/dist
    - Dest:   public/runner/libs

 4. PDF.js worker
    - Source: node_modules/pdfjs-dist/build
    - Dest:   public/vendors/pdfjs

 4b. fx terminal (libfx), for MemonOS's fx app
    - Source: node_modules/libfx/fx-term.wasm
    - Dest:   public/vendors/fx

 5-6. Sandbox runtime and HyperFrames vendor assets (see inline comments)

 7. Patch @hyperframes/player CDN fallback
    - Replaces the jsdelivr CDN URL in _injectRuntime() with chrome.runtime.getURL()
      so the extension CSP is never violated on runtime injection.
*/

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";
import { bundlePyodidePackages } from "./pyodide-packages.mjs";

const require = createRequire(import.meta.url);
const writeRetrySignal = new Int32Array(new SharedArrayBuffer(4));

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
	ensureDir(path.dirname(dest));
	fs.copyFileSync(src, dest);
	fs.chmodSync(dest, 0o644);
	console.log(`Copied: ${path.relative(process.cwd(), dest)}`);
}

function writeFileWithRetry(file, contents) {
	for (let attempt = 1; attempt <= 10; attempt += 1) {
		try {
			fs.writeFileSync(file, contents);
			return;
		} catch (error) {
			const retryable =
				error &&
				typeof error === "object" &&
				("code" in error || "errno" in error) &&
				["EBUSY", "EPERM", "EACCES", "UNKNOWN"].includes(error.code);
			if (!retryable || attempt === 10) {
				throw error;
			}
			Atomics.wait(writeRetrySignal, 0, 0, attempt * 50);
		}
	}
}

function copyDirectory(src, dest) {
	ensureDir(dest);
	const entries = fs.readdirSync(src, { withFileTypes: true });

	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);

		if (entry.isDirectory()) {
			copyDirectory(srcPath, destPath);
		} else {
			copyFile(srcPath, destPath);
		}
	}
}

function rewriteFiles(files, replacements, label) {
	let changed = 0;
	for (const file of files) {
		if (!fs.existsSync(file)) continue;
		const source = fs.readFileSync(file, "utf8");
		let rewritten = source;
		for (const [pattern, replacement] of replacements) {
			rewritten = rewritten.replace(pattern, replacement);
		}
		if (rewritten === source) continue;
		fs.writeFileSync(file, rewritten);
		changed++;
	}
	console.log(`✅ ${label}: ${changed} file(s) localized.\n`);
}

function rewriteText(source, replacements) {
	let rewritten = source;
	for (const [pattern, replacement] of replacements) {
		rewritten = rewritten.replace(pattern, replacement);
	}
	return rewritten;
}

function countExact(source, needle) {
	if (!needle) return 0;
	let count = 0;
	let offset = source.indexOf(needle);
	while (offset !== -1) {
		count++;
		offset += needle.length;
		offset = source.indexOf(needle, offset);
	}
	return count;
}

function rewriteCopiedAssetExact(
	file,
	needle,
	replacement,
	expectedCount,
	label,
) {
	const source = fs.readFileSync(file, "utf8");
	const actualCount = countExact(source, needle);
	if (actualCount !== expectedCount) {
		throw new Error(
			`${label}: expected ${expectedCount} exact occurrence(s), found ${actualCount}`,
		);
	}
	const rewritten = source
		.replaceAll(needle, replacement)
		.replace(/\r\n?/g, "\n");
	writeFileWithRetry(file, rewritten);
}

function removeMatchingFiles(dir, pattern) {
	if (!fs.existsSync(dir)) {
		return;
	}

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !pattern.test(entry.name)) {
			continue;
		}
		fs.rmSync(path.join(dir, entry.name), { force: true });
	}
}

function rewriteAlmostnodeBundleForSandbox(bundleSource) {
	let rewritten = bundleSource.replace(
		/"\/assets\/(runtime-worker-[^"]+\.js)"/g,
		'"./$1"',
	);

	// Keep packaged asset URLs as runtime-relative URLs. Rspack treats a static
	// `new URL("./asset", import.meta.url)` as a build-time module request, but
	// these files are copied from public/ and intentionally stay separate.
	const runtimeAssetUrl = "__memorallRuntimeAssetUrl";
	rewritten = rewritten.replace(
		/new URL\(("(?:\.\.?\/)[^"]+"),\s*import\.meta\.url\)\.href/g,
		`${runtimeAssetUrl}($1)`,
	);
	if (rewritten.includes(`${runtimeAssetUrl}(`)) {
		rewritten = `const ${runtimeAssetUrl} = (relative) => new URL(relative, import.meta.url).href;\n${rewritten}`;
	}

	// Rewrite CDN-based esbuild assets to local files. almostnode may emit these
	// either as fully inlined strings or as minified template literals.
	const esbuildBrowserLocal = JSON.stringify("./esbuild-wasm-browser.min.js");
	const esbuildWasmLocal = JSON.stringify("./esbuild.wasm");
	rewritten = rewritten
		.replaceAll(
			"https://esm.sh/esbuild-wasm@0.20.0",
			"./esbuild-wasm-browser.min.js",
		)
		.replaceAll(
			"https://unpkg.com/esbuild-wasm@0.20.0/esbuild.wasm",
			"./esbuild.wasm",
		)
		.replaceAll(
			"https://unpkg.com/esbuild-wasm@0.20.0/esm/browser.min.js",
			"./esbuild-wasm-browser.min.js",
		)
		.replace(
			/`https:\/\/esm\.sh\/esbuild-wasm@\$\{[^}]+\}`/g,
			esbuildBrowserLocal,
		)
		.replace(
			/`https:\/\/unpkg\.com\/esbuild-wasm@\$\{[^}]+\}\/esbuild\.wasm`/g,
			esbuildWasmLocal,
		)
		.replace(
			/`https:\/\/unpkg\.com\/esbuild-wasm@\$\{[^}]+\}\/esm\/browser\.min\.js`/g,
			esbuildBrowserLocal,
		);

	// almostnode's framework shims default to remote ESM modules. Map the pinned
	// runtimes to packaged sandbox files and send arbitrary package redirects to
	// an explicit local error module instead of executing downloaded code.
	rewritten = rewritten
		.replace(/https:\/\/esm\.sh\/react-dom@\$\{[^}]+\}/g, "./react-dom.mjs")
		.replace(
			/https:\/\/esm\.sh\/react-refresh@\$\{[^}]+\}\/runtime/g,
			"./react-refresh-runtime.mjs",
		)
		.replace(/https:\/\/esm\.sh\/react@\$\{[^}]+\}/g, "./react.mjs")
		.replace(
			/https:\/\/esm\.sh\/@rollup\/browser@\$\{[^}]+\}/g,
			"./rollup-browser.mjs",
		)
		.replaceAll(
			"https://cdn.tailwindcss.com",
			"../../vendors/artifacts/tailwind.js",
		)
		.replaceAll(
			"https://unpkg.com/almostnode/dist/index.js",
			"./almostnode.bundle.js",
		)
		.replaceAll("https://esm.sh/", "./remote-modules-disabled.mjs#")
		.replaceAll("https://unpkg.com/", "./remote-modules-disabled.mjs#");

	// Force esbuild-wasm to run without spawning blob: workers (MV3 CSP-safe).
	rewritten = rewritten
		.replaceAll(
			'initialize({wasmURL:"./esbuild.wasm"})',
			'initialize({wasmURL:"./esbuild.wasm",worker:false})',
		)
		.replaceAll(
			"initialize({wasmURL:'./esbuild.wasm'})",
			"initialize({wasmURL:'./esbuild.wasm',worker:false})",
		)
		.replaceAll(
			'initialize({wasmURL:"./vendors/esbuild.wasm"})',
			'initialize({wasmURL:"./esbuild.wasm",worker:false})',
		)
		.replaceAll(
			"initialize({wasmURL:'./vendors/esbuild.wasm'})",
			"initialize({wasmURL:'./esbuild.wasm',worker:false})",
		)
		.replaceAll(
			'initialize({wasmURL:"/sandbox/vendors/esbuild.wasm"})',
			'initialize({wasmURL:"./esbuild.wasm",worker:false})',
		)
		.replaceAll(
			"initialize({wasmURL:'/sandbox/vendors/esbuild.wasm'})",
			"initialize({wasmURL:'./esbuild.wasm',worker:false})",
		)
		.replaceAll(
			'initialize({wasmURL:"/sandbox/vendors/esbuild.wasm",worker:false})',
			'initialize({wasmURL:"./esbuild.wasm",worker:false})',
		)
		.replaceAll(
			"initialize({wasmURL:'/sandbox/vendors/esbuild.wasm',worker:false})",
			"initialize({wasmURL:'./esbuild.wasm',worker:false})",
		)
		.replaceAll(
			'initialize({wasmURL:"./vendors/esbuild.wasm",worker:false})',
			'initialize({wasmURL:"./esbuild.wasm",worker:false})',
		)
		.replaceAll(
			"initialize({wasmURL:'./vendors/esbuild.wasm',worker:false})",
			"initialize({wasmURL:'./esbuild.wasm',worker:false})",
		);
	rewritten = rewritten.replace(
		/initialize\(\{wasmURL:([^}]+)\}\)/g,
		"initialize({wasmURL:$1,worker:false})",
	);

	// Rspack rejects node:module specifiers even in dynamic import dead branches.
	// Replace with non-resolving promise to avoid compile-time scheme handling.
	return rewritten.replace(
		/import\(\s*(?:"node:module"|"node"\s*\+\s*":module")\s*\)/g,
		'Promise.reject(new Error("node:module unavailable in sandbox"))',
	);
}

async function bundleSandboxModule(entry, outfile, externalReact = false) {
	await build({
		entryPoints: [require.resolve(entry)],
		outfile,
		bundle: true,
		format: "esm",
		platform: "browser",
		target: ["es2022"],
		minify: true,
		sourcemap: false,
		define: { "process.env.NODE_ENV": '"production"' },
		logLevel: "silent",
		plugins: externalReact
			? [
					{
						name: "sandbox-react-alias",
						setup(buildApi) {
							buildApi.onResolve({ filter: /^react$/ }, () => ({
								path: "./react.mjs",
								external: true,
							}));
						},
					},
				]
			: [],
	});
}

async function main() {
	console.log("📦 Copying AI library assets...\n");

	// Dependency distributions occasionally include CDN fallbacks even when the
	// application configures local assets. Rewrite those dormant defaults before
	// bundling so Web Store review sees only packaged executable resources.
	const transformersFiles = [
		"dist/transformers.web.js",
		"dist/transformers.js",
		"dist/transformers.node.mjs",
		"dist/transformers.min.js",
		"src/backends/onnx.js",
	].map((file) =>
		path.resolve(process.cwd(), "node_modules/@huggingface/transformers", file),
	);
	rewriteFiles(
		transformersFiles,
		[
			[
				/`https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@\$\{[^}]+\}\/dist\/`/g,
				"`/vendors/transformers/`",
			],
		],
		"Transformers ONNX runtime fallback",
	);

	const chevrotainFiles = [
		"lib/chevrotain.mjs",
		"lib/chevrotain.min.mjs",
		"lib/src/diagrams/render_public.js",
	].map((file) => path.resolve(process.cwd(), "node_modules/chevrotain", file));
	rewriteFiles(
		chevrotainFiles,
		[
			[
				/`https:\/\/unpkg\.com\/chevrotain@\$\{[^}]+\}\/diagrams\/diagrams\.css`/g,
				"`/vendors/chevrotain/diagrams/diagrams.css`",
			],
			[
				/`https:\/\/unpkg\.com\/chevrotain@\$\{[^}]+\}\/diagrams\/`/g,
				"`/vendors/chevrotain/diagrams/`",
			],
		],
		"Chevrotain diagram resources",
	);

	// 1. Copy ONNX Runtime assets
	const ortSrcDir = path.resolve(
		process.cwd(),
		"node_modules/onnxruntime-web/dist",
	);
	const ortDestDir = path.resolve(process.cwd(), "public/vendors/transformers");

	if (!fs.existsSync(ortSrcDir)) {
		console.error("onnxruntime-web not found at", ortSrcDir);
		process.exit(1);
	}

	ensureDir(ortDestDir);

	const entries = fs.readdirSync(ortSrcDir);
	const wanted = entries.filter((f) =>
		/\.(jsep|asyncify)\.(wasm|mjs)$/.test(f),
	);

	if (wanted.length === 0) {
		console.warn(
			"No JSEP assets found in onnxruntime-web/dist; copying simd-threaded pair if present.",
		);
	}

	const filesToCopy =
		wanted.length > 0
			? wanted
			: [
					"ort-wasm-simd-threaded.jsep.mjs",
					"ort-wasm-simd-threaded.jsep.wasm",
					"ort-wasm-simd-threaded.asyncify.mjs",
					"ort-wasm-simd-threaded.asyncify.wasm",
				].filter((f) => fs.existsSync(path.join(ortSrcDir, f)));

	if (filesToCopy.length === 0) {
		console.error("Required ORT wasm assets not found.");
		process.exit(2);
	}

	for (const file of filesToCopy) {
		copyFile(path.join(ortSrcDir, file), path.join(ortDestDir, file));
	}

	// Standalone ORT for runner code that drives ONNX sessions itself (typed
	// decisions). The WebGPU bundle reuses the asyncify wasm above; the plain
	// WASM build is the one CPU fallback with every contrib kernel (int4
	// GatherBlockQuantized included), which the asyncify build lacks.
	const standaloneOrt = [
		"ort.webgpu.bundle.min.mjs",
		"ort.wasm.bundle.min.mjs",
		"ort-wasm-simd-threaded.mjs",
		"ort-wasm-simd-threaded.wasm",
	];
	for (const file of standaloneOrt) {
		const source = path.join(ortSrcDir, file);
		if (!fs.existsSync(source)) {
			console.error(`Required ORT asset not found: ${file}`);
			process.exit(2);
		}
		copyFile(source, path.join(ortDestDir, file));
	}

	console.log("✅ ONNX Runtime assets prepared.\n");

	// 2. Copy Wllama library and WASM files
	const wllamaSrc = path.resolve(
		process.cwd(),
		"node_modules/@wllama/wllama/esm",
	);
	const wllamaDestLibs = path.resolve(process.cwd(), "public/runner/libs");

	if (fs.existsSync(wllamaSrc)) {
		// Copy main library
		const wllamaLibraryDest = path.join(wllamaDestLibs, "wllama.js");
		copyFile(path.join(wllamaSrc, "index.js"), wllamaLibraryDest);

		// Copy WASM files — v3 ships a single wasm/ directory
		const wllamaWasmSrc = path.join(wllamaSrc, "wasm");
		if (fs.existsSync(wllamaWasmSrc)) {
			copyDirectory(wllamaWasmSrc, path.join(wllamaDestLibs, "wasm"));
		}

		// Wllama's default compatibility mode points at executable CDN assets.
		// Package the matching exact compatibility runtime and keep the library
		// usable offline under MV3's remote-code policy.
		const wllamaCompatSrc = path.resolve(
			process.cwd(),
			"node_modules/@wllama/wllama-compat/wasm",
		);
		const wllamaCompatDest = path.join(wllamaDestLibs, "compat");
		if (!fs.existsSync(wllamaCompatSrc)) {
			throw new Error("@wllama/wllama-compat assets are missing");
		}
		copyFile(
			path.join(wllamaCompatSrc, "wllama.js"),
			path.join(wllamaCompatDest, "wllama.js"),
		);
		copyFile(
			path.join(wllamaCompatSrc, "wllama.wasm"),
			path.join(wllamaCompatDest, "wllama.wasm"),
		);
		let wllamaLibrary = fs.readFileSync(wllamaLibraryDest, "utf8");
		const compatReplacements = [
			[
				"https://cdn.jsdelivr.net/npm/@wllama/wllama-compat@3.8.1/wasm/wllama.js",
				'new URL("./compat/wllama.js", import.meta.url).href',
			],
			[
				"https://cdn.jsdelivr.net/npm/@wllama/wllama-compat@3.8.1/wasm/wllama.wasm",
				'new URL("./compat/wllama.wasm", import.meta.url).href',
			],
		];
		for (const [remote, localExpression] of compatReplacements) {
			if (countExact(wllamaLibrary, remote) !== 1) {
				throw new Error(`Expected one Wllama compatibility URL: ${remote}`);
			}
			wllamaLibrary = wllamaLibrary.replace(`"${remote}"`, localExpression);
		}
		writeFileWithRetry(wllamaLibraryDest, wllamaLibrary);

		console.log("✅ Wllama library and WASM files copied.\n");
	} else {
		console.warn("⚠️  @wllama/wllama not found, skipping.\n");
	}

	// 3. Copy WebLLM library
	const webllmSrc = path.resolve(
		process.cwd(),
		"node_modules/@mlc-ai/web-llm/lib/index.js",
	);
	const webllmDest = path.resolve(
		process.cwd(),
		"public/runner/libs/web-llm.js",
	);

	if (fs.existsSync(webllmSrc)) {
		copyFile(webllmSrc, webllmDest);
		// Emscripten uses this URL only to derive its own script directory. Point it
		// at the actual copied filename so static artifact analysis does not infer a
		// nonexistent runtime request while preserving the same directory base.
		rewriteCopiedAssetExact(
			webllmDest,
			"new URL('index.js', document.baseURI)",
			"new URL('web-llm.js', document.baseURI)",
			6,
			"WebLLM self URL",
		);
		// Preserve upstream code while normalizing generated trailing whitespace.
		writeFileWithRetry(
			webllmDest,
			fs.readFileSync(webllmDest, "utf8").replace(/[\t ]+$/gm, ""),
		);
		console.log("✅ WebLLM library copied.\n");
	} else {
		console.warn("⚠️  @mlc-ai/web-llm not found, skipping.\n");
	}

	// 3b. Copy Transformers.js library
	const transformersSrc = path.resolve(
		process.cwd(),
		"node_modules/@huggingface/transformers/dist/transformers.min.js",
	);
	const transformersDest = path.resolve(
		process.cwd(),
		"public/runner/libs/transformers.js",
	);

	if (fs.existsSync(transformersSrc)) {
		copyFile(transformersSrc, transformersDest);
		// The runner config normally supplies wasmPaths before initialization. Keep
		// the library's dormant fallback correct as well, without duplicating the
		// 23 MB ONNX binary beside the runner entry.
		rewriteCopiedAssetExact(
			transformersDest,
			'new URL("ort-wasm-simd-threaded.asyncify.wasm",import.meta.url).href',
			'new URL("../../vendors/transformers/ort-wasm-simd-threaded.asyncify.wasm",import.meta.url).href',
			2,
			"Transformers ONNX fallback URL",
		);
		console.log("✅ Transformers.js library copied.\n");
	} else {
		console.warn("⚠️  @huggingface/transformers not found, skipping.\n");
	}

	// 4. Copy PDF.js worker
	const pdfjsSrc = path.resolve(
		process.cwd(),
		"node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
	);
	const pdfjsDestDir = path.resolve(process.cwd(), "public/vendors/pdfjs");
	const pdfjsDest = path.join(pdfjsDestDir, "pdf.worker.min.mjs");

	if (fs.existsSync(pdfjsSrc)) {
		copyFile(pdfjsSrc, pdfjsDest);
		console.log("✅ PDF.js worker copied.\n");
	} else {
		console.warn("⚠️  pdfjs-dist worker not found, skipping.\n");
	}

	// 4b. Copy the fx terminal. MemonOS loads it from here (libfx/wasm takes
	// the asset's URL), since MV3 runs no remote WebAssembly.
	const fxTermSrc = path.resolve(
		process.cwd(),
		"node_modules/libfx/fx-term.wasm",
	);
	const fxTermDest = path.resolve(
		process.cwd(),
		"public/vendors/fx/fx-term.wasm",
	);
	if (fs.existsSync(fxTermSrc)) {
		copyFile(fxTermSrc, fxTermDest);
		// Apache-2.0: the license travels with the WebAssembly it covers.
		copyFile(
			path.resolve(process.cwd(), "node_modules/libfx/LICENSE"),
			path.resolve(process.cwd(), "public/vendors/fx/LICENSE"),
		);
		console.log("✅ fx terminal copied.\n");
	} else {
		console.warn("⚠️  libfx fx-term.wasm not found, skipping.\n");
	}

	// 5. Copy sandbox assets to extension root (for manifest sandbox.pages)
	// 5a. Bundle almostnode for sandbox runtime core-module shims
	const almostnodeEntry = path.resolve(
		process.cwd(),
		"node_modules/almostnode/dist/index.mjs",
	);
	const almostnodeAssetsDir = path.resolve(
		process.cwd(),
		"node_modules/almostnode/dist/assets",
	);
	const brotliWasmSrc = path.resolve(
		process.cwd(),
		"node_modules/brotli-wasm/pkg.web/brotli_wasm_bg.wasm",
	);
	const esbuildBrowserSrc = path.resolve(
		process.cwd(),
		"node_modules/esbuild-wasm/esm/browser.min.js",
	);
	const esbuildWasmSrc = path.resolve(
		process.cwd(),
		"node_modules/esbuild-wasm/esbuild.wasm",
	);
	const almostnodeOut = path.resolve(
		process.cwd(),
		"public/sandbox/vendors/almostnode.bundle.js",
	);
	const almostnodeOutDir = path.dirname(almostnodeOut);
	const installedAlmostnodeSource = fs.existsSync(almostnodeEntry)
		? fs.readFileSync(almostnodeEntry, "utf8")
		: null;
	if (installedAlmostnodeSource?.includes("const memorallAssetUrl =")) {
		throw new Error(
			"Installed AlmostNode source was modified by an older asset generator. Reinstall dependencies before regenerating bundled assets.",
		);
	}
	const almostnodeEntrySource = installedAlmostnodeSource
		? rewriteText(installedAlmostnodeSource, [
				[
					/(const REACT_REFRESH_VERSION = [^;]+;\r?\n)(?!const memorallAssetUrl)/,
					"$1const memorallAssetUrl = (relative) => new URL(relative, import.meta.url).href;\n",
				],
				[
					/\$\{REACT_CDN\}&dev\/jsx-runtime/g,
					"/sandbox/vendors/react-jsx-runtime.mjs",
				],
				[
					/\$\{REACT_CDN\}&dev\/jsx-dev-runtime/g,
					"/sandbox/vendors/react-jsx-dev-runtime.mjs",
				],
				[/\$\{REACT_CDN\}\?dev/g, "/sandbox/vendors/react.mjs"],
				[/\$\{REACT_CDN\}&dev\//g, "/sandbox/vendors/react-subpath-disabled/"],
				[
					/\$\{REACT_DOM_CDN\}\/client\?dev/g,
					"/sandbox/vendors/react-dom-client.mjs",
				],
				[/\$\{REACT_DOM_CDN\}\?dev/g, "/sandbox/vendors/react-dom.mjs"],
				[
					/\$\{REACT_DOM_CDN\}&dev\//g,
					"/sandbox/vendors/react-dom-subpath-disabled/",
				],
				[
					/const REACT_CDN = [^;]+;/,
					'const REACT_CDN = memorallAssetUrl("./react.mjs");',
				],
				[
					/const REACT_DOM_CDN = [^;]+;/,
					'const REACT_DOM_CDN = memorallAssetUrl("./react-dom.mjs");',
				],
				[
					/const REACT_REFRESH_CDN = [^;]+;/,
					'const REACT_REFRESH_CDN = memorallAssetUrl("./react-refresh-runtime.mjs");',
				],
				[
					/const ESBUILD_WASM_ESM_CDN = [^;]+;/,
					'const ESBUILD_WASM_ESM_CDN = memorallAssetUrl("./esbuild-wasm-browser.min.js");',
				],
				[
					/const ESBUILD_WASM_BINARY_CDN = [^;]+;/,
					'const ESBUILD_WASM_BINARY_CDN = memorallAssetUrl("./esbuild.wasm");',
				],
				[
					/const ESBUILD_WASM_BROWSER_CDN = [^;]+;/,
					'const ESBUILD_WASM_BROWSER_CDN = memorallAssetUrl("./esbuild-wasm-browser.min.js");',
				],
				[
					/const ROLLUP_BROWSER_CDN = [^;]+;/,
					'const ROLLUP_BROWSER_CDN = memorallAssetUrl("./rollup-browser.mjs");',
				],
				[
					/const TAILWIND_CDN_URL = [^;]+;/,
					'const TAILWIND_CDN_URL = memorallAssetUrl("../../vendors/artifacts/tailwind.js");',
				],
				[
					/ {2}"react": `\/sandbox\/vendors\/react\.mjs`,/g,
					'  "react": REACT_CDN,',
				],
				[
					/ {2}"react\/jsx-runtime": `\/sandbox\/vendors\/react-jsx-runtime\.mjs`,/g,
					'  "react/jsx-runtime": memorallAssetUrl("./react-jsx-runtime.mjs"),',
				],
				[
					/ {2}"react\/jsx-dev-runtime": `\/sandbox\/vendors\/react-jsx-dev-runtime\.mjs`,/g,
					'  "react/jsx-dev-runtime": memorallAssetUrl("./react-jsx-dev-runtime.mjs"),',
				],
				[
					/ {2}"react-dom": `\/sandbox\/vendors\/react-dom\.mjs`,/g,
					'  "react-dom": REACT_DOM_CDN,',
				],
				[
					/ {2}"react-dom\/client": `\/sandbox\/vendors\/react-dom-client\.mjs`/g,
					'  "react-dom/client": memorallAssetUrl("./react-dom-client.mjs")',
				],
				[
					/return `\/sandbox\/vendors\/remote-modules-disabled\.mjs#\$\{esmPkg\}\?external=react\$\{depsParam\}`;/,
					`return memorallAssetUrl(\`./remote-modules-disabled.mjs#\${esmPkg}?external=react\${depsParam}\`);`,
				],
				[
					/const almostnodeUrl = opts\.almostnodeUrl \?\? "\/sandbox\/vendors\/almostnode\.bundle\.js";/,
					'const almostnodeUrl = opts.almostnodeUrl ?? memorallAssetUrl("./almostnode.bundle.js");',
				],
				[
					/"react": "\/sandbox\/vendors\/react\.mjs"/g,
					`"react": "\${REACT_CDN}"`,
				],
				[
					/"react\/": "\/sandbox\/vendors\/react-subpath-disabled\/"/g,
					`"react/": "\${memorallAssetUrl("./react-subpath-disabled/")}"`,
				],
				[
					/"react-dom": "\/sandbox\/vendors\/react-dom\.mjs"/g,
					`"react-dom": "\${REACT_DOM_CDN}"`,
				],
				[
					/"react-dom\/": "\/sandbox\/vendors\/react-dom-subpath-disabled\/"/g,
					`"react-dom/": "\${memorallAssetUrl("./react-dom-subpath-disabled/")}"`,
				],
				[
					/"react-dom\/client": "\/sandbox\/vendors\/react-dom-client\.mjs"/g,
					`"react-dom/client": "\${memorallAssetUrl("./react-dom-client.mjs")}"`,
				],
			])
		: null;
	if (almostnodeEntrySource) {
		console.log("✅ almostnode runtime URLs prepared in memory.\n");
	}

	if (almostnodeEntrySource) {
		ensureDir(path.dirname(almostnodeOut));
		removeMatchingFiles(almostnodeOutDir, /^runtime-worker-.*\.js$/);

		// Local ESM targets used by almostnode's generated import maps.
		const reactBase = path.join(almostnodeOutDir, "react.mjs");
		const reactJsx = path.join(almostnodeOutDir, "react-jsx-runtime.mjs");
		const reactJsxDev = path.join(
			almostnodeOutDir,
			"react-jsx-dev-runtime.mjs",
		);
		const reactDomBase = path.join(almostnodeOutDir, "react-dom.mjs");
		const reactDomClient = path.join(almostnodeOutDir, "react-dom-client.mjs");
		const reactRefreshRuntime = path.join(
			almostnodeOutDir,
			"react-refresh-runtime.mjs",
		);
		for (const output of [
			reactBase,
			reactJsx,
			reactJsxDev,
			reactDomBase,
			reactDomClient,
			reactRefreshRuntime,
		]) {
			ensureDir(path.dirname(output));
		}
		await bundleSandboxModule("react-sandbox", reactBase);
		await bundleSandboxModule("react-sandbox/jsx-runtime", reactJsx, true);
		await bundleSandboxModule(
			"react-sandbox/jsx-dev-runtime",
			reactJsxDev,
			true,
		);
		await bundleSandboxModule("react-dom-sandbox", reactDomBase, true);
		await bundleSandboxModule("react-dom-sandbox/client", reactDomClient, true);
		await bundleSandboxModule(
			"react-refresh-sandbox/runtime",
			reactRefreshRuntime,
		);
		const rollupBrowserSrc = path.resolve(
			process.cwd(),
			"node_modules/@rollup/browser/dist/es/rollup.browser.js",
		);
		const rollupWasmSrc = path.resolve(
			process.cwd(),
			"node_modules/@rollup/browser/dist/es/bindings_wasm_bg.wasm",
		);
		copyFile(
			rollupBrowserSrc,
			path.join(almostnodeOutDir, "rollup-browser.mjs"),
		);
		copyFile(
			rollupWasmSrc,
			path.join(almostnodeOutDir, "bindings_wasm_bg.wasm"),
		);
		fs.writeFileSync(
			path.join(almostnodeOutDir, "remote-modules-disabled.mjs"),
			'throw new Error("Remote package modules are disabled by Manifest V3 policy.");\n',
		);
		console.log("✅ Sandbox framework modules bundled locally.\n");

		const almostnodeBuild = await build({
			entryPoints: [almostnodeEntry],
			outfile: almostnodeOut,
			write: false,
			bundle: true,
			format: "esm",
			platform: "browser",
			target: ["esnext"],
			sourcemap: false,
			minify: true,
			banner: {
				js: [
					"globalThis.global ??= globalThis;",
					"globalThis.process ??= {",
					"  env: {},",
					"  argv: [],",
					"  browser: true,",
					'  version: "v20.0.0",',
					'  versions: { node: "20.0.0" },',
					'  cwd: () => "/",',
					"  nextTick: (cb, ...args) => Promise.resolve().then(() => cb(...args)),",
					"};",
				].join("\n"),
			},
			logLevel: "silent",
			plugins: [
				{
					name: "memorall-almostnode-entry",
					setup(buildApi) {
						buildApi.onLoad({ filter: /index\.mjs$/ }, (args) => {
							if (path.resolve(args.path) !== almostnodeEntry) return null;
							return {
								contents: almostnodeEntrySource,
								loader: "js",
								resolveDir: path.dirname(almostnodeEntry),
							};
						});
					},
				},
				{
					name: "almostnode-node-polyfill-alias",
					setup(buildApi) {
						buildApi.onResolve({ filter: /^node:zlib$/ }, () => ({
							path: require.resolve("browserify-zlib"),
						}));
						buildApi.onResolve({ filter: /^zlib$/ }, () => ({
							path: require.resolve("browserify-zlib"),
						}));
						buildApi.onResolve({ filter: /^stream$/ }, () => ({
							path: require.resolve("stream-browserify"),
						}));
						buildApi.onResolve({ filter: /^node:stream$/ }, () => ({
							path: require.resolve("stream-browserify"),
						}));
					},
				},
			],
		});

		// almostnode bundle may reference worker assets via "/assets/runtime-worker-*.js".
		// Repoint to colocated files under sandbox/vendors to keep extension bundling resolvable.
		const almostnodeOutput = almostnodeBuild.outputFiles.find((output) =>
			output.path.endsWith("almostnode.bundle.js"),
		);
		if (!almostnodeOutput) {
			throw new Error("AlmostNode bundle output was not generated.");
		}
		let almostnodeBundle = Buffer.from(almostnodeOutput.contents).toString(
			"utf8",
		);
		const workerAssetNames = new Set(
			Array.from(
				almostnodeBundle.matchAll(/\/assets\/(runtime-worker-[^"]+\.js)/g),
			).map((match) => match[1]),
		);
		almostnodeBundle = rewriteAlmostnodeBundleForSandbox(almostnodeBundle);
		writeFileWithRetry(almostnodeOut, almostnodeBundle);

		// Copy referenced runtime-worker assets next to almostnode bundle.
		for (const workerName of workerAssetNames) {
			const workerSrc = path.join(almostnodeAssetsDir, workerName);
			if (fs.existsSync(workerSrc)) {
				const workerDest = path.join(almostnodeOutDir, workerName);
				ensureDir(path.dirname(workerDest));
				fs.writeFileSync(
					workerDest,
					rewriteAlmostnodeBundleForSandbox(fs.readFileSync(workerSrc, "utf8")),
				);
				console.log(`Localized: ${path.relative(process.cwd(), workerDest)}`);
			} else {
				console.warn(
					`⚠️  almostnode worker asset not found, skipping: ${workerSrc}`,
				);
			}
		}

		// brotli-wasm is loaded via URL relative to almostnode.bundle.js.
		// Ensure the wasm binary is colocated so extension bundlers can resolve it.
		if (fs.existsSync(brotliWasmSrc)) {
			copyFile(
				brotliWasmSrc,
				path.join(almostnodeOutDir, "brotli_wasm_bg.wasm"),
			);
		} else {
			console.warn("⚠️  brotli wasm asset not found, skipping copy.\n");
		}

		// Local esbuild-wasm assets for CSP-safe transformer initialization.
		if (fs.existsSync(esbuildBrowserSrc) && fs.existsSync(esbuildWasmSrc)) {
			copyFile(
				esbuildBrowserSrc,
				path.join(almostnodeOutDir, "esbuild-wasm-browser.min.js"),
			);
			copyFile(esbuildWasmSrc, path.join(almostnodeOutDir, "esbuild.wasm"));
			// Fallback location for runtimes that resolve wasmURL from /sandbox base.
			copyFile(
				esbuildWasmSrc,
				path.resolve(process.cwd(), "public/sandbox/esbuild.wasm"),
			);
		} else {
			console.warn(
				"⚠️  esbuild-wasm local assets not found, package install transform may fail under CSP.\n",
			);
		}

		console.log("✅ almostnode bundled for sandbox runtime.\n");
	} else {
		console.warn("⚠️  almostnode entry not found, skipping bundle.\n");
	}

	// 5a. Pyodide for the sandbox's `py` command. The interpreter, the standard
	// library and the packages in python-packages.json ship with the extension
	// (downloaded and checked at build time); the CDN that loadPackage would
	// fall back to is replaced with a path that cannot load.
	const pyodideDir = path.dirname(require.resolve("pyodide/package.json"));
	const pyodideOutDir = path.resolve(
		process.cwd(),
		"public/sandbox/vendors/pyodide",
	);
	for (const file of [
		"pyodide.asm.js",
		"pyodide.asm.wasm",
		"python_stdlib.zip",
	]) {
		copyFile(path.join(pyodideDir, file), path.join(pyodideOutDir, file));
	}
	await bundlePyodidePackages({
		pyodideDir,
		outDir: pyodideOutDir,
		configFile: path.resolve(
			process.cwd(),
			"src/services/sandbox-container/python-packages.json",
		),
	});
	const pyodideLoader = fs
		.readFileSync(path.join(pyodideDir, "pyodide.js"), "utf8")
		.replace(
			// `v${t.version}` before 0.29, `v${x}` since.
			/https:\/\/cdn\.jsdelivr\.net\/pyodide\/v\$\{[\w.]+\}\/full\//g,
			"./packages-not-bundled/",
		);
	if (/cdn\.jsdelivr\.net/.test(pyodideLoader)) {
		throw new Error("Pyodide loader still points at the jsDelivr CDN.");
	}
	writeFileWithRetry(path.join(pyodideOutDir, "pyodide.js"), pyodideLoader);
	console.log("✅ Pyodide packaged for the sandbox py command.\n");

	// 5a2. FFmpeg.wasm (@ffmpeg/core, one thread) and ImageMagick
	// (magick-wasm) for the sandbox's `ffmpeg`, `ffprobe` and `magick`
	// commands, with Liberation Sans for their text. magick-wasm has no command
	// line, so ours (src/services/sandbox-container/magick) is bundled into the
	// worker that runs it. Installed with the extension: nothing to download.
	const sandboxVendorsDir = path.resolve(
		process.cwd(),
		"public/sandbox/vendors",
	);
	copyFile(
		require.resolve("@ffmpeg/core"),
		path.join(sandboxVendorsDir, "ffmpeg/ffmpeg-core.js"),
	);
	copyFile(
		require.resolve("@ffmpeg/core/wasm"),
		path.join(sandboxVendorsDir, "ffmpeg/ffmpeg-core.wasm"),
	);
	copyFile(
		require.resolve("@imagemagick/magick-wasm/magick.wasm"),
		path.join(sandboxVendorsDir, "magick/magick.wasm"),
	);
	await build({
		entryPoints: [
			path.resolve(
				process.cwd(),
				"src/services/sandbox-container/magick/magick-worker.ts",
			),
		],
		outfile: path.join(sandboxVendorsDir, "magick/magick-worker.js"),
		bundle: true,
		format: "iife",
		platform: "browser",
		target: ["es2022"],
		minify: true,
		sourcemap: false,
		logLevel: "silent",
	});
	const liberationDir = path.dirname(
		require.resolve("pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"),
	);
	for (const file of [
		"LiberationSans-Regular.ttf",
		"LiberationSans-Bold.ttf",
		"LICENSE_LIBERATION",
	]) {
		copyFile(
			path.join(liberationDir, file),
			path.join(sandboxVendorsDir, "fonts", file),
		);
	}
	console.log("✅ FFmpeg.wasm and ImageMagick packaged for the sandbox.\n");

	// 5b. Package the isolated artifact preview pages and every executable
	// runtime they use. Nothing in these previews is loaded from a remote host.
	const artifactVendorDest = path.resolve(
		process.cwd(),
		"public/vendors/artifacts",
	);
	const artifactRuntimeFiles = [
		{
			src: "node_modules/@tailwindcss/browser/dist/index.global.js",
			dest: "tailwind.js",
		},
		{
			src: "node_modules/mediabunny/dist/bundles/mediabunny.min.mjs",
			dest: "mediabunny.min.mjs",
		},
		{
			src: "node_modules/lucide/dist/umd/lucide.min.js",
			dest: "lucide.min.js",
		},
		{ src: "node_modules/d3/dist/d3.min.js", dest: "d3.min.js" },
		{
			src: "node_modules/three/build/three.module.min.js",
			dest: "three.min.mjs",
		},
		// three.module.min.js imports "./three.core.min.js"; without it every
		// Three.js composition fails to load.
		{
			src: "node_modules/three/build/three.core.min.js",
			dest: "three.core.min.js",
		},
		{
			src: "node_modules/lottie-web/build/player/lottie_canvas.min.js",
			dest: "lottie_canvas.min.js",
		},
	];
	for (const asset of artifactRuntimeFiles) {
		const src = path.resolve(process.cwd(), asset.src);
		if (!fs.existsSync(src)) {
			throw new Error(`Required packaged artifact runtime not found: ${src}`);
		}
		copyFile(src, path.join(artifactVendorDest, asset.dest));
	}

	const chevrotainDiagramsSrc = path.resolve(
		process.cwd(),
		"node_modules/chevrotain/diagrams",
	);
	if (fs.existsSync(chevrotainDiagramsSrc)) {
		copyDirectory(
			chevrotainDiagramsSrc,
			path.resolve(process.cwd(), "public/vendors/chevrotain/diagrams"),
		);
	}

	const artifactPreviewFiles = [
		[
			"runner/caption-overrides.json",
			"public/sandbox/pages/caption-overrides.json",
		],
		[
			"runner/caption-overrides.json",
			"public/vendors/hyperframes/caption-overrides.json",
		],
		[
			"runner/hyperframes-preview.html",
			"public/sandbox/pages/hyperframes-preview.html",
		],
		["runner/lottie-preview.html", "public/sandbox/pages/lottie-preview.html"],
		[
			"runner/js/hyperframes-preview.js",
			"public/sandbox/pages/js/hyperframes-preview.js",
		],
		[
			"runner/js/lottie-preview.js",
			"public/sandbox/pages/js/lottie-preview.js",
		],
		["runner/js/gif-encoder.js", "public/sandbox/pages/js/gif-encoder.js"],
	];
	for (const [src, dest] of artifactPreviewFiles) {
		copyFile(
			path.resolve(process.cwd(), src),
			path.resolve(process.cwd(), dest),
		);
	}
	console.log("✅ Artifact preview runtimes packaged locally.\n");

	// 5c. Copy sandbox assets to extension root (for manifest sandbox.pages)
	const sandboxSrcDir = path.resolve(process.cwd(), "public/sandbox");
	const sandboxDestDir = path.resolve(process.cwd(), "sandbox");
	if (fs.existsSync(sandboxSrcDir)) {
		ensureDir(sandboxDestDir);
		removeMatchingFiles(
			path.join(sandboxDestDir, "vendors"),
			/^(?:runtime-worker-.*|hyperframes-player\.global)\.js$/,
		);
		const legacySandboxRootFiles = [
			"js-execute.html",
			"js-execute.js",
			"renderer-utils.js",
			"renderer.html",
			"renderer.js",
			"sandbox-container-runtime.html",
			"sandbox-container-runtime.js",
			"sandbox-fs-handlers.js",
			"sandbox-templates.js",
			"sandbox-vfs.js",
		];
		for (const legacyFile of legacySandboxRootFiles) {
			const legacyPath = path.join(sandboxDestDir, legacyFile);
			if (fs.existsSync(legacyPath)) {
				fs.rmSync(legacyPath, { force: true });
			}
		}
		copyDirectory(sandboxSrcDir, sandboxDestDir);
		console.log("✅ Sandbox assets copied.\n");
	} else {
		console.warn("⚠️  public/sandbox not found, skipping.\n");
	}

	// 6. Copy HyperFrames runtime scripts (CSP-safe local copies of CDN scripts)
	const hfVendorDest = path.resolve(
		process.cwd(),
		"public/vendors/hyperframes",
	);
	const motionPathPluginDest = path.join(
		hfVendorDest,
		"MotionPathPlugin.min.js",
	);
	const hfFiles = [
		{
			src: path.resolve(process.cwd(), "node_modules/gsap/dist/gsap.min.js"),
			dest: path.join(hfVendorDest, "gsap.min.js"),
		},
		{
			src: path.resolve(
				process.cwd(),
				"node_modules/gsap/dist/CustomEase.min.js",
			),
			dest: path.join(hfVendorDest, "CustomEase.min.js"),
		},
		{
			src: path.resolve(
				process.cwd(),
				"node_modules/gsap/dist/MotionPathPlugin.min.js",
			),
			dest: motionPathPluginDest,
		},
		{
			src: path.resolve(
				process.cwd(),
				"node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js",
			),
			dest: path.join(hfVendorDest, "hyperframe.runtime.iife.js"),
		},
		{
			src: path.resolve(
				process.cwd(),
				"node_modules/@hyperframes/shader-transitions/dist/index.global.js",
			),
			dest: path.join(hfVendorDest, "shader-transitions.global.js"),
		},
		{
			src: path.resolve(
				process.cwd(),
				"node_modules/html2canvas/dist/html2canvas.min.js",
			),
			dest: path.join(hfVendorDest, "html2canvas.min.js"),
		},
		{
			src: path.resolve(
				process.cwd(),
				"node_modules/@hyperframes/player/dist/hyperframes-player.global.js",
			),
			dest: path.join(hfVendorDest, "hyperframes-player.global.js"),
		},
		// Apache-2.0: the license travels with the (localized) runtime files.
		{
			src: path.resolve(process.cwd(), "node_modules/@hyperframes/core/LICENSE"),
			dest: path.join(hfVendorDest, "LICENSE-hyperframes.txt"),
		},
	];

	let hfCopied = 0;
	for (const { src, dest } of hfFiles) {
		if (fs.existsSync(src)) {
			copyFile(src, dest);
			hfCopied++;
		} else {
			console.warn(`⚠️  HyperFrames asset not found, skipping: ${src}`);
		}
	}
	if (hfCopied > 0) console.log("✅ HyperFrames runtime assets copied.\n");

	// 6b. Fonts for HyperFrames design presets (frame.md), beyond those
	// HyperFrames embeds itself: woff2 per subset + an index the preview reads
	// to embed the families a composition names.
	const fontCatalog = JSON.parse(
		fs.readFileSync(
			path.resolve(
				process.cwd(),
				"src/services/flows-integrations/tools/hyperframes/font-catalog.json",
			),
			"utf8",
		),
	);
	const hfFontDest = path.join(hfVendorDest, "fonts");
	const fontManifest = {};
	const fontFaceBlock = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
	const fontProperty = (block, name) =>
		new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block)?.[1].trim();
	for (const [family, { package: fontPackage, faces }] of Object.entries(
		fontCatalog.families,
	)) {
		const prefix = fontPackage.replace(/^@fontsource\//, "");
		const entries = [];
		for (const face of faces) {
			const cssPath = path.resolve(
				process.cwd(),
				"node_modules",
				fontPackage,
				`${face}.css`,
			);
			if (!fs.existsSync(cssPath)) {
				throw new Error(`HyperFrames font face is missing: ${fontPackage}/${face}.css`);
			}
			const css = fs.readFileSync(cssPath, "utf8");
			for (const [, name, block] of css.matchAll(fontFaceBlock)) {
				const weight = fontProperty(block, "font-weight");
				const style = fontProperty(block, "font-style");
				const subset = name
					.slice(prefix.length + 1)
					.replace(new RegExp(`-${weight}-${style}$`), "");
				if (!fontCatalog.subsets.includes(subset)) continue;
				const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(block)?.[1];
				if (!file) throw new Error(`No woff2 for ${name} in ${cssPath}`);
				copyFile(
					path.resolve(process.cwd(), "node_modules", fontPackage, "files", file),
					path.join(hfFontDest, file),
				);
				entries.push({
					weight,
					style,
					unicodeRange: fontProperty(block, "unicode-range") ?? null,
					file,
				});
			}
		}
		if (!entries.some((entry) => entry.file.includes("-latin-"))) {
			throw new Error(`HyperFrames font ${family} has no latin files`);
		}
		fontManifest[family] = entries;
	}
	// HYPERFRAMES_FONT_INDEX in fonts.ts. Never manifest.json: the stores
	// refuse a package with a second one (tools/package-extension.mjs checks),
	// so an index written under that name by an older run is removed.
	fs.rmSync(path.join(hfFontDest, "manifest.json"), { force: true });
	writeFileWithRetry(
		path.join(hfFontDest, "fonts.json"),
		`${JSON.stringify(fontManifest, null, "\t")}\n`,
	);
	console.log(
		`✅ HyperFrames preset fonts packaged: ${Object.keys(fontManifest).length} families.\n`,
	);

	// HyperShader samples each transition's scenes through one capture function
	// (drawElementImage, else html2canvas). html2canvas renders from a cloned
	// iframe, which an opaque-origin sandbox page (the preview) cannot read, so
	// every transition fell back to a fade. Let the page supply the capture:
	// the preview runner sets globalThis.__hfCaptureElement there.
	const shaderTransitionsDest = path.join(
		hfVendorDest,
		"shader-transitions.global.js",
	);
	if (fs.existsSync(shaderTransitionsDest)) {
		const source = fs.readFileSync(shaderTransitionsDest, "utf8");
		const captureHook =
			'if(typeof globalThis.__hfCaptureElement=="function")return globalThis.__hfCaptureElement(A,e,r,t,n);';
		const capturePattern =
			/function ([A-Za-z_$][\w$]*)\(A,e,r=([A-Za-z_$][\w$]*),t=([A-Za-z_$][\w$]*),n=\{\}\)\{return ([A-Za-z_$][\w$]*)\(\)&&!n\.preferBrowserPaint\?/g;
		const matches = source.match(capturePattern)?.length ?? 0;
		if (matches !== 1 || source.includes(captureHook)) {
			throw new Error(
				`@hyperframes/shader-transitions scene capture anchor changed (${matches} matches)`,
			);
		}
		const patched = source.replace(
			capturePattern,
			(_match, name, width, height, nativeCapture) =>
				`function ${name}(A,e,r=${width},t=${height},n={}){${captureHook}return ${nativeCapture}()&&!n.preferBrowserPaint?`,
		);
		if (countExact(patched, captureHook) !== 1) {
			throw new Error(
				"@hyperframes/shader-transitions scene capture hook did not apply",
			);
		}
		writeFileWithRetry(shaderTransitionsDest, patched);
		console.log("✅ HyperShader scene capture hook added.\n");
	}

	if (fs.existsSync(motionPathPluginDest)) {
		const source = fs
			.readFileSync(motionPathPluginDest, "utf8")
			.replaceAll("\r\n", "\n");
		const licenseSpacer = "\n * \n";
		if (countExact(source, licenseSpacer) !== 1) {
			throw new Error(
				"GSAP MotionPathPlugin license header no longer matches the expected normalization anchor",
			);
		}
		writeFileWithRetry(
			motionPathPluginDest,
			source.replace(licenseSpacer, "\n *\n").replace(/\n+$/u, "\n"),
		);
	}

	// 7. Localize @hyperframes/player
	// The player loads the HyperFrames runtime from jsdelivr when it is not
	// already in the composition, and gives every composition iframe a sandbox
	// attribute and a same-origin probe. Point the runtime at the packaged copy,
	// and let manifest sandbox pages (any same-origin path under /sandbox/) keep
	// their own sandbox: no iframe attribute, no probe into a document the
	// player cannot read (a failed probe makes the player drop the runtime's
	// messages).
	const publicPlayerFile = path.resolve(
		process.cwd(),
		"public/vendors/hyperframes/hyperframes-player.global.js",
	);
	const playerDistFiles = [
		path.resolve(
			process.cwd(),
			"node_modules/@hyperframes/player/dist/hyperframes-player.js",
		),
		path.resolve(
			process.cwd(),
			"node_modules/@hyperframes/player/dist/hyperframes-player.cjs",
		),
		path.resolve(
			process.cwd(),
			"node_modules/@hyperframes/player/dist/hyperframes-player.global.js",
		),
		publicPlayerFile,
	];
	const hfRuntimeCdnPattern =
		/"https:\/\/cdn\.jsdelivr\.net\/npm\/@hyperframes\/core@[^"/]+\/dist\/hyperframe\.runtime\.iife\.js"/g;
	const hfRuntimeLocalExpr = `typeof chrome<"u"&&chrome.runtime?.getURL?chrome.runtime.getURL("vendors/hyperframes/hyperframe.runtime.iife.js"):typeof document<"u"&&document.currentScript?.src?new URL("./hyperframe.runtime.iife.js",document.currentScript.src).href:"./hyperframe.runtime.iife.js"`;
	const hfProbeStart = `start(){this.stop(),this._failure=null,this._runtimeInjected=!1;let e=0;this._interval=setInterval(()=>{`;
	const hfProbeStartGuarded = `start(){this.stop(),this._failure=null,this._runtimeInjected=!1;if(this._iframe.src.includes("/sandbox/"))return;let e=0;this._interval=setInterval(()=>{`;
	const hfLoadSrcPattern =
		/_loadSrc\(e\)\{if\(this\._wantsVideo\(\)\)\{this\._loadVideo\(e\);return\}this\._teardownVideo\(\),this\.iframe\.src=([A-Za-z_$][\w$]*)\(this,e\)\}/g;
	const hfSandboxGuard = `i.origin===location.origin&&i.pathname.includes("/sandbox/")?this.iframe.removeAttribute("sandbox")`;
	const hfLoadSrcLocalized = (resolver) =>
		`_loadSrc(e){if(this._wantsVideo()){this._loadVideo(e);return}this._teardownVideo(),(()=>{let t=${resolver}(this,e),i=new URL(t,location.href);${hfSandboxGuard}:(this.iframe.sandbox.add("allow-scripts"),this._applySandboxOriginPolicy()),this.iframe.src=t})()}`;

	let playerPatchCount = 0;
	for (const playerFile of playerDistFiles) {
		if (!fs.existsSync(playerFile)) {
			throw new Error(
				`Required HyperFrames player file is missing: ${playerFile}`,
			);
		}
		const src = fs.readFileSync(playerFile, "utf8");
		const resolvers = [...src.matchAll(hfLoadSrcPattern)].map(
			(match) => match[1],
		);
		const cdnCount = src.match(hfRuntimeCdnPattern)?.length ?? 0;
		if (
			cdnCount !== 1 ||
			countExact(src, hfProbeStart) !== 1 ||
			resolvers.length !== 1
		) {
			throw new Error(
				`@hyperframes/player localization anchors changed: ${playerFile} (runtime URLs ${cdnCount}, probes ${countExact(src, hfProbeStart)}, src loaders ${resolvers.length})`,
			);
		}
		const [resolver] = resolvers;
		// Replacer functions: a resolver such as "$n" must not be read as a
		// replacement pattern.
		const patched = src
			.replace(hfRuntimeCdnPattern, () => hfRuntimeLocalExpr)
			.replace(hfProbeStart, () => hfProbeStartGuarded)
			.replace(hfLoadSrcPattern, () => hfLoadSrcLocalized(resolver));
		if (
			countExact(patched, hfRuntimeLocalExpr) !== 1 ||
			countExact(patched, hfProbeStartGuarded) !== 1 ||
			countExact(patched, `let t=${resolver}(this,e),i=new URL(t,location.href)`) !==
				1 ||
			countExact(patched, hfSandboxGuard) !== 1 ||
			/cdn\.jsdelivr\.net\/npm\/@hyperframes\//.test(patched) ||
			patched.includes(`?e.source:this.iframe.contentWindow`)
		) {
			throw new Error(
				`@hyperframes/player localization integrity check failed: ${playerFile}`,
			);
		}
		if (playerFile === publicPlayerFile) {
			writeFileWithRetry(playerFile, patched.replace(/\r\n?/g, "\n"));
		}
		playerPatchCount++;
	}
	if (playerPatchCount !== playerDistFiles.length) {
		throw new Error(
			`@hyperframes/player localization touched ${playerPatchCount}/${playerDistFiles.length} required files`,
		);
	}
	console.log("✅ @hyperframes/player exact localization checks passed.\n");

	console.log("🎉 All AI library assets prepared successfully!");
}

main().catch((error) => {
	console.error("❌ Failed to copy bundled assets:", error);
	process.exit(1);
});
