import {
	pipeline,
	env,
	type PretrainedModelOptions,
	type FeatureExtractionPipeline,
} from "@huggingface/transformers";
import type { BaseEmbedding } from "../interfaces/base-embedding";
import { logError, logInfo } from "@/utils/logger";
import { isWebGPUSupported } from "@/utils/webgpu";
import { platform } from "@/platform/current";

type ModelOptions = PretrainedModelOptions;
type FeatureExtractionOptions = NonNullable<
	Parameters<FeatureExtractionPipeline["_call"]>[1]
>;

export interface LocalEmbeddingOptions {
	modelName?: string;
	batchSize?: number;
	stripNewLines?: boolean;
	pretrainedOptions?: ModelOptions;
	pipelineOptions?: FeatureExtractionOptions;
}

export class LocalEmbedding implements BaseEmbedding {
	name: string;
	dimensions: number = 768; // Will be set based on model

	private localPipe: FeatureExtractionPipeline | undefined;
	private ready = false;
	private loading = false;
	private usingWebGPU = false;

	// Configuration
	private readonly batchSize: number;
	private readonly stripNewLines: boolean;
	private readonly pretrainedOptions: ModelOptions;
	private readonly pipelineOptions: FeatureExtractionOptions;

	constructor(options: LocalEmbeddingOptions = {}) {
		this.name = options.modelName || "nomic-ai/nomic-embed-text-v1.5";
		this.batchSize = options.batchSize || 32;
		this.stripNewLines = options.stripNewLines ?? true;

		// Detect WebGPU support and configure accordingly
		const hasWebGPU = isWebGPUSupported();
		this.usingWebGPU = hasWebGPU;

		// Configure device and dtype based on WebGPU availability
		this.pretrainedOptions = {
			// WebGPU: Use fp32 for maximum accuracy (12.86x faster than WASM)
			// WASM: Use fp32 as fallback
			dtype: hasWebGPU ? "fp32" : "fp32",
			device: hasWebGPU ? "webgpu" : "wasm",
			...options.pretrainedOptions, // Allow user override
		};

		this.pipelineOptions = {
			pooling: "mean",
			normalize: true,
			...options.pipelineOptions,
		};
	}

	async initialize(): Promise<void> {
		if (this.ready) return;
		if (this.loading) {
			// Wait for current loading to complete
			while (this.loading) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			return;
		}

		this.loading = true;

		try {
			const backendName = this.usingWebGPU ? "WebGPU" : "WASM";
			const speedNote = this.usingWebGPU
				? " (12.86x faster than WASM)"
				: " (fallback mode)";
			logInfo(
				`🤗 Loading local embedding model: ${this.name} using ${backendName}${speedNote}...`,
			);

			// Route ONNX Runtime assets to local, MV3-safe URLs
			const base = `${platform.assets
				.url("vendors/transformers/runtime")
				.slice(0, -"runtime".length)}`;

			if (env?.backends?.onnx?.wasm) {
				env.backends.onnx.wasm.wasmPaths = base;
				env.backends.onnx.wasm.proxy = false;
			}

			// Initialize the embedding pipeline with WebGPU or WASM
			this.localPipe = await pipeline(
				"feature-extraction",
				this.name,
				this.pretrainedOptions,
			);

			// Get dimensions from model
			if (this.localPipe) {
				const testResult = await this.localPipe(["test"], this.pipelineOptions);
				const testList: number[][] =
					typeof testResult.tolist === "function"
						? testResult.tolist()
						: (testResult as unknown as number[][]);
				this.dimensions = testList[0].length;
			}

			this.ready = true;
			logInfo(
				`✅ Local embedding model ${this.name} loaded successfully using ${backendName} (${this.dimensions} dimensions)`,
			);
		} catch (error) {
			logError(`❌ Failed to load local embedding model ${this.name}:`, error);
			throw error;
		} finally {
			this.loading = false;
		}
	}

	async textToVector(text: string): Promise<number[]> {
		if (!this.ready) {
			await this.initialize();
		}

		if (!this.localPipe) {
			throw new Error("Embedding pipeline not available");
		}

		try {
			const processedText = this.stripNewLines
				? text.replace(/\n/g, " ")
				: text;
			const embeddings = await this.localPipe(
				[processedText],
				this.pipelineOptions,
			);
			const list: number[][] =
				typeof embeddings.tolist === "function"
					? embeddings.tolist()
					: (embeddings as unknown as number[][]);
			return list[0];
		} catch (error) {
			logError(
				`Error generating embedding for text: ${text.substring(0, 100)}...`,
				error,
			);
			throw error;
		}
	}

	async textsToVectors(texts: string[]): Promise<number[][]> {
		if (!this.ready) {
			await this.initialize();
		}

		if (!this.localPipe) {
			throw new Error("Embedding pipeline not available");
		}

		try {
			const processedTexts = this.stripNewLines
				? texts.map((text) => text.replace(/\n/g, " "))
				: texts;

			// Process in batches
			const batches = this.chunkArray(processedTexts, this.batchSize);
			const results: number[][] = [];

			for (const batch of batches) {
				const embeddings = await this.localPipe(batch, this.pipelineOptions);
				const list: number[][] =
					typeof embeddings.tolist === "function"
						? embeddings.tolist()
						: (embeddings as unknown as number[][]);
				results.push(...list);
			}

			return results;
		} catch (error) {
			logError("Error generating embeddings for multiple texts:", error);
			throw error;
		}
	}

	isReady(): boolean {
		return this.ready;
	}

	getInfo() {
		return {
			name: this.name,
			dimensions: this.dimensions,
			type: "local" as const,
			backend: this.usingWebGPU ? "webgpu" : "wasm",
			accelerated: this.usingWebGPU,
		};
	}

	// Helper method to chunk array into batches
	private chunkArray<T>(array: T[], size: number): T[][] {
		const chunks: T[][] = [];
		for (let i = 0; i < array.length; i += size) {
			chunks.push(array.slice(i, i + size));
		}
		return chunks;
	}
}
