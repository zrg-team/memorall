// WebLLM Runner - WebGPU-accelerated chat completions via WebLLM
import { reply, generateId, sendReady } from "../utils/common.js";
import { ModelLifecycleManager } from "../utils/model-lifecycle.js";

// Scoped state
let WebLLMEngine;
let WebLLMMod;
let prebuiltAppConfig;
const loadedModelsCache = new Map(); // Cache model metadata
const activeOperations = new Map(); // Track active operations for abort support
const IMAGE_EMBED_SIZE = 1921;
const MODEL_LOAD_STALL_TIMEOUT_MS = 2 * 60 * 1000;

// Query downloaded status via WebLLM engine APIs when available
async function isDownloaded(modelId) {
	try {
		if (WebLLMMod && typeof WebLLMMod.hasModelInCache === "function") {
			return await WebLLMMod.hasModelInCache(modelId);
		}
		const engine = webllmManager.model;
		if (engine && typeof engine.hasModelInCache === "function") {
			return await engine.hasModelInCache(modelId);
		}
	} catch (e) {
		console.warn("[downloaded] hasModelInCache error:", e?.message || e);
	}
	return false;
}

async function ensureWebLLM() {
	if (WebLLMEngine) return;
	try {
		// Help WebLLM avoid worker creation in iframe contexts
		if (typeof window !== "undefined") {
			window.__WEBLLM_NO_WORKER__ = true;
		}

		// Import bundled WebLLM
		const mod = await import("../libs/web-llm.js");
		WebLLMMod = mod;

		if (!mod.MLCEngine) {
			throw new Error("MLCEngine export not found");
		}
		WebLLMEngine = mod.MLCEngine;

		prebuiltAppConfig =
			mod.prebuiltAppConfig ||
			mod.prebuiltAppConfigV2 ||
			mod.prebuiltConfig ||
			null;
		if (!prebuiltAppConfig) {
			prebuiltAppConfig = { model_list: [] };
		}
	} catch (e) {
		console.error("WebLLM load error:", e);
		throw e;
	}
}

// Stored progress callback for current load operation
let currentProgressCallback = null;

