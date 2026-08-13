// Wllama Runner - Local LLM inference via WebAssembly (wllama v3)
import { reply, generateId, sendReady } from "../utils/common.js";
import { ModelLifecycleManager } from "../utils/model-lifecycle.js";

// v3: single WASM file — local relative path, never CDN (Chrome extension CSP)
const WASM_PATHS = {
	default: "./libs/wasm/wllama.wasm",
};

let _webGPUCached = null;
let Wllama;
const loadedModelsCache = new Map();
const activeOperations = new Map();
const pendingLoadMemoryHints = new Map();
const DEFAULT_WLLAMA_N_CTX = 65536;

async function detectWebGPU() {
	if (_webGPUCached !== null) return _webGPUCached;
	if (!navigator.gpu) {
		_webGPUCached = false;
		return false;
	}

	try {
		const adapter = await navigator.gpu.requestAdapter();
		_webGPUCached = adapter !== null;
	} catch {
		_webGPUCached = false;
	}

	return _webGPUCached;
}

function resolveMemoryContextTokens(memoryHint) {
	if (!memoryHint || typeof memoryHint !== "object") {
		return undefined;
	}

	const { availableGB, sizeGB, kvBytesPerToken, contextLength } = memoryHint;
	const hasValidNumbers =
		typeof availableGB === "number" &&
		Number.isFinite(availableGB) &&
		availableGB > 0 &&
		typeof sizeGB === "number" &&
		Number.isFinite(sizeGB) &&
		sizeGB >= 0 &&
		typeof kvBytesPerToken === "number" &&
		Number.isFinite(kvBytesPerToken) &&
		kvBytesPerToken > 0;

	if (!hasValidNumbers) {
		return undefined;
	}

	const availableForKV = availableGB / 1.2 - sizeGB;
	if (availableForKV <= 0) {
		return 0;
	}

	const maxTokens = Math.floor((availableForKV * 1024 ** 3) / kvBytesPerToken);
	const roundedTokens = Math.max(0, Math.floor(maxTokens / 1024) * 1024);

	if (
		typeof contextLength === "number" &&
		Number.isFinite(contextLength) &&
		contextLength > 0
	) {
		return Math.min(roundedTokens, contextLength);
	}

	return roundedTokens;
}

// Detect capabilities from the loaded model's own embedded metadata.
// Works for any GGUF from HuggingFace — no hardcoded model lists.
function detectModelCapabilities(wllama) {
	const template = wllama.getChatTemplate();
	// Native tool calling = model embeds an OAI-compatible tool_calls chat template
	const supportsNativeTools = template != null && template.includes("tool_calls");
	// Vision = wllama v3 reports this directly from model architecture metadata
	const supportsVision = wllama.supportInputModality?.("image") ?? false;
	const usesGPU = wllama._usesGPU ?? false;
	return { supportsNativeTools, supportsVision, usesGPU };
}

async function ensureWllama() {
	if (Wllama) return;
	const mod = await import("../libs/wllama.js");
	Wllama = mod.Wllama || mod.default;
	if (!Wllama) throw new Error("Failed to load @wllama/wllama");
}

// CacheManager is accessed via the Wllama instance's public cacheManager field.
// OPFS is shared so any instance sees the same cache — create a temporary one
// when no model is currently loaded.
const WLLAMA_CONFIG = { allowOffline: true };

async function getCacheManager() {
	if (wllamaManager.model?.cacheManager) {
		return wllamaManager.model.cacheManager;
	}
	await ensureWllama();
	return new Wllama(WASM_PATHS, WLLAMA_CONFIG).cacheManager;
}

/**
 * Parse model name and return components
 * @param {string} model - Format: username/repo/filename
 */
function parseModelName(model) {
	const parts = model.split("/");
	if (parts.length < 3) {
		throw new Error("Model name must be in format: username/repo/filename");
	}
	return {
		modelId: model,
		repo: `${parts[0]}/${parts[1]}`,
		filename: parts[2],
		url: `https://huggingface.co/${parts[0]}/${parts[1]}/resolve/main/${parts[2]}`,
	};
}

