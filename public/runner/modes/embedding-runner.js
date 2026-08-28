// Embedding Runner - Text embeddings via @huggingface/transformers
import { reply, sendReady } from "../utils/common.js";
import { ModelLifecycleManager } from "../utils/model-lifecycle.js";
import { withGPULock } from "../utils/gpu-lock.js";

// Read model from query params if provided
const params = new URLSearchParams(self.location ? self.location.search : "");
const requestedDevice = (params.get("device") || "wasm").toLowerCase();

let HF;
let defaultEmbeddingModel = params.get("model");

if (defaultEmbeddingModel) {
	defaultEmbeddingModel = decodeURIComponent(defaultEmbeddingModel);
} else {
	defaultEmbeddingModel = "nomic-ai/nomic-embed-text-v1.5";
}

console.log("[embedding-runner] startup", {
	defaultEmbeddingModel,
});

function nowMs() {
	return typeof performance !== "undefined" && typeof performance.now === "function"
		? performance.now()
		: Date.now();
}

function formatMs(ms) {
	return `${Math.round(ms)}ms`;
}

function resolveEmbeddingDevice(hasWebGPU) {
	if (requestedDevice === "webgpu") {
		return hasWebGPU ? "webgpu" : "wasm";
	}

	if (requestedDevice === "auto") {
		return hasWebGPU ? "webgpu" : "wasm";
	}

	return "wasm";
}

function createProgressLogger(context, notify) {
	const lastPctByFile = new Map();
	const loggedShapes = new Set();
	return (info) => {
		try {
			const status = info?.status;
			const file = info?.file || info?.name;
			const model = info?.model || info?.id || context?.model;

			if (status === "progress") {
				const pct = typeof info?.progress === "number" ? info.progress : undefined;
				if (file && typeof pct === "number") {
					const prev = lastPctByFile.get(file);
					// Throttle to 1% increments
					if (prev === pct) return;
					if (typeof prev === "number" && Math.abs(pct - prev) < 1) return;
					lastPctByFile.set(file, pct);
				}
				try {
					notify && notify({ ...info, model, file, progress: pct });
				} catch {}

				return;
			}

			if (status === "download") {
				try {
					notify && notify({ ...info, model, file });
				} catch {}
				return;
			}

			if (status === "done") {
				try {
					notify && notify({ ...info, model, file });
				} catch {}
				console.log("[embedding-runner] download done", {
					model,
					file,
				});
				return;
			}

			if (status === "ready") {
				try {
					notify && notify(info);
				} catch {}
				console.log("[embedding-runner] model ready", {
					task: info?.task,
					model: info?.model,
				});
				return;
			}

			// Fallback for initiate/unknown shapes. Transformers.js reports
			// `progress_total` for every chunk of every file, so logging each one
			// put ~1,500 entries in the console for a single 135MB model. Devtools
			// retains every entry and the object hanging off it, which is enough to
			// take the tab down. Report each status/file pair once instead: the
			// download's actual progress reaches the UI through `notify` above.
			const shape = `${status}:${file ?? ""}`;
			if (loggedShapes.has(shape)) return;
			loggedShapes.add(shape);
			console.log("[embedding-runner] load event", info);
		} catch {}
	};
}

async function ensureHFLibrary() {
	if (HF) return;

	const importStartedAt = nowMs();
	console.log("[embedding-runner] importing transformers...");
	HF = await import("../libs/transformers.js");
	console.log("[embedding-runner] transformers imported", {
		duration: formatMs(nowMs() - importStartedAt),
		hasPipelineExport: !!HF?.pipeline,
	});

	if (!HF || !HF.pipeline) {
		throw new Error("Failed to load @huggingface/transformers");
	}

	try {
		if (HF.env) {
			HF.env.useBrowserCache = true;
			HF.env.allowLocalModels = false;

			if (HF.env.backends?.onnx?.wasm) {
				const wasmPath =
					typeof chrome !== "undefined" && chrome.runtime?.getURL
						? chrome.runtime.getURL("vendors/transformers/")
						: new URL(
								"../../vendors/transformers/",
								import.meta.url,
							).href;
				HF.env.backends.onnx.wasm.wasmPaths = wasmPath;
				HF.env.backends.onnx.wasm.proxy = false;
				console.log("[embedding-runner] configured wasmPaths", wasmPath);
			}
		}
	} catch {}
}

/**
 * Load embedding pipeline for a specific model
 * @param {string} modelName
 * @param {Function} [notifyProgress]
 * @returns {Promise<any>} - The HF pipeline
 */
