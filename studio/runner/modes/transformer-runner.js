// Transformer Runner controller - Local LLM inference via HuggingFace Transformers.js with WebGPU
import { reply, sendReady } from "../utils/common.js";
import { ModelLifecycleManager } from "../utils/model-lifecycle.js";
import { ensureTransformerRunnerCatalog } from "./transformmers/catalog.js";
import {
	getCachedTransformerModelIds,
} from "./transformmers/cache.js";
import {
	executeChatCompletion,
	isRecoverableWebGPUExecutionError,
	WEBGPU_CONTEXT_LOST_CODE,
} from "./transformmers/chat-completions.js";
import { getWebgpuCapabilities } from "./transformmers/context.js";
import {
	clearLoadableDtypeCache,
	dtypeSpecLabel,
} from "./transformmers/dtype.js";
import {
	loadTransformerModel,
	unloadTransformerModel,
} from "./transformmers/model-loader.js";
import { toRunnerErrorPayload } from "./transformmers/responses.js";

const loadedModelsCache = new Map();
const activeOperations = new Map();
let currentMessageContext = null;

const transformerManager = new ModelLifecycleManager({
	name: "transformer-runner",
	loadFn: loadTransformerModel,
	unloadFn: unloadTransformerModel,
});

function serializeWebgpuCapabilities(value) {
	return {
		available: Boolean(value?.available),
		supportsF16: Boolean(value?.supportsF16),
		features: Array.isArray(value?.features)
			? value.features.filter((feature) => typeof feature === "string")
			: [],
		maxBufferSize: Number(value?.maxBufferSize ?? 0),
		maxStorageBufferBindingSize: Number(
			value?.maxStorageBufferBindingSize ?? 0,
		),
	};
}

function serializeModelInfo(modelInfo) {
	if (!modelInfo) return undefined;
	const { webgpuCapabilities, ...rest } = modelInfo;
	return {
		...rest,
		...(webgpuCapabilities
			? { webgpuCapabilities: serializeWebgpuCapabilities(webgpuCapabilities) }
			: {}),
	};
}

async function handleModels(src, origin, messageId) {
	await ensureTransformerRunnerCatalog();
	try {
		const modelIds = await getCachedTransformerModelIds();
		const currentModelId = transformerManager.modelId;

		if (currentModelId) {
			modelIds.add(currentModelId);
		}
		for (const cachedModelId of loadedModelsCache.keys()) {
			modelIds.add(cachedModelId);
		}

		const downloadedModels = Array.from(modelIds).map((modelId) => {
			const isLoaded = currentModelId === modelId && transformerManager.isLoaded;
			const cachedModelInfo = serializeModelInfo(loadedModelsCache.get(modelId));
			if (cachedModelInfo) {
				cachedModelInfo.loaded = isLoaded;
			}
			return {
				id: modelId,
				name: modelId,
				object: "model",
				created: Date.now(),
				owned_by: "transformer",
				downloaded: true,
				...(cachedModelInfo ?? {}),
				loaded: isLoaded,
			};
		});

		reply(src, origin, messageId, "complete", {
			object: "list",
			data: downloadedModels,
		});
	} catch (error) {
		console.error("Failed to get cached models:", error);
		reply(src, origin, messageId, "complete", {
			object: "list",
			data: [],
		});
	}
}

