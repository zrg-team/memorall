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
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
	ensureDir(path.dirname(dest));
	fs.copyFileSync(src, dest);
	console.log(`Copied: ${path.relative(process.cwd(), dest)}`);
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

	// Rewrite CDN-based esbuild assets to local files. almostnode may emit these
	// either as fully inlined strings or as minified template literals.
	const esbuildBrowserLocal = JSON.stringify("./esbuild-wasm-browser.min.js");
	const esbuildWasmLocal = JSON.stringify("/sandbox/vendors/esbuild.wasm");
	rewritten = rewritten
		.replaceAll(
			"https://esm.sh/esbuild-wasm@0.20.0",
			"./esbuild-wasm-browser.min.js",
		)
		.replaceAll(
			"https://unpkg.com/esbuild-wasm@0.20.0/esbuild.wasm",
			"/sandbox/vendors/esbuild.wasm",
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
		.replace(
			/https:\/\/esm\.sh\/react-dom@\$\{[^}]+\}/g,
			"/sandbox/vendors/react-dom.mjs",
		)
		.replace(
			/https:\/\/esm\.sh\/react-refresh@\$\{[^}]+\}\/runtime/g,
			"/sandbox/vendors/react-refresh-runtime.mjs",
		)
		.replace(
			/https:\/\/esm\.sh\/react@\$\{[^}]+\}/g,
			"/sandbox/vendors/react.mjs",
		)
		.replace(
			/https:\/\/esm\.sh\/@rollup\/browser@\$\{[^}]+\}/g,
			"/sandbox/vendors/rollup-browser.mjs",
		)
		.replaceAll(
			"https://cdn.tailwindcss.com",
			"/vendors/artifacts/tailwind.js",
		)
		.replaceAll(
			"https://unpkg.com/almostnode/dist/index.js",
			"/sandbox/vendors/almostnode.bundle.js",
		)
		.replaceAll(
			"https://esm.sh/",
			"/sandbox/vendors/remote-modules-disabled.mjs#",
		)
		.replaceAll(
			"https://unpkg.com/",
			"/sandbox/vendors/remote-modules-disabled.mjs#",
		);

	// Force esbuild-wasm to run without spawning blob: workers (MV3 CSP-safe).
	rewritten = rewritten
		.replaceAll(
			'initialize({wasmURL:"./esbuild.wasm"})',
			'initialize({wasmURL:"/sandbox/vendors/esbuild.wasm",worker:false})',
		)
		.replaceAll(
			"initialize({wasmURL:'./esbuild.wasm'})",
			"initialize({wasmURL:'/sandbox/vendors/esbuild.wasm',worker:false})",
		)
		.replaceAll(
			'initialize({wasmURL:"./esbuild.wasm",worker:false})',
			'initialize({wasmURL:"/sandbox/vendors/esbuild.wasm",worker:false})',
		)
		.replaceAll(
			"initialize({wasmURL:'./esbuild.wasm',worker:false})",
			"initialize({wasmURL:'/sandbox/vendors/esbuild.wasm',worker:false})",
		)
		.replaceAll(
			'initialize({wasmURL:"./vendors/esbuild.wasm"})',
			'initialize({wasmURL:"/sandbox/vendors/esbuild.wasm",worker:false})',
		)
		.replaceAll(
			"initialize({wasmURL:'./vendors/esbuild.wasm'})",
			"initialize({wasmURL:'/sandbox/vendors/esbuild.wasm',worker:false})",
		)
		.replaceAll(
			'initialize({wasmURL:"/sandbox/vendors/esbuild.wasm"})',
			'initialize({wasmURL:"/sandbox/vendors/esbuild.wasm",worker:false})',
		)
		.replaceAll(
			"initialize({wasmURL:'/sandbox/vendors/esbuild.wasm'})",
			"initialize({wasmURL:'/sandbox/vendors/esbuild.wasm',worker:false})",
		)
		.replaceAll(
			'initialize({wasmURL:"./vendors/esbuild.wasm",worker:false})',
			'initialize({wasmURL:"/sandbox/vendors/esbuild.wasm",worker:false})',
		)
		.replaceAll(
			"initialize({wasmURL:'./vendors/esbuild.wasm',worker:false})",
			"initialize({wasmURL:'/sandbox/vendors/esbuild.wasm',worker:false})",
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
								path: "/sandbox/vendors/react.mjs",
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
	const wanted = entries.filter((f) => /\.(jsep|asyncify)\.(wasm|mjs)$/.test(f));

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
		copyFile(
			path.join(wllamaSrc, "index.js"),
			path.join(wllamaDestLibs, "wllama.js"),
		);

		// Copy WASM files — v3 ships a single wasm/ directory
		const wllamaWasmSrc = path.join(wllamaSrc, "wasm");
		if (fs.existsSync(wllamaWasmSrc)) {
			copyDirectory(wllamaWasmSrc, path.join(wllamaDestLibs, "wasm"));
		}

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
	rewriteFiles(
		[almostnodeEntry],
		[
			[/\$\{REACT_CDN\}&dev\/jsx-runtime/g, "/sandbox/vendors/react-jsx-runtime.mjs"],
			[/\$\{REACT_CDN\}&dev\/jsx-dev-runtime/g, "/sandbox/vendors/react-jsx-dev-runtime.mjs"],
			[/\$\{REACT_CDN\}\?dev/g, "/sandbox/vendors/react.mjs"],
			[/\$\{REACT_CDN\}&dev\//g, "/sandbox/vendors/react-subpath-disabled/"],
			[/\$\{REACT_DOM_CDN\}\/client\?dev/g, "/sandbox/vendors/react-dom-client.mjs"],
			[/\$\{REACT_DOM_CDN\}\?dev/g, "/sandbox/vendors/react-dom.mjs"],
			[/\$\{REACT_DOM_CDN\}&dev\//g, "/sandbox/vendors/react-dom-subpath-disabled/"],
			[/https:\/\/esm\.sh\/react-dom@\$\{REACT_VERSION\}/g, "/sandbox/vendors/react-dom.mjs"],
			[/https:\/\/esm\.sh\/react-refresh@\$\{REACT_REFRESH_VERSION\}\/runtime/g, "/sandbox/vendors/react-refresh-runtime.mjs"],
			[/https:\/\/esm\.sh\/react@\$\{REACT_VERSION\}/g, "/sandbox/vendors/react.mjs"],
			[/https:\/\/esm\.sh\/@rollup\/browser@\$\{ROLLUP_BROWSER_VERSION\}/g, "/sandbox/vendors/rollup-browser.mjs"],
			[/https:\/\/esm\.sh\/esbuild-wasm@\$\{ESBUILD_WASM_VERSION\}/g, "/sandbox/vendors/esbuild-wasm-browser.min.js"],
			[/https:\/\/unpkg\.com\/esbuild-wasm@\$\{ESBUILD_WASM_VERSION\}\/esbuild\.wasm/g, "/sandbox/vendors/esbuild.wasm"],
			[/https:\/\/unpkg\.com\/esbuild-wasm@\$\{ESBUILD_WASM_VERSION\}\/esm\/browser\.min\.js/g, "/sandbox/vendors/esbuild-wasm-browser.min.js"],
			[/https:\/\/cdn\.tailwindcss\.com/g, "/vendors/artifacts/tailwind.js"],
			[/https:\/\/unpkg\.com\/almostnode\/dist\/index\.js/g, "/sandbox/vendors/almostnode.bundle.js"],
			[/https:\/\/esm\.sh\//g, "/sandbox/vendors/remote-modules-disabled.mjs#"],
			[/https:\/\/unpkg\.com\//g, "/sandbox/vendors/remote-modules-disabled.mjs#"],
		],
		"almostnode runtime URLs",
	);

	if (fs.existsSync(almostnodeEntry)) {
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
		const reactDomClient = path.join(
			almostnodeOutDir,
			"react-dom-client.mjs",
		);
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
		await bundleSandboxModule(
			"react-dom-sandbox/client",
			reactDomClient,
			true,
		);
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

		await build({
			entryPoints: [almostnodeEntry],
			outfile: almostnodeOut,
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
					"  version: \"v20.0.0\",",
					"  versions: { node: \"20.0.0\" },",
					"  cwd: () => \"/\",",
					"  nextTick: (cb, ...args) => Promise.resolve().then(() => cb(...args)),",
					"};",
				].join("\n"),
			},
			logLevel: "silent",
			plugins: [
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
		let almostnodeBundle = fs.readFileSync(almostnodeOut, "utf8");
		const workerAssetNames = new Set(
			Array.from(
				almostnodeBundle.matchAll(/\/assets\/(runtime-worker-[^"]+\.js)/g),
			).map((match) => match[1]),
		);
		almostnodeBundle = rewriteAlmostnodeBundleForSandbox(almostnodeBundle);
		fs.writeFileSync(almostnodeOut, almostnodeBundle);

		// Copy referenced runtime-worker assets next to almostnode bundle.
		for (const workerName of workerAssetNames) {
			const workerSrc = path.join(almostnodeAssetsDir, workerName);
			if (fs.existsSync(workerSrc)) {
				const workerDest = path.join(almostnodeOutDir, workerName);
				ensureDir(path.dirname(workerDest));
				fs.writeFileSync(
					workerDest,
					rewriteAlmostnodeBundleForSandbox(
						fs.readFileSync(workerSrc, "utf8"),
					),
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
			copyFile(brotliWasmSrc, path.join(almostnodeOutDir, "brotli_wasm_bg.wasm"));
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
		{ src: "node_modules/lucide/dist/umd/lucide.min.js", dest: "lucide.min.js" },
		{ src: "node_modules/d3/dist/d3.min.js", dest: "d3.min.js" },
		{ src: "node_modules/three/build/three.min.js", dest: "three.min.js" },
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
		["runner/hyperframes-preview.html", "public/sandbox/pages/hyperframes-preview.html"],
		["runner/lottie-preview.html", "public/sandbox/pages/lottie-preview.html"],
		["runner/js/hyperframes-preview.js", "public/sandbox/pages/js/hyperframes-preview.js"],
		["runner/js/lottie-preview.js", "public/sandbox/pages/js/lottie-preview.js"],
		["runner/js/gif-encoder.js", "public/sandbox/pages/js/gif-encoder.js"],
	];
	for (const [src, dest] of artifactPreviewFiles) {
		copyFile(path.resolve(process.cwd(), src), path.resolve(process.cwd(), dest));
	}
	console.log("✅ Artifact preview runtimes packaged locally.\n");

	// 5c. Copy sandbox assets to extension root (for manifest sandbox.pages)
	const sandboxSrcDir = path.resolve(process.cwd(), "public/sandbox");
	const sandboxDestDir = path.resolve(process.cwd(), "sandbox");
	if (fs.existsSync(sandboxSrcDir)) {
		ensureDir(sandboxDestDir);
		removeMatchingFiles(
			path.join(sandboxDestDir, "vendors"),
			/^runtime-worker-.*\.js$/,
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
	const hfVendorDest = path.resolve(process.cwd(), "public/vendors/hyperframes");
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
			src: path.resolve(process.cwd(), "node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js"),
			dest: path.join(hfVendorDest, "hyperframe.runtime.iife.js"),
		},
		{
			src: path.resolve(process.cwd(), "node_modules/@hyperframes/shader-transitions/dist/index.global.js"),
			dest: path.join(hfVendorDest, "shader-transitions.global.js"),
		},
		{
			src: path.resolve(process.cwd(), "node_modules/html2canvas/dist/html2canvas.min.js"),
			dest: path.join(hfVendorDest, "html2canvas.min.js"),
		},
		{
			src: path.resolve(process.cwd(), "node_modules/@hyperframes/player/dist/hyperframes-player.global.js"),
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

	// 7. Patch @hyperframes/player CDN fallback URL
	// _injectRuntime() falls back to loading the HF runtime from jsdelivr CDN when
	// the runtime isn't auto-detected. Replace with the local extension copy so
	// the extension CSP is never violated.
	const playerDistFiles = [
		path.resolve(process.cwd(), "node_modules/@hyperframes/player/dist/hyperframes-player.js"),
		path.resolve(process.cwd(), "node_modules/@hyperframes/player/dist/hyperframes-player.cjs"),
		path.resolve(process.cwd(), "node_modules/@hyperframes/player/dist/hyperframes-player.global.js"),
		path.resolve(process.cwd(), "public/vendors/hyperframes/hyperframes-player.global.js"),
	];
	const hfRuntimeCdnStr = `"https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"`;
	const hfRuntimeOldLocalExpr = `typeof chrome<"u"&&chrome.runtime?.getURL?chrome.runtime.getURL("vendors/hyperframes/hyperframe.runtime.iife.js"):"https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"`;
	const hfRuntimeLocalExpr = `typeof chrome<"u"&&chrome.runtime?.getURL?chrome.runtime.getURL("vendors/hyperframes/hyperframe.runtime.iife.js"):new URL("/vendors/hyperframes/hyperframe.runtime.iife.js",location.href).href`;
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
		[
			`case"src":i&&(this._ready=!1,this.iframe.src=j(this,i));break;`,
			`case"src":i&&(this._ready=!1,(()=>{let e=j(this,i);e.includes("/sandbox/")?this.iframe.removeAttribute("sandbox"):this["iframe"].sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e})());break;`,
		],
		[
			`this.hasAttribute("src")&&(this.iframe.src=j(this,this.getAttribute("src")||""))`,
			`this.hasAttribute("src")&&(()=>{let e=j(this,this.getAttribute("src")||"");e.includes("/sandbox/")?this.iframe.removeAttribute("sandbox"):this["iframe"].sandbox.add("allow-scripts","allow-same-origin"),this.iframe.src=e})()`,
		],
	];

	let playerPatchCount = 0;
	for (const playerFile of playerDistFiles) {
		if (!fs.existsSync(playerFile)) continue;
		const src = fs.readFileSync(playerFile, "utf8");
		let patched = src
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
		if (patched === src && src.includes(hfRuntimeLocalExpr)) {
			playerPatchCount++; // already patched
			continue;
		}
		if (patched === src) continue;
		fs.writeFileSync(playerFile, patched);
		playerPatchCount++;
	}
	if (playerPatchCount > 0) console.log("✅ @hyperframes/player CDN fallback patched.\n");

	console.log("🎉 All AI library assets prepared successfully!");
}

main().catch((error) => {
	console.error("❌ Failed to copy bundled assets:", error);
	process.exit(1);
});
