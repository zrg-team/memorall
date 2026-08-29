// Wllama Runner - Local LLM inference via WebAssembly (wllama v3)
import { generateId, reply, sendReady } from "../utils/common.js";
import { ModelLifecycleManager } from "../utils/model-lifecycle.js";
import { toWllamaMessages } from "../utils/openai-content.js";
import {
	detectDeviceCeilings,
	LIMITED_BY,
	planContextFromMemoryHint,
} from "../utils/context-planner.js";
import {
	kvBytesPerToken as kvBytesPerTokenOf,
	probeGgufArchitecture,
} from "../utils/gguf-metadata.js";

// v3: single WASM file — local relative path, never CDN (Chrome extension CSP)
const WASM_PATHS = {
	default: "./libs/wasm/wllama.wasm",
};

let _webGPUCached = null;
let Wllama;
let ModelManager;
const loadedModelsCache = new Map();
const activeOperations = new Map();
const pendingLoadMemoryHints = new Map();
const pendingMmprojFiles = new Map();
const DEFAULT_WLLAMA_N_CTX = 65536;
// llama.cpp reserves the whole KV cache up front, so an unreviewed GGUF from
// Hugging Face fails to load outright when the requested window is larger than
// the device can hold. Stepping down to this floor is what makes those models
// usable at all instead of erroring on the first load.
const MIN_WLLAMA_N_CTX = 2048;
const CONTEXT_ALLOCATION_ERROR = /memory|alloc|out of|oom|kv[ _-]?cache/i;

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

// Architecture read from the model's own GGUF header, cached per URL. This is
// what lets an unreviewed Hugging Face model be sized properly instead of
// starting from a blind default and failing its way down.
const architectureCache = new Map();
const ARCH_STORAGE_PREFIX = "wllama:arch:";
const ARCH_NONE_SENTINEL = "__none__";

function readArchitectureCache(url) {
	if (architectureCache.has(url)) {
		return { hit: true, value: architectureCache.get(url) };
	}
	try {
		const raw = localStorage.getItem(ARCH_STORAGE_PREFIX + url);
		if (raw !== null) {
			const value = raw === ARCH_NONE_SENTINEL ? null : JSON.parse(raw);
			architectureCache.set(url, value);
			return { hit: true, value };
		}
	} catch {}
	return { hit: false, value: undefined };
}

function writeArchitectureCache(url, architecture) {
	architectureCache.set(url, architecture);
	try {
		localStorage.setItem(
			ARCH_STORAGE_PREFIX + url,
			architecture ? JSON.stringify(architecture) : ARCH_NONE_SENTINEL,
		);
	} catch {}
}

/**
 * The model's own KV cost and trained context, or null when the header cannot
 * be read. A failed probe is never fatal: the catalogue figure, and then the
 * retry ladder, still stand behind it.
 * @param {string} url
 */
async function probeModelArchitecture(url) {
	const cached = readArchitectureCache(url);
	if (cached.hit) return cached.value;

	let architecture = null;
	try {
		architecture = await probeGgufArchitecture(url);
	} catch (error) {
		// A network hiccup must not be cached as "this model has no header".
		console.warn("[wllama-runner] GGUF header probe failed:", error?.message);
		return null;
	}
	writeArchitectureCache(url, architecture);
	return architecture;
}

let deviceCeilingsPromise = null;
function getDeviceCeilings() {
	if (!deviceCeilingsPromise) deviceCeilingsPromise = detectDeviceCeilings();
	return deviceCeilingsPromise;
}

/**
 * The context window to request for one backend.
 *
 * @param {object} context
 * @param {object} [context.memoryHint]
 * @param {number} [context.budgetGB] Budget of the backend in use.
 * @param {object|null} [context.architecture] Probed GGUF architecture.
 * @param {object} [context.ceilings] Device ceilings.
 * @param {boolean} [context.usesGPU]
 */
function planWllamaContext(context) {
	const { memoryHint, budgetGB, architecture, ceilings, usesGPU } = context;

	const plan = planContextFromMemoryHint(memoryHint, {
		budgetGB,
		ceiling: DEFAULT_WLLAMA_N_CTX,
		// The model's own header beats the catalogue's hand-computed figure, and
		// is the only source at all for a model outside the catalogue.
		kvBytesPerToken: kvBytesPerTokenOf(architecture),
		trainedContext: architecture?.trainedContext,
		weightsBytes: architecture?.fileSizeBytes,
		layerCount: architecture?.blockCount,
		// Only the GPU backend is bound by a per-buffer limit; only the wasm heap
		// is bound by the 32-bit address space.
		maxAllocationBytes: usesGPU ? ceilings?.maxAllocationBytes : undefined,
		addressSpaceBytes: usesGPU ? undefined : ceilings?.addressSpaceBytes,
	});

	if (plan) return plan;

	// Nothing usable to size with: take the product ceiling and let the ladder
	// find a window that loads.
	return {
		contextTokens: DEFAULT_WLLAMA_N_CTX,
		limitedBy: LIMITED_BY.UNKNOWN,
		fits: true,
	};
}

