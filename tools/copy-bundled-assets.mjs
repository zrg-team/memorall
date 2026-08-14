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

 5-6. Sandbox runtime and HyperFrames vendor assets (see inline comments)

 7. Patch @hyperframes/player CDN fallback
    - Replaces the jsdelivr CDN URL in _injectRuntime() with chrome.runtime.getURL()
      so the extension CSP is never violated on runtime injection.
*/

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { build } from "esbuild";

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

function rewriteCopiedAssetExact(file, needle, replacement, expectedCount, label) {
	const source = fs.readFileSync(file, "utf8");
	const actualCount = countExact(source, needle);
	if (actualCount !== expectedCount) {
		throw new Error(
			`${label}: expected ${expectedCount} exact occurrence(s), found ${actualCount}`,
		);
	}
	writeFileWithRetry(file, source.replaceAll(needle, replacement));
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
		copyFile(
			path.join(wllamaSrc, "index.js"),
			wllamaLibraryDest,
		);

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
				"https://cdn.jsdelivr.net/npm/@wllama/wllama-compat@3.5.1/wasm/wllama.js",
				'new URL("./compat/wllama.js", import.meta.url).href',
			],
			[
				"https://cdn.jsdelivr.net/npm/@wllama/wllama-compat@3.5.1/wasm/wllama.wasm",
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
	const almostnodeEntrySource = fs.existsSync(almostnodeEntry)
		? rewriteText(fs.readFileSync(almostnodeEntry, "utf8"), [
			[
				/(const REACT_REFRESH_VERSION = [^;]+;\r?\n)(?!const memorallAssetUrl)/,
				'$1const memorallAssetUrl = (relative) => new URL(relative, import.meta.url).href;\n',
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

	// 7. Patch @hyperframes/player CDN fallback URL
	// _injectRuntime() falls back to loading the HF runtime from jsdelivr CDN when
	// the runtime isn't auto-detected. Replace with the local extension copy so
	// the extension CSP is never violated.
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
		path.resolve(
			process.cwd(),
			"public/vendors/hyperframes/hyperframes-player.global.js",
		),
	];
	const hfRuntimeCdnStr = `"https://cdn.jsdelivr.net/npm/@hyperframes/core@0.7.108/dist/hyperframe.runtime.iife.js"`;
	const hfRuntimeOldLocalExpr = `typeof chrome<"u"&&chrome.runtime?.getURL?chrome.runtime.getURL("vendors/hyperframes/hyperframe.runtime.iife.js"):"https://cdn.jsdelivr.net/npm/@hyperframes/core@0.7.108/dist/hyperframe.runtime.iife.js"`;
	const hfRuntimePagesUnsafeExpr = `typeof chrome<"u"&&chrome.runtime?.getURL?chrome.runtime.getURL("vendors/hyperframes/hyperframe.runtime.iife.js"):typeof location<"u"?new URL("/vendors/hyperframes/hyperframe.runtime.iife.js",location.href).href:"/vendors/hyperframes/hyperframe.runtime.iife.js"`;
	const hfRuntimePagesUnsafeMinifiedExpr = `typeof chrome<"u"&&chrome.runtime?.getURL?chrome.runtime.getURL("vendors/hyperframes/hyperframe.runtime.iife.js"):new URL("/vendors/hyperframes/hyperframe.runtime.iife.js",location.href).href`;
	const hfRuntimeLocalExpr = `typeof chrome<"u"&&chrome.runtime?.getURL?chrome.runtime.getURL("vendors/hyperframes/hyperframe.runtime.iife.js"):typeof document<"u"&&document.currentScript?.src?new URL("./hyperframe.runtime.iife.js",document.currentScript.src).href:"./hyperframe.runtime.iife.js"`;
	const hfRuntimeNestedLocalExpr = `${hfRuntimeOldLocalExpr.replace(hfRuntimeCdnStr, `(${hfRuntimeLocalExpr})`)}`;
	const hfIframeSandboxExpr = `e.sandbox.add("allow-scripts","allow-same-origin"),`;
	const hfIframeSandboxNoop = `e.src.includes("/sandbox/")||e.sandbox.add("allow-scripts","allow-same-origin"),`;
	const hfSandboxDocReadPatches = [
		[
			`o=!!this._iframe.contentDocument?.querySelector("[data-composition-src]")`,
			`o=!this._iframe.src.includes("/sandbox/")&&!!this._iframe.contentDocument?.querySelector("[data-composition-src]")`,
		],
		[
			`let l=this._iframe.contentDocument,p=null,c=l?.querySelector("[data-composition-id]");`,
			`let l=this._iframe.src.includes("/sandbox/")?null:this._iframe.contentDocument,p=null,c=l?.querySelector("[data-composition-id]");`,
		],
		[
			`let e=this._iframe.contentDocument;if(!e)return;`,
			`if(location.pathname.startsWith("/sandbox/"))return;let e=this._iframe.contentDocument;if(!e)return;`,
		],
		[
			`let n=this._iframe.contentDocument?.querySelector("[data-composition-id]")?.getAttribute("data-composition-id")`,
			`let n=this._iframe.src.includes("/sandbox/")?null:this._iframe.contentDocument?.querySelector("[data-composition-id]")?.getAttribute("data-composition-id")`,
		],
		[
			`getIframeDoc:()=>this.iframe.contentDocument`,
			`getIframeDoc:()=>location.pathname.startsWith("/sandbox/")?null:this.iframe.contentDocument`,
		],
		[
			`try{let n=this.iframe.contentDocument;n&&this._media.setupFromIframe(n)}catch{}`,
			`try{let n=location.pathname.startsWith("/sandbox/")?null:this.iframe.contentDocument;n&&this._media.setupFromIframe(n)}catch{}`,
		],
		[
			`_promoteToParentProxy(){let e=null;try{e=this.iframe.contentDocument}catch{}`,
			`_promoteToParentProxy(){let e=null;try{e=location.pathname.startsWith("/sandbox/")?null:this.iframe.contentDocument}catch{}`,
		],
		[
			`_resolveDirectTimelineAdapterFromWindow(e){if(this.hasRuntimeBridge(e))return null;let t=Reflect.get(e,"__timelines");`,
			`_resolveDirectTimelineAdapterFromWindow(e){if(this._iframe.src.includes("/sandbox/")||this.hasRuntimeBridge(e))return null;let t=Reflect.get(e,"__timelines");`,
		],
		[
			`_resolveDirectTimelineAdapterFromWindow(e){if(location.pathname.startsWith("/sandbox/")||this.hasRuntimeBridge(e))return null;let t=Reflect.get(e,"__timelines");`,
			`_resolveDirectTimelineAdapterFromWindow(e){if(this._iframe.src.includes("/sandbox/")||this.hasRuntimeBridge(e))return null;let t=Reflect.get(e,"__timelines");`,
		],
		[
			`_resolveDirectTimelineAdapterFromWindow(e){if(!location.pathname.startsWith("/sandbox/")&&this.hasRuntimeBridge(e))return null;let t=Reflect.get(e,"__timelines");`,
			`_resolveDirectTimelineAdapterFromWindow(e){if(this._iframe.src.includes("/sandbox/")||this.hasRuntimeBridge(e))return null;let t=Reflect.get(e,"__timelines");`,
		],
		[
			`_resolvePlaybackDurationAdapter(e){let t=Reflect.get(e,"__player");if(ce(t))return{kind:"runtime",getDuration:()=>t.getDuration()};let i=this._resolveDirectTimelineAdapterFromWindow(e);return i?{kind:"direct-timeline",timeline:i,getDuration:()=>i.duration()}:null}`,
			`_resolvePlaybackDurationAdapter(e){let t=Reflect.get(e,"__player");if(ce(t))return{kind:"runtime",getDuration:()=>t.getDuration()};let i=this._resolveDirectTimelineAdapterFromWindow(e);return i?{kind:"direct-timeline",timeline:i,getDuration:()=>i.duration()}:null}`,
		],
		[
			`_resolvePlaybackDurationAdapter(e){let i=location.pathname.startsWith("/sandbox/")?this._resolveDirectTimelineAdapterFromWindow(e):null;if(i)return{kind:"direct-timeline",timeline:i,getDuration:()=>i.duration()};let t=Reflect.get(e,"__player");if(ce(t))return{kind:"runtime",getDuration:()=>t.getDuration()};i=this._resolveDirectTimelineAdapterFromWindow(e);return i?{kind:"direct-timeline",timeline:i,getDuration:()=>i.duration()}:null}`,
			`_resolvePlaybackDurationAdapter(e){let t=Reflect.get(e,"__player");if(ce(t))return{kind:"runtime",getDuration:()=>t.getDuration()};let i=this._resolveDirectTimelineAdapterFromWindow(e);return i?{kind:"direct-timeline",timeline:i,getDuration:()=>i.duration()}:null}`,
		],
		[
			`start(){this.stop(),this._runtimeInjected=!1;let e=0;this._interval=setInterval(()=>{`,
			`start(){this.stop(),this._runtimeInjected=!1;if(this._iframe.src.includes("/sandbox/"))return;let e=0;this._interval=setInterval(()=>{`,
		],
		[
			`start(){this.stop(),this._runtimeInjected=!1;if(location.pathname.startsWith("/sandbox/"))return;let e=0;this._interval=setInterval(()=>{`,
			`start(){this.stop(),this._runtimeInjected=!1;if(this._iframe.src.includes("/sandbox/"))return;let e=0;this._interval=setInterval(()=>{`,
		],
		[
			`_trySyncSeek(e){if(location.pathname.startsWith("/sandbox/"))return!1;try{let i=this.iframe.contentWindow?.__player;`,
			`_trySyncSeek(e){if(this.iframe.src.includes("/sandbox/"))return!1;try{let i=this.iframe.contentWindow?.__player;`,
		],
		[
			`_trySyncSeek(e){try{let i=this.iframe.contentWindow?.__player;`,
			`_trySyncSeek(e){if(this.iframe.src.includes("/sandbox/"))return!1;try{let i=this.iframe.contentWindow?.__player;`,
		],
		[
			`_trySyncSeek(e){try{let r=this.iframe.contentWindow?.__player;`,
			`_trySyncSeek(e){if(this.iframe.src.includes("/sandbox/"))return!1;try{let r=this.iframe.contentWindow?.__player;`,
		],
		[
			`_withDirectTimeline(e){if(location.pathname.startsWith("/sandbox/"))return!1;let t=this._directTimelineAdapter||this.probe.resolveDirectTimelineAdapter();`,
			`_withDirectTimeline(e){if(this.iframe.src.includes("/sandbox/"))return!1;let t=this._directTimelineAdapter||this.probe.resolveDirectTimelineAdapter();`,
		],
		[
			`_withDirectTimeline(e){let t=this._directTimelineAdapter||this.probe.resolveDirectTimelineAdapter();`,
			`_withDirectTimeline(e){if(this.iframe.src.includes("/sandbox/"))return!1;let t=this._directTimelineAdapter||this.probe.resolveDirectTimelineAdapter();`,
		],
		[
			`_onMessage(e){Ce(e,location.pathname.startsWith("/sandbox/")?e.source:this.iframe.contentWindow,{`,
			`_onMessage(e){Ce(e,this.iframe.src.includes("/sandbox/")?e.source:this.iframe.contentWindow,{`,
		],
		[
			`_onMessage(e){Ce(e,this.iframe.contentWindow,{`,
			`_onMessage(e){Ce(e,this.iframe.src.includes("/sandbox/")?e.source:this.iframe.contentWindow,{`,
		],
		[
			`getIframeDoc:()=>location.pathname.startsWith("/sandbox/")?null:this.iframe.contentDocument`,
			`getIframeDoc:()=>this.iframe.src.includes("/sandbox/")?null:this.iframe.contentDocument`,
		],
		[
			`getIframeDoc:()=>this.iframe.contentDocument`,
			`getIframeDoc:()=>this.iframe.src.includes("/sandbox/")?null:this.iframe.contentDocument`,
		],
		[
			`try{let n=location.pathname.startsWith("/sandbox/")?null:this.iframe.contentDocument;n&&this._media.setupFromIframe(n)}catch{}`,
			`try{let n=this.iframe.src.includes("/sandbox/")?null:this.iframe.contentDocument;n&&this._media.setupFromIframe(n)}catch{}`,
		],
		[
			`try{let n=this.iframe.contentDocument;n&&this._media.setupFromIframe(n)}catch{}`,
			`try{let n=this.iframe.src.includes("/sandbox/")?null:this.iframe.contentDocument;n&&this._media.setupFromIframe(n)}catch{}`,
		],
		[
			`_promoteToParentProxy(){let e=null;try{e=location.pathname.startsWith("/sandbox/")?null:this.iframe.contentDocument}catch{}`,
			`_promoteToParentProxy(){let e=null;try{e=this.iframe.src.includes("/sandbox/")?null:this.iframe.contentDocument}catch{}`,
		],
		[
			`_promoteToParentProxy(){let e=null;try{e=this.iframe.contentDocument}catch{}`,
			`_promoteToParentProxy(){let e=null;try{e=this.iframe.src.includes("/sandbox/")?null:this.iframe.contentDocument}catch{}`,
		],
		[
			`this.hasAttribute("src")&&(this.iframe.src=j(this,this.getAttribute("src")))`,
			`this.hasAttribute("src")&&(()=>{let e=j(this,this.getAttribute("src"));e.includes("/sandbox/")?this.iframe.removeAttribute("sandbox"):this["iframe"].sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e})()`,
		],
		...["q", "Y"].map((resolver) => [
			`this.hasAttribute("src")&&(this.iframe.src=${resolver}(this,this.getAttribute("src")))`,
			`this.hasAttribute("src")&&(()=>{let e=${resolver}(this,this.getAttribute("src")),t=new URL(e,location.href);t.origin===location.origin&&t.pathname.includes("/sandbox/")?this.iframe.removeAttribute("sandbox"):this.iframe.sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e})()`,
		]),
		[
			`case"src":i&&(this._ready=!1,this.iframe.src=j(this,i));break;`,
			`case"src":i&&(this._ready=!1,(()=>{let e=j(this,i);e.includes("/sandbox/")?this.iframe.removeAttribute("sandbox"):this["iframe"].sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e})());break;`,
		],
		...["q", "Y"].map((resolver) => [
			`case"src":r&&(this._ready=!1,this.iframe.src=${resolver}(this,r));break;`,
			`case"src":r&&(this._ready=!1,(()=>{let e=${resolver}(this,r),t=new URL(e,location.href);t.origin===location.origin&&t.pathname.includes("/sandbox/")?this.iframe.removeAttribute("sandbox"):this.iframe.sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e})());break;`,
		]),
		[
			`this.hasAttribute("src")&&(this.iframe.src=j(this,this.getAttribute("src")||""))`,
			`this.hasAttribute("src")&&(()=>{let e=j(this,this.getAttribute("src")||"");e.includes("/sandbox/")?this.iframe.removeAttribute("sandbox"):this["iframe"].sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e})()`,
		],
		...["q", "Y"].map((resolver) => [
			`this.hasAttribute("src")&&(this.iframe.src=${resolver}(this,this.getAttribute("src")||""))`,
			`this.hasAttribute("src")&&(()=>{let e=${resolver}(this,this.getAttribute("src")||""),t=new URL(e,location.href);t.origin===location.origin&&t.pathname.includes("/sandbox/")?this.iframe.removeAttribute("sandbox"):this.iframe.sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e})()`,
		]),
	];

	let playerPatchCount = 0;
	for (const playerFile of playerDistFiles) {
		if (!fs.existsSync(playerFile)) {
			throw new Error(
				`Required HyperFrames player file is missing: ${playerFile}`,
			);
		}
		const src = fs.readFileSync(playerFile, "utf8");
		let patched = src
			.replaceAll(hfRuntimePagesUnsafeMinifiedExpr, hfRuntimeLocalExpr)
			.replaceAll(hfRuntimePagesUnsafeExpr, hfRuntimeLocalExpr)
			.replaceAll(hfRuntimeNestedLocalExpr, hfRuntimeLocalExpr)
			.replaceAll(hfRuntimeOldLocalExpr, hfRuntimeLocalExpr)
			.replaceAll(hfRuntimeCdnStr, hfRuntimeLocalExpr)
			.replaceAll(hfIframeSandboxExpr, hfIframeSandboxNoop);
		for (const [from, to] of hfSandboxDocReadPatches) {
			patched = patched.replaceAll(from, to);
		}
		patched = patched
			.replace(
				/(?:(?:location\.pathname\.startsWith\("\/sandbox\/"\)|e\.src\.includes\("\/sandbox\/"\))\|\|)+e\.sandbox\.add\("allow-scripts","allow-same-origin"\),/g,
				hfIframeSandboxNoop,
			)
			.replace(
				/(?:if\(location\.pathname\.startsWith\("\/sandbox\/"\)\)return;)+let e=this\._iframe\.contentDocument;if\(!e\)return;/g,
				`if(location.pathname.startsWith("/sandbox/"))return;let e=this._iframe.contentDocument;if(!e)return;`,
			)
			.replaceAll(
				`:this.iframe.src.includes("/sandbox/")||e.sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e`,
				`:this["iframe"].sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e`,
			)
			.replaceAll(
				`:this.iframe.src.includes("/sandbox/")||this.iframe.sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e`,
				`:this["iframe"].sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e`,
			);
		const resolver =
			path.basename(playerFile) === "hyperframes-player.js" ? "q" : "Y";
		const localizedAnchors = [
			hfRuntimeLocalExpr,
			`start(){this.stop(),this._runtimeInjected=!1;if(this._iframe.src.includes("/sandbox/"))return;let e=0;`,
			`let e=${resolver}(this,this.getAttribute("src")),t=new URL(e,location.href)`,
			`let e=${resolver}(this,r),t=new URL(e,location.href)`,
			`let e=${resolver}(this,this.getAttribute("src")||""),t=new URL(e,location.href)`,
		];
		const anchorCounts = localizedAnchors.map((anchor) =>
			countExact(patched, anchor),
		);
		const invalidAnchor = anchorCounts.some((count) => count !== 1);
		if (
			invalidAnchor ||
			countExact(
				patched,
				`t.origin===location.origin&&t.pathname.includes("/sandbox/")?this.iframe.removeAttribute("sandbox")`,
			) !== 3 ||
			patched.includes(hfRuntimeCdnStr) ||
			patched.includes(`?e.source:this.iframe.contentWindow`)
		) {
			throw new Error(
				`@hyperframes/player localization integrity check failed: ${playerFile} (anchor counts ${anchorCounts.join(",")})`,
			);
		}
		if (patched === src && src.includes(hfRuntimeLocalExpr)) {
			playerPatchCount++; // already patched
			continue;
		}
		if (patched === src) continue;
		fs.writeFileSync(playerFile, patched);
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