async function handleServe(src, origin, messageId, payload) {
	const { model } = payload || {};
	if (!model) throw new Error("Model ID is required");

	const notifyProgress = (info) => {
		reply(src, origin, messageId, "progress", info);
	};

	try {
		const bundle = await transformerManager.load(model, notifyProgress);
		const quantizationInfo = {
			q4: "4-bit (smallest, fastest)",
			q4f16: "4-bit weights + fp16 activations",
			fp16: "16-bit floating point",
			q8: "8-bit quantization",
		}[bundle.dtype] || dtypeSpecLabel(bundle.dtype);

		console.log(`[transformer-runner] model serving with ${quantizationInfo}`);

		const modelInfo = {
			id: model,
			object: "model",
			created: Math.floor(Date.now() / 1000),
			owned_by: "transformer",
			loaded: true,
			downloaded: true,
			dtype: dtypeSpecLabel(bundle.dtype),
			device: bundle.device,
			numThreads: bundle.numThreads,
			modelLoader: bundle.modelLoader,
			supportsNativeTools: Boolean(bundle.supportsNativeTools),
			supportsVision: Boolean(bundle.supportsVision),
			webgpuCapabilities: serializeWebgpuCapabilities(getWebgpuCapabilities()),
		};

		loadedModelsCache.set(model, modelInfo);
		reply(src, origin, messageId, "complete", modelInfo);
	} catch (error) {
		console.error("[transformer-runner] model loading failed:", error);

		const errorStr = error instanceof Error ? error.message : String(error);
		const isMemoryError =
			errorStr.includes("Aborted") ||
			errorStr.includes("abort") ||
			errorStr.includes("memory") ||
			/^\d+$/.test(errorStr);

		let errorMessage = `Failed to load model: ${errorStr || "Unknown error"}`;
		if (isMemoryError) {
			const requestedModel = typeof model === "string" ? model : "This model";
			errorMessage +=
				"\n\nThis is likely due to insufficient memory or WebGPU issues. " +
				`${requestedModel} may require more available RAM or a different execution backend than your browser can provide. ` +
				"Try:\n1. Closing other browser tabs\n2. Restarting your browser\n3. Using a smaller model";
		}

		reply(
			src,
			origin,
			messageId,
			"error",
			toRunnerErrorPayload(errorMessage, {
				type: "ModelLoadError",
				code: "TRANSFORMER_MODEL_LOAD_FAILED",
				modelId: typeof model === "string" ? model : null,
			}),
		);
	}
}

async function handleChatCompletions(
	src,
	origin,
	messageId,
	payload,
	signal,
) {
	const { messages, model } = payload || {};
	if (!messages) throw new Error("Messages are required");

	const targetModel = model || transformerManager.modelId;
	if (!targetModel) {
		throw new Error("No model specified and no model loaded. Call serve first.");
	}

	try {
		await executeChatCompletion({
			transformerManager,
			targetModel,
			src,
			origin,
			messageId,
			payload,
			signal,
		});
	} catch (error) {
		// A lost WebGPU context cannot be repaired from in here: reloading the
		// model only builds a new session on the same dead device. Drop the model
		// so the weights are not stranded, then tell the host, which recycles the
		// whole runner document and replays the request.
		const contextLost = isRecoverableWebGPUExecutionError(error);
		if (contextLost) {
			console.warn(
				"[transformer-runner] WebGPU context lost, unloading model:",
				error,
			);
			try {
				await transformerManager.unload();
			} catch (unloadError) {
				console.warn(
					"[transformer-runner] failed to unload after WebGPU error:",
					unloadError,
				);
			}
		}

		reply(src, origin, messageId, "error", {
			error: {
				message: `Chat completion failed: ${error.message}`,
				type: "CompletionError",
				code: contextLost ? WEBGPU_CONTEXT_LOST_CODE : null,
				modelId: targetModel,
				serviceName: "transformer",
			},
		});
	}
}

async function handleUnload(src, origin, messageId, payload) {
	const { model } = payload || {};
	const currentModel = transformerManager.modelId;

	if (model && model !== currentModel) {
		const modelInfo = loadedModelsCache.get(model);
		if (modelInfo) {
			modelInfo.loaded = false;
			loadedModelsCache.set(model, modelInfo);
		}

		reply(src, origin, messageId, "complete", {
			status: "unloaded",
			model,
		});
		return;
	}

	await transformerManager.unload();

	if (currentModel) {
		const modelInfo = loadedModelsCache.get(currentModel);
		if (modelInfo) {
			modelInfo.loaded = false;
			loadedModelsCache.set(currentModel, modelInfo);
		}
	}

	reply(src, origin, messageId, "complete", {
		status: "unloaded",
		model: model || currentModel,
	});
}