function deepEqual(left, right) {
	if (left === right) {
		return true;
	}

	if (typeof left !== typeof right || left === null || right === null) {
		return false;
	}

	if (typeof left !== "object") {
		return false;
	}

	if (Array.isArray(left) !== Array.isArray(right)) {
		return false;
	}

	if (Array.isArray(left)) {
		if (left.length !== right.length) {
			return false;
		}
		for (let i = 0; i < left.length; i++) {
			if (!deepEqual(left[i], right[i])) {
				return false;
			}
		}
		return true;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	for (const key of leftKeys) {
		if (!rightKeys.includes(key) || !deepEqual(left[key], right[key])) {
			return false;
		}
	}

	return true;
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

function cloneConversation(conversation) {
	const cloned = new conversation.constructor(
		conversation.config,
		conversation.isTextCompletion,
	);
	cloned.messages = conversation.messages.map((message) =>
		Array.isArray(message) ? message.map((entry) => entry) : message,
	);
	cloned.function_string = conversation.function_string;
	cloned.use_function_calling = conversation.use_function_calling;
	cloned.override_system_message = conversation.override_system_message;
	cloned.isLastMessageEmptyThinkingReplyHeader =
		conversation.isLastMessageEmptyThinkingReplyHeader;
	cloned.prompt = conversation.prompt;
	return cloned;
}

function conversationsEqual(left, right) {
	return (
		left.function_string === right.function_string &&
		left.use_function_calling === right.use_function_calling &&
		left.override_system_message === right.override_system_message &&
		left.isTextCompletion === right.isTextCompletion &&
		deepEqual(left.messages, right.messages)
	);
}

function buildConversationFromMessages(pipeline, messages, includeLastMsg = false) {
	const conversation = new pipeline.conversation.constructor(
		pipeline.conversation.config,
		false,
	);
	const lastId = messages.length - 1;
	if (messages[lastId].role !== "user" && messages[lastId].role !== "tool") {
		throw new Error("The last message should be from the user or tool.");
	}

	const iterEnd = includeLastMsg ? messages.length : messages.length - 1;
	for (let i = 0; i < iterEnd; i++) {
		const message = messages[i];
		if (message.role === "system") {
			if (i !== 0) {
				throw new Error("System message must be the first message.");
			}
			conversation.override_system_message = message.content;
		} else if (message.role === "user") {
			conversation.appendMessage("user", message.content, message.name);
		} else if (message.role === "assistant") {
			conversation.appendMessage("assistant", message.content, message.name);
		} else if (message.role === "tool") {
			conversation.appendMessage("tool", message.content);
		} else {
			throw new Error(`Unsupported role: ${message.role}`);
		}
	}

	return conversation;
}

function countPromptTokens(tokenizer, prompts) {
	let numPromptTokens = 0;

	for (const prompt of prompts) {
		if (typeof prompt === "string") {
			numPromptTokens += tokenizer.encode(prompt).length;
			continue;
		}

		for (const part of prompt) {
			if (typeof part === "string") {
				numPromptTokens += tokenizer.encode(part).length;
			} else {
				numPromptTokens += IMAGE_EMBED_SIZE;
			}
		}
	}

	return numPromptTokens;
}

function resolveWebLLMPromptBudget(engine, modelId, messages, requestBody) {
	const pipeline = engine?.loadedModelIdToPipeline?.get?.(modelId);
	if (!pipeline?.conversation || !pipeline?.tokenizer) {
		return { promptLength: 0, maxContextTokens: undefined };
	}

	const oldConversation = pipeline.getConversationObject();
	const newConversation = buildConversationFromMessages(pipeline, messages, false);
	const reuseKVCache =
		newConversation.messages.length > 0 &&
		conversationsEqual(oldConversation, newConversation);
	const workingConversation = reuseKVCache
		? cloneConversation(oldConversation)
		: newConversation;
	const lastMessage = messages[messages.length - 1];

	workingConversation.appendMessage(
		lastMessage.role === "tool" ? "tool" : "user",
		lastMessage.content,
		lastMessage.role === "user" ? lastMessage.name : undefined,
	);

	if (requestBody?.extra_body?.enable_thinking === false) {
		workingConversation.appendEmptyThinkingReplyHeader(
			"assistant",
			"<think>\n\n</think>\n\n",
		);
	} else {
		workingConversation.appendReplyHeader("assistant");
	}

	const effectiveFilledKVCacheLength = reuseKVCache ? pipeline.filledKVCacheLength : 0;
	const prompts =
		effectiveFilledKVCacheLength > 0
			? workingConversation.getPromptArrayLastRound()
			: workingConversation.getPromptArray();
	let promptLength = effectiveFilledKVCacheLength;

	if (
		effectiveFilledKVCacheLength === 0 &&
		Array.isArray(workingConversation.config?.system_prefix_token_ids)
	) {
		promptLength += workingConversation.config.system_prefix_token_ids.length;
	}

	promptLength += countPromptTokens(pipeline.tokenizer, prompts);

	return {
		promptLength,
		maxContextTokens:
			typeof pipeline.contextWindowSize === "number" &&
			pipeline.contextWindowSize > 0
				? pipeline.contextWindowSize
				: undefined,
	};
}

/**
 * Load a WebLLM model
 * @param {string} modelId
 * @param {Function} [notifyProgress]
 * @returns {Promise<any>} - The WebLLM engine with model loaded
 */
async function loadWebLLMModel(modelId, notifyProgress) {
	await ensureWebLLM();

	// Validate against prebuilt config if present
	const modelEntry = (prebuiltAppConfig?.model_list || []).find((m) => {
		const id = m.model_id || m.model || m.name;
		return id === modelId;
	});

	if (!modelEntry && prebuiltAppConfig?.model_list?.length) {
		throw new Error(`Model ${modelId} not found in WebLLM prebuilt config`);
	}

	let stallTimer = null;
	let rejectStalledLoad = null;

	const clearStallTimer = () => {
		if (stallTimer !== null) {
			clearTimeout(stallTimer);
			stallTimer = null;
		}
	};

	const resetStallTimer = (engine) => {
		clearStallTimer();
		stallTimer = setTimeout(() => {
			const message =
				`WebLLM did not report model load progress for ${Math.round(
					MODEL_LOAD_STALL_TIMEOUT_MS / 1000,
				)} seconds. The browser may have blocked the download or WebGPU initialization.`;
			try {
				engine?.reloadController?.abort?.();
			} catch {}
			rejectStalledLoad?.(new Error(message));
		}, MODEL_LOAD_STALL_TIMEOUT_MS);
	};

	currentProgressCallback = (info) => {
		if (notifyProgress) {
			notifyProgress(info);
		}
	};

	const engine = new WebLLMEngine({
		appConfig: prebuiltAppConfig,
		initProgressCallback: (progressData) => {
			const { progress, text } = progressData || {};
			if (currentProgressCallback) {
				const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
				currentProgressCallback({ loaded: progress, total: 1, percent, text });
			}
			resetStallTimer(engine);
		},
	});

	if (typeof engine.reload !== "function") {
		throw new Error("MLCEngine.reload is not available");
	}

	try {
		currentProgressCallback({
			loaded: 0,
			total: 1,
			percent: 1,
			text: `Starting WebLLM load for ${modelId}`,
		});
		resetStallTimer(engine);

		await Promise.race([
			engine.reload(modelId),
			new Promise((_, reject) => {
				rejectStalledLoad = reject;
			}),
		]);
	} catch (error) {
		try {
			await engine.unload?.();
		} catch {}
		throw error;
	} finally {
		clearStallTimer();
		currentProgressCallback = null;
		rejectStalledLoad = null;
	}

	return engine;
}

/**
 * Unload WebLLM engine
 * @param {any} engine
 */
async function unloadWebLLMModel(engine) {
	try {
		if (engine && typeof engine.unload === "function") {
			await engine.unload();
		}
	} catch (e) {
		console.warn("[webllm-runner] unload error:", e?.message || e);
	}
}

// Model lifecycle manager - handles caching and auto-unload after 5 min idle
const webllmManager = new ModelLifecycleManager({
	name: "webllm-runner",
	loadFn: loadWebLLMModel,
	unloadFn: unloadWebLLMModel,
});

window.addEventListener("message", async (event) => {
	const src = event.source;
	const origin = event.origin;
	const { messageId, type, payload } = event.data || {};

	try {
		switch (type) {
			case "abort": {
				const operation = activeOperations.get(messageId);
				if (operation && operation.abortController) {
					operation.abortController.abort();
					activeOperations.delete(messageId);
				}
				return; // Don't reply for abort messages
			}
			case "init": {
				await ensureWebLLM();
				reply(src, origin, messageId, "complete", {
					status: "initialized",
					mode: "webllm",
				});
				break;
			}
			case "models": {
				await ensureWebLLM();
				const list = prebuiltAppConfig?.model_list || [];
				const currentModelId = webllmManager.modelId;
				const models = await Promise.all(
					list.map(async (m) => {
						const id = m.model_id || m.model || m.name || "unknown";
						const downloaded = await isDownloaded(id);
						return {
							id,
							object: "model",
							created: Math.floor(Date.now() / 1000),
							owned_by: "webllm",
							permission: [],
							root: id,
							parent: null,
							loaded: id === currentModelId && webllmManager.isLoaded,
							downloaded,
						};
					}),
				);
				reply(src, origin, messageId, "complete", {
					object: "list",
					data: models,
				});
				break;
			}
			case "serve": {
				const { model } = payload || {};
				if (!model) throw new Error("Model name is required");

				let lastPercent = 0;
				const notifyProgress = (info) => {
					const { percent, text } = info || {};
					if (typeof percent === "number" && percent !== lastPercent) {
						lastPercent = percent;
						reply(src, origin, messageId, "progress", info);
					}
				};

				try {
					await webllmManager.load(model, notifyProgress);

					const modelInfo = {
						id: model,
						object: "model",
						created: Math.floor(Date.now() / 1000),
						owned_by: "webllm",
						permission: [],
						root: model,
						parent: null,
						loaded: true,
						downloaded: await isDownloaded(model),
					};
					loadedModelsCache.set(model, modelInfo);
					reply(src, origin, messageId, "complete", modelInfo);
				} catch (error) {
					console.error("[serve] load error:", error);
					reply(src, origin, messageId, "error", {
						error: {
							message: `Failed to load model: ${error?.message || String(error)}`,
							type: "ModelLoadError",
							code: null,
						},
					});
				}
				break;
			}
			case "chat/completions": {
				const { messages, model, stream = false, _memoryHint, ...requestBody } =
					payload || {};

				if (!messages) throw new Error("Messages are required");

				const targetModel = model || webllmManager.modelId;
				if (!targetModel) {
					throw new Error("No model specified and no model loaded. Call serve first.");
				}

				// Create abort controller for this operation
				const abortController = new AbortController();
				activeOperations.set(messageId, { abortController });

				try {
					await webllmManager.withModel(targetModel, async (engine) => {
						const { promptLength, maxContextTokens } = resolveWebLLMPromptBudget(
							engine,
							targetModel,
							messages,
							requestBody,
						);
						const memoryContextTokens = resolveMemoryContextTokens(_memoryHint);
						const maxTotalContextTokens =
							typeof maxContextTokens === "number" &&
							typeof memoryContextTokens === "number"
								? Math.min(maxContextTokens, memoryContextTokens)
								: typeof maxContextTokens === "number"
									? maxContextTokens
									: memoryContextTokens;
						const requestedMaxTokens =
							typeof requestBody.max_tokens === "number" &&
							Number.isFinite(requestBody.max_tokens)
								? requestBody.max_tokens
								: typeof maxTotalContextTokens === "number"
									? Math.max(0, maxTotalContextTokens - promptLength)
									: undefined;
						const effectiveMaxTokens =
							typeof maxTotalContextTokens === "number" &&
							typeof requestedMaxTokens === "number"
								? Math.min(
										requestedMaxTokens,
										Math.max(0, maxTotalContextTokens - promptLength),
									)
								: requestedMaxTokens;

						if (
							typeof requestBody.max_tokens !== "number" &&
							typeof effectiveMaxTokens === "number"
						) {
							console.log("[webllm-runner] auto max_tokens", {
								auto: true,
								max_tokens: effectiveMaxTokens,
								promptLength,
								maxContextTokens,
								memoryContextTokens,
								availableGB: _memoryHint?.availableGB,
							});
						}

						if (
							typeof requestedMaxTokens === "number" &&
							typeof effectiveMaxTokens === "number" &&
							effectiveMaxTokens < requestedMaxTokens
						) {
							console.log("[webllm-runner] clamped max_tokens", {
								requested: requestedMaxTokens,
								effective: effectiveMaxTokens,
								promptLength,
								maxContextTokens,
								memoryContextTokens,
								availableGB: _memoryHint?.availableGB,
							});
						}

						if (
							typeof maxTotalContextTokens === "number" &&
							maxTotalContextTokens - promptLength <= 0
						) {
							throw new Error(
								typeof memoryContextTokens === "number" &&
								(typeof maxContextTokens !== "number" ||
									memoryContextTokens <= maxContextTokens)
									? `Prompt is too long for available device memory (promptLength=${promptLength}, memoryContextTokens=${memoryContextTokens}, availableGB=${_memoryHint?.availableGB ?? "unknown"})`
									: `Prompt is too long for the model context window (promptLength=${promptLength}, maxContextTokens=${maxContextTokens})`,
							);
						}

						const requestOptions = {
							...requestBody,
							messages,
							model: targetModel,
							signal: abortController.signal,
							...(typeof effectiveMaxTokens === "number"
								? { max_tokens: effectiveMaxTokens }
								: {}),
						};

						if (stream) {
							const completionStream = await engine.chat.completions.create({
								...requestOptions,
								stream: true,
							});
							let pendingChunk = null;
							for await (const chunk of completionStream) {
								if (abortController.signal.aborted) {
									throw new Error("Operation aborted");
								}

								if (pendingChunk) {
									reply(src, origin, messageId, "chunk", pendingChunk);
								}

								pendingChunk = chunk;
							}

							reply(
								src,
								origin,
								messageId,
								"end",
								pendingChunk || {
									id: `chatcmpl-${generateId()}`,
									object: "chat.completion.chunk",
									created: Math.floor(Date.now() / 1000),
									model: targetModel,
									choices: [
										{
											index: 0,
											delta: {},
											finish_reason: "stop",
										},
									],
								},
							);
						} else {
							const completion = await engine.chat.completions.create({
								...requestOptions,
								stream: false,
							});
							reply(src, origin, messageId, "complete", completion);
						}
					});
				} catch (error) {
					console.error("WebLLM error:", error);
					throw error;
				} finally {
					activeOperations.delete(messageId);
				}
				break;
			}
			case "unload": {
				const { model } = payload || {};
				const currentModel = webllmManager.modelId;

				if (model && model !== currentModel) {
					throw new Error(`Model ${model} is not loaded`);
				}

				await webllmManager.unload();

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

				// If this model is currently loaded, unload it first
				if (webllmManager.modelId === model) {
					await webllmManager.unload();
				}

				if (
					!WebLLMMod ||
					typeof WebLLMMod.deleteModelAllInfoInCache !== "function"
				) {
					throw new Error("WebLLM cache deletion API is unavailable");
				}

				await WebLLMMod.deleteModelAllInfoInCache(model, prebuiltAppConfig);

				loadedModelsCache.delete(model);
				reply(src, origin, messageId, "complete", { status: "deleted", model });
				break;
			}
			default:
				throw new Error(`Unknown message type: ${type}`);
		}
	} catch (err) {
		console.error("WebLLM error:", err);
		reply(src, origin, messageId, "error", {
			error: {
				message: (err && err.message) || "Unknown error",
				type: "invalid_request_error",
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
sendReady("webllm", endpoints);