/**
 * Context windows to try, largest first, before giving up on a backend. Never
 * asks for more than the caller budgeted: a device that only affords 1k tokens
 * must not be handed the floor instead.
 */
function contextLadder(nCtx) {
	const steps = [];
	let value = nCtx;
	while (value > MIN_WLLAMA_N_CTX) {
		steps.push(value);
		value = Math.max(MIN_WLLAMA_N_CTX, Math.floor(value / 4));
	}
	steps.push(Math.min(nCtx, MIN_WLLAMA_N_CTX));
	return steps;
}

// Detect capabilities from the loaded model's own embedded metadata.
// Works for any GGUF from HuggingFace — no hardcoded model lists.
function detectModelCapabilities(wllama) {
	const template = wllama.getChatTemplate();
	// Native tool calling = the chat template does something with tools. That is
	// the `tools` input variable, not the assistant-side `tool_calls` output:
	// llama.cpp parses a model's calls with a parser it picks from the template
	// format, so a template that only renders tools into the system prompt (LFM2,
	// Phi-4-mini) still yields native tool_calls. Requiring the output form
	// silently downgraded 6 of the 28 catalogued models to prompt injection.
	const supportsNativeTools =
		template != null && /\btools\b|tool_call/.test(template);
	// Modalities = wllama v3 reports these from the model's own architecture
	// metadata, so any multimodal GGUF is covered without a hardcoded list.
	const supportsVision = supportsModality(wllama, "image");
	const supportsAudio = supportsModality(wllama, "audio");
	const usesGPU = wllama._usesGPU ?? false;
	return { supportsNativeTools, supportsVision, supportsAudio, usesGPU };
}

/**
 * Whether the loaded model accepts a modality. Builds without the v3 probe are
 * treated as permissive so a missing method cannot silently reject every image.
 * @param {any} wllama
 * @param {"image" | "audio"} modality
 */
function supportsModality(wllama, modality) {
	return typeof wllama?.supportInputModality === "function"
		? wllama.supportInputModality(modality)
		: true;
}

async function ensureWllama() {
	if (Wllama) return;
	const mod = await import("../libs/wllama.js");
	Wllama = mod.Wllama || mod.default;
	ModelManager = mod.ModelManager;
	if (!Wllama) throw new Error("Failed to load @wllama/wllama");
}

/**
 * Every file a model occupies in the cache. A gguf-split model is stored as one
 * cache entry per shard, all derivable from whichever shard we hold.
 * @param {string} url
 * @returns {string[]}
 */