// Two-layer cache: memory (session) + localStorage (persistent across browser restarts).
const mmprojFilenameCache = new Map();
const MMPROJ_STORAGE_PREFIX = "wllama:mmproj:";
const MMPROJ_NONE_SENTINEL = "__none__";

function readMmprojCache(repo) {
	// Memory first
	if (mmprojFilenameCache.has(repo)) return { hit: true, value: mmprojFilenameCache.get(repo) };
	// Persistent storage
	try {
		const raw = localStorage.getItem(MMPROJ_STORAGE_PREFIX + repo);
		if (raw !== null) {
			const value = raw === MMPROJ_NONE_SENTINEL ? null : raw;
			mmprojFilenameCache.set(repo, value);
			return { hit: true, value };
		}
	} catch {}
	return { hit: false, value: undefined };
}

function writeMmprojCache(repo, filename) {
	mmprojFilenameCache.set(repo, filename);
	try {
		localStorage.setItem(MMPROJ_STORAGE_PREFIX + repo, filename ?? MMPROJ_NONE_SENTINEL);
	} catch {}
}

/**
 * Discover the mmproj filename for a HuggingFace repo.
 * Cached persistently in localStorage — survives browser restarts.
 * Network errors are not cached so the next load retries.
 * @param {string} repo - e.g. "LiquidAI/LFM2-VL-450M-GGUF"
 * @returns {Promise<string|null>}
 */
async function resolveHFMmprojFilename(repo) {
	const cached = readMmprojCache(repo);
	if (cached.hit) return cached.value;

	let result = null;
	try {
		const res = await fetch(`https://huggingface.co/api/models/${repo}`);
		if (res.ok) {
			const data = await res.json();
			const siblings = data.siblings ?? [];
			const mmprojFiles = siblings
				.map((s) => s.rfilename)
				.filter((f) => f.endsWith(".gguf") && f.toLowerCase().includes("mmproj"));
			result =
				mmprojFiles.find((f) => f.includes("Q8_0")) ??
				mmprojFiles.find((f) => f.includes("Q4_K_M")) ??
				mmprojFiles[0] ??
				null;
		}
	} catch {
		// Network unavailable — do not cache, retry on next load
		return null;
	}

	writeMmprojCache(repo, result);
	return result;
}

/**
 * Delete a cached model using v3 CacheManager API
 * @param {string} modelId
 */
async function deleteWllamaModelFromCache(modelId) {
	const { url } = parseModelName(modelId);
	const cm = await getCacheManager();
	await cm.delete(url);
}

/**
 * Load a Wllama model, auto-discovering mmproj from HuggingFace if available
 * @param {string} modelId - Model identifier (username/repo/filename)
 * @param {Function} [notifyProgress]
 */
async function loadWllamaModel(modelId, notifyProgress) {
	await ensureWllama();

	const { repo, filename } = parseModelName(modelId);
	const memoryHint = pendingLoadMemoryHints.get(modelId);
	const memoryContextTokens = resolveMemoryContextTokens(memoryHint);

	if (typeof memoryContextTokens === "number" && memoryContextTokens <= 0) {
		throw new Error(
			`Model does not fit available device memory (availableGB=${memoryHint?.availableGB ?? "unknown"})`,
		);
	}

	const nCtx =
		typeof memoryContextTokens === "number"
			? Math.min(DEFAULT_WLLAMA_N_CTX, memoryContextTokens)
			: DEFAULT_WLLAMA_N_CTX;

	const progressCallback = ({ loaded, total }) => {
		if (notifyProgress) {
			const percent = Math.max(0, Math.min(100, Math.round((loaded / (total || 1)) * 100)));
			notifyProgress({ loaded, total, percent, text: "" });
		}
	};

	// Discover mmproj filename from HF repo — loadModelFromHF resolves the full URL internally
	const mmprojFile = await resolveHFMmprojFilename(repo);
	const loadArgs = mmprojFile
		? { repo, file: filename, mmprojFile }
		: { repo, file: filename };
	const baseOpts = { progressCallback, n_ctx: nCtx };

	try {
		// WebGPU currently loads some multimodal projector models but can stall during generation.
		const useGPU = !mmprojFile && (await detectWebGPU());

		if (useGPU) {
			try {
				const wllamaGPU = new Wllama(WASM_PATHS, WLLAMA_CONFIG);
				await wllamaGPU.loadModelFromHF(loadArgs, { ...baseOpts, n_gpu_layers: 999 });
				wllamaGPU._usesGPU = true;
				return wllamaGPU;
			} catch (gpuErr) {
				console.warn("[wllama-runner] WebGPU load failed, retrying on CPU:", gpuErr?.message);
			}
		}

		const wllama = new Wllama(WASM_PATHS, WLLAMA_CONFIG);
		await wllama.loadModelFromHF(loadArgs, { ...baseOpts, n_gpu_layers: 0 });
		wllama._usesGPU = false;
		return wllama;
	} finally {
		pendingLoadMemoryHints.delete(modelId);
	}
}

