// Embedding Runner - Text embeddings via @huggingface/transformers
import { reply, sendReady } from "../utils/common.js";

// Read model from query params if provided
const params = new URLSearchParams(self.location ? self.location.search : "");

let HF;
let hfPipeline;
let embeddingModel = params.get("model");

if (embeddingModel) {
	embeddingModel = decodeURIComponent(embeddingModel);
} else {
	embeddingModel = "nomic-ai/nomic-embed-text-v1.5";
}

async function ensureTransformers(modelName) {
	if (!HF) {
		HF = await import(
			"https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2"
		);
		if (!HF || !HF.pipeline)
			throw new Error("Failed to load @huggingface/transformers");
		try {
			if (HF.env?.backends?.onnx?.wasm) {
				HF.env.backends.onnx.wasm.wasmPaths =
					"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/";
				HF.env.backends.onnx.wasm.proxy = false;
			}
		} catch {}
	}
	if (!hfPipeline || (modelName && modelName !== embeddingModel)) {
		embeddingModel = modelName || embeddingModel;
		hfPipeline = await HF.pipeline("feature-extraction", embeddingModel);
		// Warmup
		try {
			await hfPipeline(["test"], { pooling: "mean", normalize: true });
		} catch {}
	}
}

window.addEventListener("message", async (event) => {
	const src = event.source;
	const origin = event.origin;
	const { messageId, type, payload } = event.data || {};

	try {
		switch (type) {
			case "init": {
				await ensureTransformers(embeddingModel);
				reply(src, origin, messageId, "complete", {
					status: "initialized",
					mode: "embedding",
					model: embeddingModel,
				});
				break;
			}
			case "models": {
				const modelInfo = {
					object: "list",
					data: [
						{
							id: embeddingModel,
							name: embeddingModel,
							loaded: !!hfPipeline,
							object: "model",
							created: Date.now(),
							owned_by: "local",
						},
					],
				};
				reply(src, origin, messageId, "complete", modelInfo);
				break;
			}
			case "embeddings": {
				const { input, model } = payload || {};
				if (!input) throw new Error("input is required");
				await ensureTransformers(model || embeddingModel);
				const texts = Array.isArray(input) ? input : [input];
				const processed = texts.map((t) =>
					typeof t === "string" ? t.replace(/\n/g, " ") : String(t),
				);
				const result = await hfPipeline(processed, {
					pooling: "mean",
					normalize: true,
				});
				const list =
					typeof result.tolist === "function" ? result.tolist() : result;
				const response = {
					object: "list",
					data: list.map((vec, idx) => ({
						object: "embedding",
						embedding: vec,
						index: idx,
					})),
					model: model || embeddingModel,
					usage: { prompt_tokens: -1, total_tokens: -1 },
				};
				reply(src, origin, messageId, "complete", response);
				break;
			}
			default:
				throw new Error(`Unknown message type: ${type}`);
		}
	} catch (err) {
		reply(src, origin, messageId, "error", {
			error: {
				message: (err && err.message) || "Unknown error",
				type: "invalid_request_error",
				code: null,
			},
		});
	}
});

const endpoints = ["init", "models", "embeddings"];
sendReady("embedding", endpoints);