async function loadEmbeddingPipeline(modelName, notifyProgress) {
	const startedAt = nowMs();
	await ensureHFLibrary();

	const hasWebGPU =
		typeof navigator !== "undefined" && typeof navigator.gpu !== "undefined";
	const device = resolveEmbeddingDevice(hasWebGPU);
	const progress_callback = createProgressLogger({ model: modelName }, notifyProgress);

	console.log("[embedding-runner] creating pipeline", {
		modelName,
		requestedDevice,
		device,
		hasWebGPU,
	});

	const pipeline =
		device === "webgpu"
			? await withGPULock(() =>
					HF.pipeline("feature-extraction", modelName, {
						device,
						progress_callback,
					}),
				)
			: await HF.pipeline("feature-extraction", modelName, {
					device,
					progress_callback,
				});

	console.log("[embedding-runner] pipeline created", {
		modelName,
		device,
		duration: formatMs(nowMs() - startedAt),
	});
	pipeline.__memorallDevice = device;

	// Warmup
	try {
		const warmupStartedAt = nowMs();
		if (device === "webgpu") {
			await withGPULock(() =>
				pipeline(["test"], { pooling: "mean", normalize: true }),
			);
		} else {
			await pipeline(["test"], { pooling: "mean", normalize: true });
		}
		console.log("[embedding-runner] warmup done", {
			modelName,
			device,
			duration: formatMs(nowMs() - warmupStartedAt),
		});
	} catch {}

	return pipeline;
}

/**
 * Unload embedding pipeline - dispose resources
 * @param {any} pipeline
 */
async function unloadEmbeddingPipeline(pipeline) {
	try {
		if (pipeline && typeof pipeline.dispose === "function") {
			await pipeline.dispose();
		}
	} catch (err) {
		console.warn("[embedding-runner] dispose error:", err);
	}
}

// Model lifecycle manager - handles caching and auto-unload after 5 min idle
const embeddingManager = new ModelLifecycleManager({
	name: "embedding-runner",
	loadFn: loadEmbeddingPipeline,
	unloadFn: unloadEmbeddingPipeline,
});

// `postMessage` is a shared, bidirectional channel. Ignore runner responses so
// they can never be mistaken for new requests and echoed back indefinitely.
const responseMessageTypes = new Set([
	"ready",
	"progress",
	"complete",
	"error",
	"chunk",
	"stream_chunk",
	"stream_end",
]);

window.addEventListener("message", async (event) => {
	const src = event.source;
	const origin = event.origin;
	const { messageId, type, payload } = event.data || {};

	if (
		typeof messageId !== "string" ||
		messageId.length === 0 ||
		typeof type !== "string" ||
		responseMessageTypes.has(type)
	) {
		return;
	}

	if (type === "init") {
		console.log("[embedding-runner] received init", {
			messageId,
			origin,
			payload,
			hasSource: !!src,
		});
	}

	try {
		switch (type) {
			case "init": {
				const requestedModel = payload?.modelName || defaultEmbeddingModel;
				console.log("[embedding-runner] init handler starting", {
					messageId,
					requestedModel,
					origin,
				});
				const notifyProgress = (info) => {
					try {
						reply(src, origin, messageId, "progress", info);
					} catch {}
				};

				await embeddingManager.load(requestedModel, notifyProgress);

				console.log("[embedding-runner] reply(init) ->", {
					messageId,
					targetOrigin: origin,
					hasSource: !!src,
				});
				reply(src, origin, messageId, "complete", {
					status: "initialized",
					mode: "embedding",
					model: requestedModel,
				});
				break;
			}
			case "models": {
				const status = embeddingManager.getStatus();
				const modelInfo = {
					object: "list",
					data: [
						{
							id: status.modelId || defaultEmbeddingModel,
							name: status.modelId || defaultEmbeddingModel,
							loaded: status.isLoaded,
							object: "model",
							created: Date.now(),
							owned_by: "local",
						},
					],
				};
				console.log("[embedding-runner] reply(models) ->", {
					messageId,
					targetOrigin: origin,
					hasSource: !!src,
				});
				reply(src, origin, messageId, "complete", modelInfo);
				break;
			}
			case "embeddings": {
				const { input, model } = payload || {};
				if (!input) throw new Error("input is required");

				const targetModel = model || embeddingManager.modelId || defaultEmbeddingModel;
				const texts = Array.isArray(input) ? input : [input];
				const processed = texts.map((t) =>
					typeof t === "string" ? t.replace(/\n/g, " ") : String(t),
				);

				const response = await embeddingManager.withModel(targetModel, async (pipeline) => {
					const result =
						pipeline?.__memorallDevice === "webgpu"
							? await withGPULock(() =>
									pipeline(processed, {
										pooling: "mean",
										normalize: true,
									}),
								)
							: await pipeline(processed, {
									pooling: "mean",
									normalize: true,
								});
					const list =
						typeof result.tolist === "function" ? result.tolist() : result;
					return {
						object: "list",
						data: list.map((vec, idx) => ({
							object: "embedding",
							embedding: vec,
							index: idx,
						})),
						model: targetModel,
						usage: { prompt_tokens: -1, total_tokens: -1 },
					};
				});

				reply(src, origin, messageId, "complete", response);
				break;
			}
			case "unload": {
				await embeddingManager.unload();
				reply(src, origin, messageId, "complete", {
					status: "unloaded",
				});
				break;
			}
			default:
				throw new Error(`Unknown message type: ${type}`);
		}
	} catch (err) {
		console.error("[embedding-runner] error handling message", {
			messageId,
			type,
			origin,
			err,
		});
		reply(src, origin, messageId, "error", {
			error: {
				message: (err && err.message) || "Unknown error",
				type: "invalid_request_error",
				code: null,
			},
		});
	}
});

const endpoints = ["init", "models", "embeddings", "unload"];
sendReady("embedding", endpoints);
