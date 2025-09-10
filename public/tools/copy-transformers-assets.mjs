/*
 Copies ONNX Runtime Web assets required by @huggingface/transformers
 to a web-accessible location for MV3 extensions.

 - Source: node_modules/onnxruntime-web/dist
 - Dest:   public/vendors/transformers

 We copy any JSEP builds (*.jsep.wasm|*.jsep.mjs). These are used by
 transformers in browser contexts without requiring cross-origin isolation.
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

function main() {
	const srcDir = path.resolve(
		process.cwd(),
		"node_modules/onnxruntime-web/dist",
	);
	const destDir = path.resolve(process.cwd(), "public/vendors/transformers");

	if (!fs.existsSync(srcDir)) {
		console.error("onnxruntime-web not found at", srcDir);
		process.exit(1);
	}

	ensureDir(destDir);

	const entries = fs.readdirSync(srcDir);
	const wanted = entries.filter((f) => /\.jsep\.(wasm|mjs)$/.test(f));

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
				].filter((f) => fs.existsSync(path.join(srcDir, f)));

	if (filesToCopy.length === 0) {
		console.error("Required ORT wasm assets not found.");
		process.exit(2);
	}

	for (const file of filesToCopy) {
		copyFile(path.join(srcDir, file), path.join(destDir, file));
	}

	console.log("✅ ONNX Runtime assets prepared.");
}

main();
