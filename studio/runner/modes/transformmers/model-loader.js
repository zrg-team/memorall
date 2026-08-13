import { withGPULock } from "../../utils/gpu-lock.js";
import {
	getModelRuntimeConfig,
	getUnsupportedBrowserModelMessage,
} from "./catalog.js";
import {
	dtypeSpecLabel,
	isLoadRetryable,
	recordLoadableDtype,
	resolveDtypeChainForDevice,
} from "./dtype.js";
import { detectNativeToolSupport, detectVisionSupport } from "./capabilities.js";
import { getTransformersContext, getWebgpuCapabilities } from "./context.js";
import { createProgressCallback } from "./progress.js";
import { ensureTransformers } from "./transformers-env.js";

async function loadWithExecutionFallback({
	modelId,
	config,
	preferredDevice,
	kind,
	loadAttempt,
	onDtypeChange,
}) {
	const { transformers } = getTransformersContext();
	const devicesToTry =
		preferredDevice === "webgpu" ? ["webgpu", "wasm"] : ["wasm"];
	const threadsToTry = [4, 1];
	let lastError = null;

	for (const tryDevice of devicesToTry) {
		const dtypesToTry = await resolveDtypeChainForDevice(
			modelId,
			tryDevice,
			config,
		);

		if (dtypesToTry.length === 0) {
			console.log(
				`[transformer-runner] skipping ${tryDevice} for ${kind}; no compatible dtype chain`,
			);
			continue;
		}

		const attemptedDtypes = new Set();
		for (const tryDtype of dtypesToTry) {
			const dtypeLabel = dtypeSpecLabel(tryDtype);
			if (attemptedDtypes.has(dtypeLabel)) continue;
			attemptedDtypes.add(dtypeLabel);

			for (const numThreads of threadsToTry) {
				try {
					if (transformers.env?.backends?.onnx?.wasm) {
						transformers.env.backends.onnx.wasm.numThreads = numThreads;
					}

					onDtypeChange?.(tryDtype);
					console.log(
						`[transformer-runner] loading ${kind} model with dtype: ${dtypeLabel}, device: ${tryDevice}, threads: ${numThreads}`,
					);

					const loaded =
						tryDevice === "webgpu"
							? await withGPULock(() =>
									loadAttempt({
										device: tryDevice,
										dtype: tryDtype,
										numThreads,
									}),
								)
							: await loadAttempt({
									device: tryDevice,
									dtype: tryDtype,
									numThreads,
								});

					console.log(
						`[transformer-runner] ${kind} model loaded successfully with dtype: ${dtypeLabel}, device: ${tryDevice}, threads: ${numThreads}`,
					);

					recordLoadableDtype(modelId, tryDtype);

					return { ...loaded, dtype: tryDtype, device: tryDevice, numThreads };
				} catch (err) {
					lastError = err;
					const errorMsg = err instanceof Error ? err.message : String(err);
					console.warn(
						`[transformer-runner] failed to load ${kind} model ${modelId} with dtype ${dtypeLabel}, device ${tryDevice}, threads ${numThreads}: ${errorMsg}`,
					);

					if (numThreads === 4 && threadsToTry.length > 1) {
						console.log("[transformer-runner] falling back to single-thread...");
						continue;
					}

					if (!isLoadRetryable(err)) {
						throw err;
					}

					console.log(
						`[transformer-runner] trying next dtype/device fallback after ${dtypeLabel} failure...`,
					);
					break;
				}
			}
		}

		if (tryDevice === "webgpu" && devicesToTry.length > 1) {
			console.log("[transformer-runner] falling back to WASM...");
		}
	}

	throw lastError ?? new Error(`Failed to load model ${modelId}`);
}

async function loadCausalModelBundle(modelId, notifyProgress, config, preferredDevice) {
	const { AutoTokenizer, AutoModelForCausalLM } = getTransformersContext();
	let currentDtype = config.dtype;
	const progressCallback = createProgressCallback(
		notifyProgress,
		() => currentDtype,
	);

	console.log("[transformer-runner] loading tokenizer for", modelId);
	let tokenizer;
	try {
		tokenizer = await AutoTokenizer.from_pretrained(modelId, {
			progress_callback: progressCallback,
		});
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : String(error);
		if (errorMessage.includes("tokenizer_class")) {
			throw new Error(
				`Failed to load tokenizer metadata for ${modelId}. This model is not currently compatible with the bundled transformers.js runtime in the browser.`,
			);
		}
		throw error;
	}
	console.log("[transformer-runner] tokenizer loaded successfully");

	try {
		const { model, dtype, device } = await loadWithExecutionFallback({
			modelId,
			config,
			preferredDevice,
			kind: "causal",
			onDtypeChange: (dtypeSpec) => {
				currentDtype = dtypeSpec;
			},
			loadAttempt: async ({ device, dtype }) => ({
				model: await AutoModelForCausalLM.from_pretrained(modelId, {
					dtype,
					device,
					progress_callback: progressCallback,
				}),
			}),
		});

		const bundle = {
			runtime: "causal_lm",
			model,
			tokenizer,
			dtype,
			device,
			postprocess: config.postprocess ?? "none",
			defaultMaxNewTokens: config.defaultMaxNewTokens,
		};

		return {
			...bundle,
			supportsNativeTools: detectNativeToolSupport(tokenizer),
			supportsVision: detectVisionSupport(bundle),
		};
	} catch (error) {
		try {
			tokenizer.dispose?.();
		} catch {}
		throw error;
	}
}