async function handleDelete(src, origin, messageId, payload) {
	const { model } = payload || {};
	if (!model) throw new Error("Model name is required");

	try {
		if (transformerManager.modelId === model) {
			await transformerManager.unload();
		}

		const caches = await window.caches.open("transformers-cache");
		const keys = await caches.keys();
		for (const request of keys) {
			if (request.url.includes(model)) {
				await caches.delete(request);
			}
		}

		loadedModelsCache.delete(model);
		clearLoadableDtypeCache(model);
		reply(src, origin, messageId, "complete", { status: "deleted", model });
	} catch (error) {
		reply(src, origin, messageId, "error", {
			error: {
				message: `Delete failed: ${error.message}`,
				type: "DeleteError",
				code: null,
			},
		});
	}
}

// `postMessage` is a shared, bidirectional channel that anything on the page can
// write to — other extensions' content scripts included. Ignore anything that is
// not one of our requests, and ignore our own responses so they can never be
// mistaken for new requests and echoed back indefinitely.
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

	currentMessageContext = { src, origin, messageId };

	try {
		switch (type) {
			case "abort": {
				const operation = activeOperations.get(messageId);
				if (operation?.abortController) {
					operation.abortController.abort();
				}
				return;
			}

			case "init":
				await ensureTransformerRunnerCatalog();
				reply(src, origin, messageId, "complete", {
					status: "initialized",
					mode: "transformer",
				});
				break;

			case "models":
				await handleModels(src, origin, messageId);
				break;

			case "serve":
				await handleServe(src, origin, messageId, payload);
				break;

			case "chat/completions": {
				const abortController = new AbortController();
				activeOperations.set(messageId, { abortController });
				try {
					await handleChatCompletions(
						src,
						origin,
						messageId,
						payload,
						abortController.signal,
					);
				} finally {
					activeOperations.delete(messageId);
				}
				break;
			}

			case "unload":
				await handleUnload(src, origin, messageId, payload);
				break;

			case "delete":
				await handleDelete(src, origin, messageId, payload);
				break;

			default:
				reply(src, origin, messageId, "error", {
					error: {
						message: `Unknown message type: ${type}`,
						type: "UnknownMessageType",
						code: null,
					},
				});
		}
	} catch (error) {
		console.error("Transformer runner error:", error);
		reply(src, origin, messageId, "error", toRunnerErrorPayload(error));
	} finally {
		currentMessageContext = null;
	}
});

window.addEventListener("unhandledrejection", (event) => {
	event.preventDefault();
	const error = event.reason;
	console.error("[transformer-runner] Unhandled promise rejection caught:", error);

	if (currentMessageContext) {
		const { src, origin, messageId } = currentMessageContext;
		currentMessageContext = null;

		const errorMsg =
			error instanceof Error ? error.message : String(error || "Unknown error");
		const isOOM =
			error instanceof RangeError ||
			errorMsg.includes("Array buffer allocation failed") ||
			errorMsg.includes("memory") ||
			errorMsg.includes("Aborted") ||
			/^\d+$/.test(errorMsg);

		let message = `Operation failed: ${errorMsg}`;
		if (isOOM) {
			message =
				"Model loading failed: out of memory (Array buffer allocation failed). " +
				"Try closing other browser tabs, restarting your browser, or using a smaller model.";
		}

		reply(src, origin, messageId, "error", {
			error: {
				message,
				type: isOOM ? "OutOfMemoryError" : (error?.name || "Error"),
				code: isOOM ? "TRANSFORMER_OOM" : "TRANSFORMER_UNHANDLED_ERROR",
				modelId: null,
				serviceName: "transformer",
			},
		});
	}
});

window.addEventListener("error", (event) => {
	console.error(
		"[transformer-runner] Uncaught error in iframe:",
		event.error || event.message,
	);

	if (currentMessageContext) {
		const { src, origin, messageId } = currentMessageContext;
		currentMessageContext = null;

		reply(
			src,
			origin,
			messageId,
			"error",
			toRunnerErrorPayload(event.error || new Error(event.message || "Unknown error")),
		);
	}
});

const endpoints = [
	"init",
	"serve",
	"models",
	"chat/completions",
	"unload",
	"delete",
];
sendReady("transformer", endpoints);
