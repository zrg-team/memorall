// Optional real-weight smoke test; caches the model locally on first run.
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import * as HF from "@huggingface/transformers";
import { loadEmbeddingGemma2 } from "../public/runner/modes/embeddinggemma2.js";

const source = fs.readFileSync(new URL("../src/services/embedding/implementations/embeddinggemma2-embedding.ts", import.meta.url), "utf8");
const modelId = /EMBEDDING_GEMMA_2_MODEL\s*=\s*"([^"]+)"/.exec(source)?.[1];
const revision = /EMBEDDING_GEMMA_2_REVISION\s*=\s*"([^"]+)"/.exec(source)?.[1];
assert(modelId && revision, "Model and revision must be pinned");
HF.env.allowLocalModels = false;
HF.env.cacheDir = path.resolve("artifacts/qa/embeddinggemma2-model-cache");
console.log(`Loading ${modelId}@${revision} (q4, CPU; first run downloads model weights)`);
const runner = await loadEmbeddingGemma2(HF, modelId, { device: "cpu", revision });
try {
	const sharp = (await import("sharp")).default;
	const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#87ceeb" } }).jpeg().toBuffer();
	const imageBytes = new Uint8Array(image).buffer;
	const samples = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 16000) * 0.2);
	for (const input of [
		{ kind: "text", text: "A piano performance in a sunlit room.", title: "Music" },
		{ kind: "text", text: "piano performance", query: true },
		{ kind: "image", bytes: imageBytes, mimeType: "image/jpeg" },
		{ kind: "audio", samples, sampleRate: 16000 },
		{ kind: "video", frames: [{ bytes: imageBytes, timestamp: 0 }, { bytes: imageBytes, timestamp: 1 }], duration: 2 },
	]) {
		const vector = await runner.embed(input);
		assert.equal(vector.length, 768); assert(vector.every(Number.isFinite));
		assert(Math.abs(Math.hypot(...vector) - 1) < 1e-5);
		console.log(`PASS ${input.kind}${input.query ? " query" : ""}: finite, normalized 768d embedding`);
	}
} finally { await runner.dispose(); }