async function loadPipelineModelBundle(modelId, notifyProgress, config, preferredDevice) {
	const { pipelineFactory } = getTransformersContext();
	let currentDtype = config.dtype;
	const progressCallback = createProgressCallback(
		notifyProgress,
		() => currentDtype,
	);

	const { generator, dtype, device } = await loadWithExecutionFallback({
		modelId,
		config,
		preferredDevice,
		kind: "pipeline",
		onDtypeChange: (dtypeSpec) => {
			currentDtype = dtypeSpec;
		},
		loadAttempt: async ({ device, dtype }) => ({
			generator: await pipelineFactory("text-generation", modelId, {
				dtype,
				device,
				progress_callback: progressCallback,
			}),
		}),
	});

	return {
		runtime: "text_generation_pipeline",
		generator,
		model: generator.model,
		tokenizer: generator.tokenizer,
		dtype,
		device,
		postprocess: config.postprocess ?? "none",
		defaultMaxNewTokens: config.defaultMaxNewTokens,
		supportsNativeTools: detectNativeToolSupport(generator.tokenizer),
		supportsVision: false,
	};
}

async function loadSeq2SeqModelBundle(modelId, notifyProgress, config, preferredDevice) {
	const { AutoTokenizer, AutoModelForSeq2SeqLM } = getTransformersContext();
	if (!AutoModelForSeq2SeqLM) {
		throw new Error(
			"Seq2Seq browser support is unavailable in the bundled transformers.js runtime.",
		);
	}

	let currentDtype = config.dtype;
	const progressCallback = createProgressCallback(
		notifyProgress,
		() => currentDtype,
	);

	const tokenizer = await AutoTokenizer.from_pretrained(modelId, {
		progress_callback: progressCallback,
	});

	try {
		const { model, dtype, device } = await loadWithExecutionFallback({
			modelId,
			config,
			preferredDevice,
			kind: "seq2seq_lm",
			onDtypeChange: (dtypeSpec) => {
				currentDtype = dtypeSpec;
			},
			loadAttempt: async ({ device, dtype }) => ({
				model: await AutoModelForSeq2SeqLM.from_pretrained(modelId, {
					dtype,
					device,
					progress_callback: progressCallback,
				}),
			}),
		});

		const bundle = {
			runtime: "seq2seq_lm",
			model,
			tokenizer,
			dtype,
			device,
			postprocess: config.postprocess ?? "none",
			defaultMaxNewTokens: config.defaultMaxNewTokens,
		};

		return {
			...bundle,
			supportsNativeTools: detectNativeToolSupport(tokenizer),
			supportsVision: false,
		};
	} catch (error) {
		try {
			tokenizer.dispose?.();
		} catch {}
		throw error;
	}
}

function getProcessorModelLoaders(runtime, config) {
	const {
		AutoModelForImageTextToText,
		AutoModelForVision2Seq,
		Gemma4ForConditionalGeneration,
		Florence2ForConditionalGeneration,
	} = getTransformersContext();
	const loaders = [];
	const addLoader = (name, modelClass) => {
		if (modelClass && !loaders.some((loader) => loader.name === name)) {
			loaders.push({ name, modelClass });
		}
	};

	if (runtime === "image_text_to_text") {
		addLoader("image_text_to_text", AutoModelForImageTextToText);
		addLoader("vision2seq", AutoModelForVision2Seq);
	} else if (runtime === "vision2seq") {
		addLoader("vision2seq", AutoModelForVision2Seq);
		addLoader("image_text_to_text", AutoModelForImageTextToText);
	}

	if (config.modelClassFallback === "gemma4") {
		addLoader("gemma4_fallback", Gemma4ForConditionalGeneration);
	} else if (config.modelClassFallback === "florence2") {
		addLoader("florence2_fallback", Florence2ForConditionalGeneration);
	}

	return loaders;
}

