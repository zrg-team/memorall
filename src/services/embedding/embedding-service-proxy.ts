import { logInfo, logWarn } from "@/utils/logger";
import { backgroundJob } from "@/services/background-jobs/background-job";
import type {
	BaseEmbedding,
	OpenAIEmbeddingConfig,
} from "./interfaces/base-embedding";
import type { IEmbeddingService } from "./interfaces/embedding-service.interface";
import { OpenAIEmbedding } from "./implementations/openai-embedding";
import { EmbeddingProxy } from "./implementations/embedding-proxy";
import { EmbeddingServiceCore } from "./embedding-service-core";

export class EmbeddingServiceProxy
	extends EmbeddingServiceCore
	implements IEmbeddingService
{
	async initialize(): Promise<void> {
		logInfo(
			"🔤 Embedding service initialized in UI mode - heavy operations will use background jobs",
		);
		await super.initialize();
		await this.ensureDefaultEmbedding();
	}

	// Type-safe embedding creation - delegates heavy operations to background jobs
	async create(
		name: string,
		embeddingType: string,
		config: any,
	): Promise<BaseEmbedding> {
		// For lightweight services, create locally
		if (embeddingType === "openai") {
			const openaiConfig = config as OpenAIEmbeddingConfig;
			const embedding = new OpenAIEmbedding(
				openaiConfig.modelName,
				openaiConfig.apiKey,
				openaiConfig.baseUrl,
			);
			await embedding.initialize();
			this.embeddings.set(name, embedding);
			return embedding;
		}

		// For heavy services (local, worker), delegate to background jobs
		try {
			const executeResult = await backgroundJob.execute(
				"create-embedding",
				{
					name,
					embeddingType,
					config,
				},
				{ stream: false },
			);

			if ("promise" in executeResult) {
				const result = await executeResult.promise;
				if (result.status === "completed" && result.result) {
					// Create a proxy object that represents the embedding created in background
					const proxyEmbedding = new EmbeddingProxy(name, embeddingType);
					this.embeddings.set(name, proxyEmbedding);
					return proxyEmbedding;
				}
				throw new Error(result.error || "Failed to create embedding");
			} else {
				throw new Error("Expected promise result from non-streaming execute");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async get(name: string): Promise<BaseEmbedding | null | undefined> {
		let embedding = this.embeddings.get(name);
		if (embedding) {
			return embedding;
		}

		// Try to ensure default embedding if requested
		if (name === this.defaultName && !this.defaultInitialized) {
			await this.ensureDefaultEmbedding();
			embedding = this.embeddings.get(name);
		}

		return embedding || null;
	}

	// Heavy operations delegated to background jobs
	async textToVector(text: string): Promise<number[]> {
		try {
			const executeResult = await backgroundJob.execute(
				"text-to-vector",
				{ text },
				{ stream: false },
			);
			if ("promise" in executeResult) {
				const result = await executeResult.promise;
				if (result.status === "completed" && result.result) {
					return result.result.vector;
				}
				throw new Error(result.error || "Failed to convert text to vector");
			} else {
				throw new Error("Expected promise result from non-streaming execute");
			}
		} catch (error) {
			logWarn(
				"Failed to get vector via background job, falling back to local:",
				String(error),
			);
			return super.textToVector(text);
		}
	}

	async textsToVectors(texts: string[]): Promise<number[][]> {
		try {
			const executeResult = await backgroundJob.execute(
				"texts-to-vectors",
				{ texts },
				{ stream: false },
			);
			if ("promise" in executeResult) {
				const result = await executeResult.promise;
				if (result.status === "completed" && result.result) {
					return result.result.vectors;
				}
				throw new Error(result.error || "Failed to convert texts to vectors");
			} else {
				throw new Error("Expected promise result from non-streaming execute");
			}
		} catch (error) {
			logWarn(
				"Failed to get vectors via background job, falling back to local:",
				String(error),
			);
			return super.textsToVectors(texts);
		}
	}

	async textToVectorFor(
		embeddingName: string,
		text: string,
	): Promise<number[]> {
		// For lightweight API services, try local first
		const embedding = await this.get(embeddingName);
		if (embedding) {
			try {
				return await embedding.textToVector(text);
			} catch (error) {
				logWarn(`Failed to get vector from ${embeddingName}:`, String(error));
			}
		}

		// Delegate to background job if local service not available
		try {
			const executeResult = await backgroundJob.execute(
				"text-to-vector",
				{
					text,
					embeddingName,
				},
				{ stream: false },
			);
			if ("promise" in executeResult) {
				const result = await executeResult.promise;
				if (result.status === "completed" && result.result) {
					return result.result.vector;
				}
				throw new Error(result.error || "Failed to convert text to vector");
			} else {
				throw new Error("Expected promise result from non-streaming execute");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	async textsToVectorsFor(
		embeddingName: string,
		texts: string[],
	): Promise<number[][]> {
		// For lightweight API services, try local first
		const embedding = await this.get(embeddingName);
		if (embedding) {
			try {
				return await embedding.textsToVectors(texts);
			} catch (error) {
				logWarn(`Failed to get vectors from ${embeddingName}:`, String(error));
			}
		}

		// Delegate to background job if local service not available
		try {
			const executeResult = await backgroundJob.execute(
				"texts-to-vectors",
				{
					texts,
					embeddingName,
				},
				{ stream: false },
			);
			if ("promise" in executeResult) {
				const result = await executeResult.promise;
				if (result.status === "completed" && result.result) {
					return result.result.vectors;
				}
				throw new Error(result.error || "Failed to convert texts to vectors");
			} else {
				throw new Error("Expected promise result from non-streaming execute");
			}
		} catch (error) {
			throw new Error(`Background job failed: ${error}`);
		}
	}

	protected async createDefaultEmbedding(): Promise<void> {
		// Ensure the background embedding service is initialized and has a
		// default embedding we can proxy to from the UI process.
		const ensureExecuteResult = await backgroundJob.execute(
			"initialize-embedding-service",
			{},
			{ stream: false },
		);

		if (!("promise" in ensureExecuteResult)) {
			throw new Error("Expected promise result from non-streaming execute");
		}
		const ensureBackgroundReady = await ensureExecuteResult.promise;

		if (
			ensureBackgroundReady.status !== "completed" ||
			!ensureBackgroundReady.result?.ready
		) {
			throw new Error(
				ensureBackgroundReady.error || "Background embedding service not ready",
			);
		}

		// Try to reuse the default embedding that the background service manages.
		const existingExecuteResult = await backgroundJob.execute(
			"get-embedding",
			{
				name: this.defaultName,
			},
			{ stream: false },
		);

		if (!("promise" in existingExecuteResult)) {
			throw new Error("Expected promise result from non-streaming execute");
		}
		const existingEmbedding = await existingExecuteResult.promise;

		let embeddingType: string | undefined;
		if (
			existingEmbedding.status === "completed" &&
			existingEmbedding.result?.embeddingInfo?.exists
		) {
			embeddingType = existingEmbedding.result.embeddingInfo.type;
		} else {
			// No default embedding yet – ask background to create a worker-backed one.
			const createExecuteResult = await backgroundJob.execute(
				"create-embedding",
				{
					name: this.defaultName,
					embeddingType: "worker",
					config: { type: "worker" },
				},
				{ stream: false },
			);

			if (!("promise" in createExecuteResult)) {
				throw new Error("Expected promise result from non-streaming execute");
			}
			const createResult = await createExecuteResult.promise;

			if (createResult.status !== "completed") {
				throw new Error(
					createResult.error || "Failed to create default embedding",
				);
			}
			embeddingType = createResult.result?.embeddingInfo?.type || "worker";
		}

		const proxyEmbedding = new EmbeddingProxy(
			this.defaultName,
			embeddingType || "worker",
		);
		this.embeddings.set(this.defaultName, proxyEmbedding);
		logInfo(
			`🔤 UI mode: Default embedding proxied as ${embeddingType || "worker"}`,
		);
	}
}
