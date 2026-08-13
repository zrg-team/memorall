import { ensureTransformerRunnerCatalog } from "./catalog.js";
import { transformerContext } from "./context.js";

export async function ensureTransformers() {
	await ensureTransformerRunnerCatalog();
	if (transformerContext.transformers) return transformerContext;

	const transformers = await import("../../libs/transformers.js");
	transformerContext.transformers = transformers;
	transformerContext.AutoTokenizer = transformers.AutoTokenizer;
	transformerContext.AutoModelForCausalLM = transformers.AutoModelForCausalLM;
	transformerContext.AutoModelForImageTextToText =
		transformers.AutoModelForImageTextToText;
	transformerContext.AutoModelForVision2Seq = transformers.AutoModelForVision2Seq;
	transformerContext.AutoModelForSeq2SeqLM = transformers.AutoModelForSeq2SeqLM;
	transformerContext.AutoProcessor = transformers.AutoProcessor;
	transformerContext.Gemma4ForConditionalGeneration =
		transformers.Gemma4ForConditionalGeneration;
	transformerContext.Florence2ForConditionalGeneration =
		transformers.Florence2ForConditionalGeneration;
	transformerContext.ModelRegistry = transformers.ModelRegistry;
	transformerContext.pipelineFactory = transformers.pipeline;
	transformerContext.TextStreamer = transformers.TextStreamer;
	transformerContext.loadImage = transformers.load_image;

	if (
		!transformerContext.AutoTokenizer ||
		!transformerContext.AutoModelForCausalLM ||
		!transformerContext.pipelineFactory ||
		!transformerContext.TextStreamer
	) {
		throw new Error("Failed to load @huggingface/transformers");
	}

	if (typeof navigator !== "undefined" && navigator.gpu) {
		try {
			const adapter = await navigator.gpu.requestAdapter({
				powerPreference: "high-performance",
			});
			if (adapter) {
				transformerContext.webgpuCapabilities = {
					available: true,
					supportsF16: Boolean(adapter.features?.has?.("shader-f16")),
					features: Array.from(adapter.features || []),
					maxBufferSize: Number(adapter.limits?.maxBufferSize ?? 0),
					maxStorageBufferBindingSize: Number(
						adapter.limits?.maxStorageBufferBindingSize ?? 0,
					),
				};
				console.log("[transformer-runner] WebGPU adapter obtained:", {
					features: transformerContext.webgpuCapabilities.features,
					limits: adapter.limits,
					capabilities: transformerContext.webgpuCapabilities,
				});
			}
		} catch (err) {
			console.warn("[transformer-runner] could not get WebGPU adapter:", err);
		}
	}

	if (transformers.env) {
		transformers.env.useBrowserCache = true;
		transformers.env.allowLocalModels = false;

		if (transformers.env.backends?.onnx?.wasm) {
			const wasmPath =
				typeof chrome !== "undefined" && chrome.runtime?.getURL
					? chrome.runtime.getURL("vendors/transformers/")
					: new URL(
							"../../../vendors/transformers/",
							import.meta.url,
						).href;
			transformers.env.backends.onnx.wasm.wasmPaths = wasmPath;
			transformers.env.backends.onnx.wasm.wasmBinary = null;

			console.log("ONNX Runtime WASM path configured:", wasmPath);
		}

		console.log("[transformer-runner] cache and env configured", {
			useBrowserCache: transformers.env.useBrowserCache,
			allowLocalModels: transformers.env.allowLocalModels,
		});
	}

	return transformerContext;
}