function shardUrls(url) {
	try {
		const urls = ModelManager?.parseModelUrl?.(url);
		if (Array.isArray(urls) && urls.length > 0) return urls;
	} catch {}
	return [url];
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
 * Parse model name and return components.
 *
 * The file part keeps every remaining segment: plenty of Hugging Face GGUF
 * repos put a quantization in its own folder (`Q4_K_M/model-00001-of-00002.gguf`)
 * and truncating at the first segment would resolve to a directory.
 *
 * @param {string} model - Format: username/repo/path/to/file.gguf
 */
function parseModelName(model) {
	const parts = model.split("/");
	if (parts.length < 3) {
		throw new Error("Model name must be in format: username/repo/filename");
	}
	const repo = `${parts[0]}/${parts[1]}`;
	const filename = parts.slice(2).join("/");
	return {
		modelId: model,
		repo,
		filename,
		url: `https://huggingface.co/${repo}/resolve/main/${filename}`,
	};
}

// Two-layer cache: memory (session) + localStorage (persistent across browser restarts).
const mmprojFilenameCache = new Map();
const MMPROJ_STORAGE_PREFIX = "wllama:mmproj:";
const MMPROJ_NONE_SENTINEL = "__none__";

function readMmprojCache(repo) {
	// Memory first
	if (mmprojFilenameCache.has(repo))
		return { hit: true, value: mmprojFilenameCache.get(repo) };
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
		localStorage.setItem(
			MMPROJ_STORAGE_PREFIX + repo,
			filename ?? MMPROJ_NONE_SENTINEL,
		);
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
				.filter(
					(f) => f.endsWith(".gguf") && f.toLowerCase().includes("mmproj"),
				);
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
 * Delete a cached model using v3 CacheManager API.
 *
 * A split model occupies one cache entry per shard and a multimodal one also
 * keeps its projector, so deleting only the URL we were given would leave
 * gigabytes behind and make the model look half-downloaded afterwards.
 * @param {string} modelId
 */
async function deleteWllamaModelFromCache(modelId) {
	const { url } = parseModelName(modelId);
	const cm = await getCacheManager();
	const owned = new Set(shardUrls(url));
	const entries = await cm.list();
	for (const entry of entries) {
		if (owned.has(entry.metadata?.originalURL) && entry.metadata?.mmprojURL) {
			owned.add(entry.metadata.mmprojURL);
		}
	}
	await cm.deleteMany((entry) => owned.has(entry.metadata?.originalURL));
}

/**
 * Load one backend, shrinking the context window until it fits.
 *
 * Only allocation failures step down; anything else (a missing file, a bad
 * repo) is raised immediately rather than retried three more times.
 * @param {object} loadArgs
 * @param {object} baseOpts
 * @param {number} nCtx
 * @param {number} nGpuLayers
 */
async function loadWithContextLadder(loadArgs, baseOpts, nCtx, nGpuLayers) {
	let lastError;
	for (const contextTokens of contextLadder(nCtx)) {
		const wllama = new Wllama(WASM_PATHS, WLLAMA_CONFIG);
		try {
			await wllama.loadModelFromHF(loadArgs, {
				...baseOpts,
				n_ctx: contextTokens,
				n_gpu_layers: nGpuLayers,
			});
			wllama._usesGPU = nGpuLayers > 0;
			return wllama;
		} catch (error) {
			lastError = error;
			await unloadWllamaModel(wllama);
			if (!CONTEXT_ALLOCATION_ERROR.test(error?.message ?? "")) {
				throw error;
			}
			console.warn(
				`[wllama-runner] load failed at n_ctx=${contextTokens}, retrying smaller:`,
				error?.message,
			);
		}
	}
	throw lastError;
}

/**
 * Load a Wllama model, auto-discovering mmproj from HuggingFace if available
 * @param {string} modelId - Model identifier (username/repo/filename)
 * @param {Function} [notifyProgress]
 */
async function loadWllamaModel(modelId, notifyProgress) {
	await ensureWllama();

	const { repo, filename, url } = parseModelName(modelId);
	const memoryHint = pendingLoadMemoryHints.get(modelId);

	const progressCallback = ({ loaded, total }) => {
		if (notifyProgress) {
			const percent = Math.max(
				0,
				Math.min(100, Math.round((loaded / (total || 1)) * 100)),
			);
			notifyProgress({ loaded, total, percent, text: "" });
		}
	};

	// Prefer the reviewed model-registry filename. Network discovery remains a
	// fallback for user-supplied models, but known multimodal models must not
	// change runtime backends because a Hugging Face API request was flaky.
	const configuredMmprojFile = pendingMmprojFiles.get(modelId);
	const mmprojFile =
		typeof configuredMmprojFile === "string"
			? configuredMmprojFile
			: await resolveHFMmprojFilename(repo);
	const loadArgs = mmprojFile
		? { repo, file: filename, mmprojFile }
		: { repo, file: filename };
	const baseOpts = { progressCallback };

	// Read the model's own architecture before committing to a window. Both are
	// best-effort and independent of the load itself.
	const [architecture, ceilings] = await Promise.all([
		probeModelArchitecture(url),
		getDeviceCeilings(),
	]);

	try {
		// wllama offloads to WebGPU whenever n_gpu_layers > 0 and the device has an
		// adapter. Whether the *model* requires a GPU says nothing about whether it
		// may use one, so the catalogue's requiresWebGPU flag must not gate this —
		// every GGUF here also runs on CPU, and reading that flag as permission is
		// what kept the whole catalogue off the GPU.
		//
		// Multimodal models stay on CPU: WebGPU loads the projector but can stall
		// mid-generation, which a load-time fallback would not catch.
		const useGPU = !mmprojFile && (await detectWebGPU());

		if (useGPU) {
			// Offloaded weights and their KV cache sit in VRAM, so size the window
			// against the GPU budget rather than the system-RAM one.
			const gpuPlan = planWllamaContext({
				memoryHint,
				budgetGB: memoryHint?.webgpuAvailableGB,
				architecture,
				ceilings,
				usesGPU: true,
			});
			if (gpuPlan.fits) {
				console.log(
					`[wllama-runner] GPU context: ${gpuPlan.contextTokens} tokens (limited by ${gpuPlan.limitedBy})`,
				);
				try {
					return await loadWithContextLadder(
						loadArgs,
						baseOpts,
						gpuPlan.contextTokens,
						999,
					);
				} catch (gpuErr) {
					console.warn(
						"[wllama-runner] WebGPU load failed, retrying on CPU:",
						gpuErr?.message,
					);
				}
			}
		}

		const cpuPlan = planWllamaContext({
			memoryHint,
			architecture,
			ceilings,
			usesGPU: false,
		});
		if (!cpuPlan.fits) {
			throw new Error(
				`Model does not fit available device memory (limited by ${cpuPlan.limitedBy}, availableGB=${memoryHint?.availableGB ?? "unknown"})`,
			);
		}
		console.log(
			`[wllama-runner] CPU context: ${cpuPlan.contextTokens} tokens (limited by ${cpuPlan.limitedBy})`,
		);

		return await loadWithContextLadder(
			loadArgs,
			baseOpts,
			cpuPlan.contextTokens,
			0,
		);
	} finally {
		pendingLoadMemoryHints.delete(modelId);
		pendingMmprojFiles.delete(modelId);
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
					const sizeByURL = new Map();
					const projectorURLs = new Set();
					for (const entry of cacheEntries) {
						const originalURL = entry.metadata?.originalURL;
						if (!originalURL) continue;
						sizeByURL.set(originalURL, entry.size || 0);
						if (entry.metadata.mmprojURL) {
							projectorURLs.add(entry.metadata.mmprojURL);
						}
					}

					downloadedModels = cacheEntries
						.filter((entry) => entry.name.endsWith(".gguf"))
						.map((entry) => {
							const originURL = entry.metadata?.originalURL || "";
							// A split model is one model spread over N cache entries, and a
							// projector is never loadable on its own — listing either as its
							// own row offers the user something that cannot be served.
							const shards = shardUrls(originURL);
							if (shards[0] !== originURL || projectorURLs.has(originURL)) {
								return null;
							}
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
								size: shards.reduce(
									(total, url) => total + (sizeByURL.get(url) || 0),
									0,
								),
							};
						})
						.filter(Boolean);
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
				const { model, _memoryHint, _mmprojFile } = payload || {};
				if (!model) throw new Error("Model name is required");

				parseModelName(model);
				if (_memoryHint) {
					pendingLoadMemoryHints.set(model, _memoryHint);
				}
				if (_mmprojFile) {
					pendingMmprojFiles.set(model, _mmprojFile);
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
						// ModelInfo carries these at the top level and that is what the
						// warm-serve path reads back; nesting them only under
						// `capabilities` let a re-served model silently lose its detected
						// tool and vision support.
						supportsNativeTools: capabilities.supportsNativeTools,
						supportsVision: capabilities.supportsVision,
						supportsAudio: capabilities.supportsAudio,
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
					_mmprojFile,
				} = payload || {};

				if (!messages) throw new Error("Messages are required");

				const targetModel = model || wllamaManager.modelId;
				if (!targetModel) {
					throw new Error(
						"No model specified and no model loaded. Call serve first.",
					);
				}

				parseModelName(targetModel);

				const abortController = new AbortController();
				activeOperations.set(messageId, { abortController });
				if (_memoryHint) {
					pendingLoadMemoryHints.set(targetModel, _memoryHint);
				}
				if (_mmprojFile) {
					pendingMmprojFiles.set(targetModel, _mmprojFile);
				}

				try {
					await wllamaManager.withModel(targetModel, async (wllama) => {
						const loadedCtx = wllama.getLoadedContextInfo?.();
						const maxContextTokens =
							typeof loadedCtx?.n_ctx === "number"
								? loadedCtx.n_ctx
								: undefined;
						const memoryContextTokens = planContextFromMemoryHint(_memoryHint, {
							budgetGB: wllama._usesGPU
								? _memoryHint?.webgpuAvailableGB
								: undefined,
						})?.contextTokens;
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

						// Images and audio arrive as OpenAI URL parts and must be decoded
						// to the bytes wllama swaps for the model's media marker.
						const wllamaMessages = await toWllamaMessages(messages, {
							supportsModality: (modality) =>
								supportsModality(wllama, modality),
						});

						const completionOptions = {
							messages: wllamaMessages,
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
								abortSignal: abortController.signal,
							});
							if (
								!streamIter ||
								typeof streamIter[Symbol.asyncIterator] !== "function"
							) {
								throw new TypeError(
									"Wllama streaming completion did not return an async iterable",
								);
							}

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

							reply(
								src,
								origin,
								messageId,
								"stream_end",
								lastChunk ?? {
									id: `chatcmpl-${generateId()}`,
									object: "chat.completion.chunk",
									created: Math.floor(Date.now() / 1000),
									model: targetModel,
									choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
								},
							);
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