async function loadProcessorModelBundle(
	modelId,
	notifyProgress,
	config,
	preferredDevice,
) {
	const { AutoProcessor } = getTransformersContext();
	if (!AutoProcessor) {
		throw new Error(
			"Processor model support is unavailable in the bundled transformers.js runtime.",
		);
	}

	const modelLoaders = getProcessorModelLoaders(config.runtime, config);
	if (modelLoaders.length === 0) {
		throw new Error(`No processor model loader is available for ${config.runtime}.`);
	}

	let currentDtype = config.dtype;
	const progressCallback = createProgressCallback(notifyProgress, () => currentDtype);

	const processor = await AutoProcessor.from_pretrained(modelId, {
		progress_callback: progressCallback,
	});

	try {
		let loadedModel = null;
		let lastError = null;
		let loadedKind = config.runtime;

		for (const { name, modelClass } of modelLoaders) {
			try {
				loadedKind = name;
				loadedModel = await loadWithExecutionFallback({
					modelId,
					config,
					preferredDevice,
					kind: name,
					onDtypeChange: (dtypeSpec) => {
						currentDtype = dtypeSpec;
					},
					loadAttempt: async ({ device, dtype }) => ({
						model: await modelClass.from_pretrained(modelId, {
							dtype,
							device,
							progress_callback: progressCallback,
						}),
					}),
				});
				break;
			} catch (error) {
				lastError = error;
				console.warn(
					`[transformer-runner] processor model loader ${name} failed for ${modelId}:`,
					error,
				);
			}
		}

		if (!loadedModel) {
			throw lastError ?? new Error(`Failed to load processor model ${modelId}`);
		}

		const { model, dtype, device } = loadedModel;

		const bundle = {
			runtime: config.runtime,
			modelLoader: loadedKind,
			model,
			processor,
			tokenizer: processor.tokenizer,
			dtype,
			device,
			postprocess: config.postprocess ?? "none",
			processorMode: config.processorMode ?? "chat_template_images",
			defaultMaxNewTokens: config.defaultMaxNewTokens,
		};

		return {
			...bundle,
			supportsNativeTools: detectNativeToolSupport(processor.tokenizer),
			supportsVision: detectVisionSupport(bundle),
		};
	} catch (error) {
		try {
			processor.dispose?.();
		} catch {}
		throw error;
	}
}

export async function loadTransformerModel(modelId, notifyProgress) {
	await ensureTransformers();

	const unsupportedMessage = getUnsupportedBrowserModelMessage(modelId);
	if (unsupportedMessage) {
		throw new Error(unsupportedMessage);
	}

	const hasWebGPU = getWebgpuCapabilities().available;
	const preferredDevice = hasWebGPU ? "webgpu" : "wasm";
	const config = getModelRuntimeConfig(modelId);

	console.log("[transformer-runner] device selection", {
		hasWebGPU,
		initialDevice: preferredDevice,
		model: modelId,
		runtime: config.runtime,
		dtype: config.dtype,
	});

	if (config.runtime === "text_generation_pipeline") {
		return loadPipelineModelBundle(
			modelId,
			notifyProgress,
			config,
			preferredDevice,
		);
	}

	if (
		config.runtime === "image_text_to_text" ||
		config.runtime === "vision2seq"
	) {
		return loadProcessorModelBundle(
			modelId,
			notifyProgress,
			config,
			preferredDevice,
		);
	}

	if (config.runtime === "seq2seq_lm") {
		return loadSeq2SeqModelBundle(
			modelId,
			notifyProgress,
			config,
			preferredDevice,
		);
	}

	return loadCausalModelBundle(modelId, notifyProgress, config, preferredDevice);
}

export async function unloadTransformerModel(bundle) {
	if (bundle.generator) {
		try {
			bundle.generator.dispose?.();
		} catch (e) {
			console.warn("[transformer-runner] error disposing pipeline:", e);
		}
	}
	if (bundle.model) {
		try {
			bundle.model.dispose?.();
		} catch (e) {
			console.warn("[transformer-runner] error disposing model:", e);
		}
	}
	if (bundle.tokenizer) {
		try {
			bundle.tokenizer.dispose?.();
		} catch (e) {
			console.warn("[transformer-runner] error disposing tokenizer:", e);
		}
	}
	if (bundle.processor) {
		try {
			bundle.processor.dispose?.();
		} catch (e) {
			console.warn("[transformer-runner] error disposing processor:", e);
		}
	}
}
