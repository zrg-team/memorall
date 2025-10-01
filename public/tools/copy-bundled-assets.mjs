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
*/

import fs from "node:fs";
import path from "node:path";

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

function main() {
	console.log("📦 Copying AI library assets...\n");

	// 1. Copy ONNX Runtime assets
	const ortSrcDir = path.resolve(process.cwd(), "node_modules/onnxruntime-web/dist");
	const ortDestDir = path.resolve(process.cwd(), "public/vendors/transformers");

	if (!fs.existsSync(ortSrcDir)) {
		console.error("onnxruntime-web not found at", ortSrcDir);
		process.exit(1);
	}

	ensureDir(ortDestDir);

	const entries = fs.readdirSync(ortSrcDir);
	const wanted = entries.filter((f) => /\.jsep\.(wasm|mjs)$/.test(f));

	if (wanted.length === 0) {
		console.warn("No JSEP assets found in onnxruntime-web/dist; copying simd-threaded pair if present.");
	}

	const filesToCopy = wanted.length > 0
		? wanted
		: ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]
			.filter((f) => fs.existsSync(path.join(ortSrcDir, f)));

	if (filesToCopy.length === 0) {
		console.error("Required ORT wasm assets not found.");
		process.exit(2);
	}

	for (const file of filesToCopy) {
		copyFile(path.join(ortSrcDir, file), path.join(ortDestDir, file));
	}

	console.log("✅ ONNX Runtime assets prepared.\n");

	// 2. Copy Wllama library and WASM files
	const wllamaSrc = path.resolve(process.cwd(), "node_modules/@wllama/wllama/esm");
	const wllamaDestLibs = path.resolve(process.cwd(), "public/runner/libs");

	if (fs.existsSync(wllamaSrc)) {
		// Copy main library
		copyFile(
			path.join(wllamaSrc, "index.js"),
			path.join(wllamaDestLibs, "wllama.js")
		);

		// Copy WASM files (single-thread and multi-thread)
		const wllamaWasmDirs = ["single-thread", "multi-thread"];
		for (const dir of wllamaWasmDirs) {
			const srcDir = path.join(wllamaSrc, dir);
			const destDir = path.join(wllamaDestLibs, dir);
			if (fs.existsSync(srcDir)) {
				copyDirectory(srcDir, destDir);
			}
		}

		console.log("✅ Wllama library and WASM files copied.\n");
	} else {
		console.warn("⚠️  @wllama/wllama not found, skipping.\n");
	}

	// 3. Copy WebLLM library
	const webllmSrc = path.resolve(process.cwd(), "node_modules/@mlc-ai/web-llm/lib/index.js");
	const webllmDest = path.resolve(process.cwd(), "public/runner/libs/web-llm.js");

	if (fs.existsSync(webllmSrc)) {
		copyFile(webllmSrc, webllmDest);
		console.log("✅ WebLLM library copied.\n");
	} else {
		console.warn("⚠️  @mlc-ai/web-llm not found, skipping.\n");
	}

	console.log("🎉 All AI library assets prepared successfully!");
}

main();