/**
 * Unload Wllama instance
 * @param {any} wllama
 */
async function unloadWllamaModel(wllama) {
	try {
		if (wllama && typeof wllama.exit === "function") {
			await wllama.exit();
		}
	} catch (e) {
		console.warn("[wllama-runner] unload error:", e?.message || e);
	}
}

// Model lifecycle manager — handles caching and auto-unload after idle
const wllamaManager = new ModelLifecycleManager({
	name: "wllama-runner",
	loadFn: loadWllamaModel,
	unloadFn: unloadWllamaModel,
});

window.addEventListener("message", async (event) => {
	const src = event.source;
	const origin = event.origin;
	const { messageId, type, payload } = event.data || {};

	try {
		switch (type) {
			case "abort": {
				const operation = activeOperations.get(messageId);
				if (operation?.abortController) {
					operation.abortController.abort();
					activeOperations.delete(messageId);
				}
				return;
			}

			case "init": {
				await ensureWllama();
				reply(src, origin, messageId, "complete", {
					status: "initialized",
					mode: "wllama",
				});
				break;
			}

			case "models": {
				await ensureWllama();
				const cm = await getCacheManager();
				const currentModelId = wllamaManager.modelId;
				let downloadedModels = [];

				try {
					const cacheEntries = await cm.list();
					downloadedModels = cacheEntries
						.filter((entry) => entry.name.endsWith(".gguf"))
						.map((entry) => {
							const originURL = entry.metadata?.originalURL || "";
							const match = originURL.match(
								/^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/main\/(.+)$/,
							);
							const name = match ? match[1] : "";
							const filename = match ? match[2] : entry.name;
							const fullModelId =
								name && filename ? `${name}/${filename}` : entry.name;
							const isLoaded =
								currentModelId &&
								fullModelId.toLowerCase() === currentModelId.toLowerCase();
							return {
								id: fullModelId,
								name: fullModelId,
								filename,
								loaded: !!isLoaded,
								downloaded: true,
								object: "model",
								created: Date.now(),
								owned_by: "local",
								size: entry.size || 0,
							};
						});
				} catch (error) {
					console.error("Failed to get cached models:", error);
				}

				reply(src, origin, messageId, "complete", {
					object: "list",
					data: downloadedModels,
				});
				break;
			}

			case "serve": {
				const { model, _memoryHint } = payload || {};
				if (!model) throw new Error("Model name is required");

				parseModelName(model);
				if (_memoryHint) {
					pendingLoadMemoryHints.set(model, _memoryHint);
				}

				const notifyProgress = (info) => {
					reply(src, origin, messageId, "progress", info);
				};

				try {
					await wllamaManager.load(model, notifyProgress);

					const capabilities = detectModelCapabilities(wllamaManager.model);

					const modelInfo = {
						id: model,
						object: "model",
						created: Math.floor(Date.now() / 1000),
						owned_by: "wllama",
						permission: [],
						root: model,
						parent: null,
						loaded: true,
						downloaded: true,
						capabilities,
					};

					loadedModelsCache.set(model, modelInfo);
					reply(src, origin, messageId, "complete", modelInfo);
				} catch (error) {
					reply(src, origin, messageId, "error", {
						error: {
							message: `Failed to load model: ${error.message}`,
							type: "ModelLoadError",
							code: null,
						},
					});
				}
				break;
			}

			case "chat/completions": {
				const {
					messages,
					model,
					stream = false,
					max_tokens = 512,
					temperature = 0.8,
					top_p = 0.9,
					top_k = 40,
					stop,
					tools,
					tool_choice,
					_memoryHint,
				} = payload || {};

				if (!messages) throw new Error("Messages are required");

				const targetModel = model || wllamaManager.modelId;
				if (!targetModel) {
					throw new Error("No model specified and no model loaded. Call serve first.");
				}

				parseModelName(targetModel);

				const abortController = new AbortController();
				activeOperations.set(messageId, { abortController });
				if (_memoryHint) {
					pendingLoadMemoryHints.set(targetModel, _memoryHint);
				}

				try {
					await wllamaManager.withModel(targetModel, async (wllama) => {
						const loadedCtx = wllama.getLoadedContextInfo?.();
						const maxContextTokens =
							typeof loadedCtx?.n_ctx === "number" ? loadedCtx.n_ctx : undefined;
						const memoryContextTokens = resolveMemoryContextTokens(_memoryHint);
						const maxTotalContext =
							typeof maxContextTokens === "number" &&
							typeof memoryContextTokens === "number"
								? Math.min(maxContextTokens, memoryContextTokens)
								: typeof maxContextTokens === "number"
								? maxContextTokens
								: memoryContextTokens;

						const requestedMaxTokens =
							typeof max_tokens === "number" && Number.isFinite(max_tokens)
								? max_tokens
								: 512;
						const effectiveMaxTokens =
							typeof maxTotalContext === "number"
								? Math.min(requestedMaxTokens, Math.max(0, maxTotalContext))
								: requestedMaxTokens;

						const completionOptions = {
							messages,
							max_tokens: effectiveMaxTokens,
							temperature: typeof temperature === "number" ? temperature : 0.8,
							top_p: typeof top_p === "number" ? top_p : 0.9,
							top_k: typeof top_k === "number" ? top_k : 40,
							...(stop ? { stop: Array.isArray(stop) ? stop : [stop] } : {}),
							...(tools ? { tools, tool_choice } : {}),
						};

						if (stream) {
							const streamIter = await wllama.createChatCompletion({
								...completionOptions,
								stream: true,
								onData: () => {},
								abortSignal: abortController.signal,
							});

							let lastChunk = null;
							for await (const chunk of streamIter) {
								if (abortController.signal.aborted) break;
								const enriched = { ...chunk, model: targetModel };
								if (chunk.choices?.[0]?.finish_reason != null) {
									lastChunk = enriched;
								} else {
									reply(src, origin, messageId, "stream_chunk", enriched);
								}
							}

							reply(src, origin, messageId, "stream_end", lastChunk ?? {
								id: `chatcmpl-${generateId()}`,
								object: "chat.completion.chunk",
								created: Math.floor(Date.now() / 1000),
								model: targetModel,
								choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
							});
						} else {
							const response = await wllama.createChatCompletion({
								...completionOptions,
								stream: false,
							});
							reply(src, origin, messageId, "complete", {
								...response,
								model: targetModel,
							});
						}
					});
				} catch (error) {
					console.error("Wllama chat error:", error);
					throw error;
				} finally {
					activeOperations.delete(messageId);
				}
				break;
			}

			case "unload": {
				const { model } = payload || {};
				const currentModel = wllamaManager.modelId;

				if (model) {
					parseModelName(model);
					if (model !== currentModel) {
						throw new Error(`Model ${model} is not loaded`);
					}
				}

				await wllamaManager.unload();

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
				break;
			}

			case "delete": {
				const { model } = payload || {};
				if (!model) throw new Error("Model name is required");

				parseModelName(model);

				if (wllamaManager.modelId === model) {
					await wllamaManager.unload();
				}

				await deleteWllamaModelFromCache(model);

				loadedModelsCache.delete(model);
				reply(src, origin, messageId, "complete", {
					status: "deleted",
					model,
				});
				break;
			}

			default:
				throw new Error(`Unknown message type: ${type}`);
		}
	} catch (error) {
		console.error("Wllama error:", error);
		reply(src, origin, messageId, "error", {
			error: {
				message: error.message || "Unknown error",
				type: error.constructor.name || "Error",
				code: null,
			},
		});
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
sendReady("wllama", endpoints);

console.log("Wllama runner initialized (v3)");
